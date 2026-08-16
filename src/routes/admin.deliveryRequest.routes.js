// routes/admin.deliveryRequest.routes.js
const express = require("express");
const mongoose = require("mongoose");
const DeliveryRequest = require("../models/deliveryRequest.model");
const Order = require("../models/order.model");
const Shipment = require("../models/shipment.model");
const deliveryService = require("../services/delivery.service");
const adminAuth = require("../middleware/adminAuth.middleware");
const AdminActivity = require("../models/adminActivity.model");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/delivery-requests
// List all delivery requests with pagination and optional status filter
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, reason } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (status) {
      if (!["pending", "fulfilled", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "status must be one of: pending, fulfilled, rejected",
        });
      }
      query.status = status;
    }
    if (reason) {
      if (
        !["charge_exceeds_threshold", "insufficient_balance", "api_failure"].includes(reason)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "reason must be one of: charge_exceeds_threshold, insufficient_balance, api_failure",
        });
      }
      query.reason = reason;
    }

    const [requests, total] = await Promise.all([
      DeliveryRequest.find(query)
        .populate({
          path: "orderId",
          select:
            "orderNumber totalAmount userEmail orderStatus paymentStatus addressSnapshot items createdAt",
          populate: {
            path: "items.productId",
            select: "name",
          },
        })
        .populate("fulfilledBy", "name email")
        .populate("rejectedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      DeliveryRequest.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: requests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("List delivery requests error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/delivery-requests/:id
// Get a single delivery request with full order and shipment context
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", adminAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery request ID" });
    }

    const request = await DeliveryRequest.findById(req.params.id)
      .populate({
        path: "orderId",
        select:
          "orderNumber totalAmount userEmail orderStatus paymentStatus deliveryStatus " +
          "addressSnapshot items createdAt shippingCost subtotal tax discount awbCode " +
          "courierName shipmentId shiprocketOrderId",
        populate: [
          { path: "items.productId", select: "name slug" },
          { path: "items.variantId", select: "color sku" },
        ],
      })
      .populate("fulfilledBy", "name email")
      .populate("rejectedBy", "name email")
      .lean();

    if (!request) {
      return res.status(404).json({ success: false, message: "Delivery request not found" });
    }

    // Attach shipment details if order already has one (fulfilled scenario)
    let shipment = null;
    if (request.orderId?.shipmentId) {
      shipment = await Shipment.findById(request.orderId.shipmentId).lean();
    }

    res.json({ success: true, data: { ...request, shipment } });
  } catch (err) {
    console.error("Get delivery request error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/delivery-requests/:id/fulfill
// Admin manually places the shipment in Shiprocket portal, then calls this
// endpoint to fill in the resulting AWB and shipment details. The order will
// be updated to "shipped" and a Shipment record will be created.
//
// Required body fields:
//   awbCode       {string}  — AWB number from Shiprocket
//   courierName   {string}  — courier company name
//
// Optional body fields:
//   courierId             {string}
//   shiprocketOrderId     {string|number}
//   shiprocketShipmentId  {string|number}
//   trackingUrl           {string}
//   labelUrl              {string}
//   manifestUrl           {string}
//   estimatedDeliveryDate {string}  — ISO date string
//   adminNotes            {string}
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/fulfill", adminAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery request ID" });
    }

    const {
      awbCode,
      courierName,
      courierId,
      shiprocketOrderId,
      shiprocketShipmentId,
      trackingUrl,
      labelUrl,
      manifestUrl,
      estimatedDeliveryDate,
      adminNotes,
    } = req.body;

    // Input validation
    if (!awbCode || typeof awbCode !== "string" || !awbCode.trim()) {
      return res.status(400).json({ success: false, message: "awbCode is required" });
    }
    if (!courierName || typeof courierName !== "string" || !courierName.trim()) {
      return res.status(400).json({ success: false, message: "courierName is required" });
    }
    if (estimatedDeliveryDate && isNaN(Date.parse(estimatedDeliveryDate))) {
      return res
        .status(400)
        .json({ success: false, message: "estimatedDeliveryDate must be a valid ISO date string" });
    }

    const { shipment, order, deliveryRequest } = await deliveryService.fulfillDeliveryRequest(
      req.params.id,
      {
        awbCode: awbCode.trim(),
        courierName: courierName.trim(),
        courierId,
        shiprocketOrderId,
        shiprocketShipmentId,
        trackingUrl,
        labelUrl,
        manifestUrl,
        estimatedDeliveryDate,
        adminNotes,
      },
      req.admin.id,
    );

    // Log admin activity
    try {
      await AdminActivity.create({
        adminId: req.admin.id,
        adminEmail: req.admin.email,
        action: "FULFILL_DELIVERY_REQUEST",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          deliveryRequestId: req.params.id,
          orderId: order._id,
          orderNumber: order.orderNumber,
          awbCode: awbCode.trim(),
          courierName: courierName.trim(),
        },
      });
    } catch (logErr) {
      // Non-fatal — fulfillment already succeeded
      console.error("Admin activity log failed:", logErr.message);
    }

    res.json({
      success: true,
      message: "Delivery request fulfilled. Order is now shipped.",
      data: {
        deliveryRequest,
        shipment,
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          orderStatus: order.orderStatus,
          deliveryStatus: order.deliveryStatus,
          awbCode: order.awbCode,
          courierName: order.courierName,
          shippedAt: order.shippedAt,
          estimatedDeliveryDate: order.estimatedDeliveryDate,
          trackingNumber: order.trackingNumber,
        },
      },
    });
  } catch (err) {
    console.error("Fulfill delivery request error:", err);

    if (
      err.message.includes("already") ||
      err.message.includes("required") ||
      err.message.includes("not found") ||
      err.message.includes("unpaid")
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }

    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/delivery-requests/:id/reject
// Admin rejects the delivery request (e.g. order to be cancelled, or
// alternative courier arranged outside Shiprocket). Order deliveryStatus
// is set to "failed".
//
// Optional body: { rejectionReason: string }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/reject", adminAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid delivery request ID" });
    }

    const { rejectionReason } = req.body;

    const deliveryRequest = await deliveryService.rejectDeliveryRequest(
      req.params.id,
      req.admin.id,
      rejectionReason,
    );

    // Log admin activity
    try {
      await AdminActivity.create({
        adminId: req.admin.id,
        adminEmail: req.admin.email,
        action: "REJECT_DELIVERY_REQUEST",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          deliveryRequestId: req.params.id,
          orderId: deliveryRequest.orderId,
          rejectionReason: rejectionReason || null,
        },
      });
    } catch (logErr) {
      console.error("Admin activity log failed:", logErr.message);
    }

    res.json({
      success: true,
      message: "Delivery request rejected.",
      data: deliveryRequest,
    });
  } catch (err) {
    console.error("Reject delivery request error:", err);

    if (err.message.includes("not found") || err.message.includes("already")) {
      return res.status(400).json({ success: false, message: err.message });
    }

    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/delivery-requests/stats/summary
// Quick count of pending / fulfilled / rejected requests (dashboard widget)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/stats/summary", adminAuth, async (req, res) => {
  try {
    const [pending, fulfilled, rejected] = await Promise.all([
      DeliveryRequest.countDocuments({ status: "pending" }),
      DeliveryRequest.countDocuments({ status: "fulfilled" }),
      DeliveryRequest.countDocuments({ status: "rejected" }),
    ]);

    res.json({
      success: true,
      data: { pending, fulfilled, rejected, total: pending + fulfilled + rejected },
    });
  } catch (err) {
    console.error("Delivery request stats error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
