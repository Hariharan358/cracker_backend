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
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import apicache from 'apicache';

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
  "http://localhost:5000",
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

const modelCache = {};
const productSchema = new mongoose.Schema({
  name_en: String,
  name_ta: String,
  price: Number,
  original_price: Number, // Add this field
  imageUrl: String,
  youtube_url: String, // Add this field
  category: String,    // Add this field for completeness
}, { timestamps: true });

function getProductModelByCategory(category) {
  const modelName = category.replace(/\s+/g, '_').toUpperCase();
  if (!modelCache[modelName]) {
    modelCache[modelName] = mongoose.model(modelName, productSchema, modelName);
  }
  return modelCache[modelName];
}

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

function generateInvoice(order, filePath) {
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  // Header
  doc
    .fontSize(28)
    .fillColor('#d97706')
    .text('KMPyrotech Invoice', { align: 'center', underline: true });
  doc.moveDown(2);

  // Draw main box
  const boxTop = doc.y;
  const boxLeft = 40;
  const boxWidth = 520;
  let boxHeight = 350 + (order.items.length * 25);

  // Draw rectangle (box)
  doc
    .lineWidth(2)
    .roundedRect(boxLeft, boxTop, boxWidth, boxHeight, 12)
    .stroke('#d97706');

  // Customer Information Section
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#d97706').font('Helvetica-Bold');
  doc.text('Customer Information', boxLeft + 16, doc.y + 20);
  
  doc.fontSize(12).fillColor('#222').font('Helvetica');
  const startY = doc.y + 40;
  
  // Left column
  doc.text(`Order ID: ${order.orderId}`, boxLeft + 16, startY);
  doc.text(`Name: ${order.customerDetails.fullName}`, boxLeft + 16, startY + 25);
  doc.text(`Mobile: ${order.customerDetails.mobile}`, boxLeft + 16, startY + 50);
  doc.text(`Address: ${order.customerDetails.address}`, boxLeft + 16, startY + 75, { width: 240 });
  
  // Right column
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString('en-IN')}`, boxLeft + 280, startY);
  doc.text(`Email: ${order.customerDetails.email}`, boxLeft + 280, startY + 25);
  doc.text(`Pincode: ${order.customerDetails.pincode}`, boxLeft + 280, startY + 50);
  
  doc.moveDown(2);

  // Products Table Header
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#d97706');
  doc.text('Order Items', boxLeft + 16, doc.y + 20);
  
  // Table header line
  doc.moveDown(0.5);
  doc.lineWidth(1);
  doc.moveTo(boxLeft + 16, doc.y + 5);
  doc.lineTo(boxLeft + boxWidth - 16, doc.y + 5);
  doc.stroke('#d97706');
  
  // Table columns header
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#d97706');
  const tableY = doc.y + 15;
  doc.text('No.', boxLeft + 16, tableY);
  doc.text('Product Name', boxLeft + 60, tableY);
  doc.text('Qty', boxLeft + 280, tableY);
  doc.text('Price', boxLeft + 320, tableY);
  doc.text('Total', boxLeft + 380, tableY);
  
  // Table header line
  doc.moveTo(boxLeft + 16, tableY + 15);
  doc.lineTo(boxLeft + boxWidth - 16, tableY + 15);
  doc.stroke('#d97706');

  // Products Table Rows
  doc.font('Helvetica').fontSize(11).fillColor('#222');
  order.items.forEach((item, idx) => {
    const rowY = tableY + 25 + (idx * 20);
    doc.text(`${idx + 1}.`, boxLeft + 16, rowY);
    doc.text(item.name_en, boxLeft + 60, rowY, { width: 200 });
    doc.text(`${item.quantity}`, boxLeft + 280, rowY);
    doc.text(`₹${item.price}`, boxLeft + 320, rowY);
    doc.text(`₹${item.price * item.quantity}`, boxLeft + 380, rowY);
  });
  
  // Table bottom line
  const lastRowY = tableY + 25 + (order.items.length * 20);
  doc.moveTo(boxLeft + 16, lastRowY + 10);
  doc.lineTo(boxLeft + boxWidth - 16, lastRowY + 10);
  doc.stroke('#d97706');

  // Order Summary
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#222');
  doc.text(`Order Status: ${order.status || 'confirmed'}`, boxLeft + 16, lastRowY + 30);
  
  // Total Amount
  doc.fontSize(16).fillColor('#d97706');
  doc.text(`Total Amount: ₹${order.total}`, boxLeft + 280, lastRowY + 30);

  // Thank you note
  doc.moveDown(3);
  doc.fontSize(14).fillColor('#16a34a').font('Helvetica-Bold');
  doc.text('Thank you for shopping with KMPyrotech!', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#16a34a');
  doc.text('Wishing you a safe and sparkling festival!', { align: 'center' });

  doc.end();
}

async function sendEmailWithInvoice(to, filePath) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASS,
    },
  });
  await transporter.sendMail({
    from: `"KMPyrotech" <${process.env.EMAIL_FROM}>`,
    to,
    subject: 'KMPyrotech - Your Order Invoice',
    text: 'Thank you for your order! Please find your invoice attached.',
    attachments: [{ filename: 'invoice.pdf', path: filePath }],
  });
}

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
        const Model = mongoose.model(modelName, productSchema, modelName);
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



// ✅ POST: Place Order
app.post('/api/orders/place', async (req, res) => {
  try {
    const { items, total, customerDetails, status, createdAt } = req.body;
    if (!items || !total || !customerDetails) {
      return res.status(400).json({ error: 'Missing required order fields.' });
    }

    // Generate unique order ID on the backend
    const generateOrderId = async () => {
      const today = new Date();
      const dateStr = today.getDate().toString().padStart(2, '0') + 
                     (today.getMonth() + 1).toString().padStart(2, '0') + 
                     today.getFullYear().toString().slice(-2);
      
      // Get the latest order for today to determine the next sequential number
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      
      const latestOrder = await Order.findOne({
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      }).sort({ orderId: -1 });
      
      let nextNumber = 1;
      if (latestOrder && latestOrder.orderId) {
        // Extract the number from the latest order ID (last 2 digits)
        const match = latestOrder.orderId.match(/^(\d{8})(\d{2})$/);
        if (match && match[1] === dateStr) {
          nextNumber = parseInt(match[2]) + 1;
        }
      }
      
      // Format as DDMMYYYYNN (date + 2-digit sequential number)
      return `${dateStr}${nextNumber.toString().padStart(2, '0')}`;
    };

    let orderId;
    let attempts = 0;
    const maxAttempts = 10;
    
    // Try to generate a unique order ID
    do {
      orderId = await generateOrderId();
      attempts++;
      if (attempts > maxAttempts) {
        return res.status(500).json({ error: 'Failed to generate unique order ID' });
      }
    } while (await Order.findOne({ orderId }));

    // Always start with 'confirmed' status when order is placed
    const newOrder = new Order({
      orderId,
      items,
      total,
      customerDetails,
      status: 'confirmed', // Always start with confirmed
      createdAt: createdAt || new Date().toISOString(),
    });
    await newOrder.save();
    
    // Generate invoice path
    const invoicePath = path.join(invoiceDir, `${orderId}.pdf`);
    
    // Generate invoice (optional - will work without email)
    try {
      generateInvoice(newOrder, invoicePath);
      console.log('✅ Invoice generated successfully');
    } catch (invoiceError) {
      console.error('⚠️ Invoice generation failed:', invoiceError);
    }
    
    // Send email with invoice (optional - will work without email config)
    try {
      if (process.env.EMAIL_FROM && process.env.EMAIL_PASS) {
        await sendEmailWithInvoice(customerDetails.email, invoicePath);
        console.log('✅ Email sent successfully');
      } else {
        console.log('⚠️ Email not sent - missing email configuration');
      }
    } catch (emailError) {
      console.error('⚠️ Email sending failed:', emailError);
    }
    

    
    // Send push notification to admin about new order (optional)
    try {
      const adminToken = fcmTokens.get('admin');
      if (adminToken && firebaseApp) {
        const adminMessage = {
          notification: {
            title: '🆕 New Order Received!',
            body: `Order ${orderId} - ₹${total} from ${customerDetails.fullName}`,
          },
          data: {
            orderId: orderId,
            total: total.toString(),
            customerName: customerDetails.fullName,
            type: 'new_order'
          },
          token: adminToken,
        };
        await admin.messaging().send(adminMessage);
        console.log('✅ Admin notification sent for new order');
      } else {
        console.log('⚠️ Admin notification not sent - missing FCM token or Firebase config');
      }
    } catch (notificationError) {
      console.error('⚠️ Failed to send admin notification:', notificationError);
    }
    
    res.status(201).json({ message: '✅ Order placed successfully', orderId });
  } catch (error) {
    console.error('❌ Order placement error:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
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
      category: 1
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
          const Model = mongoose.model(collectionName, productSchema, collectionName);
          // Use lean() for faster plain objects, project only needed fields
          const docs = await Model.find({}, {
            name_en: 1,
            name_ta: 1,
            price: 1,
            original_price: 1,
            imageUrl: 1,
            youtube_url: 1,
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌐 CORS enabled for origins: https://www.kmpyrotech.com, https://kmpyrotech.com`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Railway deployment: ${process.env.RAILWAY_ENVIRONMENT ? 'Yes' : 'No'}`);
});


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
});
