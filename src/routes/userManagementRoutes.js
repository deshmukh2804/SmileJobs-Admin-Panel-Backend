// FILE: backend/src/routes/userManagementRoutes.js
const express = require("express");
const router = express.Router();
const {
  getCandidates,
  getCandidateById,
  toggleCandidateStatus,
  deleteCandidate,
  getRecruiters,
  getRecruiterById,
  toggleRecruiterStatus,
  deleteRecruiter,
  toggleRecruiterVerification,
} = require("../controllers/userManagementController");
const { authenticateAny, requireRecruiterOrAdmin } = require("../middleware/roleMiddleware");

// All routes require admin authentication
router.use(authenticateAny);
router.use(requireRecruiterOrAdmin);

// ── CANDIDATES ──
router.get("/candidates", getCandidates);
router.get("/candidates/:id", getCandidateById);
router.patch("/candidates/:id/toggle-status", toggleCandidateStatus);
router.delete("/candidates/:id", deleteCandidate);

// ── RECRUITERS ──
router.get("/recruiters", getRecruiters);
router.get("/recruiters/:id", getRecruiterById);
router.patch("/recruiters/:id/toggle-status", toggleRecruiterStatus);
router.patch("/recruiters/:id/toggle-verification", toggleRecruiterVerification);
router.delete("/recruiters/:id", deleteRecruiter);

module.exports = router;