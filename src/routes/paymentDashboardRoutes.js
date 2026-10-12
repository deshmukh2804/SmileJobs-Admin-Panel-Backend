const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");

router.post("/service/transactions", paymentController.syncServiceTransaction);
router.get("/stats", protect, paymentController.getStatsSummary);
router.get("/transactions", protect, paymentController.getTransactions);

module.exports = router;