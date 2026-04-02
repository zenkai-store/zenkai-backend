const express = require("express");
const crypto = require("crypto");

const razorpay = require("../config/razorpay");

const Cart = require("../models/cart.model");
const Product = require("../models/product.model");
const Address = require("../models/address.model");

const Order = require("../models/order.model");
const Payment = require("../models/payment.model");

const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * CREATE RAZORPAY ORDER
 */

router.post("/create-order", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.body;

    const cart = await Cart.findOne({ userId });

    if (!cart || cart.items.length === 0)
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      });

    const address = await Address.findOne({
      _id: addressId,
      userId,
    });

    if (!address)
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });

    let totalAmount = 0;
    const items = [];

    for (const item of cart.items) {
      const product = await Product.findById(item.productId);

      if (!product || !product.isActive)
        return res.status(400).json({
          success: false,
          message: "Invalid product in cart",
        });

      if (item.quantity > product.quantity)
        return res.status(400).json({
          success: false,
          message: `Stock not available for ${product.name}`,
        });

      const price = product.isOnSale
        ? product.pricing.onSalePrice
        : product.pricing.sellingPrice;

      totalAmount += price * item.quantity;

      items.push({
        productId: product._id,
        quantity: item.quantity,
        price,
      });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount * 100, // paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });

    const order = await Order.create({
      userId,
      items,
      totalAmount,
      addressId,
      razorpayOrderId: razorpayOrder.id,
    });

    res.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: totalAmount,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.log("Create order error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * VERIFY PAYMENT
 */

router.post("/verify", userAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature)
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });

    const order = await Order.findOne({
      razorpayOrderId: razorpay_order_id,
    });

    if (!order)
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });

    const payment = await Payment.create({
      userId: req.user.id,
      orderId: order._id,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      signature: razorpay_signature,
      amount: order.totalAmount,
      status: "success",
    });

    order.status = "paid";
    order.paymentId = payment._id;
    await order.save();

    // CLEAR CART
    await Cart.findOneAndUpdate({ userId: req.user.id }, { items: [] });

    res.json({
      success: true,
      message: "Payment successful",
    });
  } catch (err) {
    console.log("Payment verify error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
