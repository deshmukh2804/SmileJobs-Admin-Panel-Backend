// ============================================================================
// SmileJobs — Payment Dashboard Routes
// Path: backend/src/routes/paymentDashboardRoutes.js
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { requireServiceAuth } = require("../middleware/serviceAuth");
const paymentController = require("../controllers/paymentController");

// Service-to-Service: Recruiter website pushes transaction
router.post("/service/transactions", requireServiceAuth, paymentController.syncServiceTransaction);

// Admin only
router.get("/stats", protect, paymentController.getStatsSummary);
router.get("/transactions", protect, paymentController.getTransactions);
router.post("/transactions/:id/refund", protect, paymentController.processRefund);

module.exports = router;