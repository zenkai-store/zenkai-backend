const express = require("express");

const Wishlist = require("../models/wishlist.model");
const Product = require("../models/product.model");
const User = require("../models/user.model");

const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

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
 */

router.get("/", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const wishlist = await Wishlist.find({ userId })
      .populate({
        path: "productId",
        populate: {
          path: "categories",
        },
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: wishlist,
    });
  } catch (err) {
    console.log("Wishlist fetch error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
