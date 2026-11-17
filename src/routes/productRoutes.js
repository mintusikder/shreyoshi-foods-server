
const express = require("express");
const { GridFSBucket, ObjectId } = require("mongodb");
const { getDB } = require("../config/db");
const upload = require("../middleware/upload");
const verifyAdmin = require("../middleware/verifyAdmin");

const router = express.Router();

const uploadProductImage = (bucket, file) =>
  new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(file.originalname, {
      metadata: { contentType: file.mimetype },
    });

    stream.once("error", reject);
    stream.once("finish", () => resolve(stream.id.toString()));
    stream.end(file.buffer);
  });

const getProductImageUrl = (req, imageId) => {
  const baseUrl =
    process.env.API_BASE_URL ||
    `${req.protocol}://${req.get("host")}`;

  return `${baseUrl.replace(/\/+$/, "")}/api/products/images/${imageId}`;
};

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toBoolean = (value) =>
  value === true || value === "true";

const getImageId = (url) => {
  if (typeof url !== "string") return null;

  const match = url.match(/\/api\/products\/images\/([a-f\d]{24})(?:$|[?#])/i);

  return match ? match[1] : null;
};

const deleteUnusedImages = async (bucket, oldUrls, newUrls) => {
  const newIds = new Set(
    newUrls.map(getImageId).filter(Boolean)
  );

  const oldIds = [
    ...new Set(oldUrls.map(getImageId).filter(Boolean)),
  ];

  for (const id of oldIds) {
    if (newIds.has(id)) continue;

    try {
      await bucket.delete(new ObjectId(id));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("GridFS Image Delete Error:", error);
      }
    }
  }
};

const normalizeProductData = (body) => ({
  ...body,

  regularPrice: toNumber(body.regularPrice),
  salePrice: toNumber(body.salePrice),
  costPrice: toNumber(body.costPrice),
  stockQuantity: toNumber(body.stockQuantity, 0),
  lowStockLimit: toNumber(body.lowStockLimit, 10),
  productWeight: toNumber(body.productWeight),
  deliveryCharge: toNumber(body.deliveryCharge, 0),

  freeShipping: toBoolean(body.freeShipping),
  featured: toBoolean(body.featured),

  status: body.status === "published" ? "published" : "draft",
});

// ADD PRODUCT
router.post(
  "/",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
  ]),
  async (req, res) => {
    let bucket;
    const uploadedIds = [];

    try {
      const db = getDB();
      const products = db.collection("products");

      bucket = new GridFSBucket(db, {
        bucketName: "productImages",
      });

      let mainImage = null;

      if (req.files?.mainImage?.[0]) {
        const id = await uploadProductImage(
          bucket,
          req.files.mainImage[0]
        );

        uploadedIds.push(id);
        mainImage = getProductImageUrl(req, id);
      }

      const galleryImages = [];

      for (const file of req.files?.galleryImages || []) {
        const id = await uploadProductImage(bucket, file);

        uploadedIds.push(id);
        galleryImages.push(getProductImageUrl(req, id));
      }

      if (!mainImage) {
        return res.status(400).json({
          success: false,
          message: "Main product image is required",
        });
      }

      const productData = {
        ...normalizeProductData(req.body),

        name: String(req.body.name || "").trim(),
        slug: String(req.body.slug || "").trim(),

        images: {
          main: mainImage,
          gallery: galleryImages,
        },

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await products.insertOne(productData);

      uploadedIds.length = 0;

      res.status(201).json({
        success: true,
        message: "Product added successfully",
        insertedId: result.insertedId,
      });
    } catch (error) {
      if (bucket) {
        for (const id of uploadedIds) {
          try {
            await bucket.delete(new ObjectId(id));
          } catch (cleanupError) {
            console.error(cleanupError);
          }
        }
      }

      console.error("Product Insert Error:", error);

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// PRODUCT IMAGE
router.get("/images/:imageId", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.imageId)) {
      return res.status(404).json({
        success: false,
        message: "Image not found",
      });
    }

    const db = getDB();
    const bucket = new GridFSBucket(db, {
      bucketName: "productImages",
    });

    const imageId = new ObjectId(req.params.imageId);
    const file = await bucket.find({ _id: imageId }).limit(1).next();

    if (!file || !file.metadata?.contentType?.startsWith("image/")) {
      return res.status(404).json({
        success: false,
        message: "Image not found",
      });
    }

    res.set("Content-Type", file.metadata.contentType);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("X-Content-Type-Options", "nosniff");

    const stream = bucket.openDownloadStream(imageId);

    stream.once("error", next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

// ADMIN: GET ALL PRODUCTS (Draft + Published)
router.get("/admin/all", verifyAdmin, async (req, res) => {
  try {
    const db = getDB();

    const result = await db
      .collection("products")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: result.length,
      products: result,
    });
  } catch (error) {
    console.error("Admin Get Products Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ADMIN: UPDATE PRODUCT
router.put(
  "/admin/:id",
  verifyAdmin,
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
  ]),
  async (req, res) => {
    let bucket;
    const uploadedIds = [];

    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID",
        });
      }

      const db = getDB();
      const products = db.collection("products");
      const productId = new ObjectId(req.params.id);

      const existing = await products.findOne({ _id: productId });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      bucket = new GridFSBucket(db, {
        bucketName: "productImages",
      });

      let mainImage = existing.images?.main || null;

      if (req.files?.mainImage?.[0]) {
        const id = await uploadProductImage(
          bucket,
          req.files.mainImage[0]
        );

        uploadedIds.push(id);
        mainImage = getProductImageUrl(req, id);
      }

      let existingGallery = [];

      try {
        existingGallery = JSON.parse(
          req.body.existingGalleryImages || "[]"
        );

        if (!Array.isArray(existingGallery)) {
          existingGallery = [];
        }
      } catch {
        existingGallery = [];
      }

      const newGallery = [];

      for (const file of req.files?.galleryImages || []) {
        const id = await uploadProductImage(bucket, file);

        uploadedIds.push(id);
        newGallery.push(getProductImageUrl(req, id));
      }

      const galleryImages = [
        ...existingGallery.filter((url) => typeof url === "string"),
        ...newGallery,
      ].slice(0, 10);

      const normalizedData = normalizeProductData(req.body);
      delete normalizedData._id;

      const updatedData = {
        ...normalizedData,

        name: String(req.body.name || "").trim(),
        slug: String(req.body.slug || "").trim(),

        images: {
          main: mainImage,
          gallery: galleryImages,
        },

        updatedAt: new Date(),
      };

      const result = await products.updateOne(
        { _id: productId },
        { $set: updatedData }
      );

      if (!result.matchedCount) {
        throw new Error("Product update failed");
      }

      const oldUrls = [
        existing.images?.main,
        ...(existing.images?.gallery || []),
      ].filter(Boolean);

      const newUrls = [
        mainImage,
        ...galleryImages,
      ].filter(Boolean);

      await deleteUnusedImages(bucket, oldUrls, newUrls);

      uploadedIds.length = 0;

      res.status(200).json({
        success: true,
        message: "Product updated successfully",
      });
    } catch (error) {
      if (bucket) {
        for (const id of uploadedIds) {
          try {
            await bucket.delete(new ObjectId(id));
          } catch (cleanupError) {
            console.error(cleanupError);
          }
        }
      }

      console.error("Product Update Error:", error);

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// ADMIN: DELETE PRODUCT
router.delete("/admin/:id", verifyAdmin, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const db = getDB();
    const products = db.collection("products");
    const productId = new ObjectId(req.params.id);

    const product = await products.findOne({ _id: productId });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await products.deleteOne({ _id: productId });

    const bucket = new GridFSBucket(db, {
      bucketName: "productImages",
    });

    const imageUrls = [
      product.images?.main,
      ...(product.images?.gallery || []),
    ].filter(Boolean);

    const imageIds = [
      ...new Set(imageUrls.map(getImageId).filter(Boolean)),
    ];

    for (const id of imageIds) {
      try {
        await bucket.delete(new ObjectId(id));
      } catch (error) {
        console.error("GridFS Image Delete Error:", error);
      }
    }

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Product Delete Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// PUBLIC: GET PUBLISHED PRODUCTS
router.get("/", async (req, res) => {
  try {
    const db = getDB();

    const result = await db
      .collection("products")
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

// PUBLIC: GET SINGLE PUBLISHED PRODUCT
router.get("/:slug", async (req, res) => {
  try {
    const db = getDB();
    const slug = decodeURIComponent(req.params.slug).trim();

    const products = db.collection("products");

    let product = await products.findOne({
      slug,
      status: "published",
    });

    if (!product) {
      product = await products.findOne({
        status: "published",
        $expr: {
          $eq: [{ $trim: { input: "$slug" } }, slug],
        },
      });
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get Single Product Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
