const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    let token = req.cookies.adminToken;

    if (!token) {
      const authHeader = req.headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

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
