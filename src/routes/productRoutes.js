
const express = require("express");
const { getDB } = require("../config/db");
const upload = require("../middleware/upload");
const uploadToImgBB = require("../config/imgbb");
const router = express.Router();

// Convert FormData values into correct types
const toNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toBoolean = (value) => {
  return value === true || value === "true";
};

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

// ADD PRODUCT
router.post(
  "/",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const db = getDB();
      const products = db.collection("products");

      // 1. Upload Main Image to ImgBB
      let mainImage = null;

      if (req.files?.mainImage?.[0]) {
        const uploadedMain = await uploadToImgBB(
          req.files.mainImage[0]
        );

        mainImage = uploadedMain.url;
      }

      // 2. Upload Gallery Images to ImgBB
      let galleryImages = [];

      if (req.files?.galleryImages?.length) {
        const uploadedGallery = await Promise.all(
          req.files.galleryImages.map((file) =>
            uploadToImgBB(file)
          )
        );

        galleryImages = uploadedGallery.map(
          (image) => image.url
        );
      }

      // 3. Product Data
      const productData = {
        ...req.body,

        images: {
          main: mainImage,
          gallery: galleryImages,
        },

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 4. Save to MongoDB
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
  }
);

// Get All Products
router.get("/", async (req, res) => {
  try {
    const db = getDB();
    const products = db.collection("products");

    const result = await products
      .find({ status: "published" })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: result.length,
      products: result,
    });
  } catch (error) {
    console.error("Get Products Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
