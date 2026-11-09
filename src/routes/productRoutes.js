const express = require("express");
const { getDB } = require("../config/db");
const { ObjectId } = require("mongodb");
const cloudinary = require("../config/cloudinary");
const upload = require("../middleware/upload");

const router = express.Router();

// Upload image to Cloudinary
const uploadToCloudinary = (file, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `shreyoshi-foods/${folder}`,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    stream.end(file.buffer);
  });
};

// Add Product

router.post("/", async (req, res) => {
  try {
    console.log("Received Product Data:", req.body);

    const db = getDB();
    const products = db.collection("products");

    const productData = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await products.insertOne(productData);

    res.status(201).json({
      success: true,
      message: "Product added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Product Insert Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


module.exports = router;