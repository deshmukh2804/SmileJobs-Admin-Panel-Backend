const express = require("express");
const router = express.Router();
const {
  getMobileBottomNav,
  getAdminBottomNavConfig,
  updateBottomNavConfig,
  resetBottomNavConfig,
} = require("../controllers/appConfigController");

// ── Try to load auth middleware (graceful fallback) ──
let protect = (req, res, next) => next();
try {
  const authMiddleware = require("../middleware/authMiddleware");
  protect = authMiddleware.protect || authMiddleware.authenticate || protect;
} catch {
  console.warn("⚠️  authMiddleware not found — app-config admin routes are unprotected");
}

// ═══════════════════════════════════════════════════════════
// PUBLIC — Mobile app calls this to render its bottom nav
// ═══════════════════════════════════════════════════════════
router.get("/bottom-nav", getMobileBottomNav);

// ═══════════════════════════════════════════════════════════
// ADMIN — Full config with disabled items
// ═══════════════════════════════════════════════════════════
router.get("/bottom-nav/admin", protect, getAdminBottomNavConfig);

// ═══════════════════════════════════════════════════════════
// ADMIN — Update config
// ═══════════════════════════════════════════════════════════
router.put("/bottom-nav", protect, updateBottomNavConfig);

// ═══════════════════════════════════════════════════════════
// ADMIN — Reset to defaults
// ═══════════════════════════════════════════════════════════
router.post("/bottom-nav/reset", protect, resetBottomNavConfig);

module.exports = router;