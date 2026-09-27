// FILE: backend/src/models/AuditLog.js
const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    // WHO performed the action (Optional for failed logins / anonymous attempts)
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      required: false, // ✅ FIXED: Must be false so failed login attempts can be logged
    },
    adminName: { type: String, default: "System / Anonymous" },
    adminEmail: { type: String, default: "unknown@system" },
    adminRole: { type: String, default: "None" },

    // WHAT action was performed
    action: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      default: "system",
    },

    // TARGET of the action
    targetType: {
      type: String,
      default: "",
    },
    targetId: {
      type: String,
      default: "",
    },
    targetName: {
      type: String,
      default: "",
    },

    // BEFORE / AFTER snapshot for diff tracking
    changesBefore: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    changesAfter: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Context
    description: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    endpoint: { type: String, default: "" },
    method: { type: String, default: "" },

    // Status
    status: {
      type: String,
      enum: ["success", "failed", "warning"],
      default: "success",
    },
    errorMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

auditLogSchema.index({ adminId: 1, createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);