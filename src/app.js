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
require("./models/counter.model");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const adminCategoryRoutes = require("./routes/admin.category.routes");
const publicCategoryRoutes = require("./routes/public.category.routes");
const adminProductRoutes = require("./routes/admin.products.routes");
const expensesRoutes = require("./routes/admin.expense.routes");
const wishlistRoutes = require("./routes/wishlist.routes");
const cartRoutes = require("./routes/cart.routes");
const addressRoutes = require("./routes/address.routes");
const paymentRoutes = require("./routes/payment.routes");
const productRoutes = require("./routes/product.routes");
const reviewRoutes = require("./routes/review.routes");
const adminReviewRoutes = require("./routes/admin.review.routes");
const adminOrderRoutes = require("./routes/admin.order.routes");
const orderRoutes = require("./routes/order.routes");
const adminCustomerRoutes = require("./routes/admin.customer.routes");
const adminFeaturedRoutes = require("./routes/admin.featured.routes");
const featuredRoutes = require("./routes/featured.routes");
const adminShipmentRoutes = require("./routes/admin.shipment.routes");
const userRoutes = require("./routes/user.routes");

const cleanupPendingOrders = require("./jobs/cleanupPendingOrders");

const app = express();

cleanupPendingOrders();

app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "https://localhost:5173",
        "http://localhost:5173",
        "https://127.0.0.1:5173",
        "http://127.0.0.1:5173",
        "https://zenkai-frontend-nine.vercel.app",
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin); // 🔥 return exact origin
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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
app.use("/api/payment", paymentRoutes);
app.use("/api/products", productRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/admin/reviews", adminReviewRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/admin/customers", adminCustomerRoutes);
app.use("/api/admin/featured", adminFeaturedRoutes);
app.use("/api/featured", featuredRoutes);
app.use("/api/admin/shipments", adminShipmentRoutes);
app.use("/api/user", userRoutes);

app.get("/", (req, res) => {
  res.send("Zenkai Backend Running");
});

module.exports = app;
