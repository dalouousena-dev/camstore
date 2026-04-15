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
app.post('/products', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const { title, description, price } = req.body;

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
      ownerId: req.user.id, // ✅ FIXED (NO MORE NULL)
      published: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log("NEW PRODUCT:", newProduct);

    const { data, error } = await supabase
      .from('Product')
      .insert([newProduct])
      .select();

    if (error) {
      console.error("SUPABASE ERROR FULL:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ product: data[0] });

  } catch (err) {
    console.error("PRODUCT CRASH:", err);
    res.status(500).json({ error: err.message });
  }
});

 app.get('/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Product')
      .select('*')
      .eq('published', true)
      .order('createdAt', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ products: data });

  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/products/publish/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Publishing product ID:", id);

    const { data, error } = await supabase
      .from('Product')
      .update({
        published: true,
        updatedAt: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error("SUPABASE ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(400).json({ error: "Product not found or not updated" }); // ✅ THIS WAS YOUR 400
    }

    res.json({ product: data[0] });

  } catch (err) {
    console.error("PUBLISH CRASH:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ======================== AUTH ROUTES ======================== */
app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  try {
    const { email, password, fullName, phone, location } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

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
      console.error("SUPABASE ERROR:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ user: data[0], token: data[0].id });

  } catch (err) {
    console.error("REGISTER CRASH:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/pay', async (req, res) => {
  try {
    console.log("PAY BODY:", req.body);

    const { productId, amount } = req.body;

    if (!productId || !amount) {
      return res.status(400).json({ error: "Missing payment data" });
    }

    // ✅ For now (fake payment logic)
    res.json({
      success: true,
      message: "Payment successful",
      transactionId: Date.now().toString()
    });

  } catch (err) {
    console.error("PAY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ======================== LOGIN ======================== */
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    res.json({ user, token: user.id });

  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

/* ======================== START ======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
