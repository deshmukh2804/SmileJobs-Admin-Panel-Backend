const AppConfig = require("../models/AppConfig");

// ──────────────────────────────────────────────────────────────
// DEFAULT CONFIG (used for seeding & reset)
// ──────────────────────────────────────────────────────────────
const DEFAULT_BOTTOM_NAV = {
  items: [
    { key: "home", label: "Home", icon: "Home", enabled: true, order: 1 },
    { key: "allJobs", label: "All Jobs", icon: "Briefcase", enabled: true, order: 2 },
    { key: "activity", label: "Activity", icon: "Activity", enabled: true, order: 3 },
    { key: "premium", label: "Premium", icon: "Crown", enabled: true, order: 4 },
    { key: "profile", label: "Profile", icon: "User", enabled: true, order: 5 },
  ],
  size: {
    barHeight: 60,
    iconSize: 24,
    fontSize: 11,
    borderRadius: 0,
    horizontalPadding: 8,
    iconLabelGap: 4,
  },
  colors: {
    backgroundColor: "#FFFFFF",
    activeColor: "#4F46E5",
    inactiveColor: "#9CA3AF",
    badgeColor: "#EF4444",
    shadowColor: "#000000",
    shadowOpacity: 0.1,
  },
  isVisible: true,
  showLabels: true,
  showBadges: true,
};

// ──────────────────────────────────────────────────────────────
// GET — Public endpoint for mobile app (no auth required)
// ──────────────────────────────────────────────────────────────
exports.getMobileBottomNav = async (req, res) => {
  try {
    let config = await AppConfig.findOne({ configType: "mobileBottomNav" });

    if (!config) {
      // Auto-seed on first access
      config = await AppConfig.create({
        configType: "mobileBottomNav",
        bottomNav: DEFAULT_BOTTOM_NAV,
      });
    }

    // Return only enabled items sorted by order for the mobile app
    const enabledItems = config.bottomNav.items
      .filter((item) => item.enabled)
      .sort((a, b) => a.order - b.order)
      .map(({ key, label, icon, order }) => ({ key, label, icon, order }));

    res.status(200).json({
      success: true,
      data: {
        isVisible: config.bottomNav.isVisible,
        showLabels: config.bottomNav.showLabels,
        showBadges: config.bottomNav.showBadges,
        items: enabledItems,
        size: config.bottomNav.size,
        colors: config.bottomNav.colors,
      },
    });
  } catch (err) {
    console.error("getMobileBottomNav error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch bottom nav config" });
  }
};

// ──────────────────────────────────────────────────────────────
// GET — Admin endpoint (full config including disabled items)
// ──────────────────────────────────────────────────────────────
exports.getAdminBottomNavConfig = async (req, res) => {
  try {
    let config = await AppConfig.findOne({ configType: "mobileBottomNav" });

    if (!config) {
      config = await AppConfig.create({
        configType: "mobileBottomNav",
        bottomNav: DEFAULT_BOTTOM_NAV,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        bottomNav: config.bottomNav,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      },
    });
  } catch (err) {
    console.error("getAdminBottomNavConfig error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch admin config" });
  }
};

// ──────────────────────────────────────────────────────────────
// PUT — Update bottom nav config (admin only)
// ──────────────────────────────────────────────────────────────
exports.updateBottomNavConfig = async (req, res) => {
  try {
    const { items, size, colors, isVisible, showLabels, showBadges } = req.body;

    const updatePayload = {};

    if (Array.isArray(items)) {
      // Validate each item
      const validKeys = ["home", "allJobs", "activity", "premium", "profile"];
      for (const item of items) {
        if (!validKeys.includes(item.key)) {
          return res.status(400).json({
            success: false,
            message: `Invalid nav item key: ${item.key}. Allowed: ${validKeys.join(", ")}`,
          });
        }
      }
      updatePayload["bottomNav.items"] = items;
    }

    if (size && typeof size === "object") {
      // Validate size ranges
      const sizeFields = {
        barHeight: [40, 120],
        iconSize: [14, 48],
        fontSize: [8, 20],
        borderRadius: [0, 40],
        horizontalPadding: [0, 32],
        iconLabelGap: [0, 16],
      };
      for (const [field, [min, max]] of Object.entries(sizeFields)) {
        if (size[field] !== undefined) {
          const val = Number(size[field]);
          if (isNaN(val) || val < min || val > max) {
            return res.status(400).json({
              success: false,
              message: `${field} must be between ${min} and ${max}`,
            });
          }
          updatePayload[`bottomNav.size.${field}`] = val;
        }
      }
    }

    if (colors && typeof colors === "object") {
      const colorFields = [
        "backgroundColor",
        "activeColor",
        "inactiveColor",
        "badgeColor",
        "shadowColor",
      ];
      for (const field of colorFields) {
        if (colors[field] !== undefined) {
          updatePayload[`bottomNav.colors.${field}`] = colors[field];
        }
      }
      if (colors.shadowOpacity !== undefined) {
        const val = Number(colors.shadowOpacity);
        if (!isNaN(val) && val >= 0 && val <= 1) {
          updatePayload["bottomNav.colors.shadowOpacity"] = val;
        }
      }
    }

    if (typeof isVisible === "boolean") updatePayload["bottomNav.isVisible"] = isVisible;
    if (typeof showLabels === "boolean") updatePayload["bottomNav.showLabels"] = showLabels;
    if (typeof showBadges === "boolean") updatePayload["bottomNav.showBadges"] = showBadges;

    updatePayload.updatedBy = req.admin?._id || req.user?._id || null;

    const config = await AppConfig.findOneAndUpdate(
      { configType: "mobileBottomNav" },
      { $set: updatePayload },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Bottom navigation config updated successfully",
      data: { bottomNav: config.bottomNav, updatedAt: config.updatedAt },
    });
  } catch (err) {
    console.error("updateBottomNavConfig error:", err);
    res.status(500).json({ success: false, message: "Failed to update config" });
  }
};

// ──────────────────────────────────────────────────────────────
// POST — Reset to defaults (admin only)
// ──────────────────────────────────────────────────────────────
exports.resetBottomNavConfig = async (req, res) => {
  try {
    const config = await AppConfig.findOneAndUpdate(
      { configType: "mobileBottomNav" },
      {
        $set: {
          bottomNav: DEFAULT_BOTTOM_NAV,
          updatedBy: req.admin?._id || req.user?._id || null,
        },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Bottom navigation config reset to defaults",
      data: { bottomNav: config.bottomNav },
    });
  } catch (err) {
    console.error("resetBottomNavConfig error:", err);
    res.status(500).json({ success: false, message: "Failed to reset config" });
  }
};