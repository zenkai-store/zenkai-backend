const mongoose = require("mongoose");

const cartItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },

  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ProductVariant",
    required: true,
  },

  variantSku: {
    type: String,
    required: true,
  },

  variantColor: {
    name: { type: String, required: true },
    code: { type: String, required: true },
  },

  quantity: {
    type: Number,
    required: true,
    min: 1,
  },

  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },

  addedAt: {
    type: Date,
    default: Date.now,
  },
});

// Virtual for total price of this item
cartItemSchema.virtual("totalPrice").get(function () {
  return this.quantity * this.unitPrice;
});

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // This creates the unique index - remove the separate schema.index() below
    },

    items: [cartItemSchema],
  },
  { timestamps: true },
);

// Virtual for cart total
cartSchema.virtual("totalAmount").get(function () {
  return this.items.reduce(
    (total, item) => total + item.quantity * item.unitPrice,
    0,
  );
});

// Virtual for total items count
cartSchema.virtual("totalItems").get(function () {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Method to check if item exists with specific variant
cartSchema.methods.hasVariant = function (variantId) {
  return this.items.some(
    (item) => item.variantId.toString() === variantId.toString(),
  );
};

// Method to get specific cart item by variant
cartSchema.methods.getItemByVariant = function (variantId) {
  return this.items.find(
    (item) => item.variantId.toString() === variantId.toString(),
  );
};

// Ensure virtuals are included in JSON output
cartSchema.set("toJSON", { virtuals: true });
cartSchema.set("toObject", { virtuals: true });

// Only define indexes that are NOT already defined in the schema fields
// Remove the userId index since it's already defined with unique: true in the schema
cartSchema.index({ "items.variantId": 1 });
cartSchema.index({ "items.productId": 1 });
cartSchema.index({ userId: 1, "items.variantId": 1 }); // Compound index for faster lookups
cartSchema.index({ createdAt: -1 });
cartSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Cart", cartSchema);
