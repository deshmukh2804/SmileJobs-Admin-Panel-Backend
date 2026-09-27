// FILE: backend/src/routes/authRoutes.js
const express = require("express");
const router = express.Router();
const {
  login,
  logout,
  getMe,
  streamAdminEvents,
  getAllAdmins,
  createAdmin,
  updateAdmin,
  toggleAdminStatus,
  resetAdminPassword,
  deleteAdmin,
  getAuditLogs,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

// Public Auth Endpoints
router.post("/login", login);

// ⚡ Real-Time Live Push Stream (Instant Logout Event Channel)
router.get("/stream", streamAdminEvents);

// Protected User Profile
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

// Admin Management
router.get("/admins", protect, getAllAdmins);
router.post("/admins", protect, createAdmin);
router.put("/admins/:id", protect, updateAdmin);
router.patch("/admins/:id/toggle", protect, toggleAdminStatus);
router.patch("/admins/:id/reset-password", protect, resetAdminPassword);
router.delete("/admins/:id", protect, deleteAdmin);

// Audit Trail
router.get("/audit-logs", protect, getAuditLogs);

module.exports = router;