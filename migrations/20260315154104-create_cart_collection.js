module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * CARTS COLLECTION
     * =========================
     */

    if (!names.includes("carts")) {
      await db.createCollection("carts");
    }

    await db
      .collection("carts")
      .createIndexes([
        { key: { userId: 1 }, unique: true },
        { key: { "items.productId": 1 } },
        { key: { createdAt: -1 } },
        { key: { updatedAt: -1 } },
      ]);

    console.log("Cart collection created successfully.");
  },

  async down(db) {
    await db
      .collection("carts")
      .drop()
      .catch(() => {});

    console.log("Cart collection dropped.");
  },
};
