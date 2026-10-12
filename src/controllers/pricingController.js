// ============================================================================
// SmileJobs — Candidate Profile Pricing Controller
// Path: backend/src/controllers/pricingController.js
// ============================================================================

const ProfilePricing = require("../models/ProfilePricing");
const PricingAuditLog = require("../models/PricingAuditLog");

// Mask secret for safe display: "rzp_••••••••••••••••cdef"
const maskSecret = (secret) => {
  if (!secret || typeof secret !== "string" || secret.length < 8) {
    return "••••••••••••••••";
  }
  const first = secret.substring(0, 4);
  const last = secret.substring(secret.length - 4);
  return `${first}${"•".repeat(16)}${last}`;
};

// Serialize config for safe API response (never return raw secret)
const serializePricing = (config) => {
  if (!config) return null;
  const obj = config.toObject ? config.toObject() : config;
  const hasSecret = !!(obj.razorpayKeySecret && obj.razorpayKeySecret.length > 0);
  return {
    _id: obj._id,
    enabled: obj.enabled,
    priceInPaise: obj.priceInPaise,
    priceInRupees: obj.priceInPaise / 100,
    currency: obj.currency,
    razorpayKeyId: obj.razorpayKeyId || "",
    razorpayKeySecretMasked: hasSecret ? maskSecret(obj.razorpayKeySecret) : "",
    hasKeySecret: hasSecret,
    razorpayMode: obj.razorpayMode,
    version: obj.version,
    updatedByName: obj.updatedByName,
    updatedByEmail: obj.updatedByEmail,
    updatedByRole: obj.updatedByRole,
    updatedAt: obj.updatedAt,
    createdAt: obj.createdAt,
  };
};

// GET /api/v1/pricing/settings — Admin only
exports.getPricingSettings = async (req, res) => {
  try {
    const config = await ProfilePricing.getActiveWithSecret();
    return res.status(200).json({
      success: true,
      config: serializePricing(config),
    });
  } catch (err) {
    console.error("[getPricingSettings] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pricing settings",
      error: err.message,
    });
  }
};

// PUT /api/v1/pricing/settings — Admin only
exports.updatePricingSettings = async (req, res) => {
  try {
    const {
      enabled,
      priceInPaise,
      currency,
      razorpayKeyId,
      razorpayKeySecret,
      razorpayMode,
    } = req.body;

    const config = await ProfilePricing.getActiveWithSecret();
    const before = {
      enabled: config.enabled,
      priceInPaise: config.priceInPaise,
      currency: config.currency,
      razorpayKeyId: config.razorpayKeyId,
      razorpayMode: config.razorpayMode,
      hasSecret: !!config.razorpayKeySecret,
    };

    const auditActions = [];

    // enabled toggle
    if (typeof enabled === "boolean" && enabled !== config.enabled) {
      auditActions.push(enabled ? "ENABLE_PRICING" : "DISABLE_PRICING");
      config.enabled = enabled;
    }

    // priceInPaise
    if (priceInPaise !== undefined && priceInPaise !== null) {
      const p = parseInt(priceInPaise, 10);
      if (isNaN(p) || p < 100 || p > 10000000) {
        return res.status(400).json({
          success: false,
          message: "Price must be an integer between 100 paise (₹1) and 10,000,000 paise (₹1,00,000)",
        });
      }
      if (p !== config.priceInPaise) {
        auditActions.push("UPDATE_PRICE");
        config.priceInPaise = p;
      }
    }

    // currency
    if (currency && ["INR", "USD"].includes(currency) && currency !== config.currency) {
      auditActions.push("UPDATE_CURRENCY");
      config.currency = currency;
    }

    // razorpayKeyId
    if (typeof razorpayKeyId === "string" && razorpayKeyId.trim() !== config.razorpayKeyId) {
      auditActions.push("UPDATE_RAZORPAY_KEY");
      config.razorpayKeyId = razorpayKeyId.trim();
    }

    // razorpayKeySecret (only if new value provided)
    if (typeof razorpayKeySecret === "string" && razorpayKeySecret.trim().length > 0) {
      auditActions.push("UPDATE_RAZORPAY_SECRET");
      config.razorpayKeySecret = razorpayKeySecret.trim();
    }

    // razorpayMode
    if (razorpayMode && ["test", "live"].includes(razorpayMode) && razorpayMode !== config.razorpayMode) {
      // Validate: if switching to live, both key id and secret must be present
      if (razorpayMode === "live") {
        const effectiveKeyId = (razorpayKeyId && razorpayKeyId.trim()) || config.razorpayKeyId;
        const effectiveSecret =
          (razorpayKeySecret && razorpayKeySecret.trim()) || config.razorpayKeySecret;
        if (!effectiveKeyId || !effectiveSecret) {
          return res.status(400).json({
            success: false,
            message: "Cannot switch to LIVE mode without both Razorpay Key ID and Key Secret.",
          });
        }
      }
      auditActions.push("UPDATE_RAZORPAY_MODE");
      config.razorpayMode = razorpayMode;
    }

    // No changes
    if (auditActions.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No changes detected",
        config: serializePricing(config),
      });
    }

    // Bump version & update metadata
    config.version = (config.version || 0) + 1;
    config.updatedBy = req.user?._id || req.user?.id || null;
    config.updatedByName = req.user?.name || "Admin";
    config.updatedByEmail = req.user?.email || "";
    config.updatedByRole = req.user?.role || "Admin";

    await config.save();

    // Write audit logs
    const after = {
      enabled: config.enabled,
      priceInPaise: config.priceInPaise,
      currency: config.currency,
      razorpayKeyId: config.razorpayKeyId,
      razorpayMode: config.razorpayMode,
      hasSecret: !!config.razorpayKeySecret,
    };

    for (const action of auditActions) {
      await PricingAuditLog.create({
        actorId: req.user?._id || req.user?.id || null,
        actorName: req.user?.name || "Admin",
        actorEmail: req.user?.email || "",
        actorRole: req.user?.role || "Admin",
        action,
        details: `${action} performed. Version bumped to ${config.version}.`,
        changesBefore: before,
        changesAfter: after,
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        status: "success",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Pricing settings updated successfully",
      config: serializePricing(config),
    });
  } catch (err) {
    console.error("[updatePricingSettings] Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update pricing settings",
    });
  }
};

// GET /api/v1/pricing/public/active — PUBLIC, no auth
exports.getPublicPricing = async (req, res) => {
  try {
    const config = await ProfilePricing.getActive();
    const priceDisplay =
      config.currency === "INR"
        ? `₹${(config.priceInPaise / 100).toFixed(2)}`
        : `$${(config.priceInPaise / 100).toFixed(2)}`;
    return res.status(200).json({
      success: true,
      enabled: config.enabled,
      priceInPaise: config.priceInPaise,
      priceInRupees: config.priceInPaise / 100,
      priceDisplay,
      currency: config.currency,
      razorpayKeyId: config.razorpayKeyId,
      razorpayMode: config.razorpayMode,
      version: config.version,
      updatedAt: config.updatedAt,
    });
  } catch (err) {
    console.error("[getPublicPricing] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch public pricing",
    });
  }
};

// GET /api/v1/pricing/audit-logs — Admin only
exports.getPricingAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      PricingAuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PricingAuditLog.countDocuments(),
    ]);

    return res.status(200).json({
      success: true,
      logs,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("[getPricingAuditLogs] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch audit logs",
    });
  }
};