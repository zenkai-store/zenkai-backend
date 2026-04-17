const express = require("express");
const OrderService = require("../services/order.service");
const adminAuth = require("../middleware/adminAuth.middleware");

const router = express.Router();

/**
 * GET ALL ORDERS (Admin)
 * GET /api/admin/orders
 */
router.get("/", adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      orderStatus,
      paymentStatus,
      userId,
      dateFrom,
      dateTo,
    } = req.query;

    const result = await OrderService.getAdminOrders(
      { orderStatus, paymentStatus, userId, dateFrom, dateTo },
      parseInt(page),
      parseInt(limit),
    );

    res.json({
      success: true,
      data: result.orders,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error("Admin orders fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET ORDER DETAILS (Admin)
 * GET /api/admin/orders/:orderId
 */
router.get("/:orderId", adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Admin can view any order, so pass any userId
    const order = await OrderService.getOrderById(orderId, null);

    res.json({
      success: true,
      data: order,
    });
  } catch (err) {
    console.error("Admin order details error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * UPDATE ORDER STATUS (Admin)
 * PUT /api/admin/orders/:orderId/status
 */
router.put("/:orderId/status", adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const order = await OrderService.updateOrderStatus(
      orderId,
      status,
      req.admin.id,
      notes,
    );

    res.json({
      success: true,
      data: order,
      message: "Order status updated successfully",
    });
  } catch (err) {
    console.error("Update order status error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET ORDER STATISTICS (Admin)
 * GET /api/admin/orders/statistics/dashboard
 */
router.get("/statistics/dashboard", adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const statistics = await OrderService.getOrderStatistics(
      startDate,
      endDate,
    );

    res.json({
      success: true,
      data: statistics,
    });
  } catch (err) {
    console.error("Order statistics error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * BULK UPDATE ORDER STATUS (Admin)
 * POST /api/admin/orders/bulk/status
 */
router.post("/bulk/status", adminAuth, async (req, res) => {
  try {
    const { orderIds, status, notes } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order IDs array is required",
      });
    }

    const results = [];
    for (const orderId of orderIds) {
      try {
        const order = await OrderService.updateOrderStatus(
          orderId,
          status,
          req.admin.id,
          notes,
        );
        results.push({ orderId: order._id, success: true });
      } catch (error) {
        results.push({ orderId, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      data: results,
      message: "Bulk status update completed",
    });
  } catch (err) {
    console.error("Bulk status update error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
