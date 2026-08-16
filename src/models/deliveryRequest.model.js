// models/deliveryRequest.model.js
const mongoose = require("mongoose");

/**
 * DeliveryRequest represents an order whose shipment could not be placed
 * automatically — either because the estimated delivery charge exceeds the
 * configured threshold (₹250) or because the Shiprocket wallet balance is
 * insufficient. Admin must place the shipment manually in the Shiprocket
 * portal and then fulfill this request to update the order with the resulting
 * AWB, courier, and shipment details.
 */
const deliveryRequestSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
      index: true,
    },

    reason: {
      type: String,
      enum: ["charge_exceeds_threshold", "insufficient_balance", "api_failure"],
      required: true,
    },

    // Estimated charge from the courier serviceability API (may be null if
    // the check failed before a quote was obtained)
    estimatedCharge: {
      type: Number,
      default: null,
    },

    // Shiprocket wallet balance at the time of the check (null if unknown)
    walletBalance: {
      type: Number,
      default: null,
    },

    // Threshold that was crossed (₹250 for charge, or balance < charge)
    thresholdAmount: {
      type: Number,
      default: 250,
    },

    status: {
      type: String,
      enum: ["pending", "fulfilled", "rejected"],
      default: "pending",
      index: true,
    },

    // Populated when admin fulfills the request after placing shipment manually
    fulfilledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    fulfilledAt: {
      type: Date,
      default: null,
    },

    // AWB and courier details filled by admin after manual Shiprocket placement
    awbCode: { type: String, default: null },
    courierName: { type: String, default: null },
    courierId: { type: String, default: null },
    shiprocketOrderId: { type: String, default: null },
    shiprocketShipmentId: { type: String, default: null },
    trackingUrl: { type: String, default: null },
    labelUrl: { type: String, default: null },
    manifestUrl: { type: String, default: null },
    estimatedDeliveryDate: { type: Date, default: null },

    // Admin notes on fulfillment or rejection
    adminNotes: { type: String, default: null },

    // Reason provided when admin rejects the request
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true },
);

deliveryRequestSchema.index({ status: 1, createdAt: -1 });
deliveryRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model("DeliveryRequest", deliveryRequestSchema);
