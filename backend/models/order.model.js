// models/order.model.js
import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  items: [
    {
      id: String,
      name_en: String,
      name_ta: String,
      price: Number,
      quantity: Number,
      category: String,
      imageUrl: String,
    },
  ],
  total: { type: Number, required: true },
  customerDetails: {
    fullName: String,
    mobile: String,
    email: String,
    address: String,
    pincode: String,
  },
  status: { 
    type: String, 
    enum: ['confirmed', 'payment_verified', 'booked'], 
    default: "confirmed" 
  },
  transportName: { type: String, default: "" },
  lrNumber: { type: String, default: "" },
  // Payment screenshot fields
  paymentScreenshot: {
    imageUrl: String,
    uploadedAt: Date,
    verified: { type: Boolean, default: false },
    verifiedBy: String,
    verifiedAt: Date,
  },
  createdAt: { type: Date, default: Date.now },
});

export const Order = mongoose.model('Order', orderSchema);
