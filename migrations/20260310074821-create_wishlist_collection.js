module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * WISHLISTS COLLECTION
     * =========================
     */

    if (!names.includes("wishlists")) {
      await db.createCollection("wishlists");
    }

    await db.collection("wishlists").createIndexes([
      { key: { userId: 1 } },
      { key: { productId: 1 } },
      { key: { createdAt: -1 } },

      // Prevent duplicate wishlist items
      {
        key: { userId: 1, productId: 1 },
        unique: true,
      },
    ]);

    console.log("Wishlist collection created successfully.");
  },

  async down(db) {
    await db
      .collection("wishlists")
      .drop()
      .catch(() => {});

    console.log("Wishlist collection dropped.");
  },
};
