module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * REVIEWS COLLECTION
     * =========================
     */

    if (!names.includes("reviews")) {
      await db.createCollection("reviews");
    }

    await db.collection("reviews").createIndexes([
      // Core query indexes
      { key: { productId: 1 } },
      { key: { userId: 1 } },
      { key: { rating: 1 } },
      { key: { createdAt: -1 } },
      { key: { isActive: 1 } },

      // Ensure a user can review a product only once
      {
        key: { userId: 1, productId: 1 },
        unique: true,
        partialFilterExpression: { isActive: { $eq: true } },
      },

      // For admin dashboard: find reviews by product + status
      { key: { productId: 1, isActive: 1, createdAt: -1 } },

      // For user's own review list
      { key: { userId: 1, isActive: 1, createdAt: -1 } },
    ]);

    console.log("Reviews collection created successfully.");
  },

  async down(db) {
    await db
      .collection("reviews")
      .drop()
      .catch(() => {});

    console.log("Reviews collection dropped.");
  },
};
