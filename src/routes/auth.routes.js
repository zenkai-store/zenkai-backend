const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const User = require("../models/user.model");

const router = express.Router();

// Cookie settings helper
const setUserTokenCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "lax" : "lax",
    maxAge: 180 * 24 * 60 * 60 * 1000, // 6 months
  });
};

/**
 * GOOGLE LOGIN
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account",
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
      { expiresIn: "180d" },
    );

    setUserTokenCookie(res, token);

    res.redirect("/api/auth/success");
  },
);

/**
 * AUTH SUCCESS
 */
router.get("/success", (req, res) => {
  // Instead of sending JSON, send an HTML page that will close the popup
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Successful</title>
      <script>
        window.opener.postMessage({ type: 'AUTH_SUCCESS' }, '${process.env.FRONTEND_URL || "http://localhost:3000"}');
        window.close();
      </script>
    </head>
    <body>
      <h2>Login successful! You can close this window.</h2>
    </body>
    </html>
  `);
});

/**
 * AUTH FAILURE
 */
router.get("/failure", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Failed</title>
      <script>
        window.opener.postMessage({ type: 'AUTH_FAILURE' }, '${process.env.FRONTEND_URL || "http://localhost:3000"}');
        window.close();
      </script>
    </head>
    <body>
      <h2>Login failed. Please try again.</h2>
    </body>
    </html>
  `);
});

router.post("/logout", (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
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
      { expiresIn: "180d" },
    );

    setUserTokenCookie(res, token);

    return res.status(201).json({
      success: true,
      message: "Signup successful",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
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
      { expiresIn: "180d" },
    );

    setUserTokenCookie(res, token);

    return res.json({
      success: true,
      message: "Login successful",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
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
