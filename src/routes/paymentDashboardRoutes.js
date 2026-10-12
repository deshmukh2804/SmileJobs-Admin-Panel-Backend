const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");

// Webhook or recruiter S2S Integration (No strict token required, or can use S2S key)
router.post("/service/transactions", paymentController.syncServiceTransaction);

// Admin dashboard routes
router.get("/stats", protect, paymentController.getStatsSummary);
router.get("/transactions", protect, paymentController.getTransactions);
router.post("/transactions/:id/refund", protect, paymentController.processRefund);

module.exports = router;