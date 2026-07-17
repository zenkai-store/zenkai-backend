const cron = require("node-cron");
const Order = require("../models/order.model");

const cleanupPendingOrders = () => {
  // Schedule to run daily at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("🔄 Running cleanup of pending payment orders...");
    try {
      // Delete orders with paymentStatus 'pending' and created more than 24 hours ago
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await Order.deleteMany({
        paymentStatus: "pending",
        createdAt: { $lt: cutoff },
      });
      console.log(`✅ Deleted ${result.deletedCount} pending orders.`);
    } catch (err) {
      console.error("❌ Error cleaning up pending orders:", err);
    }
  });
};

module.exports = cleanupPendingOrders;
