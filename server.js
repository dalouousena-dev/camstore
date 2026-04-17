import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* ======================== SUPABASE ======================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* ======================== CORS ======================== */
app.use(cors({
  origin: ['http://localhost:5173', 'https://computerarchi.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================== MULTER ======================== */
const upload = multer({ storage: multer.memoryStorage() });

/* ======================== AUTH ======================== */
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
  } catch {
    res.status(500).json({ error: 'Auth failed' });
  }
}

/* ======================== PRODUCTS ======================== */

// CREATE PRODUCT
// CREATE PRODUCT (FIXED ONLY THIS PART)
app.post('/products', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { title, description, price, location } = req.body;

    if (!title || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ✅ SAFE USER EXTRACTION
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let imageUrl = null;

    if (req.file) {
      const fileName = `${Date.now()}-${req.file.originalname}`;

      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype
        });

      if (uploadError) {
        return res.status(500).json({ error: uploadError.message });
      }

      const { data } = supabase.storage
        .from('products')
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    const newProduct = {
      id: Date.now().toString(),
      title,
      description,
      price: Number(price),
      currency: 'XAF',
      images: imageUrl,
      user_id: userId, // ✅ FIXED (SAFE)
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
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET PRODUCTS (FIXED HERE)
app.get('/products', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('Product')
      .select('*')
      .eq('published', true);

    if (error) return res.status(500).json({ error: error.message });

    const userIds = [...new Set(products.map(p => p.user_id))];

    const { data: users } = await supabase
      .from('User')
      .select('id, fullName, location, profileImage') // ✅ FIXED
      .in('id', userIds);

    const final = products.map(p => ({
      ...p,
      User: users?.find(u => String(u.id) === String(p.user_id)) || null
    }));

    res.json({ products: final });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

 /* ======================== FAVORITES ======================== */

// ADD TO FAVORITES
app.post('/products/favorite', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Missing productId' });
    }

    const userId = req.user.id;

    // ✅ prevent duplicates
    const { data: existing } = await supabase
      .from('Favorite')
      .select('*')
      .eq('userId', userId)
      .eq('productId', productId)
      .single();

    if (existing) {
      return res.json({ message: 'Already in favorites' });
    }

    const { data, error } = await supabase
      .from('Favorite')
      .insert([
        {
          id: Date.now().toString(),
          userId,
          productId
        }
      ]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET USER FAVORITES
app.get('/products/favorites', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1️⃣ Get favorites
    const { data: favorites, error } = await supabase
      .from('Favorite')
      .select('*')
      .eq('userId', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const productIds = favorites.map(f => f.productId).filter(Boolean);

    // 2️⃣ If no favorites
    if (!productIds.length) {
      return res.json({ products: [] });
    }

    // 3️⃣ Get products
    const { data: products, error: productError } = await supabase
      .from('Product')
      .select('*')
      .in('id', productIds);

    if (productError) {
      return res.status(500).json({ error: productError.message });
    }

    // 4️⃣ Get users (sellers)
    const userIds = [...new Set(products.map(p => p.user_id))];

    const { data: users, error: userError } = await supabase
      .from('User')
      .select('id, fullName, profileImage, location')
      .in('id', userIds);

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // 5️⃣ Merge product + user (🔥 MAIN FIX HERE)
    const final = products.map(p => {
      const user = users.find(u => String(u.id) === String(p.user_id));

      return {
        ...p,
        user: user || null // ✅ VERY IMPORTANT FIX
      };
    });

    // 6️⃣ Send response
    res.json({ products: final });

  } catch (err) {
    console.error("FAVORITES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ======================== AUTH ======================== */
// ✅ GET MY PRODUCTS (FIXED)
app.get('/products/my-listings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // ✅ use token

    const { data, error } = await supabase
      .from('Product')
      .select('*')
      .eq('user_id', userId); // ✅ correct column

    if (error) throw error;

    res.json({ products: data });

  } catch (err) {
    console.error("MY LISTINGS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch listings" });
  }
});


app.delete('/products/:id', authenticateToken, async (req, res) => {
  try {
    const productId = req.params.id;
    const userId = req.user.id;

    const { data: product } = await supabase
      .from('Product')
      .select('*')
      .eq('id', productId)
      .single();

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (product.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { error } = await supabase
      .from('Product')
      .delete()
      .eq('id', productId);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REMOVE FROM FAVORITES
app.delete('/products/favorite/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.productId;

    const { error } = await supabase
      .from('Favorite')
      .delete()
      .eq('userId', userId)
      .eq('productId', productId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/messages', authenticateToken, async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverId, productId, text } = req.body;

    if (!receiverId || !productId) {
      return res.status(400).json({ error: "Missing data" });
    }

    let { data: conversation } = await supabase
      .from('Conversation')
      .select('*')
      .eq('productId', productId)
      .eq('buyerId', senderId)
      .eq('sellerId', receiverId)
      .single();

    if (!conversation) {
     const { data: newConv, error } = await supabase
  .from('Conversation')
  .insert({
    id: Date.now().toString(), // ✅ ADD THIS LINE
    productId,
    buyerId: senderId,
    sellerId: receiverId
  })
  .select()
  .single();

      if (error) throw error;
      conversation = newConv;
    }

   const { error: msgError } = await supabase
  .from('Message')
  .insert({
    id: Date.now().toString(), // ✅ ADD THIS LINE
    conversationId: conversation.id,
    senderId,
    content: text,
    read: false
  });

    if (msgError) throw msgError;

    res.json({ success: true });

  } catch (err) {
    console.error("MESSAGE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ======================== PAYMENT ======================== */

app.post('/pay', authenticateToken, async (req, res) => {
  try {
    const { productId, phone, method } = req.body;

    if (!productId || !phone || !method) {
      return res.status(400).json({ error: 'Missing payment data' });
    }

    // ⚠️ SIMULATED PAYMENT (you can replace later with real API)
    console.log("Payment request:", {
      user: req.user.id,
      productId,
      phone,
      method
    });

    // OPTIONAL: mark product as paid / published
    await supabase
      .from('Product')
      .update({ published: true })
      .eq('id', productId);

    res.json({
      success: true,
      message: 'Payment successful (simulated)'
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// REGISTER (FIXED HERE)
app.post('/auth/register', upload.single('image'), async (req, res) => {
  try {
    // ✅ FIX: add phone + location
    const { email, password, fullName, phone, location } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    let profileImage = null;

    if (req.file) {
      const fileExt = req.file.originalname.split('.').pop();
      const fileName = `profile-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype
        });

      if (uploadError) {
        return res.status(500).json({ error: uploadError.message });
      }

      const { data } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      profileImage = data.publicUrl;
    }

    // ✅ FIX: insert phone + location
    const { data, error } = await supabase
      .from('User')
      .insert([{
        id: Date.now().toString(),
        email,
        password: hashed,
        fullName,
        phone: phone || null,        // ✅ ADDED
        location: location || null,  // ✅ ADDED
        profileImage
      }])
      .select();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ user: data[0], token: data[0].id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({ user, token: user.id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================== ROOT ======================== */

app.get('/', (req, res) => {
  res.json({ message: 'API running' });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
