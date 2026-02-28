const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const token = req.cookies.adminToken;

  if (!token)
    return res.status(401).json({ message: "Admin not authenticated" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin")
      return res.status(403).json({ message: "Access denied" });

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
