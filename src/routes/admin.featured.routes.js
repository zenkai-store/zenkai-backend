const express = require("express");
const mongoose = require("mongoose");
const FeaturedProduct = require("../models/featuredProduct.model");
const Product = require("../models/product.model");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");
const adminAuth = require("../middleware/adminAuth.middleware");

const router = express.Router();

/**
 * =========================
 * VALIDATION MIDDLEWARE
 * =========================
 */
const validateFeaturedProduct = async (req, res, next) => {
  try {
    const { productId, displayPosition } = req.body;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Check if product exists and is active
    const product = await Product.findOne({
      _id: productId,
      isActive: true,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or is inactive",
      });
    }

    // Attach product to request for later use
    req.product = product;

    // Validate display position
    if (displayPosition < 1 || displayPosition > 4) {
      return res.status(400).json({
        success: false,
        message: "Display position must be between 1 and 4",
      });
    }

    // Validate dates if provided
    const { startDate, endDate } = req.body;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start >= end) {
        return res.status(400).json({
          success: false,
          message: "End date must be after start date",
        });
      }
    }

    next();
  } catch (err) {
    console.error("Validation error:", err);
    return res.status(500).json({
      success: false,
      message: "Validation failed",
    });
  }
};

/**
 * =========================
 * GET ALL FEATURED PRODUCTS (Admin View)
 * =========================
 * GET /api/admin/featured
 */
router.get("/", adminAuth, async (req, res) => {
  try {
    const featuredProducts = await FeaturedProduct.find()
      .populate({
        path: "productId",
        select: "name slug productId pricing isOnSale isActive",
        populate: {
          path: "categories",
          select: "name slug",
        },
      })
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ displayPosition: 1 })
      .lean();

    // Format the response to include positions 1-4 even if empty
    const formattedResponse = {
      positions: {
        1: null,
        2: null,
        3: null,
        4: null,
      },
      totalActive: 0,
    };

    featuredProducts.forEach((fp) => {
      if (fp.isActive) {
        formattedResponse.positions[fp.displayPosition] = fp;
        formattedResponse.totalActive++;
      }
    });

    // Add inactive featured products
    formattedResponse.inactiveFeatured = featuredProducts.filter(
      (fp) => !fp.isActive,
    );

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
      action: "VIEW_FEATURED_PRODUCTS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      data: formattedResponse,
      raw: featuredProducts, // Include raw data for admin table
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

/**
 * =========================
 * SET FEATURED PRODUCT
 * =========================
 * POST /api/admin/featured
 * Body: {
 *   productId: string,
 *   displayPosition: number (1-4),
 *   title: string (optional),
 *   subtitle: string (optional),
 *   customBadge: string (optional),
 *   startDate: date (optional),
 *   endDate: date (optional)
 * }
 */
router.post("/", adminAuth, validateFeaturedProduct, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      productId,
      displayPosition,
      title,
      subtitle,
      customBadge,
      startDate,
      endDate,
    } = req.body;

    // Check if position is already taken by an active featured product
    const existingAtPosition = await FeaturedProduct.findOne({
      displayPosition,
      isActive: true,
    }).session(session);

    if (existingAtPosition) {
      // Deactivate the existing product at this position
      existingAtPosition.isActive = false;
      existingAtPosition.updatedBy = req.admin.id;
      await existingAtPosition.save({ session });
    }

    // Check if product is already featured in another position
    const existingProduct = await FeaturedProduct.findOne({
      productId,
      isActive: true,
    }).session(session);

    let featuredProduct;

    if (existingProduct) {
      // Update existing featured product
      existingProduct.displayPosition = displayPosition;
      existingProduct.title = title || existingProduct.title;
      existingProduct.subtitle = subtitle;
      existingProduct.customBadge = customBadge;
      existingProduct.startDate = startDate || existingProduct.startDate;
      existingProduct.endDate = endDate || existingProduct.endDate;
      existingProduct.updatedBy = req.admin.id;

      featuredProduct = await existingProduct.save({ session });
    } else {
      // Create new featured product
      featuredProduct = new FeaturedProduct({
        productId,
        displayPosition,
        title: title || "New Arrival",
        subtitle,
        customBadge,
        startDate,
        endDate,
        isActive: true,
        createdBy: req.admin.id,
        updatedBy: req.admin.id,
      });

      featuredProduct = await featuredProduct.save({ session });
    }

    await session.commitTransaction();

    // Populate product details for response
    await featuredProduct.populate({
      path: "productId",
      select: "name slug productId pricing isOnSale",
    });

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
      action: "SET_FEATURED_PRODUCT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        productId,
        productName: req.product.name,
        displayPosition,
        previousPosition: existingProduct?.displayPosition,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Featured product set successfully",
      data: featuredProduct,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error setting featured product:", err);

    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "This product is already featured or position is taken",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to set featured product",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    session.endSession();
  }
});

/**
 * =========================
 * BULK UPDATE FEATURED PRODUCTS
 * =========================
 * PUT /api/admin/featured/bulk
 * Body: {
 *   featuredProducts: [
 *     {
 *       productId: string,
 *       displayPosition: number,
 *       title?: string,
 *       subtitle?: string,
 *       customBadge?: string
 *     }
 *   ]
 * }
 */
router.put("/bulk", adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { featuredProducts } = req.body;

    if (!Array.isArray(featuredProducts) || featuredProducts.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of featured products",
      });
    }

    if (featuredProducts.length > 4) {
      return res.status(400).json({
        success: false,
        message: "Maximum 4 featured products allowed",
      });
    }

    // Validate all products exist
    const productIds = featuredProducts.map((fp) => fp.productId);
    const products = await Product.find({
      _id: { $in: productIds },
      isActive: true,
    }).session(session);

    if (products.length !== productIds.length) {
      return res.status(400).json({
        success: false,
        message: "One or more products are invalid or inactive",
      });
    }

    // Deactivate all existing featured products
    await FeaturedProduct.updateMany(
      { isActive: true },
      {
        isActive: false,
        updatedBy: req.admin.id,
      },
      { session },
    );

    // Create new featured products
    const newFeaturedProducts = [];
    for (const fp of featuredProducts) {
      const product = products.find((p) => p._id.toString() === fp.productId);

      const featuredProduct = new FeaturedProduct({
        productId: fp.productId,
        displayPosition: fp.displayPosition,
        title: fp.title || "New Arrival",
        subtitle: fp.subtitle,
        customBadge: fp.customBadge,
        isActive: true,
        createdBy: req.admin.id,
        updatedBy: req.admin.id,
      });

      const saved = await featuredProduct.save({ session });
      newFeaturedProducts.push(saved);
    }

    await session.commitTransaction();

    // Populate product details
    await FeaturedProduct.populate(newFeaturedProducts, {
      path: "productId",
      select: "name slug productId pricing isOnSale",
    });

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
      action: "BULK_UPDATE_FEATURED_PRODUCTS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        count: newFeaturedProducts.length,
        products: newFeaturedProducts.map((fp) => ({
          name: fp.productId.name,
          position: fp.displayPosition,
        })),
      },
    });

    return res.json({
      success: true,
      message: "Featured products updated successfully",
      data: newFeaturedProducts,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error bulk updating featured products:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update featured products",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    session.endSession();
  }
});

/**
 * =========================
 * REMOVE FEATURED PRODUCT
 * =========================
 * DELETE /api/admin/featured/:id
 */
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid featured product ID format",
      });
    }

    const featuredProduct = await FeaturedProduct.findById(id).populate(
      "productId",
      "name",
    );

    if (!featuredProduct) {
      return res.status(404).json({
        success: false,
        message: "Featured product not found",
      });
    }

    // Soft delete - deactivate instead of remove
    featuredProduct.isActive = false;
    featuredProduct.updatedBy = req.admin.id;
    await featuredProduct.save();

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
      action: "REMOVE_FEATURED_PRODUCT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        featuredProductId: id,
        productName: featuredProduct.productId?.name,
        displayPosition: featuredProduct.displayPosition,
      },
    });

    return res.json({
      success: true,
      message: "Featured product removed successfully",
    });
  } catch (err) {
    console.error("Error removing featured product:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to remove featured product",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * GET AVAILABLE PRODUCTS FOR FEATURING
 * =========================
 * GET /api/admin/featured/available-products
 * Query params:
 * - search: string
 * - category: string
 * - page: number
 * - limit: number
 */
router.get("/available-products", adminAuth, async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;

    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit)));

    // Build query for active products
    const query = { isActive: true };

    // Search by name or productId
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [{ name: searchRegex }, { productId: searchRegex }];
    }

    // Filter by category
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      query.categories = category;
    }

    // Get currently featured products to exclude them
    const featuredProductIds = await FeaturedProduct.find({
      isActive: true,
    }).distinct("productId");

    if (featuredProductIds.length > 0) {
      query._id = { $nin: featuredProductIds };
    }

    // Get total count
    const total = await Product.countDocuments(query);

    // Fetch products
    const products = await Product.find(query)
      .select("name slug productId pricing isOnSale categories")
      .populate("categories", "name slug")
      .sort({ createdAt: -1 })
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
      action: "VIEW_AVAILABLE_PRODUCTS_FOR_FEATURING",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: { search, category },
    });

    return res.json({
      success: true,
      data: products,
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
    console.error("Error fetching available products:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch available products",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * TOGGLE FEATURED PRODUCT STATUS
 * =========================
 * PATCH /api/admin/featured/:id/toggle
 */
router.patch("/:id/toggle", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid featured product ID format",
      });
    }

    const featuredProduct = await FeaturedProduct.findById(id).populate(
      "productId",
      "name",
    );

    if (!featuredProduct) {
      return res.status(404).json({
        success: false,
        message: "Featured product not found",
      });
    }

    featuredProduct.isActive = isActive;
    featuredProduct.updatedBy = req.admin.id;
    await featuredProduct.save();

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
      action: `TOGGLE_FEATURED_PRODUCT_${isActive ? "ACTIVATE" : "DEACTIVATE"}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        featuredProductId: id,
        productName: featuredProduct.productId?.name,
        displayPosition: featuredProduct.displayPosition,
        isActive,
      },
    });

    return res.json({
      success: true,
      message: `Featured product ${isActive ? "activated" : "deactivated"} successfully`,
      data: featuredProduct,
    });
  } catch (err) {
    console.error("Error toggling featured product:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle featured product",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * PERMANENTLY DELETE FEATURED PRODUCT
 * =========================
 * DELETE /api/admin/featured/:id/permanent
 * This will completely remove the featured product entry from the database
 * Does NOT delete the actual product, only removes it from featured section
 */
router.delete("/:id/permanent", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid featured product ID format",
      });
    }

    // Find the featured product before deletion for logging
    const featuredProduct = await FeaturedProduct.findById(id).populate(
      "productId",
      "name productId",
    );

    if (!featuredProduct) {
      return res.status(404).json({
        success: false,
        message: "Featured product not found",
      });
    }

    const productInfo = {
      id: featuredProduct._id,
      productId: featuredProduct.productId?._id,
      productName: featuredProduct.productId?.name,
      productCode: featuredProduct.productId?.productId,
      displayPosition: featuredProduct.displayPosition,
      title: featuredProduct.title,
    };

    // Permanently delete the featured product
    await FeaturedProduct.deleteOne({ _id: id });

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email name");
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
      action: "PERMANENTLY_DELETE_FEATURED_PRODUCT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        featuredProductId: productInfo.id,
        productId: productInfo.productId,
        productName: productInfo.productName,
        productCode: productInfo.productCode,
        displayPosition: productInfo.displayPosition,
        title: productInfo.title,
        deletedBy: admin.name,
      },
    });

    return res.json({
      success: true,
      message: "Featured product permanently deleted successfully",
      data: {
        deletedProduct: {
          id: productInfo.id,
          productName: productInfo.productName,
          displayPosition: productInfo.displayPosition,
        },
      },
    });
  } catch (err) {
    console.error("Error permanently deleting featured product:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete featured product",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/**
 * =========================
 * CLEAR ALL FEATURED PRODUCTS (Optional - Use with caution)
 * =========================
 * DELETE /api/admin/featured/clear/all
 * Removes all featured products from the database
 */
router.delete("/clear/all", adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Get count and details before deletion for logging
    const featuredProducts = await FeaturedProduct.find()
      .populate("productId", "name productId")
      .session(session);

    const count = featuredProducts.length;

    if (count === 0) {
      return res.json({
        success: true,
        message: "No featured products to delete",
        data: { deletedCount: 0 },
      });
    }

    const productDetails = featuredProducts.map((fp) => ({
      id: fp._id,
      productName: fp.productId?.name,
      displayPosition: fp.displayPosition,
    }));

    // Delete all featured products
    const result = await FeaturedProduct.deleteMany({}).session(session);

    await session.commitTransaction();

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email name");
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
      action: "CLEAR_ALL_FEATURED_PRODUCTS",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        deletedCount: result.deletedCount,
        deletedProducts: productDetails,
        deletedBy: admin.name,
      },
    });

    return res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} featured products`,
      data: {
        deletedCount: result.deletedCount,
        deletedProducts: productDetails,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error clearing all featured products:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to clear featured products",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    session.endSession();
  }
});

/**
 * =========================
 * DELETE FEATURED PRODUCT BY POSITION
 * =========================
 * DELETE /api/admin/featured/position/:position
 * Deletes featured product at specific position (1-4)
 */
router.delete("/position/:position", adminAuth, async (req, res) => {
  try {
    const position = parseInt(req.params.position);

    // Validate position
    if (isNaN(position) || position < 1 || position > 4) {
      return res.status(400).json({
        success: false,
        message: "Position must be between 1 and 4",
      });
    }

    // Find featured product at the position
    const featuredProduct = await FeaturedProduct.findOne({
      displayPosition: position,
      isActive: true,
    }).populate("productId", "name productId");

    if (!featuredProduct) {
      return res.status(404).json({
        success: false,
        message: `No active featured product found at position ${position}`,
      });
    }

    const productInfo = {
      id: featuredProduct._id,
      productId: featuredProduct.productId?._id,
      productName: featuredProduct.productId?.name,
      productCode: featuredProduct.productId?.productId,
      displayPosition: featuredProduct.displayPosition,
      title: featuredProduct.title,
    };

    // Permanently delete the featured product
    await FeaturedProduct.deleteOne({ _id: featuredProduct._id });

    // Get admin details for activity logging
    const admin = await Admin.findById(req.admin.id).select("email name");
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
      action: "DELETE_FEATURED_PRODUCT_BY_POSITION",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        position: position,
        featuredProductId: productInfo.id,
        productName: productInfo.productName,
        deletedBy: admin.name,
      },
    });

    return res.json({
      success: true,
      message: `Featured product at position ${position} permanently deleted`,
      data: {
        deletedProduct: {
          id: productInfo.id,
          productName: productInfo.productName,
          displayPosition: position,
        },
      },
    });
  } catch (err) {
    console.error("Error deleting featured product by position:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete featured product",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;
