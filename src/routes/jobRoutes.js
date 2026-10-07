const express = require("express");
const router = express.Router();
const {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  approveJob,
  rejectJob,
  suspendJob,
  toggleFeature,
  toggleStatus,
  updateContactVisibility,
} = require("../controllers/jobController");
const { protect, requirePermission } = require("../middleware/authMiddleware");
const upload = require("../utils/uploadMiddleware");

// Public routes (candidate app reads these)
router.get("/", getJobs);
router.get("/:id", getJobById);

// Protected routes
router.post(
  "/",
  protect,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "images", maxCount: 5 },
  ]),
  createJob
);
router.put(
  "/:id",
  protect,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "images", maxCount: 5 },
  ]),
  updateJob
);
router.delete("/:id", protect, deleteJob);

// ✅ Admin approval routes
router.post("/:id/approve", protect, approveJob);
router.post("/:id/reject", protect, rejectJob);
router.post("/:id/suspend", protect, suspendJob);   // ✅ NEW

// Admin management routes
router.patch("/:id/feature", protect, toggleFeature);
router.patch("/:id/status", protect, toggleStatus);
router.patch("/:id/visibility", protect, updateContactVisibility);

module.exports = router;