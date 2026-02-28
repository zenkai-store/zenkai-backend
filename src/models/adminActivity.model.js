const mongoose = require("mongoose");

const adminActivitySchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    adminEmail: { type: String, required: true },
    action: { type: String, required: true },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true, collection: "adminActivities" },
);

module.exports = mongoose.model(
  "AdminActivity",
  adminActivitySchema,
  "adminActivities", // 👈 force exact collection name
);
