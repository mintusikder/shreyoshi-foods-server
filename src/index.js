
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { connectDB } = require("./config/db");

const productRoutes = require("./routes/productRoutes");
const homeRoutes = require("./routes/homeRoutes");
const orderRoutes = require("./routes/orderRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes"); // Analytics Route

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

// Test API
app.get("/", (req, res) => {
  res.send("Shreyoshi Foods Server Running!");
});

// API Routes
app.use("/api/products", productRoutes);
app.use("/api/home", homeRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/analytics", analyticsRoutes); // Analytics API

// Error Handler
app.use((error, req, res, next) => {
  console.error("Server Error:", error);

  const isMulterError = error.name === "MulterError";

  res.status(isMulterError ? 400 : 500).json({
    success: false,
    message: error.message || "Something went wrong",
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Start Server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
