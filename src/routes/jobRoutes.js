// FILE: backend/src/routes/jobRoutes.js
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
  getJobStats,
} = require("../controllers/jobController");
const { protect, requirePermission } = require("../middleware/authMiddleware");
const upload = require("../utils/uploadMiddleware");

// Stats route (Must come before /:id parameter route)
router.get("/stats", protect, getJobStats);

// Public routes (Candidates and public feed)
router.get("/", getJobs);
router.get("/:id", getJobById);

// Job Creation (Supports multipart logo and gallery uploads)
router.post(
  "/",
  protect,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  createJob
);

// Job Update
router.put(
  "/:id",
  protect,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  updateJob
);

// Job Deletion
router.delete("/:id", protect, deleteJob);

// Admin Approval Routes (Supports both POST & PATCH to guarantee frontend compatibility)
router.post("/:id/approve", protect, approveJob);
router.patch("/:id/approve", protect, approveJob);

router.post("/:id/reject", protect, rejectJob);
router.patch("/:id/reject", protect, rejectJob);

router.post("/:id/suspend", protect, suspendJob);
router.patch("/:id/suspend", protect, suspendJob);

// Admin Action Toggles
router.patch("/:id/feature", protect, toggleFeature);
router.patch("/:id/toggle-feature", protect, toggleFeature);

router.patch("/:id/status", protect, toggleStatus);
router.patch("/:id/toggle-status", protect, toggleStatus);

router.patch("/:id/visibility", protect, updateContactVisibility);
router.patch("/:id/contact-visibility", protect, updateContactVisibility);

module.exports = router;