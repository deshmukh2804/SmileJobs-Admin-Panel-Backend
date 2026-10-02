// FILE: backend/src/routes/billingRoutes.js
const express = require("express");
const router = express.Router();
const {
  getPayments,
  getSubscriptions,
  getRecruiterLimits,
  updateRecruiterLimits,
} = require("../controllers/billingController");
const { protect, checkRecruiterOrAdminPermission } = require("../middleware/authMiddleware");

// All billing metrics routes require admin auth + 'payments-and-billing' permission
router.use(protect);
router.use(checkRecruiterOrAdminPermission("payments-and-billing"));

router.get("/payments", getPayments);
router.get("/subscriptions", getSubscriptions);
router.get("/limits", getRecruiterLimits);
router.patch("/limits/:id", updateRecruiterLimits);

module.exports = router;