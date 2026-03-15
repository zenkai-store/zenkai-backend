const express = require("express");

const Cart = require("../models/cart.model");
const Product = require("../models/product.model");
const Wishlist = require("../models/wishlist.model");
const User = require("../models/user.model");

const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * GET USER CART
 */

router.get("/", userAuth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.id }).populate({
      path: "items.productId",
      populate: { path: "categories" },
    });

    if (!cart)
      return res.json({
        success: true,
        data: [],
      });

    res.json({
      success: true,
      data: cart.items,
    });
  } catch (err) {
    console.log("Cart fetch error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * ADD PRODUCT TO CART
 */

router.post("/", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    if (!productId || !quantity)
      return res.status(400).json({
        success: false,
        message: "ProductId and quantity required",
      });

    if (quantity <= 0)
      return res.status(400).json({
        success: false,
        message: "Quantity must be greater than zero",
      });

    const product = await Product.findById(productId);

    if (!product || !product.isActive)
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });

    if (product.quantity < quantity)
      return res.status(400).json({
        success: false,
        message: "Requested quantity exceeds stock",
      });

    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = await Cart.create({
        userId,
        items: [],
      });
    }

    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productId,
    );

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;

      if (newQuantity > product.quantity)
        return res.status(400).json({
          success: false,
          message: "Total quantity exceeds available stock",
        });

      existingItem.quantity = newQuantity;
    } else {
      cart.items.push({
        productId,
        quantity,
      });
    }

    await cart.save();

    res.status(201).json({
      success: true,
      message: "Product added to cart",
      data: cart.items,
    });
  } catch (err) {
    console.log("Add cart error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * ADD PRODUCT FROM WISHLIST TO CART
 */

router.post("/from-wishlist/:productId", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const wishlistItem = await Wishlist.findOne({
      userId,
      productId,
    });

    if (!wishlistItem)
      return res.status(404).json({
        success: false,
        message: "Product not found in wishlist",
      });

    const product = await Product.findById(productId);

    if (!product || !product.isActive)
      return res.status(404).json({
        success: false,
        message: "Product unavailable",
      });

    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = await Cart.create({
        userId,
        items: [],
      });
    }

    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productId,
    );

    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cart.items.push({
        productId,
        quantity: 1,
      });
    }

    await cart.save();

    await Wishlist.deleteOne({
      userId,
      productId,
    });

    res.json({
      success: true,
      message: "Product moved to cart",
      data: cart.items,
    });
  } catch (err) {
    console.log("Wishlist to cart error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * UPDATE CART QUANTITY
 */

router.patch("/:productId", userAuth, async (req, res) => {
  try {
    const { quantity } = req.body;
    const { productId } = req.params;

    if (!quantity || quantity <= 0)
      return res.status(400).json({
        success: false,
        message: "Quantity must be greater than zero",
      });

    const product = await Product.findById(productId);

    if (!product)
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });

    if (quantity > product.quantity)
      return res.status(400).json({
        success: false,
        message: "Quantity exceeds stock",
      });

    const cart = await Cart.findOne({ userId: req.user.id });

    if (!cart)
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });

    const item = cart.items.find((i) => i.productId.toString() === productId);

    if (!item)
      return res.status(404).json({
        success: false,
        message: "Product not in cart",
      });

    item.quantity = quantity;

    await cart.save();

    res.json({
      success: true,
      message: "Cart updated",
      data: cart.items,
    });
  } catch (err) {
    console.log("Cart update error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * REMOVE PRODUCT FROM CART
 */

router.delete("/:productId", userAuth, async (req, res) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ userId: req.user.id });

    if (!cart)
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });

    cart.items = cart.items.filter(
      (item) => item.productId.toString() !== productId,
    );

    await cart.save();

    res.json({
      success: true,
      message: "Item removed from cart",
      data: cart.items,
    });
  } catch (err) {
    console.log("Cart remove error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * CLEAR CART
 */

router.delete("/", userAuth, async (req, res) => {
  try {
    await Cart.findOneAndUpdate({ userId: req.user.id }, { items: [] });

    res.json({
      success: true,
      message: "Cart cleared",
    });
  } catch (err) {
    console.log("Cart clear error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
