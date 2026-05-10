// src/services/recommendation.service.js
// Weighted product recommendation engine — GET /api/products/recommend/:productId
//
// Scoring weights (total = 100):
//   Same Category        → 40pts
//   Top Rated  (≥ 4.0)  → 20pts
//   New Arrival (≤ 30d) → 15pts
//   High Stock (≥ 10)   → 15pts
//   Similar Price (±30%)→ 10pts

// const mongoose = require("mongoose");
// const Product = require("../models/product.model");
// const ProductVariant = require("../models/productVariant.model");
// const Wishlist = require("../models/wishlist.model");

// // ── Constants ──────────────────────────────────────────────────────────────────

// const RECOMMENDATION_LIMIT = 8;

// const WEIGHTS = {
//   sameCategory: 40,
//   topRated:     20,
//   newArrival:   15,
//   highStock:    15,
//   similarPrice: 10,
// };

// const TOP_RATED_THRESHOLD  = 4.0;   // avg rating >= 4.0 to earn topRated points
// const HIGH_STOCK_THRESHOLD = 10;    // totalQuantity >= 10 to earn highStock points
// const NEW_ARRIVAL_DAYS     = 30;    // created within last 30 days = new arrival
// const PRICE_RANGE_PERCENT  = 0.30;  // ±30% of source product's minPrice

// // ── Main export ────────────────────────────────────────────────────────────────

// /**
//  * Returns up to 8 weighted product recommendations for a given product.
//  *
//  * @param {string}      productId  - MongoDB _id of the source product
//  * @param {string|null} userId     - Decoded user id (req.user?.id), null if unauthenticated
//  * @returns {Promise<Array>}
//  */
// const getRecommendations = async (productId, userId = null) => {

//   // ── 1. Validate ─────────────────────────────────────────────────────────────
//   if (!mongoose.Types.ObjectId.isValid(productId)) {
//     throw new Error("Invalid product ID");
//   }

//   const sourceId = new mongoose.Types.ObjectId(productId);

//   // ── 2. Fetch source product signals (categories + price only) ───────────────
//   const sourceProduct = await Product.findOne({ _id: sourceId, isActive: true })
//     .select("categories variantSummary")
//     .lean();

//   if (!sourceProduct) {
//     throw new Error("Product not found");
//   }

//   const sourceCategoryIds = sourceProduct.categories || [];
//   const sourceMinPrice    = sourceProduct.variantSummary?.minPrice || 0;
//   const minPrice          = sourceMinPrice * (1 - PRICE_RANGE_PERCENT);
//   const maxPrice          = sourceMinPrice * (1 + PRICE_RANGE_PERCENT);

//   const newArrivalCutoff = new Date();
//   newArrivalCutoff.setDate(newArrivalCutoff.getDate() - NEW_ARRIVAL_DAYS);

//   // ── 3. Recommendation aggregation pipeline ───────────────────────────────────
//   // Single pipeline: filter → score → review lookup → sort → limit → project
//   const pipeline = [

//     // Stage 1 — Filter active products, exclude source
//     {
//       $match: {
//         _id:      { $ne: sourceId },
//         isActive: true,
//       },
//     },

//     // Stage 2 — Compute weight components (no DB calls, uses indexed fields)
//     {
//       $addFields: {

//         // 40pts — any category overlap with source product
//         _catScore: {
//           $cond: [
//             {
//               $gt: [
//                 {
//                   $size: {
//                     $ifNull: [
//                       { $setIntersection: ["$categories", sourceCategoryIds] },
//                       [],
//                     ],
//                   },
//                 },
//                 0,
//               ],
//             },
//             WEIGHTS.sameCategory,
//             0,
//           ],
//         },

//         // 15pts — created within the last 30 days
//         _newScore: {
//           $cond: [
//             { $gte: ["$createdAt", newArrivalCutoff] },
//             WEIGHTS.newArrival,
//             0,
//           ],
//         },

//         // 15pts — cached totalQuantity >= 10 (from variantSummary, no join needed)
//         _stockScore: {
//           $cond: [
//             {
//               $gte: [
//                 { $ifNull: ["$variantSummary.totalQuantity", 0] },
//                 HIGH_STOCK_THRESHOLD,
//               ],
//             },
//             WEIGHTS.highStock,
//             0,
//           ],
//         },

//         // 10pts — minPrice within ±30% of source product minPrice
//         _priceScore: {
//           $cond: [
//             {
//               $and: [
//                 { $gte: [{ $ifNull: ["$variantSummary.minPrice", 0] }, minPrice] },
//                 { $lte: [{ $ifNull: ["$variantSummary.minPrice", 0] }, maxPrice] },
//               ],
//             },
//             WEIGHTS.similarPrice,
//             0,
//           ],
//         },
//       },
//     },

//     // Stage 3 — Lookup reviews (matches existing codebase: isActive: true)
//     {
//       $lookup: {
//         from: "reviews",
//         let:  { pid: "$_id" },
//         pipeline: [
//           {
//             $match: {
//               $expr:    { $eq: ["$productId", "$$pid"] },
//               isActive: true,
//             },
//           },
//           { $group: { _id: null, avg: { $avg: "$rating" } } },
//         ],
//         as: "_reviewAgg",
//       },
//     },

//     // Stage 4 — Compute averageReview (1 decimal) and topRated score (20pts)
//     {
//       $addFields: {
//         averageReview: {
//           $cond: [
//             { $gt: [{ $size: "$_reviewAgg" }, 0] },
//             { $round: [{ $arrayElemAt: ["$_reviewAgg.avg", 0] }, 1] },
//             0,
//           ],
//         },
//         _ratingScore: {
//           $cond: [
//             {
//               $and: [
//                 { $gt:  [{ $size: "$_reviewAgg" }, 0] },
//                 { $gte: [{ $arrayElemAt: ["$_reviewAgg.avg", 0] }, TOP_RATED_THRESHOLD] },
//               ],
//             },
//             WEIGHTS.topRated,
//             0,
//           ],
//         },
//       },
//     },

//     // Stage 5 — Sum all components into final score
//     {
//       $addFields: {
//         _score: {
//           $add: [
//             "$_catScore",
//             "$_ratingScore",
//             "$_newScore",
//             "$_stockScore",
//             "$_priceScore",
//           ],
//         },
//       },
//     },

//     // Stage 6 — Sort: highest score → best rating → newest
//     { $sort: { _score: -1, averageReview: -1, createdAt: -1 } },

//     // Stage 7 — Limit early to reduce downstream processing
//     { $limit: RECOMMENDATION_LIMIT },

//     // Stage 8 — Project only required fields; all _internal fields are excluded
//     {
//       $project: {
//         _id:            1,
//         productId:      1,
//         name:           1,
//         slug:           1,
//         hasVariants:    1,
//         variantSummary: 1,
//         averageReview:  1,
//       },
//     },
//   ];

//   let recommendations = await Product.aggregate(pipeline);

//   // ── 4. Fallback — fill remaining slots with most recent products ─────────────
//   if (recommendations.length < RECOMMENDATION_LIMIT) {
//     const excludeIds = [sourceId, ...recommendations.map((r) => r._id)];
//     const needed     = RECOMMENDATION_LIMIT - recommendations.length;

//     const fallback = await Product.aggregate([
//       {
//         $match: {
//           _id:      { $nin: excludeIds },
//           isActive: true,
//         },
//       },
//       { $sort:  { createdAt: -1 } },
//       { $limit: needed },
//       {
//         $lookup: {
//           from: "reviews",
//           let:  { pid: "$_id" },
//           pipeline: [
//             {
//               $match: {
//                 $expr:    { $eq: ["$productId", "$$pid"] },
//                 isActive: true,
//               },
//             },
//             { $group: { _id: null, avg: { $avg: "$rating" } } },
//           ],
//           as: "_reviewAgg",
//         },
//       },
//       {
//         $addFields: {
//           averageReview: {
//             $cond: [
//               { $gt: [{ $size: "$_reviewAgg" }, 0] },
//               { $round: [{ $arrayElemAt: ["$_reviewAgg.avg", 0] }, 1] },
//               0,
//             ],
//           },
//         },
//       },
//       {
//         $project: {
//           _id:            1,
//           productId:      1,
//           name:           1,
//           slug:           1,
//           hasVariants:    1,
//           variantSummary: 1,
//           averageReview:  1,
//         },
//       },
//     ]);

//     recommendations = [...recommendations, ...fallback];
//   }

//   // ── 5. Batch wishlist lookup — single query for all recommended products ──────
//   const wishlistedSet = new Set();
//   if (userId && recommendations.length > 0) {
//     const wishlistItems = await Wishlist.find({
//       userId:    new mongoose.Types.ObjectId(userId),
//       productId: { $in: recommendations.map((r) => r._id) },
//     })
//       .select("productId")
//       .lean();

//     wishlistItems.forEach((item) => {
//       wishlistedSet.add(item.productId.toString());
//     });
//   }

//   // ── 6. Batch variant image fetch — single query for all products ─────────────
//   // Fetch cheapest in-stock variant per product in one DB call, then map in JS.
//   // This replaces the previous per-product query and eliminates N+1 completely.
//   const variantDocs = await ProductVariant.find({
//     productId: { $in: recommendations.map((r) => r._id) },
//     isActive:  true,
//     quantity:  { $gt: 0 },
//   })
//     .sort({ "pricing.sellingPrice": 1 })
//     .select("productId media")
//     .lean();

//   // Build map: productId → first image (variants are sorted cheapest first,
//   // so the first entry per productId is already the cheapest variant)
//   const imageMap = {};
//   for (const variant of variantDocs) {
//     const key = variant.productId.toString();
//     if (imageMap[key]) continue; // keep cheapest (first encountered)
//     const imageItem = variant.media?.find((m) => m.type === "image");
//     if (imageItem) {
//       imageMap[key] = { url: imageItem.url, type: "image" };
//     }
//   }

//   // ── 7. Shape and return final response ──────────────────────────────────────
//   return recommendations.map((product) => ({
//     _id:            product._id,
//     productId:      product.productId,
//     name:           product.name,
//     slug:           product.slug,
//     media:          imageMap[product._id.toString()] || null,
//     hasVariants:    product.hasVariants,
//     variantSummary: product.variantSummary,
//     pricing: product.variantSummary
//       ? {
//           sellingPrice: product.variantSummary.minPrice,
//           maxPrice:     product.variantSummary.maxPrice,
//         }
//       : null,
//     averageReview:  product.averageReview ?? 0,
//     isWishlisted:   wishlistedSet.has(product._id.toString()),
//   }));
// };

// module.exports = { getRecommendations };

// src/services/recommendation.service.js
// Weighted product recommendation engine — GET /api/products/recommend/:productId
//
// Scoring weights (total = 100):
//   Same Category           → 40pts
//   Top Rated  (≥ 4.0)     → 20pts
//   New Arrival (≤ 30d)    → 15pts
//   High Stock (≥ 10)      → 10pts  (reduced from 15 to fund metadata score)
//   Metadata Similarity    → 10pts  (productDetails topic overlap)
//   Similar Price (±30%)   →  5pts  (reduced from 10 to fund metadata score)

const mongoose = require("mongoose");
const Product = require("../models/product.model");
const ProductVariant = require("../models/productVariant.model");
const Wishlist = require("../models/wishlist.model");

// ── Constants ──────────────────────────────────────────────────────────────────

const RECOMMENDATION_LIMIT = 8;

const WEIGHTS = {
  sameCategory:   40,
  topRated:       20,
  newArrival:     15,
  highStock:      10,   // was 15, reduced by 5 to fund metaSimilarity
  metaSimilarity: 10,   // NEW — productDetails topic overlap
  similarPrice:    5,   // was 10, reduced by 5 to fund metaSimilarity
};

const TOP_RATED_THRESHOLD  = 4.0;   // avg rating >= 4.0 to earn topRated points
const HIGH_STOCK_THRESHOLD = 10;    // totalQuantity >= 10 to earn highStock points
const NEW_ARRIVAL_DAYS     = 30;    // created within last 30 days = new arrival
const PRICE_RANGE_PERCENT  = 0.30;  // ±30% of source product's minPrice

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Returns up to 8 weighted product recommendations for a given product.
 *
 * @param {string}      productId  - MongoDB _id of the source product
 * @param {string|null} userId     - Decoded user id (req.user?.id), null if unauthenticated
 * @returns {Promise<Array>}
 */
const getRecommendations = async (productId, userId = null) => {

  // ── Future personalisation hooks ─────────────────────────────────────────────
  // The scoring pipeline is intentionally modular so these can be added later
  // without restructuring this service:
  //
  // HOOK A — CTR boost (click-through rate tracking):
  //   Add a _ctrScore field in Stage 2 using a pre-aggregated ctrScore field
  //   on the Product document (updated via a background job). Weight: ~10pts.
  //
  // HOOK B — Purchase history bias:
  //   If userId is present, fetch the user's previously purchased category IDs
  //   before the pipeline and pass them alongside sourceCategoryIds to Stage 2.
  //   Boost products in those categories with an additional _historyScore.
  //
  // HOOK C — AI collaborative filtering:
  //   Replace or supplement the $match in Stage 1 with a pre-computed list of
  //   candidate product IDs from an external recommendation model (e.g. stored
  //   in a RecommendationCache collection, refreshed nightly).
  //   The scoring pipeline then re-ranks those candidates with live signals.
  // ─────────────────────────────────────────────────────────────────────────────

  // ── 1. Validate ──────────────────────────────────────────────────────────────
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new Error("Invalid product ID");
  }

  const sourceId = new mongoose.Types.ObjectId(productId);

  // ── 2. Fetch source product signals ──────────────────────────────────────────
  // productDetails added so we can extract topic names for metadata similarity
  const sourceProduct = await Product.findOne({ _id: sourceId, isActive: true })
    .select("categories variantSummary productDetails")
    .lean();

  if (!sourceProduct) {
    throw new Error("Product not found");
  }

  const sourceCategoryIds = sourceProduct.categories || [];
  const sourceMinPrice    = sourceProduct.variantSummary?.minPrice || 0;
  const minPrice          = sourceMinPrice * (1 - PRICE_RANGE_PERCENT);
  const maxPrice          = sourceMinPrice * (1 + PRICE_RANGE_PERCENT);

  // Extract topic names from productDetails for metadata similarity scoring.
  // We use topic keys (e.g. "Material", "Scale", "Brand") rather than detail
  // values (e.g. "Die-cast metal", "1:24") because topic names are consistent
  // keys reused across products, while detail values are free-text and won't
  // match reliably. If productDetails is empty, sourceTopics = [] and
  // _metaScore will safely return 0 for all candidates — no errors, no bias.
  const sourceTopics = (sourceProduct.productDetails || [])
    .map((d) => d.topic)
    .filter(Boolean);

  const newArrivalCutoff = new Date();
  newArrivalCutoff.setDate(newArrivalCutoff.getDate() - NEW_ARRIVAL_DAYS);

  // ── 3. Recommendation aggregation pipeline ────────────────────────────────────
  // Single pipeline: filter → score → review lookup → sort → limit → project
  const pipeline = [

    // Stage 1 — Filter active products, exclude source
    {
      $match: {
        _id:      { $ne: sourceId },
        isActive: true,
      },
    },

    // Stage 2 — Compute weight components (no DB calls, uses indexed fields)
    {
      $addFields: {

        // 40pts — any category overlap with source product
        _catScore: {
          $cond: [
            {
              $gt: [
                {
                  $size: {
                    $ifNull: [
                      { $setIntersection: ["$categories", sourceCategoryIds] },
                      [],
                    ],
                  },
                },
                0,
              ],
            },
            WEIGHTS.sameCategory,
            0,
          ],
        },

        // 15pts — created within the last 30 days
        _newScore: {
          $cond: [
            { $gte: ["$createdAt", newArrivalCutoff] },
            WEIGHTS.newArrival,
            0,
          ],
        },

        // 10pts — cached totalQuantity >= 10 (from variantSummary, no join needed)
        _stockScore: {
          $cond: [
            {
              $gte: [
                { $ifNull: ["$variantSummary.totalQuantity", 0] },
                HIGH_STOCK_THRESHOLD,
              ],
            },
            WEIGHTS.highStock,
            0,
          ],
        },

        // 5pts — minPrice within ±30% of source product minPrice
        _priceScore: {
          $cond: [
            {
              $and: [
                { $gte: [{ $ifNull: ["$variantSummary.minPrice", 0] }, minPrice] },
                { $lte: [{ $ifNull: ["$variantSummary.minPrice", 0] }, maxPrice] },
              ],
            },
            WEIGHTS.similarPrice,
            0,
          ],
        },

        // 10pts — shares 1+ productDetail topic names with source product
        // e.g. both products have "Material", "Scale", or "Brand" as a topic.
        // $map extracts the topic field from each productDetails entry,
        // then $setIntersection finds common topics with the source product.
        // If either side is empty the $ifNull safely returns [] and score = 0.
        _metaScore: {
          $cond: [
            {
              $gt: [
                {
                  $size: {
                    $ifNull: [
                      {
                        $setIntersection: [
                          {
                            $map: {
                              input: { $ifNull: ["$productDetails", []] },
                              as:    "pd",
                              in:    "$$pd.topic",
                            },
                          },
                          sourceTopics,
                        ],
                      },
                      [],
                    ],
                  },
                },
                0,
              ],
            },
            WEIGHTS.metaSimilarity,
            0,
          ],
        },

      },
    },

    // Stage 3 — Lookup reviews (matches existing codebase: isActive: true)
    {
      $lookup: {
        from: "reviews",
        let:  { pid: "$_id" },
        pipeline: [
          {
            $match: {
              $expr:    { $eq: ["$productId", "$$pid"] },
              isActive: true,
            },
          },
          { $group: { _id: null, avg: { $avg: "$rating" } } },
        ],
        as: "_reviewAgg",
      },
    },

    // Stage 4 — Compute averageReview (1 decimal) and topRated score (20pts)
    {
      $addFields: {
        averageReview: {
          $cond: [
            { $gt: [{ $size: "$_reviewAgg" }, 0] },
            { $round: [{ $arrayElemAt: ["$_reviewAgg.avg", 0] }, 1] },
            0,
          ],
        },
        _ratingScore: {
          $cond: [
            {
              $and: [
                { $gt:  [{ $size: "$_reviewAgg" }, 0] },
                { $gte: [{ $arrayElemAt: ["$_reviewAgg.avg", 0] }, TOP_RATED_THRESHOLD] },
              ],
            },
            WEIGHTS.topRated,
            0,
          ],
        },
      },
    },

    // Stage 5 — Sum all components into final score
    {
      $addFields: {
        _score: {
          $add: [
            "$_catScore",
            "$_ratingScore",
            "$_newScore",
            "$_stockScore",
            "$_priceScore",
            "$_metaScore",    // metadata similarity included in final score
          ],
        },
      },
    },

    // Stage 6 — Sort: highest score → best rating → newest
    // Tiebreaker order: same _score → higher averageReview wins → more recent wins
    { $sort: { _score: -1, averageReview: -1, createdAt: -1 } },

    // Stage 7 — Limit early to reduce downstream processing
    { $limit: RECOMMENDATION_LIMIT },

    // Stage 8 — Project only required fields; all _internal fields are excluded
    {
      $project: {
        _id:            1,
        productId:      1,
        name:           1,
        slug:           1,
        hasVariants:    1,
        variantSummary: 1,
        averageReview:  1,
      },
    },
  ];

  let recommendations = await Product.aggregate(pipeline);

  // ── 4. Fallback — fill remaining slots with most recent products ──────────────
  if (recommendations.length < RECOMMENDATION_LIMIT) {
    const excludeIds = [sourceId, ...recommendations.map((r) => r._id)];
    const needed     = RECOMMENDATION_LIMIT - recommendations.length;

    const fallback = await Product.aggregate([
      {
        $match: {
          _id:      { $nin: excludeIds },
          isActive: true,
        },
      },
      { $sort:  { createdAt: -1 } },
      { $limit: needed },
      {
        $lookup: {
          from: "reviews",
          let:  { pid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr:    { $eq: ["$productId", "$$pid"] },
                isActive: true,
              },
            },
            { $group: { _id: null, avg: { $avg: "$rating" } } },
          ],
          as: "_reviewAgg",
        },
      },
      {
        $addFields: {
          averageReview: {
            $cond: [
              { $gt: [{ $size: "$_reviewAgg" }, 0] },
              { $round: [{ $arrayElemAt: ["$_reviewAgg.avg", 0] }, 1] },
              0,
            ],
          },
        },
      },
      {
        $project: {
          _id:            1,
          productId:      1,
          name:           1,
          slug:           1,
          hasVariants:    1,
          variantSummary: 1,
          averageReview:  1,
        },
      },
    ]);

    recommendations = [...recommendations, ...fallback];
  }

  // ── 5. Batch wishlist lookup — single query for all recommended products ───────
  const wishlistedSet = new Set();
  if (userId && recommendations.length > 0) {
    const wishlistItems = await Wishlist.find({
      userId:    new mongoose.Types.ObjectId(userId),
      productId: { $in: recommendations.map((r) => r._id) },
    })
      .select("productId")
      .lean();

    wishlistItems.forEach((item) => {
      wishlistedSet.add(item.productId.toString());
    });
  }

  // ── 6. Batch variant image fetch — single query for all products ──────────────
  // Fetch cheapest in-stock variant per product in one DB call, then map in JS.
  // This replaces the previous per-product query and eliminates N+1 completely.
  const variantDocs = await ProductVariant.find({
    productId: { $in: recommendations.map((r) => r._id) },
    isActive:  true,
    quantity:  { $gt: 0 },
  })
    .sort({ "pricing.sellingPrice": 1 })
    .select("productId media")
    .lean();

  // Build map: productId → first image (variants are sorted cheapest first,
  // so the first entry per productId is already the cheapest variant)
  const imageMap = {};
  for (const variant of variantDocs) {
    const key = variant.productId.toString();
    if (imageMap[key]) continue; // keep cheapest (first encountered)
    const imageItem = variant.media?.find((m) => m.type === "image");
    if (imageItem) {
      imageMap[key] = { url: imageItem.url, type: "image" };
    }
  }

  // ── 7. Shape and return final response ───────────────────────────────────────
  return recommendations.map((product) => ({
    _id:            product._id,
    productId:      product.productId,
    name:           product.name,
    slug:           product.slug,
    media:          imageMap[product._id.toString()] || null,
    hasVariants:    product.hasVariants,
    variantSummary: product.variantSummary,
    pricing: product.variantSummary
      ? {
          sellingPrice: product.variantSummary.minPrice,
          maxPrice:     product.variantSummary.maxPrice,
        }
      : null,
    averageReview:  product.averageReview ?? 0,
    isWishlisted:   wishlistedSet.has(product._id.toString()),
  }));
};

module.exports = { getRecommendations };