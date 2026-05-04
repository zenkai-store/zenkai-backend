const express = require("express");
const mongoose = require("mongoose");

const Wishlist = require("../models/wishlist.model");
const Product = require("../models/product.model");
const ProductVariant = require("../models/productVariant.model");
const User = require("../models/user.model");

const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * Helper: Extract first image from variant media array
 */
const extractFirstImage = (mediaArray, fallbackName = "") => {
  if (!mediaArray || !Array.isArray(mediaArray) || mediaArray.length === 0) {
    return null;
  }

  const imageItem = mediaArray.find((m) => m && m.type === "image" && m.url);

  if (!imageItem) return null;

  return {
    url: imageItem.url,
    alt: imageItem.alt || fallbackName || "",
  };
};

/**
 * Helper: Format wishlist item for response
 */
const formatWishlistItem = async (item) => {
  const product = item.productId;

  if (!product) return null;

  // Get default variant or first active variant for the product
  const defaultVariant = await ProductVariant.findOne({
    productId: product._id,
    isActive: true,
    isDefault: true,
  }).lean();

  // Fallback to cheapest active variant with stock
  const cheapestVariant = !defaultVariant
    ? await ProductVariant.findOne({
        productId: product._id,
        isActive: true,
        quantity: { $gt: 0 },
      })
        .sort({ "pricing.sellingPrice": 1 })
        .lean()
    : null;

  const variant = defaultVariant || cheapestVariant;

  // Get first image from variant
  const productImage = variant
    ? extractFirstImage(variant.media, product.name)
    : null;

  // If no image from variant, try any active variant
  let finalImage = productImage;
  if (!finalImage) {
    const anyVariant = await ProductVariant.findOne({
      productId: product._id,
      isActive: true,
      media: { $exists: true, $ne: [], $not: { $size: 0 } },
    })
      .select("media")
      .lean();

    if (anyVariant) {
      finalImage = extractFirstImage(anyVariant.media, product.name);
    }
  }

  // Calculate total quantity across all active variants
  const activeVariants = await ProductVariant.find({
    productId: product._id,
    isActive: true,
  }).lean();

  const totalQuantity = activeVariants.reduce(
    (sum, v) => sum + (v.quantity || 0),
    0,
  );

  // Determine stock status
  let stockStatus = "out_of_stock";
  if (totalQuantity > 10) {
    stockStatus = "in_stock";
  } else if (totalQuantity > 0) {
    stockStatus = "low_stock";
  }

  // Build pricing from variant
  const pricing = variant
    ? {
        sellingPrice: variant.pricing?.sellingPrice || 0,
        marketPrice:
          variant.pricing?.marketPrice || variant.pricing?.sellingPrice || 0,
        onSalePrice: variant.isOnSale
          ? variant.pricing?.onSalePrice || null
          : null,
      }
    : null;

  return {
    _id: item._id,
    productId: product._id,
    productCode: product.productId,
    name: product.name,
    slug: product.slug,
    image: finalImage,
    pricing,
    quantity: totalQuantity,
    stockStatus,
    variantCount: activeVariants.length,
    hasVariants: product.hasVariants || false,
    isOnSale: variant?.isOnSale || false,
    isActive: product.isActive,
    categories:
      product.categories?.map((cat) => ({
        _id: cat._id,
        name: cat.name,
        slug: cat.slug,
      })) || [],
    addedAt: item.addedAt || item.createdAt,
  };
};

/**
 * ADD PRODUCT TO WISHLIST
 */
router.post("/:productId", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const user = await User.findById(userId);
    if (!user)
      return res.status(401).json({
        success: false,
        message: "Invalid user",
      });

    const product = await Product.findById(productId);

    if (!product || !product.isActive)
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });

    const exists = await Wishlist.findOne({
      userId,
      productId,
    });

    if (exists)
      return res.status(400).json({
        success: false,
        message: "Product already in wishlist",
      });

    const wishlistItem = await Wishlist.create({
      userId,
      productId,
    });

    res.status(201).json({
      success: true,
      message: "Product added to wishlist",
      data: wishlistItem,
    });
  } catch (err) {
    console.log("Wishlist add error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * REMOVE PRODUCT FROM WISHLIST
 */
router.delete("/:productId", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const wishlistItem = await Wishlist.findOneAndDelete({
      userId,
      productId,
    });

    if (!wishlistItem)
      return res.status(404).json({
        success: false,
        message: "Product not in wishlist",
      });

    res.json({
      success: true,
      message: "Product removed from wishlist",
    });
  } catch (err) {
    console.log("Wishlist remove error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET USER WISHLIST
 * Returns optimized wishlist with variant image, pricing, and quantity
 * Query params: ?page=1&limit=20
 */
router.get("/", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const total = await Wishlist.countDocuments({ userId });

    // Fetch wishlist items with populated product data
    const wishlist = await Wishlist.find({ userId })
      .populate({
        path: "productId",
        select: "name slug productId isActive hasVariants categories",
        populate: {
          path: "categories",
          select: "name slug",
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Format each wishlist item
    const formattedWishlist = await Promise.all(
      wishlist.map((item) => formatWishlistItem(item)),
    );

    // Filter out any null items (products that might have been deleted)
    const validItems = formattedWishlist.filter((item) => item !== null);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: validItems,
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
    console.log("Wishlist fetch error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch wishlist",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;
