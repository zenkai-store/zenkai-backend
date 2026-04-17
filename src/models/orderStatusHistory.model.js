const mongoose = require("mongoose");

const orderStatusHistorySchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    previousStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
      ],
    },

    newStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
      ],
      required: true,
    },

    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    changedByRole: {
      type: String,
      enum: ["user", "admin", "system"],
      default: "user",
    },

    notes: {
      type: String,
    },

    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

// Indexes
orderStatusHistorySchema.index({ orderId: 1, createdAt: -1 });
orderStatusHistorySchema.index({ newStatus: 1 });
orderStatusHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model("OrderStatusHistory", orderStatusHistorySchema);
