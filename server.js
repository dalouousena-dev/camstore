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
app.post('/products', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { title, description, price, location } = req.body;
    if (!title || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
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

    if (error) return res.status(500).json({ error: error.message });

    res.json({ product: data[0] });

  } catch (err) {
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

/* ======================== AUTH ======================== */

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
