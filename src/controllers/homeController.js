const { getDB } = require("../config/db");
const uploadToImgBB = require("../config/imgbb");

// Public: Get Homepage Hero
const getHomeHero = async (req, res) => {
  try {
    const db = getDB();

    const hero = await db.collection("homeContent").findOne({
      key: "homepageHero",
    });

    res.status(200).json({
      success: true,
      data: {
        slides: (hero?.slides || []).map((slide) => ({
          image: slide.image,
          title: slide.title || "",
          subtitle: slide.subtitle || "",
          link: slide.link || "",
        })),
        sideImage: hero?.sideImage
          ? { image: hero.sideImage.image }
          : null,
      },
    });
  } catch (error) {
    console.error("Get Home Hero Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load homepage hero",
    });
  }
};

// Admin: Update Homepage Hero
const updateHomeHero = async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection("homeContent");

    const existingHero = await collection.findOne({
      key: "homepageHero",
    });

    let slides = existingHero?.slides || [];
    let sideImage = existingHero?.sideImage || null;

    // Update slider images when new files are uploaded
    if (req.files?.slideImages?.length) {
      let slideDetails = [];

      if (req.body.slides) {
        try {
          slideDetails = JSON.parse(req.body.slides);
        } catch {
          return res.status(400).json({
            success: false,
            message: "Invalid slides JSON",
          });
        }
      }

      slides = [];

      for (let i = 0; i < req.files.slideImages.length; i++) {
        const uploaded = await uploadToImgBB(req.files.slideImages[i]);

        const details = slideDetails[i] || {};

        slides.push({
          image: uploaded.url,
          imageId: uploaded.imageId,
          deleteUrl: uploaded.deleteUrl,
          title: details.title || "",
          subtitle: details.subtitle || "",
          link: details.link || "",
        });
      }
    } else if (req.body.slides) {
      // Allows updating slide text/order while retaining existing images
      try {
        const updatedSlides = JSON.parse(req.body.slides);

        if (!Array.isArray(updatedSlides)) {
          return res.status(400).json({
            success: false,
            message: "Slides must be an array",
          });
        }

        slides = updatedSlides.map((slide) => ({
          image: slide.image,
          imageId: slide.imageId || "",
          deleteUrl: slide.deleteUrl || "",
          title: slide.title || "",
          subtitle: slide.subtitle || "",
          link: slide.link || "",
        }));
      } catch {
        return res.status(400).json({
          success: false,
          message: "Invalid slides JSON",
        });
      }
    }

    // Update right side image only when a new file is uploaded
    if (req.files?.sideImage?.[0]) {
      const uploaded = await uploadToImgBB(req.files.sideImage[0]);
      sideImage = {
        image: uploaded.url,
        imageId: uploaded.imageId,
        deleteUrl: uploaded.deleteUrl,
      };
    }

    await collection.updateOne(
      { key: "homepageHero" },
      {
        $set: {
          key: "homepageHero",
          slides,
          sideImage,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Homepage hero updated successfully",
    });
  } catch (error) {
    console.error("Update Home Hero Error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Failed to update homepage hero",
    });
  }
};

module.exports = {
  getHomeHero,
  updateHomeHero,
};