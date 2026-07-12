// models/shipment.model.js
const mongoose = require("mongoose");

const shipmentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    awbCode: { type: String, required: true },
    courierName: { type: String, required: true },
    courierId: { type: String },
    trackingUrl: { type: String },
    labelUrl: { type: String },
    manifestUrl: { type: String },
    invoiceUrl: { type: String },
    pickupScheduled: { type: Boolean, default: false },
    status: {
      type: String,
      enum: [
        "pending",
        "assigned",
        "picked_up",
        "in_transit",
        "delivered",
        "failed",
      ],
      default: "pending",
    },
    shiprocketOrderId: { type: String },
    shiprocketChannelOrderId: { type: String },
    shiprocketShipmentId: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    trackingDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

shipmentSchema.index({ awbCode: 1 });
shipmentSchema.index({ status: 1 });
shipmentSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Shipment", shipmentSchema);
