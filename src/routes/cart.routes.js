const express = require("express");
const mongoose = require("mongoose");

const Cart = require("../models/cart.model");
const ProductVariant = require("../models/productVariant.model");
const Product = require("../models/product.model");
const Wishlist = require("../models/wishlist.model");
const CartService = require("../services/cart.service");

const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * GET USER CART
 * GET /api/cart
 */
router.get("/", userAuth, async (req, res) => {
  try {
    const cartData = await CartService.getUserCart(req.user.id);

    res.json({
      success: true,
      data: cartData,
    });
  } catch (err) {
    console.error("Cart fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET CART SUMMARY (for checkout)
 * GET /api/cart/summary
 */
router.get("/summary", userAuth, async (req, res) => {
  try {
    const summary = await CartService.getCartSummary(req.user.id);

    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    console.error("Cart summary error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * ADD VARIANT TO CART
 * POST /api/cart
 * Body: { variantId, quantity }
 */
router.post("/", userAuth, async (req, res) => {
  try {
    const { variantId, quantity } = req.body;

    // Validate required fields
    if (!variantId) {
      return res.status(400).json({
        success: false,
        message: "VariantId is required",
      });
    }

    if (!quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    // Validate quantity is integer
    if (!Number.isInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be an integer",
      });
    }

    const cartData = await CartService.addToCart(
      req.user.id,
      variantId,
      quantity,
    );

    res.status(201).json({
      success: true,
      message: "Item added to cart successfully",
      data: cartData,
    });
  } catch (err) {
    console.error("Add to cart error:", err);

    // Handle specific error messages
    if (err.message.includes("stock")) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (err.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * ADD PRODUCT FROM WISHLIST TO CART
 * POST /api/cart/from-wishlist/:productId
 * Note: This will use the default variant of the product
 */
router.post("/from-wishlist/:productId", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    // Check if product exists in wishlist
    const wishlistItem = await Wishlist.findOne({
      userId,
      productId,
    });

    if (!wishlistItem) {
      return res.status(404).json({
        success: false,
        message: "Product not found in wishlist",
      });
    }

    // Get product details
    const product = await Product.findById(productId);

    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product unavailable",
      });
    }

    // Find default variant
    const defaultVariant = await ProductVariant.findOne({
      productId: product._id,
      isDefault: true,
      isActive: true,
    });

    if (!defaultVariant) {
      return res.status(404).json({
        success: false,
        message: "No active variant found for this product",
      });
    }

    // Check stock
    if (defaultVariant.quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Product is out of stock",
      });
    }

    // Add to cart
    const cartData = await CartService.addToCart(userId, defaultVariant._id, 1);

    // Remove from wishlist
    await Wishlist.deleteOne({
      userId,
      productId,
    });

    res.json({
      success: true,
      message: "Product moved to cart successfully",
      data: cartData,
    });
  } catch (err) {
    console.error("Wishlist to cart error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * UPDATE CART ITEM QUANTITY
 * PUT /api/cart/items/:variantId
 */
router.put("/items/:variantId", userAuth, async (req, res) => {
  try {
    const { quantity } = req.body;
    const { variantId } = req.params;

    if (!quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    if (!Number.isInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be an integer",
      });
    }

    const cartData = await CartService.updateCartItemQuantity(
      req.user.id,
      variantId,
      quantity,
    );

    res.json({
      success: true,
      message: "Cart updated successfully",
      data: cartData,
    });
  } catch (err) {
    console.error("Cart update error:", err);

    if (err.message.includes("stock")) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (err.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * REMOVE ITEM FROM CART
 * DELETE /api/cart/items/:variantId
 */
router.delete("/items/:variantId", userAuth, async (req, res) => {
  try {
    const { variantId } = req.params;

    const cartData = await CartService.removeCartItem(req.user.id, variantId);

    res.json({
      success: true,
      message: "Item removed from cart successfully",
      data: cartData,
    });
  } catch (err) {
    console.error("Cart remove error:", err);

    if (err.message === "Cart not found") {
      return res.status(404).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * CLEAR ENTIRE CART
 * DELETE /api/cart
 */
router.delete("/", userAuth, async (req, res) => {
  try {
    const cartData = await CartService.clearCart(req.user.id);

    res.json({
      success: true,
      message: "Cart cleared successfully",
      data: cartData,
    });
  } catch (err) {
    console.error("Cart clear error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET AVAILABLE VARIANTS FOR PRODUCT IN CART
 * GET /api/cart/product/:productId/variants
 * Returns available variants for a product that are not already in cart
 */
router.get("/product/:productId/variants", userAuth, async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    // Get product
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId });

    // Get all active variants for product
    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
      quantity: { $gt: 0 },
    }).lean();

    // Filter out variants already in cart
    const cartVariantIds =
      cart?.items.map((item) => item.variantId.toString()) || [];
    const availableVariants = variants.filter(
      (variant) => !cartVariantIds.includes(variant._id.toString()),
    );

    res.json({
      success: true,
      data: {
        product: {
          _id: product._id,
          name: product.name,
          slug: product.slug,
        },
        availableVariants,
        variantsInCart: variants.filter((v) =>
          cartVariantIds.includes(v._id.toString()),
        ),
      },
    });
  } catch (err) {
    console.error("Get product variants error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * BULK UPDATE CART (for syncing across devices)
 * POST /api/cart/bulk
 * Body: { items: [{ variantId, quantity }] }
 */
router.post("/bulk", userAuth, async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items array is required",
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.variantId) {
        return res.status(400).json({
          success: false,
          message: "Each item must have variantId",
        });
      }

      if (
        !item.quantity ||
        item.quantity < 1 ||
        !Number.isInteger(item.quantity)
      ) {
        return res.status(400).json({
          success: false,
          message: "Each item must have a valid quantity (positive integer)",
        });
      }
    }

    const cartData = await CartService.bulkAddToCart(req.user.id, items);

    res.json({
      success: true,
      message: "Cart synced successfully",
      data: cartData,
    });
  } catch (err) {
    console.error("Bulk cart update error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
