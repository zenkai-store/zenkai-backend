const mongoose = require("mongoose");
require("dotenv").config();

const cleanupIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const db = mongoose.connection.db;

    // Clean orders collection indexes
    const ordersIndexes = await db.collection("orders").indexes();
    console.log(
      "Orders indexes before cleanup:",
      ordersIndexes.map((i) => i.name),
    );

    for (const index of ordersIndexes) {
      if (index.name !== "_id_") {
        await db.collection("orders").dropIndex(index.name);
        console.log(`Dropped index: ${index.name} from orders`);
      }
    }

    // Clean payments collection indexes
    const paymentsIndexes = await db.collection("payments").indexes();
    console.log(
      "Payments indexes before cleanup:",
      paymentsIndexes.map((i) => i.name),
    );

    for (const index of paymentsIndexes) {
      if (index.name !== "_id_") {
        await db.collection("payments").dropIndex(index.name);
        console.log(`Dropped index: ${index.name} from payments`);
      }
    }

    console.log("\n✅ All indexes cleaned up successfully!");
    console.log(
      "Restart your server to recreate indexes from Mongoose schemas.\n",
    );

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error cleaning up indexes:", error);
  }
};

cleanupIndexes();
