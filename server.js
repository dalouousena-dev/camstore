import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validationResult } from 'express-validator';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { authenticateToken } from './middleware/authMiddleware.js';
import prisma from './lib/prisma.js';
import { hashPassword } from './lib/password.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Compute __dirname for ES modules and serve static files from uploads folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

// Debug: log uploadsDir existence
console.log('=== SERVER STARTING ===');
console.log('=== UPLOADS CONFIGURATION ===');
console.log('Server file location:', __filename);
console.log('Server directory (__dirname):', __dirname);
console.log('uploadsDir:', uploadsDir);
console.log('uploadsDir exists:', fs.existsSync(uploadsDir));
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  console.log(`Files in uploads folder: ${files.length} files`);
  console.log('First 3 files:', files.slice(0, 3));
}
console.log('============================\n');
console.log('PORT:', process.env.PORT || 5000);

// Simple request logger to observe incoming requests (for debugging)
app.use((req, res, next) => {
  if (req.url.includes('uploads') || req.url.includes('/')) {
    console.log('[REQ]', req.method, req.url);
  }
  next();
});

// Debug middleware: log headers and any express-validator errors early
app.use((req, res, next) => {
  console.log('[DEBUG] Incoming request:', req.method, req.url, 'Content-Type:', req.headers['content-type']);
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('[DEBUG] Pre-route validation errors:', errors.array());
    }
  } catch (err) {
    console.log('[DEBUG] validationResult threw:', err && err.message);
  }
  next();
});

// Serve static files from backend/uploads using an absolute path
app.use('/uploads', express.static(uploadsDir));
console.log('Static middleware configured for /uploads at:', uploadsDir);

// Explicit image serving route as fallback
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(uploadsDir, filename);
  
  // Sanitize filename to prevent path traversal
  if (!filepath.startsWith(uploadsDir)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  
  res.sendFile(filepath, (err) => {
    if (err) {
      console.error('Error sending file:', filename, err.message);
      res.status(404).json({ message: 'File not found: ' + filename });
    }
  });
});

// Database Connection & Admin Setup
async function initializeDatabase() {
  try {
    console.log('Connecting to SQLite database...');
    
    // Test connection
    const count = await prisma.user.count();
    console.log('✓ Database connected');

    // Default admin credentials
    const adminEmail = process.env.ADMIN_EMAIL || 'camestore@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'password693288582';

    // Create admin user if it doesn't exist
    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existingAdmin) {
      const hashedPassword = await hashPassword(adminPassword);
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          fullName: 'Admin',
          phone: '0000000000',
          location: 'Admin',
          role: 'admin'
        }
      });
      console.log(`✓ Created admin user: ${adminEmail}`);
    } else if (existingAdmin.role !== 'admin') {
      // If existing user but not admin, make them admin
      await prisma.user.update({
        where: { email: adminEmail },
        data: { role: 'admin' }
      });
      console.log(`✓ Upgraded user to admin: ${adminEmail}`);
    } else {
      console.log(`✓ Admin user already exists: ${adminEmail}`);
    }
  } catch (err) {
    console.error('Database initialization error:', err && err.message);
    process.exit(1);
  }
}

// Initialize database on startup
initializeDatabase();

// Routes (Vite proxy strips /api prefix, so routes don't need it)
app.use('/auth', authRoutes);
// Products and messaging require authentication
app.use('/products', authenticateToken, productRoutes);
app.use('/messages', authenticateToken, messageRoutes);
app.use('/payments', authenticateToken, paymentRoutes);
// Admin routes (require authentication + admin verification)
app.use('/admin', adminRoutes);

// Public endpoint for testing uploads
app.get('/test-uploads', (req, res) => {
  res.json({ message: 'Uploads middleware is working', uploadsDir });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
