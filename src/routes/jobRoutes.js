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
  toggleFeature,
  toggleStatus,
  updateContactVisibility,
} = require("../controllers/jobController");
const {
  authenticateAny,
  optionalAuth,
  requireAdmin,
  requireRecruiterOrAdmin,
} = require("../middleware/roleMiddleware");
const { uploadCompanyFiles } = require("../utils/uploadMiddleware");

// Public/Any with optional auth
router.get("/", optionalAuth, getJobs);
router.get("/:id", optionalAuth, getJobById);

// Auth required — Cloudinary upload support attached
router.post("/", authenticateAny, requireRecruiterOrAdmin, uploadCompanyFiles, createJob);
router.put("/:id", authenticateAny, requireRecruiterOrAdmin, uploadCompanyFiles, updateJob);
router.delete("/:id", authenticateAny, requireRecruiterOrAdmin, deleteJob);

// Admin actions
router.patch("/:id/approve", authenticateAny, requireAdmin, approveJob);
router.patch("/:id/reject", authenticateAny, requireAdmin, rejectJob);
router.patch("/:id/toggle-feature", authenticateAny, requireAdmin, toggleFeature);
router.patch("/:id/toggle-status", authenticateAny, requireRecruiterOrAdmin, toggleStatus);

// Contact visibility (recruiter/admin)
router.patch(
  "/:id/contact-visibility",
  authenticateAny,
  requireRecruiterOrAdmin,
  updateContactVisibility
);

module.exports = router;