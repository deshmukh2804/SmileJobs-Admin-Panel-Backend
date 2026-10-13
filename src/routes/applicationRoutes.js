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
  downloadResume,
} = require("../controllers/applicationController");
const { authenticateAny } = require("../middleware/roleMiddleware");

// ═══════════════════════════════════════════════════════════════
// 🆕 PUBLIC ROUTES — NO AUTHENTICATION REQUIRED
// Must be declared BEFORE `router.use(authenticateAny)`.
// Browser <iframe>, <embed>, and direct links cannot send JWT headers,
// so these endpoints stream the PDF directly.
// ═══════════════════════════════════════════════════════════════
router.get("/resume/view/:userId", viewResume);
router.get("/resume/download/:userId", downloadResume);

// ═══════════════════════════════════════════════════════════════
// PROTECTED ROUTES (All routes below require Admin OR Recruiter JWT)
// ═══════════════════════════════════════════════════════════════
router.use(authenticateAny);

// GET all applications
router.get("/", getApplications);

// ✅ Export applications as CSV (MUST be before /:id to avoid route conflict)
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