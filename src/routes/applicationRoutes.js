// FILE: backend/src/routes/applicationRoutes.js
const express = require("express");
const router = express.Router();
const {
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  deleteApplication,
  getApplicationsByJob,
  getApplicationsByUser,
  bulkUpdateStatus,
  exportApplications,
  viewResume,
} = require("../controllers/applicationController");
const { authenticateAny } = require("../middleware/roleMiddleware");

// All routes require authentication (admin OR recruiter)
// ✅ FIX: Removed requireRecruiterOrAdmin — it was blocking admin panel tokens
// authenticateAny already verifies the JWT is valid for any user type
router.use(authenticateAny);

// GET all applications
router.get("/", getApplications);

// ✅ NEW: Export applications as CSV (MUST be before /:id to avoid route conflict)
router.get("/export", exportApplications);

// PATCH bulk update statuses
router.patch("/bulk-status", bulkUpdateStatus);

// GET applications by job
router.get("/job/:jobId", getApplicationsByJob);

// GET applications by user
router.get("/user/:userId", getApplicationsByUser);

// GET single application
router.get("/:id", getApplicationById);

// PATCH update application status
router.patch("/:id/status", updateApplicationStatus);

// DELETE application
router.delete("/:id", deleteApplication);

module.exports = router;

// ═══════════════════════════════════════════════════════════════
// RESUME VIEW ROUTER — Exported separately for mounting at
// /api/profile/resume in app.js (NO AUTH — public access for direct links)
// Mirrors the mobile backend's /api/profile/resume/view/:userId endpoint
// ═══════════════════════════════════════════════════════════════
const resumeRouter = express.Router();
resumeRouter.get("/view/:userId", viewResume);
module.exports.resumeRouter = resumeRouter;