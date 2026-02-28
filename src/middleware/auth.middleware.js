const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    const token = req.cookies.adminToken;

    if (!token)
      return res.status(401).json({
        success: false,
        message: "Admin authentication required",
      });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin")
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired admin session",
    });
  }
};
