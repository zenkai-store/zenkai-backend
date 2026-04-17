const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    razorpayPaymentId: {
      type: String,
      // No unique or sparse here
    },

    razorpayOrderId: {
      type: String,
      // No unique or sparse here
    },

    razorpaySignature: {
      type: String,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "bank_transfer"],
      default: "razorpay",
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed", "refunded", "partially_refunded"],
      default: "pending",
    },

    refundAmount: {
      type: Number,
      default: 0,
    },

    refundId: {
      type: String,
    },

    failureReason: {
      type: String,
    },

    paymentDetails: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

// Method to process refund
paymentSchema.methods.processRefund = async function (amount, reason) {
  const razorpay = require("../config/razorpay");

  try {
    const refund = await razorpay.payments.refund(this.razorpayPaymentId, {
      amount: amount * 100,
      notes: {
        reason: reason,
        orderId: this.orderId.toString(),
      },
    });

    this.refundAmount += amount;
    this.refundId = refund.id;

    if (this.refundAmount >= this.amount) {
      this.status = "refunded";
    } else if (this.refundAmount > 0) {
      this.status = "partially_refunded";
    }

    await this.save();
    return refund;
  } catch (error) {
    throw new Error(`Refund failed: ${error.message}`);
  }
};

// =============================================
// ALL INDEXES DEFINED HERE - CLEAN AND ORGANIZED
// =============================================

// Unique indexes
paymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });

// Single field indexes
paymentSchema.index({ userId: 1 });
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });

// Compound indexes
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ orderId: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
