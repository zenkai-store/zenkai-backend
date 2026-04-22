const mongoose = require("mongoose");

const featuredProductSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    displayPosition: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
      // Remove 'unique: true' from here - we'll define it at schema level
    },
    title: {
      type: String,
      maxlength: 100,
      default: "New Arrival",
    },
    subtitle: {
      type: String,
      maxlength: 200,
    },
    customBadge: {
      type: String,
      maxlength: 50,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true },
);

// Define all indexes at schema level to avoid duplication
// Ensure only one product per position
featuredProductSchema.index(
  { displayPosition: 1 },
  {
    unique: true,
    name: "displayPosition_unique_idx",
  },
);

// Regular index for productId queries
featuredProductSchema.index(
  { productId: 1 },
  { name: "productId_regular_idx" },
);

// Index for active status queries
featuredProductSchema.index({ isActive: 1 }, { name: "isActive_idx" });

// Index for sorting by creation date
featuredProductSchema.index({ createdAt: -1 }, { name: "createdAt_desc_idx" });

// Compound index for active featured products
featuredProductSchema.index(
  {
    isActive: 1,
    displayPosition: 1,
    startDate: 1,
    endDate: 1,
  },
  { name: "active_featured_compound_idx" },
);

// Ensure a product is not featured multiple times (only for active featured products)
featuredProductSchema.index(
  { productId: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: "productId_active_unique_idx",
  },
);

module.exports = mongoose.model("FeaturedProduct", featuredProductSchema);
