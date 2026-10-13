// FILE: backend/src/routes/paymentDashboardRoutes.js
const express = require("express");
const router = express.Router();
const paymentDashboardController = require("../controllers/paymentDashboardController");
const { protect } = require("../middleware/authMiddleware");

// ─── Service-to-Service Sync (No Auth - for webhook from recruiter service) ───
router.post("/service/transactions", paymentDashboardController.syncServiceTransaction);
router.post("/service/sync", paymentDashboardController.syncServiceTransaction);

// ─── Admin Dashboard Endpoints (Protected - All Admins) ───
router.get("/stats", protect, paymentDashboardController.getStatsSummary);
router.get("/transactions", protect, paymentDashboardController.getTransactions);
router.get("/transactions/:id", protect, paymentDashboardController.getTransactionById);
router.post("/transactions/:id/refund", protect, paymentDashboardController.refundTransaction);
router.get("/credits", protect, paymentDashboardController.getRecruiterCredits);

module.exports = router;