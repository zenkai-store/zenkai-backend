require("dotenv").config();

const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");

(async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not defined in .env");
  }

  const client = await MongoClient.connect(process.env.MONGO_URI);
  const db = client.db();

  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

  await db.collection("admins").updateOne(
    { email: process.env.ADMIN_EMAIL },
    {
      $setOnInsert: {
        name: process.env.ADMIN_NAME,
        email: process.env.ADMIN_EMAIL,
        password: hashedPassword,
        role: "admin",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  console.log("Admin seeded successfully");
  process.exit();
})();
