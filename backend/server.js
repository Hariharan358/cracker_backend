import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { Order } from './models/order.model.js';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import apicache from 'apicache';
import Queue from 'bull';
import { createClient } from 'redis';
import admin from 'firebase-admin';
import { body, validationResult } from 'express-validator';

dotenv.config();

// Validate environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD'
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
app.set('timeout', 60000); // 60-second timeout

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message, err.stack);
  if (process.env.NODE_ENV !== 'production') process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.NODE_ENV !== 'production') process.exit(1);
});

// Security and performance middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://www.kmpyrotech.com',
      'https://kmpyrotech.com',
      process.env.FRONTEND_URL,
      process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
      process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : null
    ].filter(Boolean);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Handle CORS errors
app.use((err, req, res, next) => {
  if (err.message.includes('CORS policy')) {
    console.error(`❌ CORS error: ${err.message}`);
    return res.status(403).json({ error: 'CORS policy violation', message: 'Origin not allowed' });
  }
  next(err);
});

app.use(express.json());

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer setup for image uploads
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'products', allowed_formats: ['jpg', 'jpeg', 'png'], public_id: (req, file) => `${Date.now()}-${file.originalname}` }
});
const upload = multer({ storage });

// Firebase initialization
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
  console.error('❌ Firebase Admin initialization failed:', error.message, error.stack);
  firebaseApp = null;
}

// Bull queue for background jobs
const invoiceQueue = new Queue('invoice-processing', {
  redis: { url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', maxRetriesPerRequest: 3 },
});
invoiceQueue.on('error', (error) => console.error('❌ Bull queue error:', error.message, error.stack));
invoiceQueue.on('failed', (job, err) => console.error(`❌ Job ${job.id} for order ${job.data.orderId} failed:`, err.message, err.stack));
invoiceQueue.on('completed', (job) => {
  job.remove();
  console.log(`✅ Job ${job.id} for order ${job.data.orderId} completed`);
});

// MongoDB schema and model
const modelCache = {};
const productSchema = new mongoose.Schema({
  name_en: String,
  name_ta: String,
  price: Number,
  original_price: Number,
  imageUrl: String,
  youtube_url: String,
  category: String,
}, { timestamps: true });

function getProductModelByCategory(category) {
  const modelName = category.replace(/\s+/g, '_').toUpperCase();
  if (!modelCache[modelName]) {
    modelCache[modelName] = mongoose.model(modelName, productSchema, modelName);
  }
  return modelCache[modelName];
}

// Invoice generation (using Cloudinary)
async function generateInvoice(order) {
  const doc = new PDFDocument({ margin: 40 });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => Promise.resolve(Buffer.concat(buffers)));

  doc.fontSize(28).fillColor('#d97706').text('KMPyrotech Invoice', { align: 'center', underline: true });
  doc.moveDown(2);
  const boxTop = doc.y;
  const boxLeft = 40;
  const boxWidth = 520;
  let boxHeight = 350 + (order.items.length * 25);
  doc.lineWidth(2).roundedRect(boxLeft, boxTop, boxWidth, boxHeight, 12).stroke('#d97706');
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#d97706').font('Helvetica-Bold').text('Customer Information', boxLeft + 16, doc.y + 20);
  doc.fontSize(12).fillColor('#222').font('Helvetica');
  const startY = doc.y + 40;
  doc.text(`Order ID: ${order.orderId}`, boxLeft + 16, startY);
  doc.text(`Name: ${order.customerDetails.fullName}`, boxLeft + 16, startY + 25);
  doc.text(`Mobile: ${order.customerDetails.mobile}`, boxLeft + 16, startY + 50);
  doc.text(`Address: ${order.customerDetails.address}`, boxLeft + 16, startY + 75, { width: 240 });
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString('en-IN')}`, boxLeft + 280, startY);
  doc.text(`Email: ${order.customerDetails.email}`, boxLeft + 280, startY + 25);
  doc.text(`Pincode: ${order.customerDetails.pincode}`, boxLeft + 280, startY + 50);
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#d97706').text('Order Items', boxLeft + 16, doc.y + 20);
  doc.moveDown(0.5);
  doc.lineWidth(1).moveTo(boxLeft + 16, doc.y + 5).lineTo(boxLeft + boxWidth - 16, doc.y + 5).stroke('#d97706');
  const tableY = doc.y + 15;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#d97706');
  doc.text('No.', boxLeft + 16, tableY);
  doc.text('Product Name', boxLeft + 60, tableY);
  doc.text('Qty', boxLeft + 280, tableY);
  doc.text('Price', boxLeft + 320, tableY);
  doc.text('Total', boxLeft + 380, tableY);
  doc.moveTo(boxLeft + 16, tableY + 15).lineTo(boxLeft + boxWidth - 16, tableY + 15).stroke('#d97706');
  doc.font('Helvetica').fontSize(11).fillColor('#222');
  order.items.forEach((item, idx) => {
    const rowY = tableY + 25 + (idx * 20);
    doc.text(`${idx + 1}.`, boxLeft + 16, rowY);
    doc.text(item.name_en, boxLeft + 60, rowY, { width: 200 });
    doc.text(`${item.quantity}`, boxLeft + 280, rowY);
    doc.text(`₹${item.price}`, boxLeft + 320, rowY);
    doc.text(`₹${item.price * item.quantity}`, boxLeft + 380, rowY);
  });
  const lastRowY = tableY + 25 + (order.items.length * 20);
  doc.moveTo(boxLeft + 16, lastRowY + 10).lineTo(boxLeft + boxWidth - 16, lastRowY + 10).stroke('#d97706');
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#222').text(`Order Status: ${order.status || 'confirmed'}`, boxLeft + 16, lastRowY + 30);
  doc.fontSize(16).fillColor('#d97706').text(`Total Amount: ₹${order.total}`, boxLeft + 280, lastRowY + 30);
  doc.moveDown(3);
  doc.fontSize(14).fillColor('#16a34a').font('Helvetica-Bold').text('Thank you for shopping with KMPyrotech!', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#16a34a').text('Wishing you a safe and sparkling festival!', { align: 'center' });
  doc.end();

  const pdfBuffer = await new Promise(resolve => {
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });

  const result = await cloudinary.uploader.upload_stream(
    { folder: 'invoices', public_id: `${order.orderId}.pdf`, resource_type: 'raw' },
    (error, uploadResult) => {
      if (error) throw error;
      return uploadResult.secure_url;
    }
  ).end(pdfBuffer);
  return result.secure_url;
}

async function sendEmailWithInvoice(to, invoiceUrl) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_FROM, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"KMPyrotech" <${process.env.EMAIL_FROM}>`,
    to,
    subject: 'KMPyrotech - Your Order Invoice',
    text: 'Thank you for your order! Please find your invoice attached.',
    attachments: [{ filename: 'invoice.pdf', path: invoiceUrl }],
  });
}

// Routes
app.get('/api/health', async (req, res) => {
  let mongoStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let firebaseStatus = firebaseApp ? 'initialized' : 'not initialized';
  try {
    await mongoose.connection.db.admin().ping();
    mongoStatus = 'connected';
  } catch (err) {
    console.error('❌ MongoDB health check failed:', err.message, err.stack);
  }
  try {
    const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
    await redisClient.connect();
    await redisClient.ping();
    redisStatus = 'connected';
    await redisClient.quit();
  } catch (err) {
    console.error('❌ Redis health check failed:', err.message, err.stack);
  }
  res.status(mongoStatus === 'connected' && redisStatus === 'connected' ? 200 : 503).json({
    status: mongoStatus === 'connected' && redisStatus === 'connected' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    cors: 'enabled',
    allowedOrigins: corsOptions.origin,
    mongoStatus,
    redisStatus,
    firebaseStatus,
    uptime: process.uptime(),
  });
});

app.get('/api/orders/track', async (req, res) => {
  try {
    const { orderId, mobile } = req.query;
    if (!orderId || !mobile) return res.status(400).json({ error: 'Missing orderId or mobile number' });
    const order = await Order.findOne({ orderId: String(orderId), 'customerDetails.mobile': String(mobile) });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    console.error('❌ Error tracking order:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

app.post('/api/orders/upload-payment', upload.single('screenshot'), async (req, res) => {
  try {
    const { orderId, mobile } = req.body;
    if (!orderId || !mobile || !req.file) return res.status(400).json({ error: 'Missing orderId, mobile number, or screenshot' });
    const order = await Order.findOne({ orderId: String(orderId), 'customerDetails.mobile': String(mobile) });
    if (!order) return res.status(404).json({ error: 'Order not found or mobile number does not match' });
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId: String(orderId) },
      { $set: { 'paymentScreenshot.imageUrl': req.file.path, 'paymentScreenshot.uploadedAt': new Date(), 'paymentScreenshot.verified': false } },
      { new: true }
    );
    res.json({ message: '✅ Payment screenshot uploaded successfully', order: updatedOrder });
  } catch (error) {
    console.error('❌ Error uploading payment screenshot:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to upload payment screenshot' });
  }
});

app.patch('/api/orders/verify-payment/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { verified, verifiedBy } = req.body;
    if (typeof verified !== 'boolean') return res.status(400).json({ error: 'Verified status is required' });
    const updateFields = {
      'paymentScreenshot.verified': verified,
      'paymentScreenshot.verifiedBy': verifiedBy || 'admin',
      'paymentScreenshot.verifiedAt': new Date(),
      status: verified ? 'payment_verified' : 'confirmed'
    };
    const order = await Order.findOneAndUpdate({ orderId }, { $set: updateFields }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: `✅ Payment ${verified ? 'verified' : 'rejected'} successfully`, order });
  } catch (error) {
    console.error('❌ Error verifying payment:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { date, orderId, page = 1, limit = 20 } = req.query;
    const query = {};
    if (orderId) query.orderId = { $regex: orderId, $options: 'i' };
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    const orders = await Order.find(query).sort({ createdAt: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean();
    const total = await Order.countDocuments(query);
    res.json({ orders, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error('❌ Error fetching orders:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.delete('/api/orders/cancel/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const deletedOrder = await Order.findOneAndDelete({ orderId });
    if (!deletedOrder) return res.status(404).json({ error: 'Order not found' });
    res.status(200).json({ message: '✅ Order cancelled successfully', orderId });
  } catch (error) {
    console.error('❌ Order cancellation error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    let { name_en, name_ta, price, original_price, category, youtube_url, imageUrl } = req.body;
    let finalImageUrl = req.file?.path || imageUrl;
    if (!name_en || !name_ta || !price || !category || !finalImageUrl) return res.status(400).json({ error: 'All fields including image (file or URL) and category are required' });
    price = Number(price);
    original_price = original_price ? Number(original_price) : undefined;
    const ProductModel = getProductModelByCategory(category);
    const newProduct = new ProductModel({ name_en, name_ta, price, original_price, imageUrl: finalImageUrl, youtube_url });
    await newProduct.save();
    res.status(201).json({ message: '✅ Product added successfully', product: newProduct });
  } catch (error) {
    console.error('❌ Product POST error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

app.post('/api/products/apply-discount', async (req, res) => {
  try {
    const { discount } = req.body;
    if (typeof discount !== 'number' || discount < 0 || discount > 100) return res.status(400).json({ error: 'Invalid discount percentage' });
    const collections = await mongoose.connection.db.listCollections().toArray();
    let totalUpdated = 0;
    for (const col of collections) {
      const modelName = col.name;
      if (/^[A-Z0-9_]+$/.test(modelName)) {
        const Model = mongoose.model(modelName, productSchema, modelName);
        const result = await Model.updateMany(
          { original_price: { $exists: true, $ne: null } },
          [{ $set: { price: { $round: [{ $multiply: ["$original_price", (1 - discount / 100)] }, 0] } } }]
        );
        totalUpdated += result.modifiedCount || 0;
      }
    }
    apicache.clear();
    res.json({ message: `✅ Discount applied to all products`, updated: totalUpdated });
  } catch (error) {
    console.error('❌ Error applying discount:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to apply discount to products' });
  }
});

const fcmTokens = new Map();

app.post('/api/orders/place', [
  body('items').isArray().notEmpty().withMessage('Items array is required'),
  body('total').isNumeric().withMessage('Total must be a number'),
  body('customerDetails.fullName').notEmpty().withMessage('Full name is required'),
  body('customerDetails.mobile').notEmpty().withMessage('Mobile number is required'),
  body('customerDetails.email').isEmail().withMessage('Valid email is required'),
  body('customerDetails.address').notEmpty().withMessage('Address is required'),
  body('customerDetails.pincode').notEmpty().withMessage('Pincode is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { items, total, customerDetails, status, createdAt } = req.body;
    const generateOrderId = async () => {
      const today = new Date();
      const dateStr = today.getDate().toString().padStart(2, '0') + (today.getMonth() + 1).toString().padStart(2, '0') + today.getFullYear().toString().slice(-2);
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      const latestOrder = await Order.findOne({ createdAt: { $gte: startOfDay, $lte: endOfDay } }).sort({ orderId: -1 });
      let nextNumber = 1;
      if (latestOrder && latestOrder.orderId) {
        const match = latestOrder.orderId.match(/^(\d{8})(\d{2})$/);
        if (match && match[1] === dateStr) nextNumber = parseInt(match[2]) + 1;
      }
      return `${dateStr}${nextNumber.toString().padStart(2, '0')}`;
    };

    let orderId;
    let attempts = 0;
    const maxAttempts = 10;
    do {
      orderId = await generateOrderId();
      attempts++;
      if (attempts > maxAttempts) return res.status(500).json({ error: 'Failed to generate unique order ID' });
    } while (await Order.findOne({ orderId }));

    const newOrder = new Order({ orderId, items, total, customerDetails, status: 'confirmed', createdAt: createdAt || new Date().toISOString() });
    await newOrder.save();

    try {
      const invoiceUrl = await generateInvoice(newOrder);
      if (process.env.EMAIL_FROM && process.env.EMAIL_PASS) {
        invoiceQueue.add({ email: customerDetails.email, invoiceUrl, orderId }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
        console.log('✅ Invoice job queued');
      }
    } catch (invoiceError) {
      console.error('⚠️ Invoice generation failed:', invoiceError.message, invoiceError.stack);
    }

    try {
      const adminToken = fcmTokens.get('admin');
      if (adminToken && firebaseApp) {
        const adminMessage = {
          notification: { title: '🆕 New Order Received!', body: `Order ${orderId} - ₹${total} from ${customerDetails.fullName}` },
          data: { orderId, total: total.toString(), customerName: customerDetails.fullName, type: 'new_order' },
          token: adminToken,
        };
        await admin.messaging().send(adminMessage);
        console.log('✅ Admin notification sent for new order');
      }
    } catch (notificationError) {
      console.error('⚠️ Failed to send admin notification:', notificationError.message, notificationError.stack);
    }

    res.status(201).json({ message: '✅ Order placed successfully', orderId });
  } catch (error) {
    console.error('❌ Order placement error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    return res.json({ success: true, token: "admin-auth-token" });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

app.get('/api/analytics', apicache.middleware('2 minutes'), async (req, res) => {
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
    console.error('❌ Analytics fetch error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.patch('/api/orders/update-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, transportName, lrNumber } = req.body;
    let updateFields = {};
    if (transportName || lrNumber) {
      updateFields.transportName = transportName || '';
      updateFields.lrNumber = lrNumber || '';
      updateFields.status = 'booked';
    } else if (status) {
      const currentOrder = await Order.findOne({ orderId });
      if (!currentOrder) return res.status(404).json({ error: 'Order not found' });
      const validTransitions = {
        'confirmed': ['payment_verified', 'booked'],
        'payment_verified': ['booked'],
        'booked': ['booked']
      };
      if (!validTransitions[currentOrder.status]?.includes(status)) {
        return res.status(400).json({ error: `Invalid status transition from '${currentOrder.status}' to '${status}'` });
      }
      updateFields.status = status;
    } else {
      return res.status(400).json({ error: 'Status or transport details required' });
    }
    const order = await Order.findOneAndUpdate({ orderId }, { $set: updateFields }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });

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
            notification: { title: notificationTitle, body: notificationBody },
            data: { orderId, status: updateFields.status, type: 'order_status_update' },
            token: customerToken,
          };
          await admin.messaging().send(customerMessage);
          console.log(`✅ Customer notification sent for order ${orderId} status: ${updateFields.status}`);
        }
      }
    } catch (notificationError) {
      console.error('❌ Failed to send customer notification:', notificationError.message, notificationError.stack);
    }

    res.json({ message: '✅ Order updated successfully', order });
  } catch (error) {
    console.error('❌ Status update error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

app.get('/api/products/home', apicache.middleware('3 minutes'), async (req, res) => {
  try {
    const featuredCategories = ['ATOM_BOMB', 'SPARKLER_ITEMS'];
    const homeProducts = await Promise.all(
      featuredCategories.map(async (category) => {
        try {
          const ProductModel = getProductModelByCategory(category);
          const products = await ProductModel.find({}, {
            name_en: 1,
            name_ta: 1,
            price: 1,
            original_price: 1,
            imageUrl: 1,
            youtube_url: 1,
            category: 1
          }).limit(6).lean();
          return products.map(product => ({ ...product, category: category.replace(/_/g, ' ') }));
        } catch (err) {
          console.warn(`⚠️ Warning: Could not fetch products for category ${category}:`, err.message);
          return [];
        }
      })
    );
    res.json(homeProducts.flat());
  } catch (error) {
    console.error('❌ Error fetching home page products:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch home page products' });
  }
});

app.get('/api/products/category/:category', apicache.middleware('2 minutes'), async (req, res) => {
  try {
    let { category } = req.params;
    // Normalize category: replace spaces/hyphens with underscores, convert to uppercase
    category = category
      .replace(/%20/g, '_')
      .replace(/ /g, '_')
      .replace(/-/g, '_')
      .toUpperCase();
    // Validate category against known collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    const validCollections = collections
      .map(c => c.name)
      .filter(name => /^[A-Z0-9_]+$/.test(name));
    if (!validCollections.includes(category)) {
      return res.status(404).json({ error: `Category ${category} not found` });
    }
    const ProductModel = getProductModelByCategory(category);
    const products = await ProductModel.find({}, {
      name_en: 1,
      name_ta: 1,
      price: 1,
      original_price: 1,
      imageUrl: 1,
      youtube_url: 1,
      category: 1
    }).lean();
    res.json(products.map(product => ({ ...product, category: category.replace(/_/g, ' ') })));
  } catch (error) {
    console.error(`❌ Error fetching category products for ${req.params.category}:`, error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch products by category' });
  }
});

app.get('/api/products/all', apicache.middleware('5 minutes'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const collections = await mongoose.connection.db.listCollections().toArray();
    const categoryCollectionNames = collections.map(c => c.name).filter(name => /^[A-Z0-9_]+$/.test(name));
    const allProductsArrays = await Promise.all(
      categoryCollectionNames.map(async (collectionName) => {
        try {
          const Model = mongoose.model(collectionName, productSchema, collectionName);
          const docs = await Model.find({}, {
            name_en: 1,
            name_ta: 1,
            price: 1,
            original_price: 1,
            imageUrl: 1,
            youtube_url: 1,
          }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean();
          return docs.map(doc => ({ ...doc, category: collectionName.replace(/_/g, ' ') }));
        } catch (err) {
          console.warn(`⚠️ Warning: Could not fetch products for collection ${collectionName}:`, err.message);
          return [];
        }
      })
    );
    res.json(allProductsArrays.flat());
  } catch (error) {
    console.error('❌ Error fetching all products:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch all products' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const collections = await mongoose.connection.db.listCollections().toArray();
    let deleted = false;
    for (const col of collections) {
      const modelName = col.name;
      if (/^[A-Z0-9_]+$/.test(modelName)) {
        const Model = mongoose.model(modelName, productSchema, modelName);
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
    console.error('❌ Product DELETE error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.post('/api/notifications/register-token', async (req, res) => {
  try {
    const { token, userId } = req.body;
    if (!token) return res.status(400).json({ error: 'FCM token is required' });
    fcmTokens.set(userId, token);
    console.log(`✅ FCM token registered for user: ${userId}`);
    res.json({ message: 'Token registered successfully' });
  } catch (error) {
    console.error('❌ Error registering FCM token:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to register token' });
  }
});

app.post('/api/notifications/send', async (req, res) => {
  try {
    if (!firebaseApp) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const { title, body, userId, data } = req.body;
    const token = fcmTokens.get(userId);
    if (!token) return res.status(404).json({ error: 'User token not found' });
    const message = {
      notification: { title: title || 'KMPyrotech', body: body || 'You have a new notification' },
      data: data || {},
      token,
    };
    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent:', response);
    res.json({ message: 'Notification sent successfully', messageId: response });
  } catch (error) {
    console.error('❌ Error sending push notification:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

app.post('/api/notifications/send-to-all', async (req, res) => {
  try {
    if (!firebaseApp) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const { title, body, data } = req.body;
    const tokens = Array.from(fcmTokens.values());
    if (tokens.length === 0) return res.status(404).json({ error: 'No registered tokens found' });
    const message = {
      notification: { title: title || 'KMPyrotech', body: body || 'You have a new notification' },
      data: data || {},
      tokens,
    };
    const response = await admin.messaging().sendMulticast(message);
    console.log('✅ Multicast notification sent:', response);
    res.json({ message: 'Notifications sent successfully', successCount: response.successCount, failureCount: response.failureCount });
  } catch (error) {
    console.error('❌ Error sending multicast notification:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

app.get('/api/notifications/tokens-count', (req, res) => {
  res.json({ count: fcmTokens.size });
});

app.get('/api/performance', (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    status: 'Server running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memory.external / 1024 / 1024).toFixed(2)} MB`,
    },
    endpoints: {
      home: '/api/products/home - Optimized for first impression',
      category: '/api/products/category/:category - Optimized with lean queries',
      all: '/api/products/all - Optimized with parallel fetching'
    }
  });
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`📊 ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - Body: ${JSON.stringify(req.body)} - Query: ${JSON.stringify(req.query)}`);
  });
  next();
});

app.use((err, req, res, next) => {
  console.error(`❌ Server error on ${req.method} ${req.path}:`, err.message, err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI, { retryWrites: true, w: 'majority', retryReads: true, maxPoolSize: 10 })
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`🌐 CORS enabled for origins: ${corsOptions.origin}`);
      console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📊 Railway deployment: ${process.env.RAILWAY_ENVIRONMENT ? 'Yes' : 'No'}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message, err.stack);
    process.exit(1);
  });

const setupDatabaseIndexes = async () => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const categoryCollectionNames = collections.map(c => c.name).filter(name => /^[A-Z0-9_]+$/.test(name));
    for (const collectionName of categoryCollectionNames) {
      try {
        const collection = mongoose.connection.db.collection(collectionName);
        const indexes = await collection.indexes();
        if (!indexes.some(index => index.key.name_en)) {
          await collection.createIndex({ name_en: 1 });
          console.log(`✅ Index created on name_en for ${collectionName}`);
        }
        if (!indexes.some(index => index.key.category)) {
          await collection.createIndex({ category: 1 });
          console.log(`✅ Index created on category for ${collectionName}`);
        }
        if (!indexes.some(index => index.key.price)) {
          await collection.createIndex({ price: 1 });
          console.log(`✅ Index created on price for ${collectionName}`);
        }
      } catch (err) {
        console.warn(`⚠️ Could not create indexes for ${collectionName}:`, err.message);
      }
    }
  } catch (error) {
    console.warn('⚠️ Database index setup failed:', error.message);
  }
};

mongoose.connection.once('open', () => {
  console.log('✅ Connected to MongoDB');
  setupDatabaseIndexes();
});
