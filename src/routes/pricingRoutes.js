// ============================================================================
// SmileJobs — Pricing Routes
// Path: backend/src/routes/pricingRoutes.js
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const pricingController = require("../controllers/pricingController");

// Public — recruiter website fetches active price
router.get("/public/active", pricingController.getPublicPricing);

// Admin only
router.get("/settings", protect, pricingController.getPricingSettings);
router.put("/settings", protect, pricingController.updatePricingSettings);
router.get("/audit-logs", protect, pricingController.getPricingAuditLogs);

module.exports = router;