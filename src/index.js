const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { connectDB } = require("./config/db");
const productRoutes = require("./routes/productRoutes");

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Shreyoshi Foods Server Running!");
});

app.use("/api/products", productRoutes);

// Error handler for Multer and other middleware errors
app.use((error, req, res, next) => {
  console.error(error);

  res.status(error instanceof require("multer").MulterError ? 400 : 500)
    .json({
      success: false,
      message: error.message || "Something went wrong",
    });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

startServer();