const mongoose = require("mongoose");

const productVariantSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    sku: { type: String, required: true, unique: true }, // Remove index: true from here

    name: { type: String, required: true }, // Can be color specific name

    color: {
      name: { type: String, required: true },
      code: { type: String, required: true }, // Hex code or color identifier
    },

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

    quantity: { type: Number, default: 0, min: 0, index: true },

    pricing: {
      costPrice: { type: Number, default: 0, min: 0 },
      marginalPrice: { type: Number, default: 0, min: 0 },
      marketPrice: { type: Number, required: true, min: 0 },
      sellingPrice: { type: Number, required: true, min: 0 },
      onSalePrice: { type: Number, min: 0, default: null },
    },

    isOnSale: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false }, // Default variant for backward compatibility

    displayOrder: { type: Number, default: 0 }, // For ordering variants

    attributes: {
      type: Map,
      of: String,
      default: {}, // For future expansion (size, material, etc.)
    },

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

// Compound indexes for common queries
productVariantSchema.index({ productId: 1, isActive: 1, displayOrder: 1 });
productVariantSchema.index({ productId: 1, isDefault: 1 });
productVariantSchema.index({ "color.name": 1 });

// Remove the duplicate SKU index since it's already defined in the schema
// The unique: true in the field definition already creates the index
// So we don't need: productVariantSchema.index({ sku: 1 }, { unique: true });

// Virtual for current price (respects on sale)
productVariantSchema.virtual("currentPrice").get(function () {
  if (this.isOnSale && this.pricing.onSalePrice) {
    return this.pricing.onSalePrice;
  }
  return this.pricing.sellingPrice;
});

// Virtual for display purposes (what to show to users)
productVariantSchema.virtual("displayPrice").get(function () {
  return {
    marketPrice: this.pricing.marketPrice,
    sellingPrice: this.pricing.sellingPrice,
    onSalePrice: this.pricing.isOnSale ? this.pricing.onSalePrice : null,
    isOnSale: this.pricing.isOnSale,
    discountPercentage:
      this.pricing.isOnSale && this.pricing.onSalePrice
        ? Math.round(
            ((this.pricing.marketPrice - this.pricing.onSalePrice) /
              this.pricing.marketPrice) *
              100,
          )
        : 0,
  };
});

// Method to check if in stock
productVariantSchema.methods.isInStock = function (quantity = 1) {
  return this.quantity >= quantity;
};

// Static method to bulk update variant quantities
productVariantSchema.statics.bulkUpdateQuantities = async function (updates) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const bulkOps = updates.map((update) => ({
      updateOne: {
        filter: { _id: update.variantId },
        update: { $inc: { quantity: -update.quantity } },
      },
    }));

    await this.bulkWrite(bulkOps, { session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Ensure indexes are created (Mongoose will handle this automatically)
// You can also explicitly set options to avoid conflicts
productVariantSchema.set("autoIndex", true);

module.exports = mongoose.model("ProductVariant", productVariantSchema);
