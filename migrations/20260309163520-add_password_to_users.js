module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    if (!names.includes("users")) {
      throw new Error("Users collection does not exist.");
    }

    const users = db.collection("users");

    // Add password field to existing users
    await users.updateMany(
      {},
      {
        $set: {
          password: null,
        },
      },
    );

    // Check if email index already exists
    const indexes = await users.indexes();
    const emailIndexExists = indexes.some((index) => index.name === "email_1");

    if (!emailIndexExists) {
      await users.createIndex({ email: 1 }, { unique: true, sparse: true });
      console.log("Email index created.");
    } else {
      console.log("Email index already exists. Skipping index creation.");
    }

    console.log("Password field added to users collection.");
  },

  async down(db) {
    const users = db.collection("users");

    await users.updateMany(
      {},
      {
        $unset: { password: "" },
      },
    );

    console.log("Password field removed from users collection.");
  },
};
