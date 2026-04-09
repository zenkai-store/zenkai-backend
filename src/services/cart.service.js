const mongoose = require("mongoose");
const Cart = require("../models/cart.model");
const ProductVariant = require("../models/productVariant.model");
const Product = require("../models/product.model");

class CartService {
  /**
   * Get user cart with populated data
   */
  static async getUserCart(userId) {
    const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.productId",
        select: "name slug productId categories description",
        populate: { path: "categories", select: "name slug" },
      })
      .populate({
        path: "items.variantId",
        select: "sku color media pricing isOnSale quantity",
      })
      .lean();

    if (!cart) {
      return { items: [], totalAmount: 0, totalItems: 0 };
    }

    // Enhance cart items with additional computed data
    const enhancedItems = cart.items.map((item) => {
      const variant = item.variantId;
      const product = item.productId;

      return {
        ...item,
        availableStock: variant?.quantity || 0,
        isInStock: (variant?.quantity || 0) >= item.quantity,
        variantMedia: variant?.media?.[0] || null,
        productName: product?.name,
        productSlug: product?.slug,
      };
    });

    return {
      items: enhancedItems,
      totalAmount: cart.totalAmount,
      totalItems: cart.totalItems,
      rawCart: cart,
    };
  }

  /**
   * Add item to cart
   */
  static async addToCart(userId, variantId, quantity) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate variant
      const variant = await ProductVariant.findOne({
        _id: variantId,
        isActive: true,
      }).session(session);

      if (!variant) {
        throw new Error("Variant not found or inactive");
      }

      // Check stock availability
      if (variant.quantity < quantity) {
        throw new Error(`Only ${variant.quantity} items available in stock`);
      }

      // Get product details
      const product = await Product.findById(variant.productId)
        .select("name slug productId isActive")
        .session(session);

      if (!product || !product.isActive) {
        throw new Error("Product not found or inactive");
      }

      // Calculate unit price (respects sale price)
      const unitPrice =
        variant.isOnSale && variant.pricing.onSalePrice
          ? variant.pricing.onSalePrice
          : variant.pricing.sellingPrice;

      // Find or create cart
      let cart = await Cart.findOne({ userId }).session(session);

      if (!cart) {
        cart = new Cart({
          userId,
          items: [],
        });
      }

      // Check if variant already in cart
      const existingItemIndex = cart.items.findIndex(
        (item) => item.variantId.toString() === variantId.toString(),
      );

      if (existingItemIndex !== -1) {
        // Update existing item
        const newQuantity = cart.items[existingItemIndex].quantity + quantity;

        // Check stock again for new total
        if (variant.quantity < newQuantity) {
          throw new Error(`Only ${variant.quantity} items available in stock`);
        }

        cart.items[existingItemIndex].quantity = newQuantity;
      } else {
        // Add new item
        cart.items.push({
          productId: variant.productId,
          variantId: variant._id,
          variantSku: variant.sku,
          variantColor: variant.color,
          quantity: quantity,
          unitPrice: unitPrice,
        });
      }

      await cart.save({ session });
      await session.commitTransaction();

      return await CartService.getUserCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update cart item quantity
   */
  static async updateCartItemQuantity(userId, variantId, quantity) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (quantity < 1) {
        throw new Error("Quantity must be at least 1");
      }

      // Validate variant stock
      const variant = await ProductVariant.findOne({
        _id: variantId,
        isActive: true,
      }).session(session);

      if (!variant) {
        throw new Error("Variant not found");
      }

      if (variant.quantity < quantity) {
        throw new Error(`Only ${variant.quantity} items available in stock`);
      }

      const cart = await Cart.findOne({ userId }).session(session);

      if (!cart) {
        throw new Error("Cart not found");
      }

      const itemIndex = cart.items.findIndex(
        (item) => item.variantId.toString() === variantId.toString(),
      );

      if (itemIndex === -1) {
        throw new Error("Item not found in cart");
      }

      // Update quantity
      cart.items[itemIndex].quantity = quantity;

      // Update unit price in case price changed
      const unitPrice =
        variant.isOnSale && variant.pricing.onSalePrice
          ? variant.pricing.onSalePrice
          : variant.pricing.sellingPrice;
      cart.items[itemIndex].unitPrice = unitPrice;

      await cart.save({ session });
      await session.commitTransaction();

      return await CartService.getUserCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Remove item from cart
   */
  static async removeCartItem(userId, variantId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cart = await Cart.findOne({ userId }).session(session);

      if (!cart) {
        throw new Error("Cart not found");
      }

      cart.items = cart.items.filter(
        (item) => item.variantId.toString() !== variantId.toString(),
      );

      await cart.save({ session });
      await session.commitTransaction();

      return await CartService.getUserCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Clear entire cart
   */
  static async clearCart(userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cart = await Cart.findOne({ userId }).session(session);

      if (cart) {
        cart.items = [];
        await cart.save({ session });
      }

      await session.commitTransaction();

      return { items: [], totalAmount: 0, totalItems: 0 };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get cart summary for checkout
   */
  static async getCartSummary(userId) {
    const cartData = await CartService.getUserCart(userId);

    if (!cartData.items.length) {
      return {
        items: [],
        subtotal: 0,
        totalItems: 0,
        isEligibleForCheckout: false,
        message: "Cart is empty",
      };
    }

    // Check stock availability for all items
    const stockIssues = [];
    let subtotal = 0;

    for (const item of cartData.items) {
      subtotal += item.quantity * item.unitPrice;

      if (!item.isInStock) {
        stockIssues.push({
          variantId: item.variantId._id,
          variantSku: item.variantSku,
          variantColor: item.variantColor,
          requestedQuantity: item.quantity,
          availableStock: item.availableStock,
        });
      }
    }

    const isEligibleForCheckout =
      stockIssues.length === 0 && cartData.items.length > 0;

    return {
      items: cartData.items,
      subtotal,
      totalItems: cartData.totalItems,
      isEligibleForCheckout,
      stockIssues,
      message: isEligibleForCheckout
        ? "Ready for checkout"
        : "Some items have stock issues",
    };
  }

  /**
   * Bulk add items to cart (for migration or bulk operations)
   */
  static async bulkAddToCart(userId, items) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let cart = await Cart.findOne({ userId }).session(session);

      if (!cart) {
        cart = new Cart({
          userId,
          items: [],
        });
      }

      for (const item of items) {
        const variant = await ProductVariant.findOne({
          _id: item.variantId,
          isActive: true,
        }).session(session);

        if (!variant) {
          throw new Error(`Variant ${item.variantId} not found`);
        }

        const unitPrice =
          variant.isOnSale && variant.pricing.onSalePrice
            ? variant.pricing.onSalePrice
            : variant.pricing.sellingPrice;

        const existingItemIndex = cart.items.findIndex(
          (cartItem) =>
            cartItem.variantId.toString() === item.variantId.toString(),
        );

        if (existingItemIndex !== -1) {
          cart.items[existingItemIndex].quantity += item.quantity;
        } else {
          cart.items.push({
            productId: variant.productId,
            variantId: variant._id,
            variantSku: variant.sku,
            variantColor: variant.color,
            quantity: item.quantity,
            unitPrice: unitPrice,
          });
        }
      }

      await cart.save({ session });
      await session.commitTransaction();

      return await CartService.getUserCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

module.exports = CartService;
