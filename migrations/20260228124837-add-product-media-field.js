module.exports = {
  async up(db) {
    await db.collection("products").updateMany(
      {},
      {
        $set: {
          media: [],
        },
      },
    );

    await db.collection("products").createIndex({
      "media.type": 1,
    });

    console.log("Media field added to products.");
  },

  async down(db) {
    await db.collection("products").updateMany(
      {},
      {
        $unset: { media: "" },
      },
    );

    console.log("Media field removed.");
  },
};
