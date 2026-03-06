const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },

    media: [
      {
        type: {
          type: String,
          enum: ["image", "video", "model"],
        },
        url: String,
        public_id: String,
        format: String,
        bytes: Number,
      },
    ],

    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],

    quantity: { type: Number, default: 0 },

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

    pricing: {
      costPrice: Number,
      marginalPrice: Number,
      sellingPrice: Number,
      onSalePrice: Number,
    },

    isOnSale: { type: Boolean, default: false },
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

module.exports = mongoose.model("Product", productSchema);
