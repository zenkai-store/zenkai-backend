module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * ADDRESSES COLLECTION
     * =========================
     */

    if (!names.includes("addresses")) {
      await db.createCollection("addresses");
    }

    await db.collection("addresses").createIndexes([
      { key: { userId: 1 } },
      { key: { isDefault: 1 } },
      { key: { createdAt: -1 } },
      { key: { pincode: 1 } },

      // Faster user lookup
      {
        key: { userId: 1, isDefault: 1 },
      },
    ]);

    console.log("Addresses collection created successfully.");
  },

  async down(db) {
    await db
      .collection("addresses")
      .drop()
      .catch(() => {});

    console.log("Addresses collection dropped.");
  },
};
