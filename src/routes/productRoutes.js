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
router.post(
  "/",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
  ]),
  async (req, res) => {
    const uploadedImages = [];

    try {
      const db = getDB();

      const data = JSON.parse(req.body.productData || "{}");

      const {
        basicInfo,
        pricing,
        productDetails,
        shipping,
        seo,
        featuredProduct,
        productStatus,
      } = data;

      // Required fields validation
      if (
        !basicInfo?.productName ||
        !basicInfo?.category ||
        !basicInfo?.sku ||
        !pricing?.regularPrice ||
        pricing?.stockQuantity === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "Please fill all required fields",
        });
      }

      // Main image validation
      if (!req.files?.mainImage?.[0]) {
        return res.status(400).json({
          success: false,
          message: "Main product image is required",
        });
      }

      // Numeric validation
      const numericValues = [
        pricing.regularPrice,
        pricing.stockQuantity,
        pricing.lowStockAlertLimit ?? 5,
        shipping?.productWeight ?? 0,
        shipping?.deliveryCharge ?? 0,
      ];

      if (
        numericValues.some(
          (value) => !Number.isFinite(Number(value)) || Number(value) < 0
        ) ||
        Number(pricing.regularPrice) <= 0 ||
        !Number.isInteger(Number(pricing.stockQuantity))
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid price, stock and shipping values",
        });
      }

      const existingProduct = await db.collection("products").findOne({
        $or: [
          { "basicInfo.sku": basicInfo.sku },
          { "basicInfo.productSlug": basicInfo.productSlug },
        ],
      });

      if (existingProduct) {
        return res.status(409).json({
          success: false,
          message: "Product SKU or slug already exists",
        });
      }

      // Upload main image
      const mainImage = await uploadToCloudinary(
        req.files.mainImage[0],
        "products/main"
      );

      uploadedImages.push(mainImage);

      // Upload gallery images
      const galleryImages = [];

      if (req.files.galleryImages) {
        for (const file of req.files.galleryImages) {
          const image = await uploadToCloudinary(
            file,
            "products/gallery"
          );

          galleryImages.push(image);
          uploadedImages.push(image);
        }
      }

      const product = {
        basicInfo: {
          productName: basicInfo.productName.trim(),
          productSlug: basicInfo.productSlug.trim(),
          sku: basicInfo.sku.trim(),
          brand: basicInfo.brand || "",
          category: basicInfo.category,
          shortDescription: basicInfo.shortDescription || "",
          fullDescription: basicInfo.fullDescription || "",
        },

        images: {
          mainImage,
          galleryImages,
        },

        pricing: {
          regularPrice: Number(pricing.regularPrice),
          salePrice:
            pricing.salePrice === "" || pricing.salePrice == null
              ? null
              : Number(pricing.salePrice),
          costPrice:
            pricing.costPrice === "" || pricing.costPrice == null
              ? null
              : Number(pricing.costPrice),
          stockQuantity: Number(pricing.stockQuantity),
          lowStockAlertLimit: Number(
            pricing.lowStockAlertLimit ?? 5
          ),
          stockStatus:
            Number(pricing.stockQuantity) > 0
              ? "In Stock"
              : "Out of Stock",
        },

        productDetails: {
          weightVolume: productDetails?.weightVolume || "",
          packagingType: productDetails?.packagingType || "",
          ingredients: productDetails?.ingredients || "",
          benefits: productDetails?.benefits || "",
          expiryDate: productDetails?.expiryDate || null,
          storageInstructions:
            productDetails?.storageInstructions || "",
        },

        shipping: {
          productWeight: Number(shipping?.productWeight || 0),
          deliveryCharge: Number(shipping?.deliveryCharge || 0),
          freeShipping: Boolean(shipping?.freeShipping),
        },

        seo: {
          metaTitle: seo?.metaTitle || "",
          metaDescription: seo?.metaDescription || "",
        },

        featuredProduct: Boolean(featuredProduct),
        productStatus: productStatus || "Draft",

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save to MongoDB
      const result = await db.collection("products").insertOne(product);

      res.status(201).json({
        success: true,
        message: "Product added successfully!",
        productId: result.insertedId,
        product,
      });

    } catch (error) {
      // Cleanup uploaded images if database operation fails
      await Promise.allSettled(
        uploadedImages.map((image) =>
          cloudinary.uploader.destroy(image.publicId)
        )
      );

      console.error("Add Product Error:", error);

      res.status(500).json({
        success: false,
        message: error instanceof SyntaxError
          ? "Invalid product data"
          : "Failed to add product",
      });
    }
  }
);

module.exports = router;