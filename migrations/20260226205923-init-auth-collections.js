module.exports = {
  async up(db, client) {
    // =========================
    // USERS COLLECTION
    // =========================
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);

    if (!collectionNames.includes("users")) {
      await db.createCollection("users");
    }

    await db
      .collection("users")
      .createIndexes([
        { key: { email: 1 }, unique: true, sparse: true },
        { key: { phone: 1 }, unique: true, sparse: true },
        { key: { googleId: 1 }, unique: true, sparse: true },
        { key: { role: 1 } },
        { key: { createdAt: 1 } },
      ]);

    // =========================
    // ADMINS COLLECTION
    // =========================
    if (!collectionNames.includes("admins")) {
      await db.createCollection("admins");
    }

    await db
      .collection("admins")
      .createIndexes([
        { key: { email: 1 }, unique: true },
        { key: { role: 1 } },
        { key: { createdAt: 1 } },
      ]);

    // =========================
    // OTP COLLECTION
    // =========================
    if (!collectionNames.includes("otps")) {
      await db.createCollection("otps");
    }

    await db
      .collection("otps")
      .createIndexes([
        { key: { phone: 1 } },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      ]);

    // =========================
    // SESSIONS COLLECTION
    // =========================
    if (!collectionNames.includes("sessions")) {
      await db.createCollection("sessions");
    }

    await db
      .collection("sessions")
      .createIndexes([
        { key: { userId: 1 } },
        { key: { token: 1 } },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      ]);

    console.log("Auth-related collections and indexes created successfully.");
  },

  async down(db, client) {
    await db
      .collection("users")
      .drop()
      .catch(() => {});
    await db
      .collection("admins")
      .drop()
      .catch(() => {});
    await db
      .collection("otps")
      .drop()
      .catch(() => {});
    await db
      .collection("sessions")
      .drop()
      .catch(() => {});

    console.log("Auth-related collections dropped.");
  },
};
