module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    if (!names.includes("adminActivities")) {
      await db.createCollection("adminActivities");
    }

    await db
      .collection("adminActivities")
      .createIndexes([
        { key: { adminId: 1 } },
        { key: { action: 1 } },
        { key: { createdAt: 1 } },
        { key: { ipAddress: 1 } },
      ]);

    console.log("Admin activity collection created.");
  },

  async down(db) {
    await db
      .collection("adminActivities")
      .drop()
      .catch(() => {});
    console.log("Admin activity collection dropped.");
  },
};
