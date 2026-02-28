module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * CATEGORIES COLLECTION
     * =========================
     */
    if (!names.includes("categories")) {
      await db.createCollection("categories");
    }

    await db
      .collection("categories")
      .createIndexes([
        { key: { name: 1 }, unique: true },
        { key: { slug: 1 }, unique: true },
        { key: { isActive: 1 } },
        { key: { displayOrder: 1 } },
        { key: { createdAt: -1 } },
      ]);

    /**
     * =========================
     * PRODUCTS COLLECTION
     * =========================
     */
    if (!names.includes("products")) {
      await db.createCollection("products");
    }

    await db.collection("products").createIndexes([
      { key: { productId: 1 }, unique: true }, // Admin custom ID
      { key: { name: 1 } },
      { key: { slug: 1 }, unique: true },
      { key: { categories: 1 } },
      { key: { "pricing.sellingPrice": 1 } },
      { key: { isActive: 1 } },
      { key: { isOnSale: 1 } },
      { key: { createdAt: -1 } },
    ]);

    console.log("Categories and Products collections created successfully.");
  },

  async down(db) {
    await db
      .collection("products")
      .drop()
      .catch(() => {});
    await db
      .collection("categories")
      .drop()
      .catch(() => {});

    console.log("Categories and Products collections dropped.");
  },
};
