import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export function generateInvoice(order, outputPath) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(outputPath));

  doc.fontSize(20).text("🧨 KMPyrotech - Invoice", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Order ID: ${order.orderId}`);
  doc.text(`Customer: ${order.customerDetails.fullName}`);
  doc.text(`Mobile: ${order.customerDetails.mobile}`);
  doc.text(`Email: ${order.customerDetails.email}`);
  doc.text(`Address: ${order.customerDetails.address}`);
  doc.text(`Pincode: ${order.customerDetails.pincode}`);
  doc.moveDown();

  doc.fontSize(14).text("Items Ordered:", { underline: true });
  order.items.forEach((item, i) => {
    doc.text(`${i + 1}. ${item.name_en} (${item.name_ta}) - ₹${item.price} × ${item.quantity}`);
  });

  doc.moveDown();
  doc.text(`Total Amount: ₹${order.total}`, { bold: true });
  
  doc.text("Status: " + order.status);

  doc.end();
}
