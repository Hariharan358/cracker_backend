// routes/orderRoutes.js
import express from "express";
import { Order } from "../models/order.model.js";
import { OrderCounter } from "../models/order.model.js";
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Generate unique order ID using atomic per-day counter (YYMMDD + 3 digits)
const getNextOrderIdForToday = async () => {
  const today = new Date();
  const dateStr = today.getFullYear().toString().slice(-2) +
                 (today.getMonth() + 1).toString().padStart(2, '0') +
                 today.getDate().toString().padStart(2, '0');
  
  console.log('🔢 Generating order ID for date:', dateStr);
  const counter = await OrderCounter.findOneAndUpdate(
    { _id: dateStr },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const seq = counter?.seq || 1;
  const suffix = String(seq).padStart(3, '0');
  const orderId = `${dateStr}${suffix}`;
  
  console.log('🔢 Generated order ID:', orderId);
  return orderId;
};

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

// Place Order Route
router.post("/place", async (req, res) => {
  try {
    const { items, total, customerDetails, status, createdAt } = req.body;
    if (!items || !total || !customerDetails) {
      return res.status(400).json({ error: 'Missing required order fields.' });
    }

    // Generate a unique order ID with minimal retries (in case of rare collision)
    let orderId;
    {
      let attempts = 0;
      const maxAttempts = 5;
      while (true) {
        orderId = await getNextOrderIdForToday();
        console.log('🔍 Checking if order ID exists:', orderId);
        const exists = await Order.findOne({ orderId });
        if (!exists) {
          console.log('✅ Order ID is unique:', orderId);
          break;
        }
        console.log('⚠️ Order ID collision detected, retrying...');
        attempts++;
        if (attempts >= maxAttempts) {
          console.error('❌ Failed to generate unique order ID after', maxAttempts, 'attempts');
          return res.status(500).json({ error: 'Failed to generate unique order ID' });
        }
      }
    }

    // Always start with 'confirmed' status when order is placed
    console.log('📝 Creating new order with ID:', orderId);
    const newOrder = new Order({
      orderId,
      items,
      total,
      customerDetails,
      status: 'confirmed', // Always start with confirmed
      createdAt: createdAt || new Date().toISOString(),
    });
    
    console.log('📝 Order object created, saving to database...');
    await newOrder.save();
    console.log('✅ Order saved successfully');
    
    // Generate invoice path
    const invoiceDir = path.join(__dirname, '..', 'invoices');
    if (!fs.existsSync(invoiceDir)) fs.mkdirSync(invoiceDir);
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
    
    res.status(201).json({ message: '✅ Order placed successfully', orderId });
  } catch (error) {
    console.error('❌ Order placement error:', error);
    res.status(500).json({ 
      error: 'Failed to place order', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export default router;

