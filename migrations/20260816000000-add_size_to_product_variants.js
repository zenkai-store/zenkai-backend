/**
 * Migration: add_size_to_product_variants
 *
 * 1. Adds `size` field (default "1:24") to every existing productvariant document
 *    that does not already have one.
 * 2. Rebuilds the `variantSummary.availableSizes` cache on every product.
 */

const VALID_SIZES = ["1:16", "1:24", "1:32", "1:64"];
const DEFAULT_SIZE = "1:24";

module.exports = {
  async up(db) {
    // ─── Step 1: Backfill `size` on variants that are missing it ──────────────
    const backfillResult = await db
      .collection("productvariants")
      .updateMany(
        { size: { $exists: false } },
        { $set: { size: DEFAULT_SIZE } },
      );

    console.log(
      `[migration] Backfilled size="${DEFAULT_SIZE}" on ${backfillResult.modifiedCount} variant(s).`,
    );

    // ─── Step 2: Rebuild availableSizes in variantSummary for every product ───
    const products = await db.collection("products").find({}).toArray();

    let updatedProducts = 0;

    for (const product of products) {
      const variants = await db
        .collection("productvariants")
        .find({ productId: product._id, isActive: true })
        .toArray();

      if (variants.length === 0) continue;

      // Collect unique, valid sizes from active variants
      const sizesSet = new Set();
      for (const v of variants) {
        if (v.size && VALID_SIZES.includes(v.size)) {
          sizesSet.add(v.size);
        }
      }
      const availableSizes = [...sizesSet];

      // Rebuild prices and colors while we're here to keep summary consistent
      const prices = variants.map((v) =>
        v.isOnSale && v.pricing?.onSalePrice
          ? v.pricing.onSalePrice
          : v.pricing?.sellingPrice || 0,
      );
      const totalQuantity = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
      const availableColors = variants
        .filter((v) => v.color && v.color.name && v.color.code)
        .map((v) => ({
          name: v.color.name,
          code: v.color.code,
          isActive: v.isActive && v.quantity > 0,
        }));

      await db.collection("products").updateOne(
        { _id: product._id },
        {
          $set: {
            "variantSummary.availableSizes": availableSizes,
            "variantSummary.availableColors": availableColors,
            "variantSummary.minPrice": prices.length ? Math.min(...prices) : 0,
            "variantSummary.maxPrice": prices.length ? Math.max(...prices) : 0,
            "variantSummary.totalQuantity": totalQuantity,
          },
        },
      );

      updatedProducts++;
    }

    console.log(
      `[migration] Rebuilt variantSummary.availableSizes for ${updatedProducts} product(s).`,
    );

    // ─── Step 3: Add index on the size field ──────────────────────────────────
    const existingIndexes = await db
      .collection("productvariants")
      .indexes();
    const sizeIndexExists = existingIndexes.some((idx) => idx.key && idx.key.size !== undefined);

    if (!sizeIndexExists) {
      await db.collection("productvariants").createIndex({ size: 1 });
      console.log("[migration] Created index on productvariants.size.");
    }

    console.log("[migration] add_size_to_product_variants: UP complete.");
  },

  async down(db) {
    // Remove the size field from all variants
    await db
      .collection("productvariants")
      .updateMany({}, { $unset: { size: "" } });

    // Remove availableSizes from all product variantSummary caches
    await db
      .collection("products")
      .updateMany({}, { $unset: { "variantSummary.availableSizes": "" } });

    // Drop the size index if it exists
    try {
      await db.collection("productvariants").dropIndex("size_1");
    } catch (_) {
      // Index may not exist — safe to ignore
    }

    console.log("[migration] add_size_to_product_variants: DOWN complete.");
  },
};
