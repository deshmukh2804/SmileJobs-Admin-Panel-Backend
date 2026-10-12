const express = require("express");
const router = express.Router();
const pricingController = require("../controllers/pricingController");
const { protect } = require("../middleware/authMiddleware");

router.get("/public/active", pricingController.getPublicPricing);
router.get("/settings", protect, pricingController.getPricingSettings);
router.put("/settings", protect, pricingController.updatePricingSettings);

module.exports = router;