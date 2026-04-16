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

/* ======================== PATH CONFIG ======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

/* ======================== MIDDLEWARE ======================== */
app.use(cors({ origin: '*' }));
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

/* ======================== AUTH ======================== */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token' });

  const token = authHeader.split(' ')[1];

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
}

/* ======================== PRODUCTS ======================== */

// CREATE PRODUCT
app.post('/products', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { title, description, price, location } = req.body;

    if (!title || !description || !price) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const newProduct = {
      id: Date.now().toString(),
      title,
      description,
      price: parseInt(price),
      currency: 'XAF',
      images: req.file ? `/uploads/${req.file.filename}` : null,
      user_id: req.user.id, // ✅ FIXED
      location: location || null, // ✅ FIXED
      published: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('Product')
      .insert([newProduct])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ product: data[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET PRODUCTS WITH USER JOIN
app.get('/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Product')
      .select(`
        *,
        User ( fullName, location )
      `)
      .eq('published', true)
      .order('createdAt', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ products: data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MY LISTINGS
app.get('/products/my-listings', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Product')
      .select('*')
      .eq('user_id', req.user.id) // ✅ FIXED
      .order('createdAt', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ products: data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================== FAVORITES ======================== */

app.post('/products/favorite', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;

    const { error } = await supabase
      .from('Favorite')
      .insert([{
        id: Date.now().toString(),
        user_id: req.user.id,
        product_id: productId,
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

/* ======================== MESSAGES ======================== */

// SEND MESSAGE
app.post('/messages', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text } = req.body;

    const { error } = await supabase
      .from('Message')
      .insert([{
        id: Date.now().toString(),
        senderId: req.user.id,
        receiverId,
        text,
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

// GET MESSAGES
app.get('/messages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('Message')
      .select('*')
      .or(`senderId.eq.${userId},receiverId.eq.${userId}`)
      .order('createdAt', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================== AUTH ======================== */

app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  try {
    const { email, password, fullName, phone, location } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now().toString(),
      email,
      password: hashedPassword,
      fullName,
      phone: phone || null,
      location: location || null,
      role: 'user',
      profileImage: req.file ? `/uploads/${req.file.filename}` : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('User')
      .insert([newUser])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ user: data[0], token: data[0].id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    res.json({ user, token: user.id });

  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

/* ======================== START ======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
