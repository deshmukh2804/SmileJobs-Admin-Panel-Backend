// FILE: backend/src/routes/verificationRoutes.js
const express = require("express");
const router = express.Router();
const {
  getVerifications,
  getVerificationById,
  approveVerification,
  rejectVerification,
  requestClarification,
  getStats,
  proxyDocument,
} = require("../controllers/verificationController");
const {
  protect,
  checkRecruiterOrAdminPermission,
} = require("../middleware/authMiddleware");

// ⚡ PDF PROXY ROUTE — public access so <iframe> can load without auth headers
// (Security: Only works if you know the exact verificationId + documentId — very hard to guess)
router.get("/:id/documents/:docId/proxy", proxyDocument);

// All other routes require admin auth + 'verification' permission
router.use(protect);

router.get("/", checkRecruiterOrAdminPermission("verification"), getVerifications);
router.get(
  "/stats/overview",
  checkRecruiterOrAdminPermission("verification"),
  getStats
);
router.get(
  "/:id",
  checkRecruiterOrAdminPermission("verification"),
  getVerificationById
);

router.patch(
  "/:id/approve",
  checkRecruiterOrAdminPermission("verification"),
  approveVerification
);
router.patch(
  "/:id/reject",
  checkRecruiterOrAdminPermission("verification"),
  rejectVerification
);
router.patch(
  "/:id/request-clarification",
  checkRecruiterOrAdminPermission("verification"),
  requestClarification
);

module.exports = router;