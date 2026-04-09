module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * UPDATE CARTS COLLECTION FOR VARIANTS
     * =========================
     */

    if (!names.includes("carts")) {
      await db.createCollection("carts");
    }

    // Drop existing indexes
    try {
      await db.collection("carts").dropIndex("items.productId_1");
    } catch (err) {
      // Index might not exist
    }

    try {
      await db.collection("carts").dropIndex("userId_1_items.productId_1");
    } catch (err) {
      // Index might not exist
    }

    // Create new indexes for variant support
    await db.collection("carts").createIndexes([
      { key: { userId: 1 }, unique: true },
      { key: { "items.variantId": 1 } },
      { key: { "items.productId": 1 } },
      { key: { createdAt: -1 } },
      { key: { updatedAt: -1 } },

      // Compound index for faster lookups
      { key: { userId: 1, "items.variantId": 1 } },
    ]);

    /**
     * =========================
     * MIGRATE EXISTING CARTS TO USE VARIANTS
     * =========================
     */

    const carts = await db.collection("carts").find({}).toArray();

    for (const cart of carts) {
      let needsUpdate = false;

      for (const item of cart.items) {
        // If the item doesn't have variantId, we need to migrate it
        if (!item.variantId && item.productId) {
          // Find the default variant for this product
          const defaultVariant = await db
            .collection("productvariants")
            .findOne({
              productId: item.productId,
              isDefault: true,
              isActive: true,
            });

          if (defaultVariant) {
            item.variantId = defaultVariant._id;
            item.variantSku = defaultVariant.sku;
            item.variantColor = defaultVariant.color;
            item.unitPrice =
              defaultVariant.isOnSale && defaultVariant.pricing.onSalePrice
                ? defaultVariant.pricing.onSalePrice
                : defaultVariant.pricing.sellingPrice;
            needsUpdate = true;
          }
        }
      }

      if (needsUpdate) {
        await db
          .collection("carts")
          .updateOne({ _id: cart._id }, { $set: { items: cart.items } });
      }
    }

    console.log("Cart collection updated for variant support successfully.");
  },

  async down(db) {
    // Revert carts to old format (remove variant fields)
    const carts = await db.collection("carts").find({}).toArray();

    for (const cart of carts) {
      for (const item of cart.items) {
        delete item.variantId;
        delete item.variantSku;
        delete item.variantColor;
        delete item.unitPrice;
      }

      await db
        .collection("carts")
        .updateOne({ _id: cart._id }, { $set: { items: cart.items } });
    }

    // Restore old indexes
    await db.collection("carts").createIndex({ "items.productId": 1 });

    console.log("Cart collection reverted to old format.");
  },
};
