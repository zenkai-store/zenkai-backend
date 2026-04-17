const express = require("express");
const OrderService = require("../services/order.service");
const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * GET USER ORDERS
 * GET /api/orders
 */
router.get("/", userAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const result = await OrderService.getUserOrders(
      req.user.id,
      parseInt(page),
      parseInt(limit),
    );

    res.json({
      success: true,
      data: result.orders,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error("User orders fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET ORDER DETAILS
 * GET /api/orders/:orderId
 */
router.get("/:orderId", userAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderService.getOrderById(orderId, req.user.id);

    res.json({
      success: true,
      data: order,
    });
  } catch (err) {
    console.error("Order details error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * CANCEL ORDER
 * POST /api/orders/:orderId/cancel
 */
router.post("/:orderId/cancel", userAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await OrderService.cancelOrder(orderId, req.user.id, reason);

    res.json({
      success: true,
      data: order,
      message: "Order cancelled successfully",
    });
  } catch (err) {
    console.error("Order cancellation error:", err);

    if (err.message === "Order cannot be cancelled at this stage") {
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
 * TRACK ORDER
 * GET /api/orders/:orderId/track
 */
router.get("/:orderId/track", userAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderService.getOrderById(orderId, req.user.id);

    const trackingInfo = {
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      estimatedDeliveryDate: order.estimatedDeliveryDate,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      statusHistory: order.statusHistory,
      currentStatus: order.orderStatus,
      progress: {
        orderPlaced: order.createdAt,
        confirmed: null,
        shipped: null,
        delivered: null,
      },
    };

    // Populate progress from status history
    for (const history of order.statusHistory) {
      if (history.newStatus === "confirmed")
        trackingInfo.progress.confirmed = history.createdAt;
      if (history.newStatus === "shipped")
        trackingInfo.progress.shipped = history.createdAt;
      if (history.newStatus === "delivered")
        trackingInfo.progress.delivered = history.createdAt;
    }

    res.json({
      success: true,
      data: trackingInfo,
    });
  } catch (err) {
    console.error("Order tracking error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
