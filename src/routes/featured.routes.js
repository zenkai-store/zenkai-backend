const express = require("express");
const FeaturedProduct = require("../models/featuredProduct.model");
const Product = require("../models/product.model");
const ProductVariant = require("../models/productVariant.model"); // ← Direct import

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const currentDate = new Date();

    const featuredProducts = await FeaturedProduct.find({
      isActive: true,
      $and: [
        {
          $or: [
            { startDate: { $exists: false } },
            { startDate: null },
            { startDate: { $lte: currentDate } },
          ],
        },
        {
          $or: [
            { endDate: { $exists: false } },
            { endDate: null },
            { endDate: { $gte: currentDate } },
          ],
        },
      ],
    })
      .populate({
        path: "productId",
        select: "name slug productId pricing isOnSale",
        match: { isActive: true },
        populate: {
          path: "categories",
          select: "name slug",
        },
      })
      .sort({ displayPosition: 1 })
      .lean();

    const validFeaturedProducts = featuredProducts.filter(
      (fp) => fp.productId !== null,
    );

    // Get default variant for each product
    const productsWithVariants = await Promise.all(
      validFeaturedProducts.map(async (fp) => {
        try {
          const defaultVariant = await ProductVariant.findOne({
            productId: fp.productId._id,
            isDefault: true,
            isActive: true,
          })
            .select("sku color media pricing isOnSale quantity")
            .lean();

          return {
            ...fp,
            defaultVariant: defaultVariant || null,
          };
        } catch (err) {
          console.error(`Error fetching variant:`, err);
          return {
            ...fp,
            defaultVariant: null,
          };
        }
      }),
    );

    const response = {
      1: productsWithVariants.find((fp) => fp.displayPosition === 1) || null,
      2: productsWithVariants.find((fp) => fp.displayPosition === 2) || null,
      3: productsWithVariants.find((fp) => fp.displayPosition === 3) || null,
      4: productsWithVariants.find((fp) => fp.displayPosition === 4) || null,
    };

    return res.json({
      success: true,
      data: response,
    });
  } catch (err) {
    console.error("Error fetching featured products:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch featured products",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;
