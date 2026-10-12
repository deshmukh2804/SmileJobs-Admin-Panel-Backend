// ============================================================================
// SmileJobs — Pricing & Payment Audit Trail
// Path: backend/src/models/PricingAuditLog.js
// ============================================================================

const mongoose = require("mongoose");

const PricingAuditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    actorName: { type: String, default: "System", trim: true },
    actorEmail: { type: String, default: "", trim: true, lowercase: true },
    actorRole: { type: String, default: "", trim: true },

    action: {
      type: String,
      required: true,
      enum: [
        "ENABLE_PRICING",
        "DISABLE_PRICING",
        "UPDATE_PRICE",
        "UPDATE_RAZORPAY_KEY",
        "UPDATE_RAZORPAY_SECRET",
        "UPDATE_RAZORPAY_MODE",
        "UPDATE_CURRENCY",
        "TRIGGER_REFUND",
        "GRANT_ACCESS",
        "REVOKE_ACCESS",
        "CREATE_PRICING",
      ],
      index: true,
    },

    details: { type: String, default: "", trim: true },

    changesBefore: { type: mongoose.Schema.Types.Mixed, default: null },
    changesAfter: { type: mongoose.Schema.Types.Mixed, default: null },

    targetId: { type: String, default: "", trim: true, index: true },

    ipAddress: { type: String, default: "", trim: true },
    userAgent: { type: String, default: "", trim: true },

    status: {
      type: String,
      enum: ["success", "failed"],
      default: "success",
      index: true,
    },
    errorMessage: { type: String, default: "", trim: true },
  },
  { timestamps: true, collection: "pricing_audit_logs" }
);

PricingAuditLogSchema.index({ createdAt: -1 });
PricingAuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports =
  mongoose.models.PricingAuditLog ||
  mongoose.model("PricingAuditLog", PricingAuditLogSchema);