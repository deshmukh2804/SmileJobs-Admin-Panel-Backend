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
} = require("../controllers/applicationController");
const { authenticateAny, requireRecruiterOrAdmin } = require("../middleware/roleMiddleware");

// All routes require admin authentication
router.use(authenticateAny);
router.use(requireRecruiterOrAdmin);

// GET all applications
router.get("/", getApplications);

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