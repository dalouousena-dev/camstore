import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* ======================== SUPABASE ======================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* ======================== PATH ======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

/* ======================== CORS ======================== */
app.use(cors({
  origin: ['http://localhost:5173', 'https://computerarchi.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================== MULTER ======================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({ storage });

/* ======================== AUTH MIDDLEWARE ======================== */
async function authenticateToken(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'No token' });

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('id', token)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = user;
    next();

  } catch (err) {
    res.status(500).json({ error: 'Auth failed' });
  }
}

/* ======================== PRODUCTS ======================== */

// CREATE PRODUCT
app.post('/products', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { title, description, price, location } = req.body;

    const safePrice = Number(price);

    if (!title || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newProduct = {
      id: Date.now().toString(),
      title,
      description,
      price: safePrice,
      currency: 'XAF',
      images: req.file ? `/uploads/${req.file.filename}` : null,
      user_id: req.user.id,
      location: location || null,
      published: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('Product')
      .insert([newProduct])
      .select();

    if (error) {
      console.error("PRODUCT ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ product: data[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET PRODUCTS WITH USER
// GET PRODUCTS WITH USER
app.get('/products', async (req, res) => {
  try {
    // STEP 1: GET PRODUCTS
    const { data: products, error } = await supabase
      .from('Product')
      .select('*')
      .eq('published', true)
      .order('createdAt', { ascending: false });

    if (error) {
      console.error("PRODUCT FETCH ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    // STEP 2: GET USERS MANUALLY (SAFE)
    const userIds = [...new Set(products.map(p => p.user_id))];

    const { data: users } = await supabase
      .from('User')
      .select('id, fullName, location')
      .in('id', userIds);

    // STEP 3: MERGE DATA
    const productsWithUser = products.map(product => ({
      ...product,
      User: users?.find(u => u.id === product.user_id) || null
    }));

    res.json({ products: productsWithUser });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ======================== FAVORITES ======================== */

app.post('/products/favorite', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;

    // CHECK IF ALREADY EXISTS
    const { data: existing } = await supabase
      .from('Favorite')
      .select('*')
      .eq('userId', req.user.id)
      .eq('productId', productId)
      .single();

    if (existing) {
      return res.json({ success: true, message: 'Already in favorites' });
    }

    const { error } = await supabase
      .from('Favorite')
      .insert([{
        id: Date.now().toString(),
        userId: req.user.id,
        productId: String(productId),
        createdAt: new Date().toISOString()
      }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products/favorites', authenticateToken, async (req, res) => {
  try {
    const { data: favorites, error: favError } = await supabase
      .from('Favorite')
      .select('productId')
      .eq('userId', req.user.id);

    if (favError) {
      return res.status(500).json({ error: favError.message });
    }

    const ids = (favorites || []).map(f => String(f.productId));

    if (ids.length === 0) {
      return res.json({ favorites: [] });
    }

    const { data: products, error } = await supabase
      .from('Product')
      .select('*')
      .in('id', ids);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // GET USERS
    const userIds = [...new Set(products.map(p => p.user_id))];

    const { data: users } = await supabase
      .from('User')
      .select('id, fullName, location')
      .in('id', userIds);

   const finalProducts = products.map(p => ({
  ...p,
  User: users?.find(u => String(u.id) === String(p.user_id)) || null
}));

    res.json({ favorites: finalProducts });

  } catch (err) {
    console.error("FAVORITES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/products/publish/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    const { data, error } = await supabase
      .from('Product')
      .update({ published: true })
      .eq('id', id)
      .select();

    if (error) {
      console.error("PUBLISH ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, product: data[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET CURRENT USER PRODUCTS (MY LISTINGS)
app.get('/products/my-listings', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Product')
      .select('*')
      .eq('user_id', req.user.id)
      .order('createdAt', { ascending: false });

    if (error) {
      console.error("MY LISTINGS ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ products: data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ======================== MESSAGES ======================== */

app.post('/messages', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, productId } = req.body;

    // ✅ CHECK REQUIRED FIELDS
    if (!receiverId || !text || !productId) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const conversationId = Date.now().toString();

    // CREATE CONVERSATION
    const { error: convError } = await supabase
      .from('Conversation')
      .insert([{
        id: conversationId,
        productId: productId, // ✅ FIXED HERE
        buyerId: req.user.id,
        sellerId: receiverId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]);

    if (convError) {
      return res.status(500).json({ error: convError.message });
    }

    // CREATE MESSAGE
    const { error } = await supabase
      .from('Message')
      .insert([{
        conversationId,
        senderId: req.user.id,
        content: text,
        read: false,
        createdAt: new Date().toISOString()
      }]);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, conversationId });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ======================== AUTH ======================== */
app.get('/messages', authenticateToken, async (req, res) => {
  try {
    const { user } = req.query;

    if (!user) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // GET CONVERSATIONS BETWEEN USERS
    const { data: conversations, error } = await supabase
      .from('Conversation')
      .select('*')
      .or(`buyerId.eq.${req.user.id},sellerId.eq.${req.user.id}`)
      .or(`buyerId.eq.${user},sellerId.eq.${user}`);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ conversations });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// REGISTER
app.post('/auth/register', upload.single('image'), async (req, res) => {
  try {
    const { email, password, fullName, location, phone } = req.body;

    // ✅ CHECK REQUIRED FIELDS
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now().toString(),
      email,
      password: hashed,
      fullName,
      location: location || null,
      phone: phone || null,
      profileImage: req.file ? `/uploads/${req.file.filename}` : null,
      role: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('User')
      .insert([newUser])
      .select();

    if (error) {
      console.error("❌ SUPABASE ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ user: data[0], token: data[0].id });

  } catch (err) {
    console.error("❌ REGISTER CRASH:", err); // 🔥 THIS WILL SHOW REAL ERROR
    res.status(500).json({ error: err.message });
  }
});
// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    res.json({ user, token: user.id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================== PAYMENT ======================== */

app.post('/pay', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    const { error } = await supabase
      .from('Product')
      .update({ published: true })
      .eq('id', productId);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================== ROOT ======================== */
app.get('/', (req, res) => {
  res.json({ message: 'API is running 🚀' });
});

/* ======================== START ======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
