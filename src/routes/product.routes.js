const express = require("express");

const Product = require("../models/product.model");
const Category = require("../models/category.model");

const router = express.Router();

/**
 * PAGINATION FUNCTION HELPER
 */
const getPagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 20);
  const skip = (pageNum - 1) * limitNum;
  return { page: pageNum, limit: limitNum, skip };
};

/**
 * Helper: Format a product for listing views (concise response)
 * Includes: id, productId, name, slug, first image (if any), pricing, on-sale flag.
 */
const formatProductForListing = (product) => {
  // Find the first media item that is an image
  let firstImage = null;
  if (product.media && product.media.length) {
    const imageItem = product.media.find((m) => m.type === "image");
    if (imageItem) {
      firstImage = {
        url: imageItem.url,
        type: "image",
        // optionally include public_id if needed, but omitted for brevity
      };
    } else if (product.media[0]) {
      // fallback to first media item (could be video/model) – still provide something
      firstImage = {
        url: product.media[0].url,
        type: product.media[0].type,
      };
    }
  }

  return {
    _id: product._id,
    productId: product.productId,
    name: product.name,
    slug: product.slug,
    media: firstImage, // single object, not an array
    pricing: {
      sellingPrice: product.pricing?.sellingPrice,
      onSalePrice: product.pricing?.onSalePrice,
      isOnSale: product.isOnSale || false,
    },
    // Optional: include categories summary if needed for listing
    // categories: product.categories?.map(cat => ({ _id: cat._id, name: cat.name, slug: cat.slug }))
  };
};

/**
 * GET: /api/products
 * PAGINATED LIST OF ALL ACTIVE PRODUCTS (isActive: true)
 * Query: ?page=1&limit=20
 * Response: concise listing format
 */
router.get("/", async (req, res) => {
  try {
    const { page, limit } = req.query;
    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    const query = { isActive: true };

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("categories", "name slug") // still populated for possible category display
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    // Transform each product to concise listing format
    const conciseProducts = products.map(formatProductForListing);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: conciseProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    console.error("Error in product listing: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/search
 * FUZZY SEARCH ACROSS NAME, SLUG, AND PRODUCTID
 * QUERY: ?q=searchTerm&page=1&limit=10
 * Response: concise listing format
 */
router.get("/search", async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    if (!q) {
      return res
        .status(400)
        .json({ success: false, message: "Search query is required" });
    }

    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    const searchRegex = new RegExp(q, "i");
    const query = {
      isActive: true,
      $or: [
        { name: searchRegex },
        { slug: searchRegex },
        { productId: searchRegex },
      ],
    };

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("categories", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    const conciseProducts = products.map(formatProductForListing);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: conciseProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    console.error("Error in product search: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/category/:categoryId
 * FILTER PRODUCTS BY A SPECIFIC CATEGORY (active only)
 * QUERY: ?page=1&limit=10
 * (Keeps full product details – you may also apply concise format if desired, but we leave unchanged per request)
 */
router.get("/category/:categoryId", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page, limit } = req.query;

    // Validate category exists and is active
    const category = await Category.findById(categoryId);
    if (!category || !category.isActive) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    const query = {
      isActive: true,
      categories: categoryId,
    };

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("categories", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // For category filter we keep full product data, but you can easily change to conciseProducts.map if needed
    res.json({
      success: true,
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    console.error("Error in filtering by category: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/:id
 * FETCH A SINGLE ACTIVE PRODUCT BY ITS MongoDB _id
 * Returns full product details (no change)
 */
router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      isActive: true,
    })
      .populate("categories", "name slug")
      .lean();

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, data: product });
  } catch (err) {
    console.error("Error in fetching product by id: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/slug/:slug
 * FETCH A SINGLE ACTIVE PRODUCT BY ITS SLUG
 * Returns full product details (no change)
 */
router.get("/slug/:slug", async (req, res) => {
  try {
    const product = await Product.findOne({
      slug: req.params.slug,
      isActive: true,
    })
      .populate("categories", "name slug")
      .lean();

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, data: product });
  } catch (err) {
    console.error("Error in fetching product by slug: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
