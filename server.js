import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* ========================
   SAFETY (PREVENT CRASHES)
======================== */
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

/* ========================
   FILE PATHS
======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

/* ========================
   CREATE UPLOAD FOLDER
======================== */
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

/* ========================
   MULTER CONFIG (SAFE)
======================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit (prevents crashes)
  }
});

/* ========================
   MIDDLEWARE
======================== */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(uploadsDir));

/* ========================
   MEMORY DB
======================== */
const db = {
  users: [],
  products: [],
  messages: [],
  favorites: []
};

/* ========================
   AUTH MIDDLEWARE
======================== */
function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    const user = db.users.find(u => u.id === token);

    if (!user) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err);
    return res.status(500).json({ message: 'Auth error' });
  }
}

/* ========================
   HEALTH CHECK
======================== */
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/* ========================
   REGISTER
======================== */
app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  try {
    console.log("REGISTER BODY:", req.body);
    console.log("FILE:", req.file);

    const { email, password, fullName, phone, location } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const exists = db.users.find(u => u.email === email);
    if (exists) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const user = {
      id: Date.now().toString(),
      email,
      password: await bcrypt.hash(password, 10),
      fullName,
      phone,
      location,
      profileImage: req.file ? `/uploads/${req.file.filename}` : null
    };

    db.users.push(user);

    return res.status(200).json({
      user,
      token: user.id
    });

  } catch (err) {
    console.error('REGISTER ERROR:', err);
    return res.status(500).json({ message: 'Registration failed' });
  }
});

/* ========================
   LOGIN
======================== */
app.post('/auth/login', async (req, res) => {
  try {
    console.log('LOGIN BODY:', req.body);

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const user = db.users.find(u => u.email === email);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.json({
      user,
      token: user.id
    });

  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ message: 'Login failed' });
  }
});

/* ========================
   VERIFY
======================== */
app.get('/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

/* ========================
   PROFILE UPDATE (MISSING BEFORE)
======================== */
app.put('/auth/profile', authenticateToken, upload.single('profileImage'), (req, res) => {
  try {
    const user = req.user;

    const { fullName, email, phone, location } = req.body;

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (location) user.location = location;

    if (req.file) {
      user.profileImage = `/uploads/${req.file.filename}`;
    }

    return res.json({
      success: true,
      user
    });

  } catch (err) {
    console.error("PROFILE UPDATE ERROR:", err);
    return res.status(500).json({ message: 'Profile update failed' });
  }
});

/* ========================
   PRODUCTS
======================== */
app.get('/products', authenticateToken, (req, res) => {
  res.json(db.products);
});

app.get('/products/my-listings', authenticateToken, (req, res) => {
  const myProducts = db.products.filter(p => p.userId === req.user.id);
  res.json({ products: myProducts });
});

app.post('/products', authenticateToken, (req, res) => {
  const product = {
    id: Date.now().toString(),
    userId: req.user.id,
    ...req.body
  };

  db.products.push(product);
  res.json(product);
});

/* ========================
   DELETE PRODUCT
======================== */
app.delete('/products/:id', authenticateToken, (req, res) => {
  const id = req.params.id;

  db.products = db.products.filter(p => p.id !== id);

  res.json({ success: true });
});

/* ========================
   MESSAGES
======================== */
app.get('/messages', authenticateToken, (req, res) => {
  res.json(db.messages);
});

app.post('/messages', authenticateToken, (req, res) => {
  const message = {
    id: Date.now().toString(),
    senderId: req.user.id,
    ...req.body
  };

  db.messages.push(message);
  res.json(message);
});

/* ========================
   START SERVER (SAFE)
======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
