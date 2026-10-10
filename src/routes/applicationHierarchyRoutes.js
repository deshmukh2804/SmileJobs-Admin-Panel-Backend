// FILE: backend/src/routes/applicationHierarchyRoutes.js
const express = require("express");
const router = express.Router();
const {
  getCompaniesWithStats,
  getJobsByCompany,
  getRecruiterJobsWithStats,
  getRecruiterJobApplications,
} = require("../controllers/applicationHierarchyController"); // Casing matches your file exactly now
const {
  authenticateAny,
  requireAdmin,
  requireRecruiter,
} = require("../middleware/roleMiddleware");

// All hierarchy routes require authentication
router.use(authenticateAny);

// ═══ ADMIN ROUTES ═══
router.get("/companies", requireAdmin, getCompaniesWithStats);
router.get("/companies/:companyId/jobs", requireAdmin, getJobsByCompany);

// ═══ RECRUITER ROUTES ═══
router.get("/recruiter/jobs", requireRecruiter, getRecruiterJobsWithStats);
router.get(
  "/recruiter/jobs/:jobId/applications",
  requireRecruiter,
  getRecruiterJobApplications
);

module.exports = router;