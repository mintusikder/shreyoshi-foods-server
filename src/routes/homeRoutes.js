const express = require("express");
const { getHomeHero, updateHomeHero } = require("../controllers/homeController");
const verifyAdmin = require("../middleware/verifyAdmin");
const upload = require("../middleware/upload");

const router = express.Router();

router.get("/hero", getHomeHero);
router.put(
  "/hero",
  verifyAdmin,
  upload.fields([
    { name: "slideImages", maxCount: 10 },
    { name: "sideImage", maxCount: 1 },
  ]),
  updateHomeHero
);

module.exports = router;
