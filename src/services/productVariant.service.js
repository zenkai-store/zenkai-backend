const express = require("express");
const mongoose = require("mongoose");

const Product = require("../models/product.model");
const ProductVariant = require("../models/productVariant.model");
const Category = require("../models/category.model");

const router = express.Router();

const VALID_SIZES = ["1:16", "1:24", "1:32", "1:64"];

const getPagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * limitNum;
  return { page: pageNum, limit: limitNum, skip };
};

/**
 * Recomputes and persists the variant summary cache on a product.
 * Accepts an optional Mongoose session for transactional consistency.
 */
const updateProductVariantSummary = async (productId, session = null) => {
  const variants = await ProductVariant.find(
    { productId, isActive: true },
    null,
    { session },
  ).lean();

  if (variants.length === 0) {
    return;
  }

  const prices = variants.map((v) =>
    v.isOnSale && v.pricing.onSalePrice
      ? v.pricing.onSalePrice
      : v.pricing.sellingPrice,
  );
  const totalQuantity = variants.reduce((sum, v) => sum + v.quantity, 0);

  const availableColors = variants
    .filter((v) => v.color && v.color.name && v.color.code)
    .map((v) => ({
      name: v.color.name,
      code: v.color.code,
      isActive: v.isActive,
    }));

  const availableSizes = [
    ...new Set(variants.filter((v) => v.size).map((v) => v.size)),
  ].filter((s) => VALID_SIZES.includes(s));

  await Product.findByIdAndUpdate(
    productId,
    {
      $set: {
        variantSummary: {
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
          totalQuantity,
          availableColors,
          availableSizes,
        },
        hasVariants: true,
      },
    },
    { session },
  );
};

const formatProductForListing = async (product) => {
  const cheapestVariant = await ProductVariant.findOne({
    productId: product._id,
    isActive: true,
    quantity: { $gt: 0 },
  })
    .sort({ "pricing.sellingPrice": 1 })
    .lean();

  let variantImage = null;
  if (cheapestVariant?.media?.length) {
    const imageItem = cheapestVariant.media.find((m) => m.type === "image");
    if (imageItem) {
      variantImage = {
        variantId: cheapestVariant._id,
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
    availableSizes: product.variantSummary?.availableSizes || [],
  };
};

/**
 * GET /api/products
 */
router.get("/", async (req, res) => {
  try {
    const { page, limit } = req.query;
    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    const [products, total] = await Promise.all([
      Product.find({ isActive: true })
        .populate("categories", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments({ isActive: true }),
    ]);

    const formattedProducts = await Promise.all(
      products.map((p) => formatProductForListing(p)),
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
 * GET /api/products/:id/variants
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

    res.json({ success: true, data: variants, count: variants.length });
  } catch (err) {
    console.error("Error fetching product variants: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/products/:id/variants/:variantId
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

    res.json({ success: true, data: variant });
  } catch (err) {
    console.error("Error fetching variant: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/products/:id/variants
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

    const { color, size, sku, pricing, quantity, media, isDefault, displayOrder } =
      req.body;

    // Validate size if provided
    if (size !== undefined && size !== null && !VALID_SIZES.includes(size)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Size must be one of: ${VALID_SIZES.join(", ")}`,
      });
    }

    const variantSize = size || "1:24";

    const colorPart = color?.name
      ? color.name.toUpperCase().replace(/\s+/g, "")
      : "DEFAULT";
    const sizePart = variantSize.replace(":", "");
    const generatedSku = sku || `${product.productId}-${colorPart}-${sizePart}`;

    const existingSku = await ProductVariant.findOne({ sku: generatedSku }).session(session);
    if (existingSku) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "SKU already exists" });
    }

    if (isDefault) {
      await ProductVariant.updateMany(
        { productId: product._id },
        { $set: { isDefault: false } },
        { session },
      );
    }

    const nameParts = [product.name];
    if (color?.name) nameParts.push(color.name);
    nameParts.push(variantSize);

    const variant = new ProductVariant({
      productId: product._id,
      sku: generatedSku,
      name: nameParts.join(" - "),
      color: color || null,
      size: variantSize,
      pricing,
      quantity: quantity || 0,
      media: media || [],
      isDefault: isDefault || false,
      displayOrder: displayOrder || 0,
      createdBy: req.user?._id,
    });

    await variant.save({ session });
    await updateProductVariantSummary(product._id, session);
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
 * PUT /api/products/:id/variants/:variantId
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

    const { color, size, pricing, quantity, media, isActive, isDefault, displayOrder } =
      req.body;

    // Validate size if provided
    if (size !== undefined && size !== null && !VALID_SIZES.includes(size)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Size must be one of: ${VALID_SIZES.join(", ")}`,
      });
    }

    if (isDefault) {
      await ProductVariant.updateMany(
        { productId: variant.productId, _id: { $ne: variant._id } },
        { $set: { isDefault: false } },
        { session },
      );
    }

    if (color !== undefined) variant.color = color || null;
    if (size !== undefined) variant.size = size || null;
    if (pricing) {
      variant.pricing = {
        costPrice: pricing.costPrice ?? variant.pricing.costPrice ?? 0,
        marginalPrice: pricing.marginalPrice ?? variant.pricing.marginalPrice ?? 0,
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
    await updateProductVariantSummary(variant.productId, session);
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
 * DELETE /api/products/:id/variants/:variantId
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

    variant.isActive = false;
    variant.updatedBy = req.user?._id;
    await variant.save({ session });
    await updateProductVariantSummary(variant.productId, session);
    await session.commitTransaction();
    session.endSession();

    res.json({ success: true, message: "Variant deleted successfully" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error deleting variant: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/products/search
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

    const productQuery = {
      isActive: true,
      $or: [{ name: searchRegex }, { slug: searchRegex }, { productId: searchRegex }],
    };

    const matchedVariantProductIds = await ProductVariant.find({
      isActive: true,
      $or: [
        { sku: searchRegex },
        { name: searchRegex },
        { "color.name": searchRegex },
        { size: searchRegex },
      ],
    })
      .distinct("productId")
      .lean();

    const finalQuery = {
      $or: [productQuery, { _id: { $in: matchedVariantProductIds } }],
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
      products.map((p) => formatProductForListing(p)),
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
 * GET /api/products/:id
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

    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, isDefault: -1 })
      .lean();

    res.json({ success: true, data: { ...product, variants } });
  } catch (err) {
    console.error("Error in fetching product by id: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/products/slug/:slug
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

    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, isDefault: -1 })
      .lean();

    res.json({ success: true, data: { ...product, variants } });
  } catch (err) {
    console.error("Error in fetching product by slug: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = {
  router,
  updateProductVariantSummary,
};
