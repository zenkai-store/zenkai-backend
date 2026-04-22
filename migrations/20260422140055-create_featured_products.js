module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * FEATURED PRODUCTS COLLECTION
     * =========================
     */

    if (!names.includes("featuredproducts")) {
      await db.createCollection("featuredproducts");
    }

    // Drop any existing indexes that might conflict
    try {
      await db.collection("featuredproducts").dropIndex("productId_1");
    } catch (err) {
      // Index might not exist, ignore error
    }

    try {
      await db.collection("featuredproducts").dropIndex("displayPosition_1");
    } catch (err) {
      // Index might not exist, ignore error
    }

    // Create indexes with explicit names to avoid conflicts
    await db.collection("featuredproducts").createIndexes([
      {
        key: { displayPosition: 1 },
        unique: true,
        name: "displayPosition_unique_idx",
      },
      {
        key: { productId: 1 },
        name: "productId_regular_idx",
      },
      {
        key: { isActive: 1 },
        name: "isActive_idx",
      },
      {
        key: { createdAt: -1 },
        name: "createdAt_desc_idx",
      },

      // Compound index for active featured products
      {
        key: {
          isActive: 1,
          displayPosition: 1,
          startDate: 1,
          endDate: 1,
        },
        name: "active_featured_compound_idx",
      },

      // Ensure a product is only featured once with unique constraint
      {
        key: { productId: 1 },
        unique: true,
        partialFilterExpression: { isActive: true },
        name: "productId_active_unique_idx",
      },
    ]);

    console.log("Featured products collection created successfully.");
  },

  async down(db) {
    await db
      .collection("featuredproducts")
      .drop()
      .catch(() => {});

    console.log("Featured products collection dropped.");
  },
};
