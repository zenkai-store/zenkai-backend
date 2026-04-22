const express = require("express");
const slugify = require("slugify");

const Category = require("../models/category.model");
const Product = require("../models/product.model");
const adminAuth = require("../middleware/adminAuth.middleware");
const AdminActivity = require("../models/adminActivity.model");
const Admin = require("../models/admin.model");

const router = express.Router();

/**
 * CREATE CATEGORY
 */
router.post("/", adminAuth, async (req, res) => {
  try {
    const { name, description, image, displayOrder } = req.body;

    const slug = slugify(name, { lower: true });

    const admin = await Admin.findOne({ _id: req.admin.id });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    const existing = await Category.findOne({ slug });
    if (existing)
      return res.status(400).json({
        success: false,
        message: "Category already exists",
      });

    const category = await Category.create({
      name,
      slug,
      description,
      image,
      displayOrder,
      createdBy: req.admin.id,
    });

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `CREATE_CATEGORY (${category.name})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      success: true,
      data: category,
    });
  } catch (err) {
    console.log("Error creating category:", err);
    res.status(500).json({
      success: false,
      message: "Failed to create category",
    });
  }
});

/**
 * UPDATE CATEGORY
 */
router.put("/:id", adminAuth, async (req, res) => {
  try {
    const { name, description, image, displayOrder, isActive } = req.body;

    const admin = await Admin.findOne({ _id: req.admin.id });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    const category = await Category.findById(req.params.id);
    if (!category)
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });

    if (name) {
      category.name = name;
      category.slug = slugify(name, { lower: true });
    }

    if (description !== undefined) category.description = description;
    if (image !== undefined) category.image = image;
    if (displayOrder !== undefined) category.displayOrder = displayOrder;
    if (isActive !== undefined) category.isActive = isActive;

    category.updatedBy = req.admin.id;

    await category.save();

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `UPDATE_CATEGORY (${category.name})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      data: category,
    });
  } catch (err) {
    console.log("Error updating category:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update category",
    });
  }
});

/**
 * DELETE CATEGORY
 */
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category)
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });

    // Prevent deletion if products exist
    const productExists = await Product.findOne({
      categories: category._id,
    });

    if (productExists)
      return res.status(400).json({
        success: false,
        message: "Cannot delete category linked to products",
      });

    await category.deleteOne();

    const admin = await Admin.findOne({ _id: req.admin.id });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `DELETE_CATEGORY (${category.name})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (err) {
    console.log("Error deleting category:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
    });
  }
});

/**
 * LIST ALL CATEGORIES (Public)
 * Accessible to everyone - no authentication required
 */
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .select("name slug description image displayOrder");

    res.json({
      success: true,
      data: categories,
    });
  } catch (err) {
    console.log("Error fetching categories:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    });
  }
});

module.exports = router;
