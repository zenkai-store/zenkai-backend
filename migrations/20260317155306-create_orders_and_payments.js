module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * ORDERS COLLECTION
     * =========================
     */

    if (!names.includes("orders")) {
      await db.createCollection("orders");
    }

    await db
      .collection("orders")
      .createIndexes([
        { key: { userId: 1 } },
        { key: { status: 1 } },
        { key: { createdAt: -1 } },
        { key: { razorpayOrderId: 1 } },
      ]);

    /**
     * =========================
     * PAYMENTS COLLECTION
     * =========================
     */

    if (!names.includes("payments")) {
      await db.createCollection("payments");
    }

    await db
      .collection("payments")
      .createIndexes([
        { key: { userId: 1 } },
        { key: { orderId: 1 } },
        { key: { razorpayPaymentId: 1 } },
        { key: { createdAt: -1 } },
      ]);

    console.log("Orders and Payments collections created.");
  },

  async down(db) {
    await db
      .collection("orders")
      .drop()
      .catch(() => {});
    await db
      .collection("payments")
      .drop()
      .catch(() => {});

    console.log("Orders and Payments collections dropped.");
  },
};
