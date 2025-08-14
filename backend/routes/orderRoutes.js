// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const Order = require("../models/order.model");

router.post("/place-order", async (req, res) => {
  try {
    const { orderId, items, total, customerDetails, status, createdAt } = req.body;

    if (!orderId || !items || !total || !customerDetails) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const newOrder = new Order({
      orderId,
      items,
      total,
      customerDetails,
      status,
      createdAt,
    });

    await newOrder.save();

    res.status(201).json({ message: "Order placed successfully", orderId });
  } catch (err) {
    console.error("Order save error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
