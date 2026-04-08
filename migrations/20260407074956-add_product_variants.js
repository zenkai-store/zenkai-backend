module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    /**
     * =========================
     * PRODUCT VARIANTS COLLECTION
     * =========================
     */

    if (!names.includes("productvariants")) {
      await db.createCollection("productvariants");
    }

    await db.collection("productvariants").createIndexes([
      { key: { productId: 1 } },
      { key: { sku: 1 }, unique: true, sparse: true },
      { key: { color: 1 } },
      { key: { "pricing.sellingPrice": 1 } },
      { key: { isActive: 1 } },
      { key: { quantity: 1 } },
      { key: { createdAt: -1 } },

      // Compound index for finding variants of a product with active status
      { key: { productId: 1, isActive: 1, displayOrder: 1 } },

      // For stock management
      { key: { productId: 1, quantity: 1 } },
    ]);

    /**
     * =========================
     * MIGRATE EXISTING PRODUCTS TO HAVE DEFAULT VARIANT
     * =========================
     */

    const products = await db.collection("products").find({}).toArray();

    for (const product of products) {
      // Check if product already has variants
      const existingVariant = await db.collection("productvariants").findOne({
        productId: product._id,
      });

      if (!existingVariant) {
        // Create default variant from product data
        const defaultVariant = {
          productId: product._id,
          sku: `${product.productId}-DEFAULT`,
          name: product.name,
          color: {
            name: "Default",
            code: "#000000",
          },
          media: product.media || [],
          quantity: product.quantity || 0,
          pricing: {
            costPrice: product.pricing?.costPrice || 0,
            marginalPrice: product.pricing?.marginalPrice || 0,
            sellingPrice: product.pricing?.sellingPrice || 0,
            onSalePrice: product.pricing?.onSalePrice || null,
          },
          isOnSale: product.isOnSale || false,
          isActive: true,
          isDefault: true,
          displayOrder: 0,
          createdBy: product.createdBy,
          updatedBy: product.updatedBy,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
        };

        await db.collection("productvariants").insertOne(defaultVariant);
      }
    }

    /**
     * =========================
     * UPDATE PRODUCTS COLLECTION - REMOVE OLD FIELDS
     * =========================
     */

    // Remove quantity and media from products collection as they're now in variants
    await db.collection("products").updateMany(
      {},
      {
        $unset: {
          quantity: "",
          media: "",
        },
      },
    );

    console.log(
      "Product variants collection created and existing products migrated successfully.",
    );
  },

  async down(db) {
    // Restore products with aggregated data from variants
    const variants = await db.collection("productvariants").find({}).toArray();

    // Group variants by productId
    const variantMap = new Map();
    for (const variant of variants) {
      if (!variantMap.has(variant.productId.toString())) {
        variantMap.set(variant.productId.toString(), []);
      }
      variantMap.get(variant.productId.toString()).push(variant);
    }

    // Update each product with aggregated data
    for (const [productId, productVariants] of variantMap) {
      const defaultVariant =
        productVariants.find((v) => v.isDefault) || productVariants[0];

      await db.collection("products").updateOne(
        { _id: new ObjectId(productId) },
        {
          $set: {
            quantity: defaultVariant?.quantity || 0,
            media: defaultVariant?.media || [],
          },
        },
      );
    }

    await db
      .collection("productvariants")
      .drop()
      .catch(() => {});

    console.log("Product variants collection dropped and data restored.");
  },
};
