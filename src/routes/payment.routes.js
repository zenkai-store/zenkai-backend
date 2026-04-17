const express = require("express");
const crypto = require("crypto");
const razorpay = require("../config/razorpay");
const OrderService = require("../services/order.service");
const CartService = require("../services/cart.service");
const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * CREATE RAZORPAY ORDER
 * POST /api/payment/create-order
 */
router.post("/create-order", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId, paymentMethod = "razorpay" } = req.body;

    if (!addressId) {
      return res.status(400).json({
        success: false,
        message: "Address ID is required",
      });
    }

    // Create order from cart
    const orderData = await OrderService.createOrderFromCart(
      userId,
      addressId,
      paymentMethod,
    );

    // If COD, return order details without payment
    if (paymentMethod === "cod") {
      return res.json({
        success: true,
        requiresPayment: false,
        order: {
          orderId: orderData.order._id,
          orderNumber: orderData.order.orderNumber,
          totalAmount: orderData.order.totalAmount,
        },
        message: "Order created successfully. You can pay on delivery.",
      });
    }

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: orderData.order.totalAmount * 100, // Convert to paise
      currency: "INR",
      receipt: `receipt_${orderData.order.orderNumber}`,
      notes: {
        orderId: orderData.order._id.toString(),
        userId: userId.toString(),
      },
    });

    // Update order with Razorpay order ID
    orderData.order.razorpayOrderId = razorpayOrder.id;
    await orderData.order.save();

    res.json({
      success: true,
      requiresPayment: true,
      razorpayOrderId: razorpayOrder.id,
      amount: orderData.order.totalAmount,
      key: process.env.RAZORPAY_KEY_ID,
      orderId: orderData.order._id,
      orderNumber: orderData.order.orderNumber,
    });
  } catch (err) {
    console.error("Create order error:", err);

    if (
      err.message.includes("stock") ||
      err.message.includes("Cart is empty")
    ) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (err.message.includes("Address not found")) {
      return res.status(404).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * VERIFY PAYMENT
 * POST /api/payment/verify
 */
router.post("/verify", userAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    // Process successful payment
    const result = await OrderService.processSuccessfulPayment(
      req.user.id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );

    res.json({
      success: true,
      message: "Payment successful",
      orderId: result.order._id,
      orderNumber: result.order.orderNumber,
    });
  } catch (err) {
    console.error("Payment verify error:", err);

    if (err.message === "Order already paid") {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET PAYMENT STATUS
 * GET /api/payment/status/:orderId
 */
router.get("/status/:orderId", userAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderService.getOrderById(orderId, req.user.id);

    res.json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        payment: order.payment,
      },
    });
  } catch (err) {
    console.error("Payment status error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * RETRY PAYMENT FOR FAILED ORDER
 * POST /api/payment/retry/:orderId
 */
router.post("/retry/:orderId", userAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await OrderService.getOrderById(orderId, req.user.id);

    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Order is already paid",
      });
    }

    // Create new Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: order.totalAmount * 100,
      currency: "INR",
      receipt: `receipt_${order.orderNumber}_retry`,
      notes: {
        orderId: order._id.toString(),
        userId: req.user.id.toString(),
        isRetry: "true",
      },
    });

    // Update order with new Razorpay order ID
    await Order.findByIdAndUpdate(orderId, {
      razorpayOrderId: razorpayOrder.id,
    });

    res.json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      amount: order.totalAmount,
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order._id,
      orderNumber: order.orderNumber,
    });
  } catch (err) {
    console.error("Payment retry error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
