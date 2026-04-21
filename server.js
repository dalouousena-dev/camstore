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

/* ✅ ADD THIS EXACTLY HERE (RIGHT AFTER authenticateToken) */
function isAdmin(req, res, next) {
  if (req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
}

/* ======================== PRODUCTS ======================== */

// CREATE PRODUCT
// CREATE PRODUCT (FIXED ONLY THIS PART)
// CREATE PRODUCT (MULTIPLE IMAGES + ERROR HANDLING)
app.post('/products', authenticateToken, (req, res) => {

  const uploadMiddleware = upload.array('images', 3);

  uploadMiddleware(req, res, async (err) => {

    // ✅ HANDLE MULTER ERROR (TOO MANY FILES)
    if (err) {
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          error: 'You can upload a maximum of 3 images.'
        });
      }

      return res.status(500).json({
        error: 'File upload error.'
      });
    }

    try {
      const { title, description, price, location } = req.body;

      if (!title || !price) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      let imageUrls = [];

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const cleanName = file.originalname
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9.]/g, "_");

          const fileName = `${Date.now()}-${cleanName}`;

          const { error: uploadError } = await supabase.storage
            .from('products')
            .upload(fileName, file.buffer, {
              contentType: file.mimetype
            });

          if (uploadError) {
            return res.status(500).json({ error: uploadError.message });
          }

          const { data } = supabase.storage
            .from('products')
            .getPublicUrl(fileName);

          imageUrls.push(data.publicUrl);
        }
      }

      const newProduct = {
        id: Date.now().toString(),
        title,
        description,
        price: Number(price),
        currency: 'XAF',
        images: imageUrls,
        user_id: userId,
        location: location || null,
        published: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('Product')
        .insert([newProduct])
        .select();

      if (error) {
        console.error("PRODUCT ERROR:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ product: data[0] });

    } catch (err) {
      console.error("SERVER ERROR:", err);
      res.status(500).json({ error: err.message });
    }

  });
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

 /* ======================== FAVORITES ======================== */

// ADD TO FAVORITES
app.post('/products/favorite', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Missing productId' });
    }

    const userId = req.user.id;

    // ✅ prevent duplicates
    const { data: existing } = await supabase
      .from('Favorite')
      .select('*')
      .eq('userId', userId)
      .eq('productId', productId)
      .single();

    if (existing) {
      return res.json({ message: 'Already in favorites' });
    }

    const { data, error } = await supabase
      .from('Favorite')
      .insert([
        {
          id: Date.now().toString(),
          userId,
          productId
        }
      ]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET USER FAVORITES
app.get('/products/favorites', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1️⃣ Get favorites
    const { data: favorites, error } = await supabase
      .from('Favorite')
      .select('*')
      .eq('userId', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const productIds = favorites.map(f => f.productId).filter(Boolean);

    // 2️⃣ If no favorites
    if (!productIds.length) {
      return res.json({ products: [] });
    }

    // 3️⃣ Get products
    const { data: products, error: productError } = await supabase
      .from('Product')
      .select('*')
      .in('id', productIds);

    if (productError) {
      return res.status(500).json({ error: productError.message });
    }

    // 4️⃣ Get users (sellers)
    const userIds = [...new Set(products.map(p => p.user_id))];

    const { data: users, error: userError } = await supabase
      .from('User')
      .select('id, fullName, profileImage, location')
      .in('id', userIds);

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // 5️⃣ Merge product + user (🔥 MAIN FIX HERE)
    const final = products.map(p => {
      const user = users.find(u => String(u.id) === String(p.user_id));

      return {
        ...p,
        user: user || null // ✅ VERY IMPORTANT FIX
      };
    });

    // 6️⃣ Send response
    res.json({ products: final });

  } catch (err) {
    console.error("FAVORITES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ======================== AUTH ======================== */
// ✅ GET MY PRODUCTS (FIXED)
app.get('/products/my-listings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // ✅ use token

    const { data, error } = await supabase
      .from('Product')
      .select('*')
      .eq('user_id', userId); // ✅ correct column

    if (error) throw error;

    res.json({ products: data });

  } catch (err) {
    console.error("MY LISTINGS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch listings" });
  }
});


app.delete('/products/:id', authenticateToken, async (req, res) => {
  try {
    const productId = req.params.id;
    const userId = req.user.id;

    const { data: product } = await supabase
      .from('Product')
      .select('*')
      .eq('id', productId)
      .single();

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (product.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { error } = await supabase
      .from('Product')
      .delete()
      .eq('id', productId);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REMOVE FROM FAVORITES
app.delete('/products/favorite/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.productId;

    const { error } = await supabase
      .from('Favorite')
      .delete()
      .eq('userId', userId)
      .eq('productId', productId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/messages', authenticateToken, async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverId, productId, text } = req.body;

    if (!receiverId || !text) {
      return res.status(400).json({ error: "Missing data" });
    }

    // =========================
    // 1. GET PRODUCT OWNER (REAL SELLER)
    // =========================
    let sellerId = receiverId;
    let buyerId = senderId;

    if (productId) {
      const { data: product } = await supabase
        .from('Product')
        .select('user_id')
        .eq('id', productId)
        .single();

      if (product) {
        sellerId = product.user_id;

        // whoever is NOT seller = buyer
        buyerId = String(senderId) === String(sellerId)
          ? receiverId
          : senderId;
      }
    }

    // =========================
    // 2. FIND EXISTING CONVERSATION
    // =========================
    const { data: existingConv } = await supabase
      .from('Conversation')
      .select('*')
      .eq('productId', productId)
      .eq('buyerId', buyerId)
      .eq('sellerId', sellerId)
      .maybeSingle();

    let conversationId;

    // =========================
    // 3. CREATE IF NOT EXISTS
    // =========================
    if (!existingConv) {
      const { data: newConv, error } = await supabase
        .from('Conversation')
        .insert({
          id: Date.now().toString(),
          productId,
          buyerId,
          sellerId,
          lastMessage: text, // ✅ STORE DIRECTLY
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      conversationId = newConv.id;

    } else {
      conversationId = existingConv.id;

      // ✅ UPDATE LAST MESSAGE
      await supabase
        .from('Conversation')
        .update({
          lastMessage: text,
          updatedAt: new Date().toISOString()
        })
        .eq('id', conversationId);
    }

    // =========================
    // 4. SAVE MESSAGE
    // =========================
    const { data: message, error: msgError } = await supabase
      .from('Message')
      .insert({
        id: Date.now().toString(),
        conversationId,
        senderId,
        text,
        read: false,
        createdAt: new Date().toISOString()
      })
      .select()
      .single();

    if (msgError) throw msgError;

    // =========================
    // 5. RESPONSE
    // =========================
    res.json({
      success: true,
      message,
      conversationId
    });

  } catch (err) {
    console.error("SEND MESSAGE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/messages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: conversations, error } = await supabase
      .from('Conversation')
      .select('*')
      .or(`buyerId.eq.${userId},sellerId.eq.${userId}`)
      .order('updatedAt', { ascending: false });

    if (error) throw error;

    if (!conversations.length) {
      return res.json({ conversations: [] });
    }

    const productIds = conversations.map(c => c.productId).filter(Boolean);

    const userIds = [
      ...new Set(
        conversations.flatMap(c => [c.buyerId, c.sellerId])
      )
    ];

    const { data: products } = await supabase
      .from('Product')
      .select('id, title, images')
      .in('id', productIds);

    const { data: users } = await supabase
      .from('User')
      .select('id, fullName, profileImage')
      .in('id', userIds);

    const final = await Promise.all(
      conversations.map(async (conv) => {

        const buyer = users.find(u => String(u.id) === String(conv.buyerId));
        const seller = users.find(u => String(u.id) === String(conv.sellerId));
        const product = products.find(p => String(p.id) === String(conv.productId));

        // ✅ FIX: use text + correct ordering
        lastMessage: conv.lastMessage || null
          .select('text')
          .eq('conversationId', conv.id)
          .order('createdAt', { ascending: false }) // 🔥 FIXED
          .limit(1)
          .maybeSingle();

        return {
          ...conv,

          lastMessage: lastMessage?.text || null,

          sellerName: seller?.fullName || null,
          sellerAvatar: seller?.profileImage || null,

          buyerName: buyer?.fullName || null,
          buyerAvatar: buyer?.profileImage || null,

          productName: product?.title || null,
          productImage: product?.images || null
        };
      })
    );

    res.json({ conversations: final });

  } catch (err) {
    console.error("GET MESSAGES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/messages/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // ✅ CHECK ACCESS
    const { data: conv } = await supabase
      .from('Conversation')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (!conv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (
      String(conv.buyerId) !== String(userId) &&
      String(conv.sellerId) !== String(userId)
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // ✅ GET MESSAGES
    const { data, error } = await supabase
      .from('Message')
      .select('*')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: true });

    if (error) throw error;

    res.json({ messages: data });

  } catch (err) {
    console.error("GET CHAT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ======================== PAYMENT ======================== */

app.post('/pay', authenticateToken, async (req, res) => {
  try {
    const { productId, phone, method } = req.body;

    if (!productId || !phone || !method) {
      return res.status(400).json({ error: 'Missing payment data' });
    }

    // ⚠️ SIMULATED PAYMENT (you can replace later with real API)
    console.log("Payment request:", {
      user: req.user.id,
      productId,
      phone,
      method
    });

    // OPTIONAL: mark product as paid / published
    await supabase
      .from('Product')
      .update({ published: true })
      .eq('id', productId);

    res.json({
      success: true,
      message: 'Payment successful (simulated)'
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// REGISTER (FIXED HERE)
app.post('/auth/register', upload.single('image'), async (req, res) => {
  try {
    const { email, password, fullName, phone, location } = req.body;

    // ========================
    // 1. VALIDATION
    // ========================
    if (!email || !password || !fullName) {
      return res.status(400).json({
        message: 'Email, password and full name are required'
      });
    }

    // Simple email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: 'Invalid email format'
      });
    }

    // Password length check
    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters'
      });
    }

    // ========================
    // 2. CHECK IF EMAIL EXISTS
    // ========================
    const { data: existingUser } = await supabase
      .from('User')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({
        message: 'Email already exists'
      });
    }

    // ========================
    // 3. HASH PASSWORD
    // ========================
    const hashedPassword = await bcrypt.hash(password, 10);

    // ========================
    // 4. HANDLE IMAGE UPLOAD
    // ========================
    let profileImage = null;

    if (req.file) {
      const cleanName = req.file.originalname
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9.]/g, "_");

      const fileName = `profile-${Date.now()}-${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype
        });

      if (uploadError) {
        console.error("UPLOAD ERROR:", uploadError);
        return res.status(500).json({
          message: 'Failed to upload image'
        });
      }

      const { data } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      profileImage = data.publicUrl;
    }

    // ========================
    // 5. CREATE USER
    // ========================
    const newUser = {
      id: Date.now().toString(),
      email,
      password: hashedPassword,
      fullName,
      phone: phone || null,
      location: location || null,
      profileImage
    };

    const { data, error } = await supabase
      .from('User')
      .insert([newUser])
      .select();

    if (error) {
      console.error("REGISTER ERROR:", error);

      // Extra safety (race condition)
      if (
        error.message.includes('duplicate key') ||
        error.code === '23505'
      ) {
        return res.status(400).json({
          message: 'Email already exists'
        });
      }

      return res.status(500).json({
        message: 'Server error'
      });
    }

    // ========================
    // 6. SUCCESS RESPONSE
    // ========================
    return res.status(201).json({
      success: true,
      user: data[0],
      token: data[0].id
    });

  } catch (err) {
    console.error("REGISTER CATCH ERROR:", err);

    return res.status(500).json({
      message: 'Unexpected server error'
    });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required'
      });
    }

    const { data: user } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    // ❌ user not found OR password wrong → SAME MESSAGE
    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // ✅ SUCCESS
    res.json({
      success: true,
      user,
      token: user.id
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({
      message: 'Server error'
    });
  }
});
app.get('/auth/verify', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

 app.put('/auth/profile', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;

    const { fullName, phone, location } = req.body;

    let profileImage = req.user.profileImage;

    // ✅ Handle new image upload
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

    // ✅ Update user in DB
    const { data, error } = await supabase
      .from('User')
      .update({
        fullName: fullName || req.user.fullName,
        phone: phone || req.user.phone,
        location: location || req.user.location,
        profileImage
      })
      .eq('id', userId)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      success: true,
      user: data[0]
    });

  } catch (err) {
    console.error("PROFILE UPDATE ERROR:", err);
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
/* ======================== ADMIN ======================== */

// GET ALL USERS
app.get('/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('User')
      .select('id, fullName, email, phone, location, profileImage');

    if (error) throw error;

    res.json({
      success: true,
      users: data
    });

  } catch (err) {
    console.error("ADMIN USERS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/admin/products', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('Product')
      .select('*');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get unique user IDs
    const userIds = [...new Set(products.map(p => p.user_id))];

    // Get owners
    const { data: users, error: userError } = await supabase
      .from('User')
      .select('id, fullName, email')
      .in('id', userIds);

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // Merge product + owner
    const final = products.map(p => ({
      ...p,
      owner: users.find(u => String(u.id) === String(p.user_id)) || null
    }));

    res.json({
      success: true,
      products: final
    });

  } catch (err) {
    console.error("ADMIN PRODUCTS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    // USERS COUNT
    const { count: totalUsers, error: userError } = await supabase
      .from('User')
      .select('*', { count: 'exact', head: true });

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // PRODUCTS COUNT
    const { count: totalProducts, error: productError } = await supabase
      .from('Product')
      .select('*', { count: 'exact', head: true });

    if (productError) {
      return res.status(500).json({ error: productError.message });
    }

    // CONVERSATIONS COUNT
    const { count: totalConversations, error: convError } = await supabase
      .from('Conversation')
      .select('*', { count: 'exact', head: true });

    if (convError) {
      return res.status(500).json({ error: convError.message });
    }

    res.json({
      success: true,
      totalUsers: totalUsers || 0,
      totalProducts: totalProducts || 0,
      totalConversations: totalConversations || 0
    });

  } catch (err) {
    console.error("ADMIN STATS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
