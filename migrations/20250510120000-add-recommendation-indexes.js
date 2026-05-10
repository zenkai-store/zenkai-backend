// migrations/20250510120000-add-recommendation-indexes.js
// Adds indexes required for the product recommendation aggregation pipeline.
// All indexes use background: true so they do not block production traffic.

module.exports = {
  async up(db) {
    // ── products collection ────────────────────────────────────────────────────

    // Core filter used in every recommendation query
    // await db.collection("products").createIndex(
    //   { isActive: 1 },
    //   { name: "idx_products_isActive", background: true },
    // );

    // New arrival scoring + fallback sort
    // await db.collection("products").createIndex(
    //   { createdAt: -1 },
    //   { name: "idx_products_createdAt_desc", background: true },
    // );

    // Same-category scoring (40% weight) — most important index
    await db.collection("products").createIndex(
      { categories: 1, isActive: 1 },
      { name: "idx_products_categories_isActive", background: true },
    );

    // High-stock scoring (15% weight)
    await db.collection("products").createIndex(
      { "variantSummary.totalQuantity": -1, isActive: 1 },
      { name: "idx_products_stock_isActive", background: true },
    );

    // Similar-price scoring (10% weight)
    await db.collection("products").createIndex(
      { "variantSummary.minPrice": 1, isActive: 1 },
      { name: "idx_products_minPrice_isActive", background: true },
    );

    // Compound: category + createdAt + isActive — used together in sort/filter
    await db.collection("products").createIndex(
      { categories: 1, createdAt: -1, isActive: 1 },
      { name: "idx_products_categories_date_status", background: true },
    );

    // ── reviews collection ─────────────────────────────────────────────────────

    // Review lookup in aggregation pipeline (productId + isActive)
    await db.collection("reviews").createIndex(
      { productId: 1, isActive: 1 },
      { name: "idx_reviews_productId_isActive", background: true },
    );

    // ── wishlists collection ───────────────────────────────────────────────────

    // Batch wishlist lookup for authenticated users
    await db.collection("wishlists").createIndex(
      { userId: 1, productId: 1 },
      { name: "idx_wishlists_userId_productId", background: true },
    );

    // ── productvariants collection ─────────────────────────────────────────────

    // Batch variant image fetch (productId + isActive + quantity)
    await db.collection("productvariants").createIndex(
      { productId: 1, isActive: 1, quantity: 1 },
      { name: "idx_variants_productId_isActive_qty", background: true },
    );
  },

  async down(db) {
    const drops = [
    //   { col: "products",       name: "idx_products_isActive" },
    //   { col: "products",       name: "idx_products_createdAt_desc" },
      { col: "products",       name: "idx_products_categories_isActive" },
      { col: "products",       name: "idx_products_stock_isActive" },
      { col: "products",       name: "idx_products_minPrice_isActive" },
      { col: "products",       name: "idx_products_categories_date_status" },
      { col: "reviews",        name: "idx_reviews_productId_isActive" },
      { col: "wishlists",      name: "idx_wishlists_userId_productId" },
      { col: "productvariants",name: "idx_variants_productId_isActive_qty" },
    ];

    for (const { col, name } of drops) {
      try {
        await db.collection(col).dropIndex(name);
      } catch (e) {
        // Index may not exist — safe to ignore during rollback
        console.warn(`Could not drop index ${name} on ${col}:`, e.message);
      }
    }
  },
};