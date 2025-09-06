import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export function generateInvoice(order, outputPath) {
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(fs.createWriteStream(outputPath));

  // Header
  doc
    .fontSize(28)
    .fillColor('#d97706')
    .text('KM PYROTECH Invoice', { align: 'center', underline: true });
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
  doc.text('Order and Customer Details', boxLeft + 16, doc.y + 20);
  
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
  doc.text('Products', boxLeft + 16, doc.y + 20);
  
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
  doc.text('Name', boxLeft + 60, tableY);
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
    doc.text(`${item.name_en} (${item.name_ta})`, boxLeft + 60, rowY, { width: 200 });
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
  doc.text('Thank you for shopping with KM Crackers!', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#16a34a');
  doc.text('Wishing you a safe and sparkling festival!', { align: 'center' });

  doc.end();
}
