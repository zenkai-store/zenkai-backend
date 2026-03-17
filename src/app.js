const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const passport = require("./config/passport");
const cookieParser = require("cookie-parser");
require("dotenv").config();

require("./models/user.model");
require("./models/admin.model");
require("./models/adminActivity.model");
require("./models/category.model");
require("./models/product.model");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const adminCategoryRoutes = require("./routes/admin.category.routes");
const publicCategoryRoutes = require("./routes/public.category.routes");
const adminProductRoutes = require("./routes/admin.products.routes");
const expensesRoutes = require("./routes/admin.expense.routes");
const wishlistRoutes = require("./routes/wishlist.routes");
const cartRoutes = require("./routes/cart.routes");
const addressRoutes = require("./routes/address.routes");

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

app.use(passport.initialize());

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/categories", adminCategoryRoutes);
app.use("/api/categories", publicCategoryRoutes);
app.use("/api/admin/products", adminProductRoutes);
app.use("/api/admin/expenses", expensesRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/address", addressRoutes);

app.get("/", (req, res) => {
  res.send("Zenkai Backend Running");
});

module.exports = app;
