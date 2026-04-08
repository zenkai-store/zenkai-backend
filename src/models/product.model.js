const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },

    // Variant information moved to separate collection
    hasVariants: { type: Boolean, default: true },

    // Variant summary for quick display (cached data)
    variantSummary: {
      minPrice: { type: Number, default: 0 },
      maxPrice: { type: Number, default: 0 },
      totalQuantity: { type: Number, default: 0 },
      availableColors: [
        {
          name: String,
          code: String,
          isActive: Boolean,
        },
      ],
    },

    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],

    description: [
      {
        type: {
          type: String,
          enum: ["topic", "line", "bullet"],
        },
        content: String,
      },
    ],

    productDetails: [
      {
        topic: String,
        detail: String,
      },
    ],

    isActive: { type: Boolean, default: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true },
);

// Indexes for better performance
productSchema.index({ variantSummary: 1 });
productSchema.index({ "variantSummary.minPrice": 1 });
productSchema.index({ "variantSummary.totalQuantity": 1 });

module.exports = mongoose.model("Product", productSchema);
