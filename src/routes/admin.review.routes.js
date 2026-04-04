const express = require("express");
const Review = require("../models/review.model");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");
const adminAuth = require("../middleware/adminAuth.middleware");

const router = express.Router();

/**
 * GET /api/admin/reviews
 * Admin views all reviews (including inactive) with pagination & filters
 * Query: ?page=1&limit=20&productId=xxx&userId=xxx&isActive=true/false
 */
router.get("/", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, productId, userId, isActive } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, parseInt(limit));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (productId) query.productId = productId;
    if (userId) query.userId = userId;
    if (isActive !== undefined) query.isActive = isActive === "true";

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate("productId", "name slug productId")
        .populate("userId", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("Error fetching reviews for admin:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/admin/reviews/:reviewId
 * Admin hard deletes a review (or soft delete – we'll do hard delete as admin action)
 * Also logs the activity.
 */
router.delete("/:reviewId", adminAuth, async (req, res) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId).populate("userId", "email");
    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Optionally delete media from Cloudinary
    if (review.media && review.media.length) {
      for (const media of review.media) {
        await cloudinary.uploader.destroy(media.public_id, {
          resource_type: media.type === "video" ? "video" : "image",
        });
      }
    }

    await review.deleteOne();

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `DELETE_REVIEW (Product: ${review.productId}, User: ${review.userId?.email || "unknown"})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      message: "Review permanently deleted by admin",
    });
  } catch (err) {
    console.error("Error admin deleting review:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/admin/reviews/:reviewId/toggle-status
 * Admin can soft‑deactivate or reactivate a review (set isActive)
 * Body: { isActive: boolean }
 */
router.patch("/:reviewId/toggle-status", adminAuth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
      });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    review.isActive = isActive;
    await review.save();

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `${isActive ? "ACTIVATE" : "DEACTIVATE"}_REVIEW (ID: ${reviewId})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      message: `Review ${isActive ? "activated" : "deactivated"} successfully`,
      data: { isActive: review.isActive },
    });
  } catch (err) {
    console.error("Error toggling review status:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
