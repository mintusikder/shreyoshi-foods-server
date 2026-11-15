
const express = require("express");
const { GridFSBucket, ObjectId } = require("mongodb");
const { getDB } = require("../config/db");
const upload = require("../middleware/upload");
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
    process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`;

  return `${baseUrl.replace(/\/+$/, "")}/api/products/images/${imageId}`;
};

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

// ADD PRODUCT
router.post(
  "/",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
  ]),
  async (req, res) => {
    let imageBucket;
    const uploadedImageIds = [];

    try {
      const db = getDB();
      const products = db.collection("products");
      imageBucket = new GridFSBucket(db, { bucketName: "productImages" });

      let mainImage = null;

      if (req.files?.mainImage?.[0]) {
        const imageId = await uploadProductImage(
          imageBucket,
          req.files.mainImage[0]
        );
        uploadedImageIds.push(imageId);
        mainImage = getProductImageUrl(req, imageId);
      }

      let galleryImages = [];

      if (req.files?.galleryImages?.length) {
        for (const file of req.files.galleryImages) {
          const imageId = await uploadProductImage(imageBucket, file);
          uploadedImageIds.push(imageId);
          galleryImages.push(getProductImageUrl(req, imageId));
        }
      }

      const productData = {
        ...req.body,
        slug:
          typeof req.body.slug === "string"
            ? req.body.slug.trim()
            : req.body.slug,

        images: {
          main: mainImage,
          gallery: galleryImages,
        },

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await products.insertOne(productData);
      uploadedImageIds.length = 0;

      res.status(201).json({
        success: true,
        message: "Product added successfully",
        insertedId: result.insertedId,
      });

    } catch (error) {
      if (imageBucket) {
        for (const imageId of uploadedImageIds) {
          try {
            await imageBucket.delete(new ObjectId(imageId));
          } catch (cleanupError) {
            console.error("Product Image Cleanup Error:", cleanupError);
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

router.get("/images/:imageId", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.imageId)) {
      return res.status(404).json({
        success: false,
        message: "Image not found",
      });
    }

    const db = getDB();
    const bucket = new GridFSBucket(db, { bucketName: "productImages" });
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

    const downloadStream = bucket.openDownloadStream(imageId);
    downloadStream.once("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }

      next(error);
    });
    downloadStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

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


// Get Single Published Product by Slug

router.get("/:slug", async (req, res) => {
  try {
    const db = getDB();

    const slug = decodeURIComponent(req.params.slug).trim();
    const products = db.collection("products");

    let product = await products.findOne({
      slug: slug,
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
        searchedSlug: slug,
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
