const express = require("express");
const router = express.Router();
const {
  requestWhatsAppContact,
  getWhatsAppStatus,
  getWhatsAppContact,
  getRecruiterWhatsAppRequests,
  approveWhatsAppRequest,
  rejectWhatsAppRequest,
  revokeWhatsAppRequest,
  updateWhatsAppSettings,
  getRecruiterDashboard,
} = require("../controllers/whatsappController");
const {
  authenticateAny,
  requireUser,
  requireRecruiterOrAdmin,
} = require("../middleware/roleMiddleware");

// User APIs
router.post(
  "/jobs/:jobId/whatsapp/request",
  authenticateAny,
  requireUser,
  requestWhatsAppContact
);
router.get(
  "/jobs/:jobId/whatsapp/status",
  authenticateAny,
  requireUser,
  getWhatsAppStatus
);
router.get(
  "/jobs/:jobId/whatsapp/contact",
  authenticateAny,
  requireUser,
  getWhatsAppContact
);

// Recruiter/Admin APIs
router.get(
  "/recruiter/whatsapp/requests",
  authenticateAny,
  requireRecruiterOrAdmin,
  getRecruiterWhatsAppRequests
);
router.patch(
  "/recruiter/whatsapp/requests/:requestId/approve",
  authenticateAny,
  requireRecruiterOrAdmin,
  approveWhatsAppRequest
);
router.patch(
  "/recruiter/whatsapp/requests/:requestId/reject",
  authenticateAny,
  requireRecruiterOrAdmin,
  rejectWhatsAppRequest
);
router.patch(
  "/recruiter/whatsapp/requests/:requestId/revoke",
  authenticateAny,
  requireRecruiterOrAdmin,
  revokeWhatsAppRequest
);
router.patch(
  "/recruiter/whatsapp-settings",
  authenticateAny,
  requireRecruiterOrAdmin,
  updateWhatsAppSettings
);

// Dashboard
router.get(
  "/recruiter/dashboard",
  authenticateAny,
  requireRecruiterOrAdmin,
  getRecruiterDashboard
);

module.exports = router;