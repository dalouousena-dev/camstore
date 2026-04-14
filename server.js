import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';

dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

const app = express();
const PORT = process.env.PORT || 5000;

/* ========================
   FILE SYSTEM (FIXED ORDER)
======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

// ✅ Ensure uploads folder exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

/* ========================
   MULTER (NOW SAFE)
======================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

/* ========================
   MIDDLEWARE
======================== */
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(uploadsDir));

/* ========================
   IN-MEMORY DATABASE
======================== */
const db = {
  users: [],
  products: [],
  messages: [],
  payments: [],
  favorites: []
};

/* ========================
   AUTH MIDDLEWARE
======================== */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: 'No token' });
  }

  const token = authHeader.split(' ')[1];

  const user = db.users.find(u => u.id === token);

  if (!user) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  req.user = user;
  next();
}

/* ========================
   AUTH ROUTES
======================== */

// REGISTER (FIXED)
app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const { email, password, fullName, phone, location } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Missing fields' });
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

    res.json({
      user,
      token: user.id
    });

  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    console.log('LOGIN HIT');
    console.log('BODY:', req.body);

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const user = db.users.find(u => u.email === email);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({
      user,
      token: user.id
    });

  } catch (err) {
    console.error('LOGIN CRASH:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// VERIFY
app.get('/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

/* ========================
   PRODUCTS
======================== */
app.get('/products', authenticateToken, (req, res) => {
  res.json(db.products);
});

app.get('/products/my-listings', authenticateToken, (req, res) => {
  const myProducts = db.products.filter(p => p.userId === req.user.id);
  res.json(myProducts);
});

app.get('/products/favorites', authenticateToken, (req, res) => {
  const favs = db.favorites.filter(f => f.userId === req.user.id);
  res.json(favs);
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
   HEALTH
======================== */
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/* ========================
   START
======================== */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
