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
   PATH CONFIG (IMPORTANT)
======================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

/* ========================
   CREATE UPLOAD FOLDER
======================== */
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/* ========================
   STATIC FILES (🔥 FIX)
======================== */
app.use('/uploads', express.static(uploadsDir));

/* ========================
   MIDDLEWARE
======================== */
app.use(cors({
  origin: '*',
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========================
   MULTER CONFIG
======================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

/* ========================
   MEMORY DATABASE
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
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token' });

  const token = authHeader.split(' ')[1];
  const user = db.users.find(u => u.id === token);

  if (!user) return res.status(401).json({ message: 'Invalid token' });

  req.user = user;
  next();
}

/* ========================
   TEST IMAGE ROUTE (DEBUG)
======================== */
app.get('/test-image', (req, res) => {
  const files = fs.readdirSync(uploadsDir);
  if (!files.length) return res.send('No images uploaded');

  res.sendFile(path.join(uploadsDir, files[0]));
});

/* ========================
   REGISTER
======================== */
app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  const { email, password, fullName, phone, location } = req.body;

  if (!email || !password || !fullName) {
    return res.status(400).json({ message: 'Missing fields' });
  }

  const exists = db.users.find(u => u.email === email);
  if (exists) return res.status(409).json({ message: 'User exists' });

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

  res.json({ user, token: user.id });
});

/* ========================
   LOGIN
======================== */
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

  res.json({ user, token: user.id });
});

/* ========================
   VERIFY
======================== */
app.get('/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

/* ========================
   UPDATE PROFILE
======================== */
app.put('/auth/profile', authenticateToken, upload.single('profileImage'), (req, res) => {
  const user = req.user;

  const { fullName, email, phone, location } = req.body;

  if (fullName) user.fullName = fullName;
  if (email) user.email = email;
  if (phone) user.phone = phone;
  if (location) user.location = location;

  if (req.file) {
    user.profileImage = `/uploads/${req.file.filename}`;
  }

  res.json({ success: true, user });
});

/* ========================
   PRODUCTS (🔥 FIXED)
======================== */

/* GET ALL PRODUCTS */
app.get('/products', (req, res) => {
  res.json(db.products);
});

/* GET MY PRODUCTS */
app.get('/products/my-listings', authenticateToken, (req, res) => {
  const myProducts = db.products.filter(p => p.userId === req.user.id);
  res.json({ products: myProducts });
});

/* CREATE PRODUCT */
app.post('/products', authenticateToken, upload.array('images', 5), (req, res) => {
  const { title, description, price } = req.body;

  const product = {
    id: Date.now().toString(),
    userId: req.user.id,
    title,
    description,
    price,
    images: req.files ? req.files.map(f => `/uploads/${f.filename}`) : []
  };

  db.products.push(product);

  res.json({ success: true, product });
});

/* DELETE PRODUCT */
app.delete('/products/:id', authenticateToken, (req, res) => {
  db.products = db.products.filter(p => p.id !== req.params.id);
  res.json({ success: true });
});

/* ========================
   FAVORITES
======================== */
app.get('/products/favorites', authenticateToken, (req, res) => {
  const favs = db.favorites
    .filter(f => f.userId === req.user.id)
    .map(f => db.products.find(p => p.id === f.productId))
    .filter(Boolean);

  res.json(favs);
});

app.post('/products/favorites', authenticateToken, (req, res) => {
  const { productId } = req.body;

  const favorite = {
    id: Date.now().toString(),
    userId: req.user.id,
    productId
  };

  db.favorites.push(favorite);

  res.json({ success: true });
});

/* ========================
   MESSAGES
======================== */
app.get('/messages', authenticateToken, (req, res) => {
  const messages = db.messages.filter(
    m => m.senderId === req.user.id || m.receiverId === req.user.id
  );
  res.json(messages);
});

app.post('/messages', authenticateToken, (req, res) => {
  const { receiverId, text } = req.body;

  const message = {
    id: Date.now().toString(),
    senderId: req.user.id,
    receiverId,
    text,
    createdAt: new Date()
  };

  db.messages.push(message);

  res.json({ success: true, message });
});

/* ========================
   START SERVER
======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
