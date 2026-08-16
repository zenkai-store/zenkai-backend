const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Address = require("../models/address.model");
const Order = require("../models/order.model");
const Review = require("../models/review.model");
const Wishlist = require("../models/wishlist.model");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");
const adminAuth = require("../middleware/adminAuth.middleware");

const router = express.Router();

/**
 * =========================
 * LIST ALL CUSTOMERS (USERS)
 * =========================
 * GET /api/admin/customers
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - search: string (search in name, email, phone)
 * - role: string (filter by role)
 * - isActive: boolean (filter by active status)
 * - startDate: date (filter by registration date)
 * - endDate: date (filter by registration date)
 * - sortBy: string (field to sort by, default: createdAt)
 * - sortOrder: string (asc or desc, default: desc)
 */
router.get("/", adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit)));

    // Build match stage
    const matchStage = {};

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      matchStage.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    // Allowed sort fields to prevent injection
    const allowedSortFields = ["createdAt", "name", "email", "orderCount", "totalSpent"];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const safeSortOrder = sortOrder === "asc" ? 1 : -1;

    // Aggregation pipeline: join orders, compute orderCount + totalSpent, paginate
    const pipeline = [
      { $match: matchStage },

      // Join orders for this user
      {
        $lookup: {
          from: "orders",
          let: { userId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$userId", "$$userId"] } } },
            {
              $group: {
                _id: null,
                orderCount: { $sum: 1 },
                totalSpent: {
                  $sum: {
                    $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
                  },
                },
              },
            },
          ],
          as: "orderStats",
        },
      },

      // Flatten orderStats array into scalar fields
      {
        $addFields: {
          orderCount: { $ifNull: [{ $arrayElemAt: ["$orderStats.orderCount", 0] }, 0] },
          totalSpent: { $ifNull: [{ $arrayElemAt: ["$orderStats.totalSpent", 0] }, 0] },
        },
      },

      { $unset: ["orderStats", "password", "__v"] },

      // Total count facet + paginated results in one round-trip
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $sort: { [safeSortBy]: safeSortOrder } },
            { $skip: (parsedPage - 1) * parsedLimit },
            { $limit: parsedLimit },
          ],
        },
      },
    ];

    const [result] = await User.aggregate(pipeline);

    const total = result.metadata[0]?.total ?? 0;
    const users = result.data;

    // Log activity (non-blocking)
    Admin.findById(req.admin.id)
      .select("email")
      .then((admin) => {
        if (admin) {
          AdminActivity.create({
            adminId: req.admin.id,
            adminEmail: admin.email,
            action: "LIST_CUSTOMERS",
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            details: { filters: { search }, page: parsedPage, limit: parsedLimit },
          }).catch(() => {});
        }
      })
      .catch(() => {});

    return res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasNextPage: parsedPage * parsedLimit < total,
        hasPrevPage: parsedPage > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching customers:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET SINGLE CUSTOMER DETAILS
 * =========================
 * GET /api/admin/customers/:userId
 */
router.get("/:userId", adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const user = await User.findById(userId).select("-password -__v").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Log admin activity
    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "VIEW_CUSTOMER_DETAILS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        userId: user._id,
        userEmail: user.email,
        userName: user.name,
      },
    });

    return res.json({
      success: true,
      data: user,
    });
  } catch (err) {
    console.error("Error fetching customer details:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer details",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET CUSTOMER ADDRESSES
 * =========================
 * GET /api/admin/customers/:userId/addresses
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 10)
 */
router.get("/:userId/addresses", adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit)));

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Build query
    const query = { userId: new mongoose.Types.ObjectId(userId) };

    // Get total count
    const total = await Address.countDocuments(query);

    // Fetch addresses
    const addresses = await Address.find(query)
      .sort({ isDefault: -1, createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean();

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Log admin activity
    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "VIEW_CUSTOMER_ADDRESSES",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: { userId },
    });

    return res.json({
      success: true,
      data: addresses,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasNextPage: parsedPage * parsedLimit < total,
        hasPrevPage: parsedPage > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching customer addresses:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer addresses",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET CUSTOMER ORDERS
 * =========================
 * GET /api/admin/customers/:userId/orders
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - status: string (filter by order status)
 * - paymentStatus: string (filter by payment status)
 * - startDate: date
 * - endDate: date
 * - sortBy: string (default: createdAt)
 * - sortOrder: string (asc/desc, default: desc)
 */
router.get("/:userId/orders", adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      paymentStatus,
      startDate,
      endDate,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit)));

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Build query
    const query = { userId: new mongoose.Types.ObjectId(userId) };

    // Filter by order status
    if (status) {
      query.status = status;
    }

    // Filter by payment status
    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};

      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }

      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDateTime;
      }
    }

    // Build sort object
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Get total count
    const total = await Order.countDocuments(query);

    // Fetch orders with populated product details
    const orders = await Order.find(query)
      .sort(sortOptions)
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .populate("items.productId", "name productId slug")
      .populate("items.variantId", "sku color")
      .lean();

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Log admin activity
    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "VIEW_CUSTOMER_ORDERS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        userId,
        filters: { status, paymentStatus, startDate, endDate },
      },
    });

    return res.json({
      success: true,
      data: orders,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasNextPage: parsedPage * parsedLimit < total,
        hasPrevPage: parsedPage > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching customer orders:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer orders",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET CUSTOMER REVIEWS
 * =========================
 * GET /api/admin/customers/:userId/reviews
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - rating: number (filter by rating)
 * - isActive: boolean
 * - sortBy: string (default: createdAt)
 * - sortOrder: string (asc/desc, default: desc)
 */
router.get("/:userId/reviews", adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 20,
      rating,
      isActive,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit)));

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Build query
    const query = { userId: new mongoose.Types.ObjectId(userId) };

    // Filter by rating
    if (rating !== undefined) {
      const parsedRating = parseInt(rating);
      if (!isNaN(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
        query.rating = parsedRating;
      }
    }

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Build sort object
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Get total count
    const total = await Review.countDocuments(query);

    // Fetch reviews with populated product details
    const reviews = await Review.find(query)
      .sort(sortOptions)
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .populate("productId", "name slug productId")
      .populate("userId", "name email")
      .lean();

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Log admin activity
    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "VIEW_CUSTOMER_REVIEWS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        userId,
        filters: { rating, isActive },
      },
    });

    return res.json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasNextPage: parsedPage * parsedLimit < total,
        hasPrevPage: parsedPage > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching customer reviews:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer reviews",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET CUSTOMER WISHLIST
 * =========================
 * GET /api/admin/customers/:userId/wishlist
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 20)
 */
router.get("/:userId/wishlist", adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit)));

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Build query
    const query = { userId: new mongoose.Types.ObjectId(userId) };

    // Get total count
    const total = await Wishlist.countDocuments(query);

    // Fetch wishlist items with populated product details
    const wishlist = await Wishlist.find(query)
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .populate({
        path: "productId",
        select: "name slug productId pricing isOnSale isActive",
        populate: {
          path: "categories",
          select: "name slug",
        },
      })
      .lean();

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Log admin activity
    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "VIEW_CUSTOMER_WISHLIST",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: { userId },
    });

    return res.json({
      success: true,
      data: wishlist,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasNextPage: parsedPage * parsedLimit < total,
        hasPrevPage: parsedPage > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching customer wishlist:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer wishlist",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET CUSTOMER STATISTICS
 * =========================
 * GET /api/admin/customers/:userId/stats
 */
router.get("/:userId/stats", adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Check if user exists
    const user = await User.findById(userId).select("_id name email");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Run all queries in parallel for better performance
    const [
      totalOrders,
      totalSpent,
      orderStats,
      totalReviews,
      avgRating,
      totalWishlist,
      totalAddresses,
    ] = await Promise.all([
      // Total orders count
      Order.countDocuments({ userId: user._id }),

      // Total amount spent (successful orders only)
      Order.aggregate([
        {
          $match: {
            userId: user._id,
            paymentStatus: "paid",
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmount" },
          },
        },
      ]),

      // Order status breakdown
      Order.aggregate([
        {
          $match: { userId: user._id },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            status: "$_id",
            count: 1,
            _id: 0,
          },
        },
      ]),

      // Total reviews count
      Review.countDocuments({ userId: user._id }),

      // Average rating
      Review.aggregate([
        {
          $match: { userId: user._id, isActive: true },
        },
        {
          $group: {
            _id: null,
            average: { $avg: "$rating" },
          },
        },
      ]),

      // Wishlist count
      Wishlist.countDocuments({ userId: user._id }),

      // Addresses count
      Address.countDocuments({ userId: user._id }),
    ]);

    const totalSpentAmount = totalSpent.length > 0 ? totalSpent[0].total : 0;
    const averageRating = avgRating.length > 0 ? avgRating[0].average : 0;

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // Log admin activity
    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: "VIEW_CUSTOMER_STATS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: { userId: user._id },
    });

    return res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
        stats: {
          totalOrders,
          totalSpent: totalSpentAmount,
          averageOrderValue:
            totalOrders > 0 ? totalSpentAmount / totalOrders : 0,
          orderStatusBreakdown: orderStats,
          totalReviews,
          averageRating: parseFloat(averageRating.toFixed(2)),
          totalWishlistItems: totalWishlist,
          totalAddresses,
        },
      },
    });
  } catch (err) {
    console.error("Error fetching customer statistics:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer statistics",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;
