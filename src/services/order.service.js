const mongoose = require("mongoose");
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const OrderStatusHistory = require("../models/orderStatusHistory.model");
const ProductVariant = require("../models/productVariant.model");
const CartService = require("./cart.service");

class OrderService {
  /**
   * Create order from cart
   */
  static async createOrderFromCart(
    userId,
    addressId,
    paymentMethod = "razorpay",
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get cart with items
      const cartData = await CartService.getCartSummary(userId);

      if (!cartData.items.length) {
        throw new Error("Cart is empty");
      }

      if (!cartData.isEligibleForCheckout) {
        throw new Error(
          "Some items have stock issues. Please check your cart.",
        );
      }

      // Validate address
      const Address = require("../models/address.model");
      const address = await Address.findOne({ _id: addressId, userId }).session(
        session,
      );

      if (!address) {
        throw new Error("Address not found");
      }

      // Prepare order items and calculate totals
      const orderItems = [];
      let subtotal = 0;

      for (const cartItem of cartData.items) {
        // Get fresh variant data with lock
        const variant = await ProductVariant.findById(
          cartItem.variantId._id,
        ).session(session);

        if (!variant || !variant.isActive) {
          throw new Error(
            `Variant ${cartItem.variantSku} is no longer available`,
          );
        }

        if (variant.quantity < cartItem.quantity) {
          throw new Error(
            `Insufficient stock for ${cartItem.variantColor.name} variant`,
          );
        }

        const unitPrice = cartItem.unitPrice;
        const totalPrice = unitPrice * cartItem.quantity;

        orderItems.push({
          productId: cartItem.productId._id,
          variantId: variant._id,
          variantSku: variant.sku,
          variantColor: variant.color,
          quantity: cartItem.quantity,
          unitPrice: unitPrice,
          totalPrice: totalPrice,
        });

        subtotal += totalPrice;
      }

      // Calculate additional charges
      const tax = subtotal * 0; // 18% GST, 0 GST for now
      const shippingCost = subtotal > 500 ? 0 : 0; // Free shipping above ₹500, zero shipping cost for now
      const discount = 0; // Add discount logic here if needed
      const totalAmount = subtotal + tax + shippingCost - discount;

      // Create order
      const order = new Order({
        userId,
        items: orderItems,
        subtotal,
        tax,
        shippingCost,
        discount,
        totalAmount,
        addressId: address._id,
        addressSnapshot: {
          fullName: address.fullName,
          phone: address.phone,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          landmark: address.landmark,
        },
        paymentMethod,
        paymentStatus: paymentMethod === "cod" ? "pending" : "pending",
        orderStatus: "pending",
        createdBy: userId,
      });

      await order.save({ session });

      // Create status history
      await OrderStatusHistory.create(
        [
          {
            orderId: order._id,
            previousStatus: null,
            newStatus: "pending",
            changedBy: userId,
            changedByRole: "user",
            notes: "Order created",
          },
        ],
        { session },
      );

      // If COD, don't create Razorpay order
      if (paymentMethod === "cod") {
        await session.commitTransaction();
        return {
          order,
          requiresPayment: false,
        };
      }

      await session.commitTransaction();
      return {
        order,
        requiresPayment: true,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Process payment success and update stock
   */
  static async processSuccessfulPayment(
    userId,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Find order
      const order = await Order.findOne({ razorpayOrderId }).session(session);

      if (!order) {
        throw new Error("Order not found");
      }

      if (order.userId.toString() !== userId) {
        throw new Error("Unauthorized");
      }

      if (order.paymentStatus === "paid") {
        throw new Error("Order already paid");
      }

      // Create payment record
      const payment = new Payment({
        userId,
        orderId: order._id,
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature,
        amount: order.totalAmount,
        status: "success",
        paymentMethod: "razorpay",
      });

      await payment.save({ session });

      // Update order
      order.paymentStatus = "paid";
      order.orderStatus = "confirmed";
      order.paymentId = payment._id;
      await order.save({ session });

      // Create status history
      await OrderStatusHistory.create(
        [
          {
            orderId: order._id,
            previousStatus: "pending",
            newStatus: "confirmed",
            changedBy: userId,
            changedByRole: "user",
            notes: "Payment successful",
          },
        ],
        { session },
      );

      // Update stock for each item
      for (const item of order.items) {
        await ProductVariant.updateOne(
          { _id: item.variantId },
          { $inc: { quantity: -item.quantity } },
          { session },
        );

        // Update product variant summary
        const ProductVariantService = require("./productVariant.service");
        await ProductVariantService.updateProductVariantSummary(
          item.productId,
          session,
        );
      }

      // Clear user's cart
      const Cart = require("../models/cart.model");
      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [] } },
        { session },
      );

      await session.commitTransaction();

      return {
        order,
        payment,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get order by ID with details
   */
  static async getOrderById(orderId, userId) {
    let query = { _id: orderId };

    // Only apply userId filter if provided
    if (userId) {
      query.userId = userId;
    }

    const order = await Order.findOne(query)
      .populate("items.productId", "name slug productId media")
      .populate("items.variantId", "color media")
      .lean();

    // Get payment details
    const payment = await Payment.findOne({ orderId: order._id }).lean();

    // Get status history
    const statusHistory = await OrderStatusHistory.find({ orderId: order._id })
      .sort({ createdAt: -1 })
      .lean();

    return {
      ...order,
      payment,
      statusHistory,
    };
  }

  /**
   * Get user orders with pagination
   */
  static async getUserOrders(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "orderNumber totalAmount paymentStatus orderStatus createdAt items",
        )
        .lean(),
      Order.countDocuments({ userId }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Cancel order
   */
  static async cancelOrder(orderId, userId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findOne({ _id: orderId, userId }).session(
        session,
      );

      if (!order) {
        throw new Error("Order not found");
      }

      if (!order.canBeCancelled()) {
        throw new Error("Order cannot be cancelled at this stage");
      }

      // Update order status
      const previousStatus = order.orderStatus;
      order.orderStatus = "cancelled";
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
      await order.save({ session });

      // Create status history
      await OrderStatusHistory.create(
        [
          {
            orderId: order._id,
            previousStatus,
            newStatus: "cancelled",
            changedBy: userId,
            changedByRole: "user",
            notes: reason,
          },
        ],
        { session },
      );

      // If paid, process refund
      if (order.paymentStatus === "paid") {
        const payment = await Payment.findOne({ orderId: order._id }).session(
          session,
        );

        if (payment && payment.razorpayPaymentId) {
          await payment.processRefund(
            order.totalAmount,
            `Order cancelled: ${reason}`,
          );
          order.paymentStatus = "refunded";
          await order.save({ session });
        }
      }

      // Restore stock
      for (const item of order.items) {
        await ProductVariant.updateOne(
          { _id: item.variantId },
          { $inc: { quantity: item.quantity } },
          { session },
        );

        const ProductVariantService = require("./productVariant.service");
        await ProductVariantService.updateProductVariantSummary(
          item.productId,
          session,
        );
      }

      await session.commitTransaction();

      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get order summary for admin
   */
  static async getAdminOrders(filters = {}, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.orderStatus) query.orderStatus = filters.orderStatus;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
    if (filters.userId) query.userId = filters.userId;
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("userId", "name email phone")
        .populate("addressId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update order status (admin)
   */
  static async updateOrderStatus(orderId, status, adminId, notes) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new Error("Order not found");
      }

      const previousStatus = order.orderStatus;
      order.orderStatus = status;

      if (status === "delivered") {
        order.deliveredAt = new Date();
      }

      order.updatedBy = adminId;
      await order.save({ session });

      // Create status history
      await OrderStatusHistory.create(
        [
          {
            orderId: order._id,
            previousStatus,
            newStatus: status,
            changedBy: adminId,
            changedByRole: "admin",
            notes,
          },
        ],
        { session },
      );

      await session.commitTransaction();

      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get order statistics
   */
  static async getOrderStatistics(startDate, endDate) {
    const match = {};
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    const stats = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmount" },
          averageOrderValue: { $avg: "$totalAmount" },
          totalItems: { $sum: { $sum: "$items.quantity" } },
          paidOrders: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
          },
          deliveredOrders: {
            $sum: { $cond: [{ $eq: ["$orderStatus", "delivered"] }, 1, 0] },
          },
        },
      },
    ]);

    // Get daily sales
    const dailySales = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      ...stats[0],
      dailySales,
    };
  }
}

module.exports = OrderService;
