const express = require("express");

const Expense = require("../models/expense.model");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");

const adminAuth = require("../middleware/adminAuth.middleware");

const router = express.Router();

/**
 * CREATE EXPENSE
 */

router.post("/", adminAuth, async (req, res) => {
  try {
    const { title, category, description, amount, paymentMethod, expenseDate } =
      req.body;

    const admin = await Admin.findById(req.admin.id);

    if (!admin)
      return res.status(401).json({
        success: false,
        message: "Invalid Admin Credentials",
      });

    if (!title || !category || !amount || !expenseDate)
      return res.status(400).json({
        success: false,
        message: "Title, category, amount and expense date are required",
      });

    if (isNaN(amount) || amount <= 0)
      return res.status(400).json({
        success: false,
        message: "Amount must be a positive number",
      });

    const expense = await Expense.create({
      title,
      category,
      description,
      amount,
      paymentMethod,
      expenseDate,
      createdBy: req.admin.id,
    });

    await AdminActivity.create({
      adminId: req.admin.id,
      adminEmail: admin.email,
      action: `CREATE_EXPENSE (${title}) AMOUNT (${amount})`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      data: expense,
    });
  } catch (err) {
    console.log("Error in creating expense: ", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET ALL EXPENSES
 */

router.get("/", adminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id);

    if (!admin)
      return res.status(401).json({
        success: false,
        message: "Invalid Admin Credentials",
      });

    const { category, startDate, endDate, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (category) filter.category = category;

    if (startDate || endDate) {
      filter.expenseDate = {};

      if (startDate) filter.expenseDate.$gte = new Date(startDate);
      if (endDate) filter.expenseDate.$lte = new Date(endDate);
    }

    const expenses = await Expense.find(filter)
      .populate("createdBy", "email")
      .sort({ expenseDate: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Expense.countDocuments(filter);

    return res.json({
      success: true,
      data: expenses,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.log("Error fetching expenses: ", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
