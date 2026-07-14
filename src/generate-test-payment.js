// generate-test-payment.js
const crypto = require("crypto");
require("dotenv").config();

// Your order ID from create-order response
const razorpayOrderId = "order_TDMHnh7OdGy6Oi";

// Generate a random test payment ID (follows Razorpay format)
const razorpayPaymentId = "pay_" + Math.random().toString(36).substring(2, 15);

// Generate signature
const body = razorpayOrderId + "|" + razorpayPaymentId;
const signature = crypto
  .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
  .update(body)
  .digest("hex");

console.log("✅ Payment Details for Postman:");
console.log("===============================");
console.log("razorpay_order_id:", razorpayOrderId);
console.log("razorpay_payment_id:", razorpayPaymentId);
console.log("razorpay_signature:", signature);
console.log("===============================");
