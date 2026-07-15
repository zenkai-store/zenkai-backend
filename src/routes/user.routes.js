const express = require("express");
const User = require("../models/user.model");
const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * GET USER PROFILE
 * Returns user details (excluding password)
 */
router.get("/profile", userAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -__v");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.json({
      success: true,
      data: user,
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
