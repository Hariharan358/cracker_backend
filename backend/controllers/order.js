import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { Order } from './models/order.model.js';
import fs from 'fs';

// Utility to generate PDF buffer
const generateInvoicePDF = async (order) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });

    doc.fontSize(20).text('🧾 KMPyrotech Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Order ID: ${order.orderId}`);
    doc.text(`Name: ${order.customerDetails.fullName}`);
    doc.text(`Mobile: ${order.customerDetails.mobile}`);
    doc.text(`Email: ${order.customerDetails.email}`);
    doc.text(`Address: ${order.customerDetails.address}, ${order.customerDetails.pincode}`);
    doc.moveDown();

    doc.fontSize(14).text('Products:');
    order.items.forEach((item) => {
      doc.text(`- ${item.name_en} (${item.name_ta}) × ${item.quantity} @ ₹${item.price} = ₹${item.price * item.quantity}`);
    });

    doc.moveDown();
    doc.fontSize(14).text(`Total: ₹${order.total}`, { align: 'right' });
    doc.text(`Date: ${new Date(order.createdAt).toLocaleString()}`, { align: 'right' });

    doc.end();
  });
};

const sendInvoiceEmail = async (order) => {
  const pdfBuffer = await generateInvoicePDF(order);

  const transporter = nodemailer.createTransport({
    service: 'gmail', // use another SMTP if needed
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"KMPyrotech" <${process.env.EMAIL_USER}>`,
    to: order.customerDetails.email,
    subject: `🧾 Invoice for KMPyrotech Order #${order.orderId}`,
    text: `Dear ${order.customerDetails.fullName},\n\nPlease find attached the invoice for your recent order.\n\nThanks for shopping with KMPyrotech!`,
    attachments: [
      {
        filename: `Invoice-${order.orderId}.pdf`,
        content: pdfBuffer,
      },
    ],
  };

  await transporter.sendMail(mailOptions);
};
    