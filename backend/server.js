// ✅ Fixed Backend + Updated Track Order + Update Status + Fetch Orders with Date and Partial OrderId Filters

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { Order } from './models/order.model.js';
import { getProductModelByCategory } from './models/getProductModelByCategory.js';
import { Category } from './models/category.model.js';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import apicache from 'apicache';
import orderRoutes from './routes/orderRoutes.js';

import admin from 'firebase-admin'; // <-- Add this line


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configure Helmet with CORS-friendly settings
app.set("trust proxy", 1);

// 1️⃣ Helmet with CORS-friendly settings
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// 2️⃣ Compression
app.use(compression());

// 3️⃣ Allowed origins
const allowedOrigins = [
  "https://www.kmpyrotech.com",
  "https://kmpyrotech.com",
   "https://kmcrackers.vercel.app",
  "http://localhost:5000",
  "https://api.kmpyrotech.com",
  "http://localhost:5173"
];

// 4️⃣ CORS setup with logging
app.use(cors({
  origin: (origin, callback) => {
    console.log(`🌐 CORS Request from: ${origin || "Unknown"}`);
    if (!origin || allowedOrigins.includes(origin)) {
      console.log(`✅ Origin allowed: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ Origin blocked: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

// Preflight requests
app.options("*", cors());

// 5️⃣ Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// 6️⃣ JSON body parsing
app.use(express.json());

// 7️⃣ Health check (Railway ping)
app.get("/", (req, res) => {
  res.json({ status: "Backend is running ✅" });
});

// 8️⃣ Use order routes
app.use('/api/orders', orderRoutes);

const cache = apicache.middleware;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const invoiceDir = path.join(__dirname, 'invoices');
if (!fs.existsSync(invoiceDir)) fs.mkdirSync(invoiceDir);
// Remove static serving of invoices. Use custom endpoint below.

// Custom endpoint: Serve and delete invoice after download
app.get('/invoices/:filename', (req, res) => {
  const filePath = path.join(invoiceDir, req.params.filename);
  res.download(filePath, (err) => {
    if (!err) {
      // Delete the file after successful download
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting invoice:', unlinkErr);
      });
    }
  });
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'products',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    public_id: (req, file) => `${Date.now()}-${file.originalname}`
  }
});
const upload = multer({ storage });





// ✅ GET: Track Order
app.get('/api/orders/track', async (req, res) => {
  try {
    const { orderId, mobile } = req.query;
    if (!orderId || !mobile) {
      return res.status(400).json({ error: 'Missing orderId or mobile number' });
    }
    const order = await Order.findOne({
      orderId: String(orderId),
      'customerDetails.mobile': String(mobile)
    });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('❌ Error tracking order:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// ✅ POST: Upload Payment Screenshot
app.post('/api/orders/upload-payment', upload.single('screenshot'), async (req, res) => {
  try {
    const { orderId, mobile } = req.body;
    
    if (!orderId || !mobile || !req.file) {
      return res.status(400).json({ error: 'Missing orderId, mobile number, or screenshot' });
    }

    // Verify order exists and belongs to the customer
    const order = await Order.findOne({
      orderId: String(orderId),
      'customerDetails.mobile': String(mobile)
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found or mobile number does not match' });
    }

    // Update order with payment screenshot
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: String(orderId) },
      {
        $set: {
          'paymentScreenshot.imageUrl': req.file.path,
          'paymentScreenshot.uploadedAt': new Date(),
          'paymentScreenshot.verified': false
        }
      },
      { new: true }
    );

    res.json({ 
      message: '✅ Payment screenshot uploaded successfully', 
      order: updatedOrder 
    });
  } catch (error) {
    console.error('❌ Error uploading payment screenshot:', error);
    res.status(500).json({ error: 'Failed to upload payment screenshot' });
  }
});

// ✅ PATCH: Verify Payment Screenshot (Admin only)
app.patch('/api/orders/verify-payment/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { verified, verifiedBy } = req.body;

    if (typeof verified !== 'boolean') {
      return res.status(400).json({ error: 'Verified status is required' });
    }

    const updateFields = {
      'paymentScreenshot.verified': verified,
      'paymentScreenshot.verifiedBy': verifiedBy || 'admin',
      'paymentScreenshot.verifiedAt': new Date(),
      // Update order status to 'payment_verified' when payment is verified
      status: verified ? 'payment_verified' : 'confirmed'
    };

    const order = await Order.findOneAndUpdate(
      { orderId },
      { $set: updateFields },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ 
      message: `✅ Payment ${verified ? 'verified' : 'rejected'} successfully`, 
      order 
    });
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// ✅ GET: All Orders
app.get('/api/orders', async (req, res) => {
  try {
    const { date, orderId } = req.query;
    const query = {};
    if (orderId) query.orderId = { $regex: orderId, $options: 'i' };
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// generateInvoice function moved to orderRoutes.js

// sendEmailWithInvoice function moved to orderRoutes.js

// ✅ DELETE: Cancel Order
app.delete('/api/orders/cancel/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const deletedOrder = await Order.findOneAndDelete({ orderId });
    if (!deletedOrder) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    res.status(200).json({ message: '✅ Order cancelled successfully', orderId });
  } catch (error) {
    console.error('❌ Order cancellation error:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// ✅ POST: Add Product
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    let { name_en, name_ta, price, original_price, category, youtube_url, imageUrl } = req.body;
    let finalImageUrl = req.file?.path || imageUrl;
    if (!name_en || !name_ta || !price || !category || !finalImageUrl) {
      return res.status(400).json({ error: 'All fields including image (file or URL) and category are required.' });
    }
    // Ensure price and original_price are numbers
    price = Number(price);
    original_price = original_price ? Number(original_price) : undefined;
    const ProductModel = getProductModelByCategory(category);
    const newProduct = new ProductModel({ name_en, name_ta, price, original_price, imageUrl: finalImageUrl, youtube_url });
    await newProduct.save();
    res.status(201).json({ message: '✅ Product added successfully', product: newProduct });
  } catch (error) {
    console.error('❌ Product POST error:', error);
    res.status(500).json({ error: 'Failed to add product' });
  }
});


// ✅ PUT: Update Product (supports image URL or file upload and category change)
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    let { name_en, name_ta, price, original_price, category, youtube_url, imageUrl } = req.body;

    // Coerce numerics if present
    if (price !== undefined) price = Number(price);
    if (original_price !== undefined && original_price !== '') original_price = Number(original_price);
    else if (original_price === '') original_price = undefined;

    // Determine final image URL (prefer uploaded file)
    const finalImageUrl = req.file?.path || imageUrl;

    // Find the product across all category collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    let foundDoc = null;
    let foundCollectionName = null;
    for (const col of collections) {
      const modelName = col.name;
      if (!/^[A-Z0-9_]+$/.test(modelName)) continue;
      const Model = getProductModelByCategory(modelName.replace(/_/g, ' '));
      const doc = await Model.findById(id);
      if (doc) {
        foundDoc = doc;
        foundCollectionName = modelName;
        break;
      }
    }

    if (!foundDoc) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // If category is changing, move document to new collection
    const isCategoryChange = category && foundDoc.category !== category;
    if (isCategoryChange) {
      // Create in new category collection
      const NewModel = getProductModelByCategory(category);
      const newPayload = {
        name_en: name_en ?? foundDoc.name_en,
        name_ta: name_ta ?? foundDoc.name_ta,
        price: price ?? foundDoc.price,
        original_price: original_price ?? foundDoc.original_price,
        imageUrl: finalImageUrl ?? foundDoc.imageUrl,
        youtube_url: youtube_url ?? foundDoc.youtube_url,
        category, // store plain spaced name for frontend convenience
        createdAt: foundDoc.createdAt,
        updatedAt: new Date(),
      };
      const created = await NewModel.create(newPayload);
      // Delete old document
      const OldModel = getProductModelByCategory(foundCollectionName.replace(/_/g, ' '));
      await OldModel.findByIdAndDelete(foundDoc._id);
      return res.json({ message: '✅ Product updated and moved to new category', product: created });
    } else {
      // In-place update
      const updateFields = {};
      if (name_en !== undefined) updateFields.name_en = name_en;
      if (name_ta !== undefined) updateFields.name_ta = name_ta;
      if (price !== undefined) updateFields.price = price;
      if (original_price !== undefined) updateFields.original_price = original_price;
      if (finalImageUrl) updateFields.imageUrl = finalImageUrl;
      if (youtube_url !== undefined) updateFields.youtube_url = youtube_url;
      if (category !== undefined) updateFields.category = category;

      const Model = getProductModelByCategory(foundCollectionName.replace(/_/g, ' '));
      const updated = await Model.findByIdAndUpdate(foundDoc._id, { $set: updateFields }, { new: true });
      return res.json({ message: '✅ Product updated successfully', product: updated });
    }
  } catch (error) {
    console.error('❌ Product PUT error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});






// ✅ BULK DISCOUNT: Apply discount to all products in all categories
app.post('/api/products/apply-discount', async (req, res) => {
  try {
    const { discount } = req.body;
    if (typeof discount !== 'number' || discount < 0 || discount > 100) {
      return res.status(400).json({ error: 'Invalid discount percentage.' });
    }
    // Get all collections that match the category naming pattern
    const collections = await mongoose.connection.db.listCollections().toArray();
    let totalUpdated = 0;
    for (const col of collections) {
      const modelName = col.name;
      if (/^[A-Z0-9_]+$/.test(modelName)) {
        const Model = getProductModelByCategory(modelName.replace(/_/g, ' '));
        // Only update products that have an original_price
        const result = await Model.updateMany(
          { original_price: { $exists: true, $ne: null } },
          [{ $set: { price: { $round: [{ $multiply: ["$original_price", (1 - discount / 100)] }, 0] } } }]
        );
        totalUpdated += result.modifiedCount || 0;
      }
    }
    // Clear apicache for all product category endpoints (dynamic)
    if (apicache.clearRegexp) {
      apicache.clearRegexp(/\/api\/products\/category\//);
    } else {
      apicache.clear(); // fallback: clear all cache
    }
    res.json({ message: `✅ Discount applied to all products.`, updated: totalUpdated });
  } catch (error) {
    console.error('❌ Error applying discount:', error);
    res.status(500).json({ error: 'Failed to apply discount to products.' });
  }
});

// Initialize Firebase Admin
let firebaseApp;
try {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: "kmpyrotech-ff59c",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase Admin initialized');
  } else {
    console.log('⚠️ Firebase Admin not initialized - missing credentials');
  }
} catch (error) {
  console.log('⚠️ Firebase Admin initialization failed:', error.message);
}



// FCM Token storage (in production, use a database)
const fcmTokens = new Map();

// Shared simple order creation used by fallback endpoints
const createOrderSimple = async (payload) => {
  const { items, total, customerDetails, createdAt } = payload;
  if (!items || !total || !customerDetails) {
    const err = new Error('Missing required order fields.');
    err.statusCode = 400;
    throw err;
  }

  // Generate a simple unique order ID (YYMMDD + random 3 digits)
  const today = new Date();
  const dateStr = today.getFullYear().toString().slice(-2) +
                 (today.getMonth() + 1).toString().padStart(2, '0') +
                 today.getDate().toString().padStart(2, '0');
  const orderId = `${dateStr}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

  const newOrder = new Order({
    orderId,
    items,
    total,
    customerDetails,
    status: 'confirmed',
    createdAt: createdAt || new Date().toISOString(),
  });

  await newOrder.save();
  return orderId;
};



// ✅ POST: Place Order - Direct implementation as backup
app.post('/api/orders/place', async (req, res) => {
  try {
    const orderId = await createOrderSimple(req.body);
    console.log('✅ Order saved successfully:', orderId);
    res.status(201).json({ message: '✅ Order placed successfully', orderId });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('❌ Order placement error:', error);
    res.status(status).json({ 
      error: 'Failed to place order', 
      details: error.message
    });
  }
});

// ✅ POST: Fallback endpoint (some clients may still POST /api/orders)
app.post('/api/orders', async (req, res) => {
  try {
    const orderId = await createOrderSimple(req.body);
    console.log('✅ Order saved successfully (fallback):', orderId);
    res.status(201).json({ message: '✅ Order placed successfully', orderId });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('❌ Fallback order placement error:', error);
    res.status(status).json({ 
      error: 'Failed to place order', 
      details: error.message
    });
  }
});

// ✅ Quick ping to verify orders route availability
app.get('/api/orders/ping', (req, res) => {
  res.json({ ok: true, message: 'orders route is live' });
});

// ✅ Admin Login Route
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return res.json({ success: true, token: "admin-auth-token" });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// ✅ GET: Analytics
app.get('/api/analytics', cache('2 minutes'), async (req, res) => {
  try {
    const { date } = req.query;
    let orders;
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      orders = await Order.find({ createdAt: { $gte: start, $lte: end } });
    } else {
      orders = await Order.find({});
    }
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => {
      let itemTotal = 0;
      if (Array.isArray(order.items)) {
        itemTotal = order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
      }
      return sum + itemTotal;
    }, 0);
    res.json({ totalOrders, totalRevenue });
  } catch (error) {
    console.error("❌ Analytics fetch error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ✅ PATCH: Update Order Status and Transport Details
// Order Status Flow: confirmed → payment_verified → booked
// - confirmed: Order placed, waiting for payment verification
// - payment_verified: Payment screenshot verified by admin  
// - booked: Order booked for delivery with transport details
app.patch('/api/orders/update-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, transportName, lrNumber } = req.body;
    // Handle status updates with proper flow validation
    let updateFields = {};
    if (transportName || lrNumber) {
      updateFields.transportName = transportName || '';
      updateFields.lrNumber = lrNumber || '';
      updateFields.status = 'booked';
    } else if (status) {
      // Validate status transitions
      const currentOrder = await Order.findOne({ orderId });
      if (!currentOrder) {
        return res.status(404).json({ error: "Order not found." });
      }
      
      const currentStatus = currentOrder.status;
      const validTransitions = {
        'confirmed': ['payment_verified', 'booked'],
        'payment_verified': ['booked'],
        'booked': ['booked'] // Can stay booked
      };
      
      if (!validTransitions[currentStatus] || !validTransitions[currentStatus].includes(status)) {
        return res.status(400).json({ 
          error: `Invalid status transition from '${currentStatus}' to '${status}'. Valid transitions: ${validTransitions[currentStatus].join(', ')}` 
        });
      }
      
      updateFields.status = status;
    } else {
      return res.status(400).json({ error: "Status or transport details required." });
    }
    const order = await Order.findOneAndUpdate(
      { orderId },
      { $set: updateFields },
      { new: true }
    );
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Send push notification to customer about order status update
    try {
      const customerUserId = `customer_${order.customerDetails.mobile}`;
      const customerToken = fcmTokens.get(customerUserId);
      if (customerToken && firebaseApp) {
        let notificationTitle = '';
        let notificationBody = '';
        
        if (updateFields.status === 'confirmed') {
          notificationTitle = '✅ Order Confirmed!';
          notificationBody = `Your order ${orderId} has been confirmed and is being processed.`;
        } else if (updateFields.status === 'payment_verified') {
          notificationTitle = '✅ Payment Verified!';
          notificationBody = `Your payment for order ${orderId} has been verified successfully.`;
        } else if (updateFields.status === 'booked') {
          notificationTitle = '🚚 Order Booked for Delivery!';
          notificationBody = `Your order ${orderId} has been booked for delivery. Transport: ${updateFields.transportName}`;
        }
        
        if (notificationTitle && notificationBody) {
          const customerMessage = {
            notification: {
              title: notificationTitle,
              body: notificationBody,
            },
            data: {
              orderId: orderId,
              status: updateFields.status,
              type: 'order_status_update'
            },
            token: customerToken,
          };
          await admin.messaging().send(customerMessage);
          console.log(`✅ Customer notification sent for order ${orderId} status: ${updateFields.status}`);
        }
      }
    } catch (notificationError) {
      console.error('❌ Failed to send customer notification:', notificationError);
    }

    res.json({ message: "✅ Order updated successfully", order });
  } catch (error) {
    console.error("❌ Status update error:", error);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

// ✅ GET: Home Page Products (Optimized for first impression)
app.get('/api/products/home', cache('3 minutes'), async (req, res) => {
  try {
    // Prioritize Atom Bomb and Sparkler products for home page
    const featuredCategories = ['ATOM_BOMB', 'SPARKLER_ITEMS'];
    
    // Fetch products in parallel with limited results for faster loading
    const homeProducts = await Promise.all(
      featuredCategories.map(async (category) => {
        try {
          const ProductModel = getProductModelByCategory(category);
          // Use lean() for faster plain objects, limit to 6 products per category for better display
          const products = await ProductModel.find({}, {
            name_en: 1,
            name_ta: 1,
            price: 1,
            original_price: 1,
            imageUrl: 1,
            youtube_url: 1,
            category: 1
          }).limit(6).lean();
          
          // Add category name for frontend
          return products.map(product => ({
            ...product,
            category: category.replace(/_/g, ' ')
          }));
        } catch (err) {
          console.warn(`⚠️ Warning: Could not fetch products for category ${category}:`, err.message);
          return [];
        }
      })
    );

    // Flatten and return home page products
    const allHomeProducts = homeProducts.flat();
    res.json(allHomeProducts);
  } catch (error) {
    console.error('❌ Error fetching home page products:', error);
    res.status(500).json({ error: 'Failed to fetch home page products' });
  }
});

// ✅ GET: Products by Category (Optimized)
app.get('/api/products/category/:category', cache('2 minutes'), async (req, res) => {
  try {
    const category = req.params.category;
    const ProductModel = getProductModelByCategory(category);
    
    // Use lean() for faster plain objects, project only needed fields
    const products = await ProductModel.find({}, {
      name_en: 1,
      name_ta: 1,
      price: 1,
      original_price: 1,
      imageUrl: 1,
      youtube_url: 1,
      category: 1,
      createdAt: 1,
    }).lean();
    
    // Add category name for frontend
    const productsWithCategory = products.map(product => ({
      ...product,
      category: category.replace(/_/g, ' ')
    }));
    
    res.json(productsWithCategory);
  } catch (error) {
    console.error('❌ Error fetching category products:', error);
    res.status(500).json({ error: 'Failed to fetch products by category' });
  }
});

// ✅ GET: All Products across all categories (Optimized with better caching)
app.get('/api/products/all', cache('5 minutes'), async (req, res) => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const categoryCollectionNames = collections
      .map((c) => c.name)
      .filter((name) => /^[A-Z0-9_]+$/.test(name));

    // Fetch all collections in parallel with optimized queries
    const allProductsArrays = await Promise.all(
      categoryCollectionNames.map(async (collectionName) => {
        try {
          const Model = getProductModelByCategory(collectionName.replace(/_/g, ' '));
          // Use lean() for faster plain objects, project only needed fields
          const docs = await Model.find({}, {
            name_en: 1,
            name_ta: 1,
            price: 1,
            original_price: 1,
            imageUrl: 1,
            youtube_url: 1,
            createdAt: 1,
          }).lean();
          
          const category = collectionName.replace(/_/g, ' ');
          return docs.map((doc) => ({ ...doc, category }));
        } catch (err) {
          console.warn(`⚠️ Warning: Could not fetch products for collection ${collectionName}:`, err.message);
          return [];
        }
      })
    );

    const allProducts = ([]).concat(...allProductsArrays);
    res.json(allProducts);
  } catch (error) {
    console.error('❌ Error fetching all products:', error);
    res.status(500).json({ error: 'Failed to fetch all products' });
  }
});

// ✅ DELETE: Delete Product by ID
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Search all category collections for the product
    const collections = await mongoose.connection.db.listCollections().toArray();
    let deleted = false;
    for (const col of collections) {
      const modelName = col.name;
      // Only check collections that match the category naming pattern
      if (/^[A-Z0-9_]+$/.test(modelName)) {
        const Model = getProductModelByCategory(modelName.replace(/_/g, ' '));
        const result = await Model.findByIdAndDelete(id);
        if (result) {
          deleted = true;
          break;
        }
      }
    }
    if (deleted) {
      res.status(200).json({ message: '✅ Product deleted successfully', id });
    } else {
      res.status(404).json({ error: 'Product not found' });
    }
  } catch (error) {
    console.error('❌ Product DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ✅ FCM Token Registration
app.post('/api/notifications/register-token', async (req, res) => {
  try {
    const { token, userId } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'FCM token is required' });
    }
    
    fcmTokens.set(userId, token);
    console.log(`✅ FCM token registered for user: ${userId}`);
    res.json({ message: 'Token registered successfully' });
  } catch (error) {
    console.error('❌ Error registering FCM token:', error);
    res.status(500).json({ error: 'Failed to register token' });
  }
});

// ✅ Send Push Notification
app.post('/api/notifications/send', async (req, res) => {
  try {
    const { title, body, userId, data } = req.body;
    
    if (!firebaseApp) {
      return res.status(500).json({ error: 'Firebase Admin not initialized' });
    }
    
    const token = fcmTokens.get(userId);
    if (!token) {
      return res.status(404).json({ error: 'User token not found' });
    }
    
    const message = {
      notification: {
        title: title || 'KMPyrotech',
        body: body || 'You have a new notification',
      },
      data: data || {},
      token: token,
    };
    
    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent:', response);
    res.json({ message: 'Notification sent successfully', messageId: response });
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ✅ Send Notification to All Users
app.post('/api/notifications/send-to-all', async (req, res) => {
  try {
    const { title, body, data } = req.body;
    
    if (!firebaseApp) {
      return res.status(500).json({ error: 'Firebase Admin not initialized' });
    }
    
    const tokens = Array.from(fcmTokens.values());
    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No registered tokens found' });
    }
    
    const message = {
      notification: {
        title: title || 'KMPyrotech',
        body: body || 'You have a new notification',
      },
      data: data || {},
      tokens: tokens,
    };
    
    const response = await admin.messaging().sendMulticast(message);
    console.log('✅ Multicast notification sent:', response);
    res.json({ 
      message: 'Notifications sent successfully', 
      successCount: response.successCount,
      failureCount: response.failureCount
    });
  } catch (error) {
    console.error('❌ Error sending multicast notification:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// ✅ Get Registered Tokens Count
app.get('/api/notifications/tokens-count', (req, res) => {
  res.json({ count: fcmTokens.size });
});

// Performance monitoring middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`📊 ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  
  // Handle CORS errors specifically
  if (err.message && err.message.includes('CORS')) {
    console.error('🌐 CORS Error Details:', {
      origin: req.headers.origin,
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent']
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ✅ GET: Performance metrics
app.get('/api/performance', (req, res) => {
  res.json({
    status: 'Server running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    endpoints: {
      home: '/api/products/home - Optimized for first impression',
      category: '/api/products/category/:category - Optimized with lean queries',
      all: '/api/products/all - Optimized with parallel fetching'
    }
  });
});

// ✅ Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cors: 'enabled',
    allowedOrigins: [
      'https://www.kmpyrotech.com',
      'https://kmpyrotech.com',
      'http://localhost:3000',
      'http://localhost:5173'
    ]
  });
});

// ✅ Test CORS endpoint
app.get('/api/test-cors', (req, res) => {
  console.log('🧪 Test CORS endpoint called');
  console.log('📋 Request headers:', req.headers);
  res.json({
    message: 'CORS test successful',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    method: req.method
  });
});

// ✅ CATEGORY MANAGEMENT API
// GET: Fetch all categories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .select('name displayName description isActive createdAt')
      .lean();
    
    // Extract just the names for backward compatibility
    const categoryNames = categories.map(cat => cat.name);
    
    res.json(categoryNames);
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST: Add new category
app.post('/api/categories', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required and must be a non-empty string' });
    }
    
    const trimmedName = name.trim().toUpperCase();
    
    // Check if category already exists in database
    const existingCategory = await Category.findOne({ name: trimmedName });
    if (existingCategory) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    
    // Create new category in database
    const newCategory = new Category({
      name: trimmedName,
      displayName: name.trim(),
      isActive: true
    });
    
    await newCategory.save();
    console.log(`✅ New category added to database: ${trimmedName}`);
    
    res.status(201).json({ 
      message: 'Category added successfully',
      category: trimmedName
    });
  } catch (error) {
    console.error('❌ Error adding category:', error);
    res.status(500).json({ error: 'Failed to add category' });
  }
});

// PATCH: Edit category display name and optionally rename collection
app.patch('/api/categories/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { displayName } = req.body;
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    const decodedName = decodeURIComponent(name);
    const existing = await Category.findOne({ name: decodedName });
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await Category.updateOne({ name: decodedName }, { $set: { displayName: displayName.trim(), updatedAt: new Date() } });
    res.json({ message: '✅ Category updated', name: decodedName, displayName: displayName.trim() });
  } catch (error) {
    console.error('❌ Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE: Remove category
app.delete('/api/categories/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name);
    
    if (!decodedName) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    // Check if category exists in database
    const existingCategory = await Category.findOne({ name: decodedName });
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    // Soft delete by setting isActive to false
    // This preserves existing products and prevents data loss
    await Category.findOneAndUpdate(
      { name: decodedName },
      { isActive: false, updatedAt: new Date() }
    );
    
    console.log(`✅ Category deactivated: ${decodedName}`);
    
    res.json({ 
      message: 'Category removed successfully',
      category: decodedName
    });
  } catch (error) {
    console.error('❌ Error removing category:', error);
    res.status(500).json({ error: 'Failed to remove category' });
  }
});

// GET: Get categories for user side (public)
app.get('/api/categories/public', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .select('name displayName')
      .lean();
    
    res.json(categories);
  } catch (error) {
    console.error('❌ Error fetching public categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET: Get detailed category information with product counts
app.get('/api/categories/detailed', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .lean();
    
    // Get product counts for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        try {
          const ProductModel = getProductModelByCategory(category.name);
          const count = await ProductModel.countDocuments();
          return {
            name: category.name,
            displayName: category.displayName,
            description: category.description,
            productCount: count,
            createdAt: category.createdAt
          };
        } catch (err) {
          return {
            name: category.name,
            displayName: category.displayName,
            description: category.description,
            productCount: 0,
            createdAt: category.createdAt
          };
        }
      })
    );
    
    res.json(categoriesWithCounts);
  } catch (error) {
    console.error('❌ Error fetching detailed categories:', error);
    res.status(500).json({ error: 'Failed to fetch detailed categories' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌐 CORS enabled for origins: https://www.kmpyrotech.com, https://kmpyrotech.com`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Railway deployment: ${process.env.RAILWAY_ENVIRONMENT ? 'Yes' : 'No'}`);
});


// Removed hardcoded default categories initialization to avoid duplication.

// Performance optimization: Add database indexes for faster queries
const setupDatabaseIndexes = async () => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const categoryCollectionNames = collections
      .map((c) => c.name)
      .filter((name) => /^[A-Z0-9_]+$/.test(name));

    // Create indexes for each category collection
    for (const collectionName of categoryCollectionNames) {
      try {
        const collection = mongoose.connection.db.collection(collectionName);
        await collection.createIndex({ name_en: 1 });
        await collection.createIndex({ category: 1 });
        await collection.createIndex({ price: 1 });
        console.log(`✅ Indexes created for collection: ${collectionName}`);
      } catch (err) {
        console.warn(`⚠️ Could not create indexes for ${collectionName}:`, err.message);
      }
    }
  } catch (error) {
    console.warn('⚠️ Database index setup failed:', error.message);
  }
};

// Call setup function when database connects
mongoose.connection.once('open', () => {
  console.log('✅ Connected to MongoDB');
  setupDatabaseIndexes();
  // Default categories are managed client-side (mockData) or via /api/categories endpoints.
});
