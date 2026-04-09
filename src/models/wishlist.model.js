const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductVariant",
      default: null,
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Ensure a user can wishlist a specific variant only once
wishlistSchema.index(
  { userId: 1, productId: 1, variantId: 1 },
  { unique: true },
);
wishlistSchema.index({ userId: 1 });
wishlistSchema.index({ productId: 1 });
wishlistSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Wishlist", wishlistSchema);
