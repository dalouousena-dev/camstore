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

/* ======================== DATABASE ======================== */
const db = {
  users: [],
  products: [],
  messages: [],
  favorites: [],
  payments: [] // ✅ NEW
};

/* ======================== AUTH ======================== */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token' });

  const token = authHeader.split(' ')[1];
  const user = db.users.find(u => u.id === token);

  if (!user) return res.status(401).json({ message: 'Invalid token' });

  req.user = user;
  next();
}

/* ======================== AUTH ROUTES ======================== */
app.post('/auth/register', upload.single('profileImage'), async (req, res) => {
  const { email, password, fullName } = req.body;

  const user = {
    id: Date.now().toString(),
    email,
    password: await bcrypt.hash(password, 10),
    fullName,
    profileImage: req.file ? `/uploads/${req.file.filename}` : null
  };

  db.users.push(user);
  res.json({ user, token: user.id });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

  res.json({ user, token: user.id });
});

/* ======================== PRODUCTS ======================== */
app.get('/products', (req, res) => {
  res.json(db.products);
});

app.post('/products', authenticateToken, upload.array('images', 5), (req, res) => {
  const { title, description, price } = req.body;

  const product = {
    id: Date.now().toString(),
    userId: req.user.id,
    title,
    description,
    price,
    images: req.files?.map(f => `/uploads/${f.filename}`) || [],
    isPaid: false // 🔥 IMPORTANT
  };

  db.products.push(product);

  res.json({ success: true, product });
});

/* ======================== PAYMENT ROUTE ======================== */
app.post('/pay', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, operator, productId } = req.body;

    const response = await fetch("https://api.ashtechpay.top/v1/collect", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.ASHTECH_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount,
        currency: "XAF",
        phone,
        operator,
        reference: "CAMSTORE_" + Date.now()
      })
    });

    const data = await response.json();

    // Save payment
    const payment = {
      id: Date.now().toString(),
      userId: req.user.id,
      productId,
      amount,
      phone,
      operator,
      status: data.status || "pending",
      createdAt: new Date()
    };

    db.payments.push(payment);

    res.json(data);

  } catch (error) {
    console.error("PAY ERROR:", error);
    res.status(500).json({ error: "Payment failed" });
  }
});

/* ======================== VERIFY PAYMENT ======================== */
app.post('/verify-payment', async (req, res) => {
  try {
    const { reference } = req.body;

    const response = await fetch(`https://api.ashtechpay.top/v1/status/${reference}`, {
      headers: {
        "Authorization": `Bearer ${process.env.ASHTECH_API_KEY}`
      }
    });

    const data = await response.json();

    // Update product if success
    if (data.status === "success") {
      const payment = db.payments.find(p => p.reference === reference);

      if (payment) {
        const product = db.products.find(p => p.id === payment.productId);
        if (product) product.isPaid = true;
      }
    }

    res.json(data);

  } catch (error) {
    console.error("VERIFY ERROR:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

/* ======================== START ======================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
