const express = require("express");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");

const Review = require("../models/review.model");
const Product = require("../models/product.model");
const User = require("../models/user.model"); // adjust path as needed

const userAuth = require("../middleware/userAuth.middleware"); // you'll have this
const upload = require("../middleware/upload.middleware"); // reuse existing

const router = express.Router();

/**
 * Helper: Get pagination params
 */
const getPagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 10);
  const skip = (pageNum - 1) * limitNum;
  return { page: pageNum, limit: limitNum, skip };
};

/**
 * POST /api/reviews
 * Create a new review (user must be authenticated)
 * Body: { productId, rating, reviewText }
 * Files: media (optional, up to 5 files)
 */
router.post("/", userAuth, upload.array("media", 5), async (req, res) => {
  try {
    const { productId, rating, reviewText } = req.body;
    const userId = req.user.id; // assuming userAuth sets req.user

    if (!productId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Product ID and rating are required",
      });
    }

    // Validate product exists and is active
    const product = await Product.findOne({ _id: productId, isActive: true });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check if user already reviewed this product (active review)
    const existingReview = await Review.findOne({
      userId,
      productId,
      isActive: true,
    });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this product",
      });
    }

    // Process media files (if any)
    const mediaFiles = (req.files || []).map((file) => {
      let type = "image";
      if (file.mimetype.startsWith("video/")) type = "video";
      return {
        type,
        url: file.path,
        public_id: file.filename,
        format: file.format,
        bytes: file.size,
      };
    });

    const review = await Review.create({
      productId,
      userId,
      rating: parseInt(rating),
      reviewText: reviewText || "",
      media: mediaFiles,
    });

    res.status(201).json({
      success: true,
      data: review,
    });
  } catch (err) {
    console.error("Error creating review:", err);
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this product",
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/reviews/product/:productId
 * Get all active reviews for a product (paginated)
 * Query: ?page=1&limit=10
 */
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { page, limit } = req.query;
    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    // Validate product exists
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const query = { productId, isActive: true };

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate("userId", "name email") // show only user name and email
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching product reviews:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/reviews/product/:productId/stats
 * Get star rating analysis for a product
 */
router.get("/product/:productId/stats", async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const stats = await Review.aggregate([
      {
        $match: {
          productId: new mongoose.Types.ObjectId(productId),
          isActive: true,
        },
      },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: "$count" },
          ratings: {
            $push: {
              rating: "$_id",
              count: "$count",
            },
          },
          avgRatingSum: { $sum: { $multiply: ["$_id", "$count"] } },
        },
      },
      {
        $project: {
          _id: 0,
          totalReviews: 1,
          ratings: 1,
          averageRating: {
            $cond: [
              { $eq: ["$totalReviews", 0] },
              0,
              { $divide: ["$avgRatingSum", "$totalReviews"] },
            ],
          },
        },
      },
    ]);

    const result = stats[0] || {
      totalReviews: 0,
      ratings: [],
      averageRating: 0,
    };

    // Ensure all ratings 1-5 appear (with count 0 if missing)
    const fullRatings = [];
    for (let i = 5; i >= 1; i--) {
      const found = result.ratings.find((r) => r.rating === i);
      fullRatings.push({
        rating: i,
        count: found ? found.count : 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalReviews: result.totalReviews,
        averageRating: parseFloat(result.averageRating.toFixed(2)),
        ratings: fullRatings,
      },
    });
  } catch (err) {
    console.error("Error fetching review stats:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/reviews/:reviewId
 * User updates their own review (rating, text, or add media)
 * Body: { rating, reviewText }
 * Files: media (optional)
 */
router.put(
  "/:reviewId",
  userAuth,
  upload.array("media", 5),
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { rating, reviewText } = req.body;
      const userId = req.user.id;

      const review = await Review.findOne({
        _id: reviewId,
        userId,
        isActive: true,
      });
      if (!review) {
        return res.status(404).json({
          success: false,
          message: "Review not found or you are not the author",
        });
      }

      if (rating) review.rating = parseInt(rating);
      if (reviewText !== undefined) review.reviewText = reviewText;

      // Add new media (if any)
      if (req.files && req.files.length) {
        const newMedia = req.files.map((file) => ({
          type: file.mimetype.startsWith("video/") ? "video" : "image",
          url: file.path,
          public_id: file.filename,
          format: file.format,
          bytes: file.size,
        }));
        review.media.push(...newMedia);
      }

      await review.save();

      res.json({
        success: true,
        data: review,
      });
    } catch (err) {
      console.error("Error updating review:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

/**
 * DELETE /api/reviews/:reviewId
 * User deletes their own review (soft delete)
 */
router.delete("/:reviewId", userAuth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user.id;

    const review = await Review.findOne({
      _id: reviewId,
      userId,
      isActive: true,
    });
    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you are not the author",
      });
    }

    review.isActive = false;
    await review.save();

    res.json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting review:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/reviews/:reviewId/media/:publicId
 * User removes a specific media attachment from their own review
 */
router.delete("/:reviewId/media/:publicId", userAuth, async (req, res) => {
  try {
    const { reviewId, publicId } = req.params;
    const userId = req.user.id;

    const review = await Review.findOne({
      _id: reviewId,
      userId,
      isActive: true,
    });
    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found or you are not the author",
      });
    }

    const mediaItem = review.media.find((m) => m.public_id === publicId);
    if (!mediaItem) {
      return res.status(404).json({
        success: false,
        message: "Media not found",
      });
    }

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(mediaItem.public_id, {
      resource_type: mediaItem.type === "video" ? "video" : "image",
    });

    review.media = review.media.filter((m) => m.public_id !== publicId);
    await review.save();

    res.json({
      success: true,
      message: "Media removed from review",
    });
  } catch (err) {
    console.error("Error removing review media:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
