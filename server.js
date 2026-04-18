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
app.post('/products', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { title, description, price, location } = req.body;

    if (!title || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let imageUrl = null;

    if (req.file) {
      // ✅ FIX: sanitize filename (REMOVE SPECIAL CHARACTERS)
      const cleanName = req.file.originalname
        .normalize("NFD") // remove accents (é → e)
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9.]/g, "_"); // remove symbols

      const fileName = `${Date.now()}-${cleanName}`;

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

    let conversation = null;

    // ✅ CHECK 1 (sender -> receiver)
    const { data: conv1 } = await supabase
      .from('Conversation')
      .select('*')
      .eq('productId', productId)
      .eq('buyerId', senderId)
      .eq('sellerId', receiverId)
      .maybeSingle();

    // ✅ CHECK 2 (receiver -> sender)
    const { data: conv2 } = await supabase
      .from('Conversation')
      .select('*')
      .eq('productId', productId)
      .eq('buyerId', receiverId)
      .eq('sellerId', senderId)
      .maybeSingle();

    conversation = conv1 || conv2;

    let conversationId;

    // ✅ CREATE IF NOT EXISTS
    if (!conversation) {
      const { data: newConv, error: createError } = await supabase
        .from('Conversation')
        .insert({
          id: Date.now().toString(),
          productId: productId || null,
          buyerId: senderId,
          sellerId: receiverId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) throw createError;

      conversationId = newConv.id;

    } else {
      conversationId = conversation.id;

      await supabase
        .from('Conversation')
        .update({ updatedAt: new Date().toISOString() })
        .eq('id', conversationId);
    }

    // ✅ INSERT MESSAGE
    const { error: msgError } = await supabase
      .from('Message')
      .insert({
        id: Date.now().toString(),
        conversationId,
        senderId,
        content: text,
        read: false,
        createdAt: new Date().toISOString()
      });

    if (msgError) throw msgError;

    res.json({
      success: true,
      conversationId
    });

  } catch (err) {
    console.error("MESSAGE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/messages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1️⃣ GET CONVERSATIONS
    const { data: conversations, error } = await supabase
      .from('Conversation')
      .select('*')
      .or(`buyerId.eq.${userId},sellerId.eq.${userId}`)
      .order('createdAt', { ascending: false });

    if (error) throw error;

    if (!conversations.length) {
      return res.json({ conversations: [] });
    }

    // 2️⃣ GET RELATED IDS
    const productIds = conversations.map(c => c.productId).filter(Boolean);
    const userIds = [
      ...new Set(
        conversations.flatMap(c => [c.buyerId, c.sellerId])
      )
    ];

    // 3️⃣ FETCH PRODUCTS
    const { data: products } = await supabase
      .from('Product')
      .select('id, title, images')
      .in('id', productIds);

    // 4️⃣ FETCH USERS
    const { data: users } = await supabase
      .from('User')
      .select('id, fullName, profileImage')
      .in('id', userIds);

    // 5️⃣ MERGE + LAST MESSAGE (FIXED WITH Promise.all)
    const final = await Promise.all(
      conversations.map(async (conv) => {

        const buyer = users.find(u => String(u.id) === String(conv.buyerId));
        const seller = users.find(u => String(u.id) === String(conv.sellerId));
        const product = products.find(p => String(p.id) === String(conv.productId));

        // ✅ LAST MESSAGE (SAFE)
        const { data: lastMessage } = await supabase
          .from('Message')
          .select('content')
          .eq('conversationId', conv.id)
          .order('createdAt', { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          ...conv,

          lastMessage: lastMessage?.content || null,

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
/* ======================== ROOT ======================== */

app.get('/', (req, res) => {
  res.json({ message: 'API running' });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
/* ======================== ADMIN ======================== */

// GET ALL USERS
app.get('/admin/users', authenticateToken, isAdmin, ...)
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
app.get('/admin/products', authenticateToken, async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('Product')
      .select('*');

    if (error) throw error;

    // Get users (owners)
    const userIds = [...new Set(products.map(p => p.user_id))];

    const { data: users } = await supabase
      .from('User')
      .select('id, fullName, email')
      .in('id', userIds);

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
app.get('/admin/stats', authenticateToken, async (req, res) => {
  try {

    // USERS COUNT
    const { count: totalUsers } = await supabase
      .from('User')
      .select('*', { count: 'exact', head: true });

    // PRODUCTS COUNT
    const { count: totalProducts } = await supabase
      .from('Product')
      .select('*', { count: 'exact', head: true });

    // MESSAGES COUNT
    const { count: totalConversations } = await supabase
      .from('Conversation')
      .select('*', { count: 'exact', head: true });

    res.json({
      totalUsers: totalUsers || 0,
      totalProducts: totalProducts || 0,
      totalConversations: totalConversations || 0
    });

  } catch (err) {
    console.error("ADMIN STATS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

