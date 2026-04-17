module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * UPDATE ORDERS COLLECTION FOR VARIANTS
     * =========================
     */

    if (!names.includes("orders")) {
      await db.createCollection("orders");
    }

    // Drop existing indexes
    const existingIndexes = await db.collection("orders").indexes();
    const indexNames = existingIndexes.map((idx) => idx.name);

    // Create new indexes for variant support
    const indexesToCreate = [
      { key: { userId: 1 }, name: "userId_1" },
      { key: { status: 1 }, name: "status_1" },
      { key: { createdAt: -1 }, name: "createdAt_-1" },
      { key: { razorpayOrderId: 1 }, name: "razorpayOrderId_1" },
      { key: { orderNumber: 1 }, unique: true, name: "orderNumber_1" },
      { key: { "items.variantId": 1 }, name: "items.variantId_1" },
      {
        key: { userId: 1, status: 1, createdAt: -1 },
        name: "userId_1_status_1_createdAt_-1",
      },
      { key: { paymentStatus: 1 }, name: "paymentStatus_1" },
      { key: { paymentMethod: 1 }, name: "paymentMethod_1" },
    ];

    for (const index of indexesToCreate) {
      if (!indexNames.includes(index.name)) {
        await db.collection("orders").createIndex(index.key, {
          unique: index.unique || false,
          name: index.name,
        });
      }
    }

    /**
     * =========================
     * UPDATE PAYMENTS COLLECTION FOR VARIANTS
     * =========================
     */

    if (!names.includes("payments")) {
      await db.createCollection("payments");
    }

    const paymentIndexes = await db.collection("payments").indexes();
    const paymentIndexNames = paymentIndexes.map((idx) => idx.name);

    const paymentIndexesToCreate = [
      { key: { userId: 1 }, name: "userId_1" },
      { key: { orderId: 1 }, name: "orderId_1" },
      {
        key: { razorpayPaymentId: 1 },
        unique: true,
        name: "razorpayPaymentId_1",
      },
      {
        key: { razorpayOrderId: 1 },
        unique: true,
        sparse: true,
        name: "razorpayOrderId_1",
      },
      { key: { status: 1 }, name: "status_1" },
      { key: { createdAt: -1 }, name: "createdAt_-1" },
      { key: { paymentMethod: 1 }, name: "paymentMethod_1" },
    ];

    for (const index of paymentIndexesToCreate) {
      if (!paymentIndexNames.includes(index.name)) {
        await db.collection("payments").createIndex(index.key, {
          unique: index.unique || false,
          sparse: index.sparse || false,
          name: index.name,
        });
      }
    }

    /**
     * =========================
     * CREATE ORDER STATUS HISTORY COLLECTION
     * =========================
     */

    if (!names.includes("orderstatushistories")) {
      await db.createCollection("orderstatushistories");

      await db.collection("orderstatushistories").createIndexes([
        { key: { orderId: 1 }, name: "orderId_1" },
        { key: { status: 1 }, name: "status_1" },
        { key: { createdAt: -1 }, name: "createdAt_-1" },
        { key: { orderId: 1, createdAt: -1 }, name: "orderId_1_createdAt_-1" },
      ]);
    }

    /**
     * =========================
     * MIGRATE EXISTING ORDERS TO USE VARIANTS
     * =========================
     */

    const orders = await db.collection("orders").find({}).toArray();

    for (const order of orders) {
      let needsUpdate = false;

      for (const item of order.items) {
        // If item doesn't have variantId, migrate it
        if (!item.variantId && item.productId) {
          const defaultVariant = await db
            .collection("productvariants")
            .findOne({
              productId: item.productId,
              isDefault: true,
              isActive: true,
            });

          if (defaultVariant) {
            item.variantId = defaultVariant._id;
            item.variantSku = defaultVariant.sku;
            item.variantColor = defaultVariant.color;
            needsUpdate = true;
          }
        }
      }

      if (needsUpdate) {
        await db
          .collection("orders")
          .updateOne({ _id: order._id }, { $set: { items: order.items } });
      }
    }

    console.log(
      "Orders and Payments collections updated for variant support successfully.",
    );
  },

  async down(db) {
    // Revert orders to old format
    const orders = await db.collection("orders").find({}).toArray();

    for (const order of orders) {
      for (const item of order.items) {
        delete item.variantId;
        delete item.variantSku;
        delete item.variantColor;
      }

      await db
        .collection("orders")
        .updateOne({ _id: order._id }, { $set: { items: order.items } });
    }

    // Drop new collections
    await db
      .collection("orderstatushistories")
      .drop()
      .catch(() => {});

    console.log("Orders and Payments collections reverted to old format.");
  },
};
