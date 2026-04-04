const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    reviewText: {
      type: String,
      trim: true,
      default: "",
    },
    media: [
      {
        type: {
          type: String,
          enum: ["image", "video"],
        },
        url: String,
        public_id: String,
        format: String,
        bytes: Number,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Ensure a user can write only one active review per product
reviewSchema.index(
  { userId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

module.exports = mongoose.model("Review", reviewSchema);
