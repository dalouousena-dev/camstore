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
   FILE SYSTEM
======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

/* ========================
   MULTER
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
   IN-MEMORY DB
======================== */
const db = {
  users: [],
  products: [],
  messages: [],
  favorites: []
};

/* ========================
   HELPERS
======================== */
const normalizeEmail = (email) => email?.trim().toLowerCase();

/* ========================
   AUTH MIDDLEWARE
======================== */
function authenticateToken(req, res, next) {
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
}

/* ========================
   AUTH ROUTES
======================== */

// REGISTER
app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  try {
    console.log("REGISTER BODY:", req.body);
    console.log("REGISTER FILE:", req.file);

    let { email, password, fullName, phone, location } = req.body;

    email = normalizeEmail(email);

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // ❗ prevent duplicate users
    const existingUser = db.users.find(u => u.email === email);
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const newUser = {
      id: Date.now().toString(),
      email,
      password: await bcrypt.hash(password, 10),
      fullName,
      phone,
      location,
      profileImage: req.file ? `/uploads/${req.file.filename}` : null
    };

    db.users.push(newUser);

    return res.json({
      user: newUser,
      token: newUser.id
    });

  } catch (err) {
    console.error('REGISTER ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    console.log('LOGIN HIT');
    console.log('BODY:', req.body);

    let { email, password } = req.body;

    email = normalizeEmail(email);

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
    return res.status(500).json({ message: 'Server error' });
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

app.put('/products/:id', authenticateToken, (req, res) => {
  const product = db.products.find(p => p.id === req.params.id);

  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  Object.assign(product, req.body);

  res.json(product);
});

app.delete('/products/:id', authenticateToken, (req, res) => {
  const index = db.products.findIndex(p => p.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: 'Product not found' });
  }

  db.products.splice(index, 1);

  res.json({ message: 'Deleted successfully' });
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
   HEALTH CHECK
======================== */

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/* ========================
   START SERVER
======================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
