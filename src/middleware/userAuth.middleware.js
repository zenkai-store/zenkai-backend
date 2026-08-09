const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  let token = req.cookies.token;

  if (!token) {
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token)
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid authentication token",
    });
  }
};
