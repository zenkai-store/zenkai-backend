module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * EXPENSES COLLECTION
     * =========================
     */

    if (!names.includes("expenses")) {
      await db.createCollection("expenses");
    }

    await db
      .collection("expenses")
      .createIndexes([
        { key: { title: 1 } },
        { key: { category: 1 } },
        { key: { amount: 1 } },
        { key: { expenseDate: -1 } },
        { key: { createdBy: 1 } },
        { key: { createdAt: -1 } },
      ]);

    console.log("Expenses collection created successfully.");
  },

  async down(db) {
    await db
      .collection("expenses")
      .drop()
      .catch(() => {});

    console.log("Expenses collection dropped.");
  },
};
