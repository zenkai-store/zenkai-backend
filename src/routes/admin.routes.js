const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");
const adminAuth = require("../middleware/auth.middleware");

const router = express.Router();

/**
 * ADMIN LOGIN
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("SECRET AT SIGN:", process.env.JWT_SECRET);

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",

      //secure: false,     // ✅ changed
      //sameSite: "lax",  // ✅ changed
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Log activity
    await AdminActivity.create({
      adminId: admin._id,
      adminEmail: admin.email,
      action: "LOGIN",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ message: "Admin logged in successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ADMIN LOGOUT
 */
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies.adminToken;
    if (!token) return res.status(401).json({ message: "Not authenticated" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const admin = await Admin.findById(decoded.id);

    await AdminActivity.create({
      adminId: admin._id,
      adminEmail: admin.email,
      action: "LOGOUT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.clearCookie("adminToken");
    res.json({ message: "Admin logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ message: "Logout failed" });
  }
});

/**
 * GET ALL ADMIN ACTIVITIES
 */
router.get("/activities", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, action, startDate, endDate } = req.query;

    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);

    const query = {};

    // Filter by action
    if (action) {
      query.action = action;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};

      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }

      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const total = await AdminActivity.countDocuments(query);

    const activities = await AdminActivity.find(query)
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean();

    return res.json({
      success: true,
      data: activities,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
      },
    });
  } catch (err) {
    console.error("Error fetching admin activities:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin activities",
    });
  }
});

module.exports = router;
