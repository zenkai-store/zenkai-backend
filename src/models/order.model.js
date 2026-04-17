const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },

  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ProductVariant",
    required: true,
  },

  variantSku: {
    type: String,
    required: true,
  },

  variantColor: {
    name: { type: String, required: true },
    code: { type: String, required: true },
  },

  quantity: {
    type: Number,
    required: true,
    min: 1,
  },

  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },

  totalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    items: [orderItemSchema],

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    tax: {
      type: Number,
      default: 0,
      min: 0,
    },

    shippingCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    addressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      required: true,
    },

    addressSnapshot: {
      fullName: String,
      phone: String,
      addressLine1: String,
      addressLine2: String,
      city: String,
      state: String,
      pincode: String,
      landmark: String,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "partially_refunded"],
      default: "pending",
    },

    orderStatus: {
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
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "bank_transfer"],
      required: true,
    },

    razorpayOrderId: {
      type: String,
      // REMOVED: sparse: true - this was creating an automatic index
    },

    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },

    trackingNumber: {
      type: String,
      // REMOVED: sparse: true
    },

    trackingUrl: {
      type: String,
    },

    estimatedDeliveryDate: {
      type: Date,
    },

    deliveredAt: {
      type: Date,
    },

    cancelledAt: {
      type: Date,
    },

    cancellationReason: {
      type: String,
    },

    notes: {
      type: String,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

// Virtual for order summary
orderSchema.virtual("summary").get(function () {
  return {
    orderNumber: this.orderNumber,
    totalAmount: this.totalAmount,
    itemCount: this.items.reduce((sum, item) => sum + item.quantity, 0),
    paymentStatus: this.paymentStatus,
    orderStatus: this.orderStatus,
    createdAt: this.createdAt,
  };
});

// Method to check if order can be cancelled
orderSchema.methods.canBeCancelled = function () {
  const cancellableStatuses = ["pending", "confirmed", "processing"];
  return (
    cancellableStatuses.includes(this.orderStatus) &&
    this.paymentStatus === "paid"
  );
};

// Method to check if order can be returned
orderSchema.methods.canBeReturned = function () {
  const returnableStatuses = ["delivered"];
  const daysSinceDelivery = this.deliveredAt
    ? (Date.now() - this.deliveredAt) / (1000 * 60 * 60 * 24)
    : Infinity;
  return (
    returnableStatuses.includes(this.orderStatus) && daysSinceDelivery <= 7
  );
};

// Pre-save middleware to generate order number
orderSchema.pre("save", async function () {
  if (!this.orderNumber) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    const Order = mongoose.model("Order");
    const count = await Order.countDocuments();

    this.orderNumber = `ORD-${year}${month}-${String(count + 1).padStart(6, "0")}`;
  }
});

// =============================================
// ALL INDEXES DEFINED HERE - CLEAN AND ORGANIZED
// =============================================

// Unique indexes
orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ razorpayOrderId: 1 }, { sparse: true }); // Now only one sparse index

// Single field indexes
orderSchema.index({ userId: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ trackingNumber: 1 }, { sparse: true });

// Compound indexes
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });

// Special indexes
orderSchema.index({ "items.variantId": 1 });

// Ensure virtuals are included
orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Order", orderSchema);
