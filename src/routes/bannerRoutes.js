const express = require("express");
const multer = require("multer");
const router = express.Router();
const bannerController = require("../controllers/bannerController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file format"));
    }
  },
});

// ✅ Support primary image + up to 4 additional + optional mobile image
const bannerUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "images", maxCount: 4 },
  { name: "mobileImage", maxCount: 1 },
]);

router.get("/", bannerController.getBanners);
router.get("/:id", bannerController.getBannerById);
router.post("/", bannerUpload, bannerController.createBanner);
router.put("/:id", bannerUpload, bannerController.updateBanner);
router.delete("/:id", bannerController.deleteBanner);
router.patch("/:id/toggle", bannerController.toggleStatus);
router.post("/reorder", bannerController.reorderBanners);
router.post("/bulk", bannerController.bulkAction);

module.exports = router;