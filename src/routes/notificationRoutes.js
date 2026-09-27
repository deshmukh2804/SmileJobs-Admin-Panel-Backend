// FILE: backend/src/routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const {
  getNotifications,
  getNotificationById,
  getMyNotifications,
  getUnreadCount,
  sendNotification,
  getTargetCount,
  deleteNotification,
  cancelNotification,
} = require("../controllers/notificationController");
const { authenticateAny, requireRecruiterOrAdmin } = require("../middleware/roleMiddleware");

// ═══════════════════════════════════════════════════════════════
// 📱 MOBILE APP ROUTES (user authentication)
// These are called by the mobile app to fetch notifications from DB
// ═══════════════════════════════════════════════════════════════
router.get("/user/my-notifications", authenticateAny, getMyNotifications);
router.get("/user/unread-count", authenticateAny, getUnreadCount);

// ═══════════════════════════════════════════════════════════════
// 🔧 ADMIN PANEL ROUTES (admin authentication)
// ═══════════════════════════════════════════════════════════════
router.get("/", authenticateAny, requireRecruiterOrAdmin, getNotifications);
router.get("/:id", authenticateAny, requireRecruiterOrAdmin, getNotificationById);
router.post("/send", authenticateAny, requireRecruiterOrAdmin, sendNotification);
router.post("/preview-count", authenticateAny, requireRecruiterOrAdmin, getTargetCount);
router.patch("/:id/cancel", authenticateAny, requireRecruiterOrAdmin, cancelNotification);
router.delete("/:id", authenticateAny, requireRecruiterOrAdmin, deleteNotification);

module.exports = router;