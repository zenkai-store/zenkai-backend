const express = require("express");
const Category = require("../models/category.model");
const Product = require("../models/product.model");

const router = express.Router();

/**
 * LIST PRODUCTS BY CATEGORY SLUG
 */
router.get("/:slug/products", async (req, res) => {
  try {
    const category = await Category.findOne({
      slug: req.params.slug,
      isActive: true,
    });

    if (!category)
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });

    const products = await Product.find({
      categories: category._id,
      isActive: true,
    })
      .select("-__v")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      category: category.name,
      count: products.length,
      data: products,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
});

module.exports = router;
