const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },

    razorpayPaymentId: String,
    razorpayOrderId: String,
    signature: String,

    amount: Number,

    status: {
      type: String,
      enum: ["success", "failed"],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Payment", paymentSchema);
