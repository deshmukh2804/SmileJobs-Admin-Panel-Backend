// FILE: backend/src/models/PromotionalEmail.js
const mongoose = require("mongoose");

const promotionalEmailSchema = new mongoose.Schema(
  {
    // Campaign info
    campaignName: {
      type: String,
      required: [true, "Campaign name is required"],
      trim: true,
    },
    subject: {
      type: String,
      required: [true, "Email subject is required"],
      trim: true,
      maxlength: 200,
    },
    previewText: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    // Email content (HTML)
    htmlContent: {
      type: String,
      required: [true, "Email HTML content is required"],
    },

    // Template type
    templateType: {
      type: String,
      enum: [
        "promotion",
        "newsletter",
        "job_alert",
        "feature_update",
        "event",
        "custom",
      ],
      default: "promotion",
    },

    // Targeting
    targetAudience: {
      type: String,
      enum: ["all", "candidates", "recruiters", "specific"],
      default: "all",
    },
    targetUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],

    // Filters
    filters: {
      city: String,
      state: String,
      experienceLevel: String,
      skills: [String],
      industry: String,
      registeredAfter: Date,
      registeredBefore: Date,
    },

    // Sent by
    sentBy: {
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true,
      },
      adminName: { type: String, required: true },
      adminEmail: { type: String, required: true },
    },

    // Scheduling
    scheduledAt: {
      type: Date,
    },
    sentAt: {
      type: Date,
    },

    // Status
    status: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "failed", "cancelled"],
      default: "draft",
    },

    // Delivery stats
    stats: {
      totalRecipients: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
    },

    // Error log
    errors: [
      {
        email: String,
        error: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

promotionalEmailSchema.index({ status: 1, createdAt: -1 });
promotionalEmailSchema.index({ "sentBy.adminId": 1 });
promotionalEmailSchema.index({ scheduledAt: 1, status: 1 });

module.exports = mongoose.model("PromotionalEmail", promotionalEmailSchema);