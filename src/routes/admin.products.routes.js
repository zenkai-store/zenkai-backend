const express = require("express");
const slugify = require("slugify");
const cloudinary = require("../config/cloudinary");

const Product = require("../models/product.model");
const Category = require("../models/category.model");

const adminAuth = require("../middleware/adminAuth.middleware");
const upload = require("../middleware/upload.middleware");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");

const router = express.Router();

/**
 * CREATE PRODUCT WITH MEDIA
 */
router.post("/", adminAuth, upload.array("media", 10), async (req, res) => {
  try {
    const {
      productId,
      name,
      quantity,
      description,
      productDetails,
      costPrice,
      marginalPrice,
      sellingPrice,
      onSalePrice,
      categories,
    } = req.body;

    const admin = await Admin.findOne({ _id: req.admin.id });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    if (!productId || !name)
      return res
        .status(400)
        .json({ success: false, message: "Product ID and name are required" });

    const existing = await Product.findOne({ productId });
    if (existing)
      return res.status(400).json({
        success: false,
        message: "Product with this ID already exists",
      });

    if (!quantity || isNaN(quantity) || quantity < 0)
      return res.status(400).json({
        success: false,
        message: "Quantity must be a non-negative number",
      });

    if (
      !costPrice ||
      !marginalPrice ||
      !sellingPrice ||
      isNaN(costPrice) ||
      isNaN(marginalPrice) ||
      isNaN(sellingPrice) ||
      costPrice < 0 ||
      marginalPrice < 0 ||
      sellingPrice < 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Cost price, marginal price, and selling price must be non-negative numbers",
      });
    }

    // Validate Categories
    let categoryIds = [];
    if (categories) {
      const parsed = JSON.parse(categories);
      const foundCategories = await Category.find({
        _id: { $in: parsed },
        isActive: true,
      });

      if (foundCategories.length !== parsed.length)
        return res.status(400).json({
          success: false,
          message: "Invalid categories provided",
        });

      categoryIds = parsed;
    }

    const mediaFiles = req.files.map((file) => {
      let type = "image";
      if (file.mimetype.startsWith("video/")) type = "video";
      if (
        !file.mimetype.startsWith("image/") &&
        !file.mimetype.startsWith("video/")
      )
        type = "model";

      return {
        type,
        url: file.path,
        public_id: file.filename,
        format: file.format,
        bytes: file.size,
      };
    });

    const product = await Product.create({
      productId,
      name,
      slug: slugify(name, { lower: true }),
      quantity,
      categories: categoryIds,
      description: description ? JSON.parse(description) : [],
      productDetails: productDetails ? JSON.parse(productDetails) : [],
      pricing: {
        costPrice,
        marginalPrice,
        sellingPrice,
        onSalePrice,
      },
      media: mediaFiles,
      createdBy: req.admin.id,
    });

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `CREATE_PRODUCT (${product.name})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      data: product,
    });
  } catch (err) {
    console.log("Error in creating product by Admin: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * ADD MEDIA TO EXISTING PRODUCT
 */
router.post(
  "/:id/media",
  adminAuth,
  upload.array("media", 10),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);

      const admin = await Admin.findOne({ _id: req.admin.id });
      if (!admin)
        return res.status(401).json({ message: "Invalid credentials" });

      if (!product)
        return res.status(404).json({
          success: false,
          message: "Product not found!",
        });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No media files uploaded",
        });
      }

      const mediaFiles = req.files.map((file) => {
        let type = "image";
        if (file.mimetype.startsWith("video/")) type = "video";
        if (
          !file.mimetype.startsWith("image/") &&
          !file.mimetype.startsWith("video/")
        )
          type = "model";

        return {
          type,
          url: file.path,
          public_id: file.filename,
          format: file.format,
          bytes: file.size,
        };
      });

      product.media.push(...mediaFiles);
      await product.save();

      await AdminActivity.create({
        adminId: req.admin.id,
        adminEmail: admin.email,
        action: `ADD_MEDIA (${product.name})`,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.json({
        success: true,
        data: product.media,
      });
    } catch (err) {
      console.log("Error in adding media to a product: ", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

/**
 * DELETE PRODUCT MEDIA
 */
router.delete("/:id/media/:publicId", adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    const admin = await Admin.findOne({ _id: req.admin.id });
    if (!admin)
      res.status(401).json({
        message: "Invalid credentials",
      });

    if (!product)
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });

    const mediaItem = product.media.find(
      (m) => m.public_id === req.params.publicId,
    );

    if (!mediaItem)
      return res.status(404).json({
        success: false,
        message: "Media not found",
      });

    await cloudinary.uploader.destroy(mediaItem.public_id, {
      resource_type:
        mediaItem.type === "video"
          ? "video"
          : mediaItem.type === "model"
            ? "raw"
            : "image",
    });

    product.media = product.media.filter(
      (m) => m.public_id !== req.params.publicId,
    );

    await product.save();

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `DELETE_MEDIA (${product.name})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Media deleted" });
  } catch (err) {
    console.log("Error in Deleting a Product Media: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * UPDATE QUANTITY OF A PRODUCT
 */
router.patch("/:id/quantity", adminAuth, async (req, res) => {
  try {
    const { quantity } = req.body;

    if (!quantity || quantity < 0)
      return res.status(404).json({
        success: false,
        message: "Quantity can be a negative number",
      });

    const admin = Admin.findOne({ _id: req.admin.id });
    if (!admin)
      return res.status(401).json({ message: "Invalid Admin Credentials" });

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const lastQuantity = product.quantity;

    product.quantity = quantity;
    await product.save();

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `UPDATED_QUANTITY OF (${product.name}) FROM (${lastQuantity}) TO (${quantity})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      message: "Quantity Updated Successfully",
      data: product.quantity,
    });
  } catch (err) {
    console.log("Error in updating quantity: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * SOFT DELETE PRODUCT BY ADMIN
 */
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product)
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });

    const admin = Admin.findOne({ _id: req.admin.id });
    if (!admin)
      return res.status(401).json({ message: "Invalid Admin Credentials" });

    product.isActive = false;
    await product.save();

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `SOFT_DELETE_PRODUCT (${product.name})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      message: "Product soft deleted",
    });
  } catch (err) {
    console.log("Error in Soft Delete Product: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
