const mongoose = require("mongoose");

const PricingAuditLogSchema = new mongoose.Schema(
  {
    actorName: { type: String, default: "Admin" },
    actorEmail: { type: String, default: "" },
    action: { type: String, default: "UPDATE_PRICE" },
    details: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PricingAuditLog", PricingAuditLogSchema);