import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* ========================
   MIDDLEWARE
======================== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========================
   FILE SYSTEM (UPLOADS)
======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

app.use('/uploads', express.static(uploadsDir));

app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);

  if (!filePath.startsWith(uploadsDir)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  res.sendFile(filePath, (err) => {
    if (err) return res.status(404).json({ message: 'File not found' });
  });
});

/* ========================
   IN-MEMORY DATABASE
======================== */
const db = {
  users: [],
  products: [],
  messages: [],
  payments: []
};

/* ========================
   SIMPLE AUTH MIDDLEWARE (FAKE JWT STYLE)
======================== */
function authenticateToken(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

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
app.post('/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body;

  const existing = db.users.find(u => u.email === email);
  if (existing) {
    return res.status(400).json({ message: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = {
    id: Date.now().toString(),
    email,
    password: hashedPassword,
    fullName,
    role: 'user'
  };

  db.users.push(user);

 res.json({
  user,
  token: user.id
});
// LOGIN
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const user = db.users.find(u => u.email === email);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // simple token = user id (MVP ONLY)
  res.json({
    token: user.id,
    user
  });
});

/* ========================
   PRODUCTS
======================== */

app.get('/products', authenticateToken, (req, res) => {
  res.json(db.products);
});

app.post('/products', authenticateToken, (req, res) => {
  const product = {
    id: Date.now().toString(),
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
