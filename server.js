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

/* ======================== MIDDLEWARE ======================== */
app.use(cors({ origin: '*' }));
app.use(express.json());

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
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'No token' });

    const { data: user } = await supabase
      .from('User')
      .select('*')
      .eq('id', token)
      .single();

    if (!user) return res.status(401).json({ message: 'Invalid token' });

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

    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const newProduct = {
      id: Date.now().toString(),
      title,
      description,
      price: Number(price), // ✅ FIX
      currency: 'XAF',
      images: req.file ? `/uploads/${req.file.filename}` : null,
      user_id: req.user.id,
      location: location || null,
      published: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log("📦 INSERT:", newProduct);

    const { data, error } = await supabase
      .from('Product')
      .insert([newProduct])
      .select();

    if (error) {
      console.error("❌ SUPABASE ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ product: data[0] });

  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET PRODUCTS
app.get('/products', async (req, res) => {
  const { data, error } = await supabase
    .from('Product')
    .select('*')
    .eq('published', true)
    .order('createdAt', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ products: data });
});

// MY PRODUCTS
app.get('/products/my-listings', authenticateToken, async (req, res) => {
  const { data } = await supabase
    .from('Product')
    .select('*')
    .eq('user_id', req.user.id);

  res.json({ products: data });
});

/* ======================== FAVORITES ======================== */

// ADD FAVORITE
app.post('/products/favorite', authenticateToken, async (req, res) => {
  const { productId } = req.body;

  const { error } = await supabase
    .from('Favorite')
    .insert([{
      id: Date.now().toString(),
      userId: req.user.id,
      productId,
      createdAt: new Date().toISOString()
    }]);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// GET FAVORITES
app.get('/products/favorites', authenticateToken, async (req, res) => {
  const { data: favorites } = await supabase
    .from('Favorite')
    .select('productId')
    .eq('userId', req.user.id);

  if (!favorites || favorites.length === 0) {
    return res.json({ favorites: [] });
  }

  const ids = favorites.map(f => f.productId);

  const { data: products } = await supabase
    .from('Product')
    .select('*')
    .in('id', ids);

  res.json({ favorites: products });
});

/* ======================== MESSAGES ======================== */

// SEND MESSAGE
app.post('/messages', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text } = req.body;

    if (!receiverId || !text) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const { error } = await supabase
      .from('Message')
      .insert([{
        conversationId: Date.now().toString(), // ✅ FIX
        senderId: req.user.id,
        content: text,
        read: false,
        createdAt: new Date().toISOString()
      }]);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET MESSAGES
app.get('/messages', authenticateToken, async (req, res) => {
  const { data } = await supabase
    .from('Message')
    .select('*')
    .order('createdAt', { ascending: true });

  res.json(data);
});

/* ======================== AUTH ======================== */

app.post('/auth/register', async (req, res) => {
  const { email, password, fullName, location } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  const { data } = await supabase
    .from('User')
    .insert([{
      id: Date.now().toString(),
      email,
      password: hashed,
      fullName,
      location,
      role: 'user',
      createdAt: new Date().toISOString()
    }])
    .select();

  res.json({ user: data[0], token: data[0].id });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await supabase
    .from('User')
    .select('*')
    .eq('email', email)
    .single();

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

  res.json({ user, token: user.id });
});

/* ======================== PAYMENT ======================== */

app.post('/pay', authenticateToken, async (req, res) => {
  try {
    const { productId, phone, method } = req.body;

    console.log("💰 PAYMENT BODY:", req.body);

    // ✅ Only require productId
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Optional defaults (so frontend won't crash)
    const safePhone = phone || "000000000";
    const safeMethod = method || "default";

    console.log("Using:", {
      productId,
      phone: safePhone,
      method: safeMethod
    });

    await supabase
      .from('Product')
      .update({ published: true })
      .eq('id', productId);

    res.json({
      success: true,
      message: "Payment successful"
    });

  } catch (err) {
    console.error("❌ PAYMENT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ======================== START ======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
