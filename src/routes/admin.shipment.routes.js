// routes/admin.shipment.routes.js
const express = require("express");
const mongoose = require("mongoose");
const Shipment = require("../models/shipment.model");
const Order = require("../models/order.model");
const deliveryService = require("../services/delivery.service");
const adminAuth = require("../middleware/adminAuth.middleware");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");

const router = express.Router();

/**
 * GET /api/admin/shipments
 * List all shipments with pagination and filters
 */
router.get("/", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, courierName, orderId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (courierName) query.courierName = new RegExp(courierName, "i");
    if (orderId && mongoose.Types.ObjectId.isValid(orderId))
      query.orderId = orderId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [shipments, total] = await Promise.all([
      Shipment.find(query)
        .populate("orderId", "orderNumber totalAmount userEmail")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Shipment.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: shipments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/shipments/:id
 * Get single shipment details
 */
router.get("/:id", adminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate(
        "orderId",
        "orderNumber totalAmount userEmail addressSnapshot items",
      )
      .lean();
    if (!shipment)
      return res
        .status(404)
        .json({ success: false, message: "Shipment not found" });
    res.json({ success: true, data: shipment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/shipments/:id/retry
 * Retry a failed shipment
 */
router.post("/:id/retry", adminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment)
      return res
        .status(404)
        .json({ success: false, message: "Shipment not found" });
    if (shipment.status !== "failed")
      return res
        .status(400)
        .json({
          success: false,
          message: "Only failed shipments can be retried",
        });

    const admin = await Admin.findById(req.admin.id);
    const newShipment = await deliveryService.retryShipment(shipment._id);

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "RETRY_SHIPMENT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: { oldShipmentId: shipment._id, newShipmentId: newShipment._id },
    });

    res.json({
      success: true,
      message: "Shipment retry initiated",
      data: newShipment,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/shipments/:id/refresh-tracking
 * Manually sync tracking status from Shiprocket
 */
router.post("/:id/refresh-tracking", adminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment)
      return res
        .status(404)
        .json({ success: false, message: "Shipment not found" });
    const tracking = await deliveryService.updateTrackingStatus(
      shipment.awbCode,
    );
    res.json({ success: true, data: tracking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/shipments/:id/label
 * Get label PDF URL (proxy or redirect)
 */
router.get("/:id/label", adminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment || !shipment.labelUrl)
      return res
        .status(404)
        .json({ success: false, message: "Label not available" });
    res.redirect(shipment.labelUrl);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
