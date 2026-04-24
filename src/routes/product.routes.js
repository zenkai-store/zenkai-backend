const express = require("express");
const mongoose = require("mongoose");

const Product = require("../models/product.model");
const ProductVariant = require("../models/productVariant.model");
const Category = require("../models/category.model");

const router = express.Router();

/**
 * PAGINATION FUNCTION HELPER
 */
const getPagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * limitNum;
  return { page: pageNum, limit: limitNum, skip };
};

/**
 * Helper: Update product variant summary cache
 */
const updateProductVariantSummary = async (productId) => {
  const variants = await ProductVariant.find({
    productId,
    isActive: true,
  }).lean();

  if (variants.length === 0) {
    return;
  }

  const prices = variants.map((v) =>
    v.isOnSale && v.pricing.onSalePrice
      ? v.pricing.onSalePrice
      : v.pricing.sellingPrice,
  );
  const totalQuantity = variants.reduce((sum, v) => sum + v.quantity, 0);
  const availableColors = variants.map((v) => ({
    name: v.color.name,
    code: v.color.code,
    isActive: v.isActive,
  }));

  await Product.findByIdAndUpdate(productId, {
    $set: {
      variantSummary: {
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        totalQuantity,
        availableColors,
      },
      hasVariants: true,
    },
  });
};

/**
 * Helper: Format product for listing with variant info
 */
const formatProductForListing = async (product) => {
  // Get cheapest variant for listing display
  const cheapestVariant = await ProductVariant.findOne({
    productId: product._id,
    isActive: true,
    quantity: { $gt: 0 },
  })
    .sort({ "pricing.sellingPrice": 1 })
    .lean();

  let variantImage = null;
  if (
    cheapestVariant &&
    cheapestVariant.media &&
    cheapestVariant.media.length
  ) {
    const imageItem = cheapestVariant.media.find((m) => m.type === "image");
    if (imageItem) {
      variantImage = {
        url: imageItem.url,
        type: "image",
      };
    }
  }

  return {
    _id: product._id,
    productId: product.productId,
    name: product.name,
    slug: product.slug,
    media: variantImage,
    hasVariants: product.hasVariants,
    variantSummary: product.variantSummary,
    pricing: product.variantSummary
      ? {
          sellingPrice: product.variantSummary.minPrice,
          maxPrice: product.variantSummary.maxPrice,
        }
      : null,
  };
};

/**
 * GET: /api/products
 * PAGINATED LIST OF ALL ACTIVE PRODUCTS
 */
router.get("/", async (req, res) => {
  try {
    const { page, limit } = req.query;
    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    const query = { isActive: true };

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("categories", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    // Format products with variant information
    const formattedProducts = await Promise.all(
      products.map((product) => formatProductForListing(product)),
    );

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: formattedProducts,
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
 * GET: /api/products/:id/variants
 * FETCH ALL VARIANTS FOR A SPECIFIC PRODUCT
 */
router.get("/:id/variants", async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      isActive: true,
    });

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, isDefault: -1 })
      .lean();

    res.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  } catch (err) {
    console.error("Error fetching product variants: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/:id/variants/:variantId
 * FETCH SPECIFIC VARIANT
 */
router.get("/:id/variants/:variantId", async (req, res) => {
  try {
    const variant = await ProductVariant.findOne({
      _id: req.params.variantId,
      productId: req.params.id,
      isActive: true,
    }).populate("productId", "name slug productId categories");

    if (!variant) {
      return res
        .status(404)
        .json({ success: false, message: "Variant not found" });
    }

    res.json({
      success: true,
      data: variant,
    });
  } catch (err) {
    console.error("Error fetching variant: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST: /api/products/:id/variants
 * ADD NEW VARIANT TO EXISTING PRODUCT
 */
router.post("/:id/variants", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await Product.findById(req.params.id).session(session);

    if (!product) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const { color, sku, pricing, quantity, media, isDefault, displayOrder } =
      req.body;

    // Check if SKU already exists
    const existingSku = await ProductVariant.findOne({ sku }).session(session);
    if (existingSku) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "SKU already exists" });
    }

    // If this variant is set as default, unset other defaults
    if (isDefault) {
      await ProductVariant.updateMany(
        { productId: product._id },
        { $set: { isDefault: false } },
        { session },
      );
    }

    const variant = new ProductVariant({
      productId: product._id,
      sku: sku || `${product.productId}-${color.name.toUpperCase()}`,
      name: `${product.name} - ${color.name}`,
      color,
      pricing,
      quantity: quantity || 0,
      media: media || [],
      isDefault: isDefault || false,
      displayOrder: displayOrder || 0,
      createdBy: req.user?._id,
    });

    await variant.save({ session });

    // Update product variant summary
    await updateProductVariantSummary(product._id);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      data: variant,
      message: "Variant added successfully",
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error adding variant: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT: /api/products/:id/variants/:variantId
 * UPDATE EXISTING VARIANT
 */
router.put("/:id/variants/:variantId", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const variant = await ProductVariant.findOne({
      _id: req.params.variantId,
      productId: req.params.id,
    }).session(session);

    if (!variant) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Variant not found" });
    }

    const {
      color,
      pricing,
      quantity,
      media,
      isActive,
      isDefault,
      displayOrder,
    } = req.body;

    // If this variant is set as default, unset other defaults
    if (isDefault) {
      await ProductVariant.updateMany(
        { productId: variant.productId, _id: { $ne: variant._id } },
        { $set: { isDefault: false } },
        { session },
      );
    }

    // Update variant fields
    if (color) variant.color = color;
    if (pricing) {
      variant.pricing = {
        costPrice: pricing.costPrice ?? variant.pricing.costPrice ?? 0,
        marginalPrice:
          pricing.marginalPrice ?? variant.pricing.marginalPrice ?? 0,
        marketPrice:
          pricing.marketPrice ??
          variant.pricing.marketPrice ??
          variant.pricing.sellingPrice ??
          0,
        sellingPrice: pricing.sellingPrice ?? variant.pricing.sellingPrice ?? 0,
        onSalePrice:
          pricing.onSalePrice !== undefined
            ? pricing.onSalePrice
            : (variant.pricing.onSalePrice ?? null),
      };

      variant.markModified("pricing");
    }
    if (quantity !== undefined) variant.quantity = quantity;
    if (media) variant.media = media;
    if (isActive !== undefined) variant.isActive = isActive;
    if (isDefault !== undefined) variant.isDefault = isDefault;
    if (displayOrder !== undefined) variant.displayOrder = displayOrder;

    variant.updatedBy = req.user?._id;
    variant.updatedAt = new Date();

    await variant.save({ session });

    // Update product variant summary
    await updateProductVariantSummary(variant.productId);

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      data: variant,
      message: "Variant updated successfully",
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error updating variant: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE: /api/products/:id/variants/:variantId
 * DELETE VARIANT (SOFT DELETE)
 */
router.delete("/:id/variants/:variantId", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const variant = await ProductVariant.findOne({
      _id: req.params.variantId,
      productId: req.params.id,
    }).session(session);

    if (!variant) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Variant not found" });
    }

    // Soft delete
    variant.isActive = false;
    variant.updatedBy = req.user?._id;
    await variant.save({ session });

    // Update product variant summary
    await updateProductVariantSummary(variant.productId);

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: "Variant deleted successfully",
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error deleting variant: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/search
 * FUZZY SEARCH ACROSS PRODUCTS AND VARIANTS
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

    // Search in products
    const productQuery = {
      isActive: true,
      $or: [
        { name: searchRegex },
        { slug: searchRegex },
        { productId: searchRegex },
      ],
    };

    // Also search in variants
    const variants = await ProductVariant.find({
      isActive: true,
      $or: [
        { sku: searchRegex },
        { name: searchRegex },
        { "color.name": searchRegex },
      ],
    })
      .distinct("productId")
      .lean();

    // Combine product queries
    const finalQuery = {
      $or: [productQuery, { _id: { $in: variants } }],
    };

    const [products, total] = await Promise.all([
      Product.find(finalQuery)
        .populate("categories", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(finalQuery),
    ]);

    const formattedProducts = await Promise.all(
      products.map((product) => formatProductForListing(product)),
    );

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: formattedProducts,
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
 * GET: /api/products/:id
 * FETCH A SINGLE ACTIVE PRODUCT WITH ITS VARIANTS
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

    // Fetch all active variants
    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, isDefault: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        ...product,
        variants,
      },
    });
  } catch (err) {
    console.error("Error in fetching product by id: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET: /api/products/slug/:slug
 * FETCH A SINGLE ACTIVE PRODUCT BY SLUG WITH VARIANTS
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

    // Fetch all active variants
    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, isDefault: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        ...product,
        variants,
      },
    });
  } catch (err) {
    console.error("Error in fetching product by slug: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
