// FILE: backend/src/routes/promoEmailRoutes.js
const express = require("express");
const router = express.Router();
const {
  getCampaigns,
  getCampaignById,
  createDraft,
  sendCampaign,
  sendNow,
  updateCampaign,
  deleteCampaign,
  checkSmtpHealth,
  getTemplates,
} = require("../controllers/promoEmailController");
const { authenticateAny, requireRecruiterOrAdmin } = require("../middleware/roleMiddleware");

// All routes require admin authentication
router.use(authenticateAny);
router.use(requireRecruiterOrAdmin);

// GET templates (predefined)
router.get("/templates", getTemplates);

// GET SMTP health
router.get("/smtp-health", checkSmtpHealth);

// GET all campaigns
router.get("/", getCampaigns);

// GET single campaign
router.get("/:id", getCampaignById);

// POST create draft
router.post("/draft", createDraft);

// POST send campaign immediately (create + send)
router.post("/send-now", sendNow);

// POST send existing campaign
router.post("/:id/send", sendCampaign);

// PUT update draft/scheduled campaign
router.put("/:id", updateCampaign);

// DELETE campaign
router.delete("/:id", deleteCampaign);

module.exports = router;