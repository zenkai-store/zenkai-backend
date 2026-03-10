const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const User = require("../models/user.model");

const router = express.Router();

/**
 * GOOGLE LOGIN
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

/**
 * GOOGLE CALLBACK
 */
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/api/auth/failure",
  }),
  (req, res) => {
    const token = jwt.sign(
      {
        id: req.user._id,
        role: req.user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // set true in production with HTTPS
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect("/api/auth/success");
  },
);

/**
 * AUTH SUCCESS
 */
router.get("/success", (req, res) => {
  res.json({ message: "Login successful" });
});

/**
 * AUTH FAILURE
 */
router.get("/failure", (req, res) => {
  res.status(401).json({ message: "Login failed" });
});

/**
 * LOGOUT
 */
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
});

/**
 * CHECK AUTH
 */
router.get("/me", (req, res) => {
  const token = req.cookies.token;

  if (!token) return res.status(401).json({ message: "Not authenticated" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user: decoded });
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
});

/**
 * EMAIL SIGNUP
 */

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });

    if (password.length < 6)
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });

    const existing = await User.findOne({ email });

    if (existing)
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });

    const salt = await bcrypt.genSalt(12);

    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      success: true,
      message: "Signup successful",
    });
  } catch (err) {
    console.log("Signup error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * EMAIL LOGIN
 */

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });

    const user = await User.findOne({ email }).select("+password");

    if (!user || !user.password)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: "Login successful",
    });
  } catch (err) {
    console.log("Login error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
