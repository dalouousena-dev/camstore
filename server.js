import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* ========================
   MIDDLEWARE
======================== */
app.use(cors({
  origin: '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========================
   FILE SYSTEM
======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

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
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ message: 'No token' });

  const user = db.users.find(u => u.id === token);
  if (!user) return res.status(401).json({ message: 'Invalid token' });

  req.user = user;
  next();
}

/* ========================
   AUTH ROUTES
======================== */

// REGISTER
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    if (db.users.find(u => u.email === email)) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = {
      id: Date.now().toString(),
      email,
      password: await bcrypt.hash(password, 10),
      fullName,
      role: 'user'
    };

    db.users.push(user);

    return res.json({
      user,
      token: user.id
    });

  } catch (err) {
    console.error('REGISTER CRASH:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const user = db.users.find(u => u.email === email);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    return res.json({
      user,
      token: user.id
    });

  } catch (err) {
    console.error('LOGIN CRASH:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// VERIFY (NEW)
app.get('/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

/* ========================
   PRODUCTS
======================== */

// ALL PRODUCTS
app.get('/products', authenticateToken, (req, res) => {
  res.json(db.products);
});

// MY LISTINGS (NEW)
app.get('/products/my-listings', authenticateToken, (req, res) => {
  const myProducts = db.products.filter(p => p.userId === req.user.id);
  res.json(myProducts);
});

// FAVORITES (NEW)
app.get('/products/favorites', authenticateToken, (req, res) => {
  const favs = db.favorites.filter(f => f.userId === req.user.id);
  res.json(favs);
});

// CREATE PRODUCT
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

// ALL MESSAGES
app.get('/messages', authenticateToken, (req, res) => {
  res.json(db.messages);
});

// CONVERSATIONS (NEW)
app.get('/messages/conversations', authenticateToken, (req, res) => {
  const conversations = db.messages.filter(
    m => m.senderId === req.user.id || m.receiverId === req.user.id
  );
  res.json(conversations);
});

// SEND MESSAGE
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
   PAYMENTS
======================== */
app.post('/payments', authenticateToken, (req, res) => {
  const payment = {
    id: Date.now().toString(),
    userId: req.user.id,
    ...req.body
  };

  db.payments.push(payment);
  res.json(payment);
});

/* ========================
   ADMIN
======================== */
app.get('/admin/users', authenticateToken, (req, res) => {
  res.json(db.users);
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
