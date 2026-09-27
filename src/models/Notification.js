// FILE: backend/src/models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // Who sent it
    sentBy: {
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true,
      },
      adminName: { type: String, required: true },
      adminEmail: { type: String, required: true },
    },

    // Notification content
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: [true, "Notification body is required"],
      trim: true,
      maxlength: 1000,
    },
    imageUrl: {
      type: String,
      trim: true,
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

    // Filters for targeted notifications
    filters: {
      city: String,
      state: String,
      experienceLevel: String,
      skills: [String],
      industry: String,
    },

    // Delivery channels (only in-app + email, NO push)
    channels: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
    },

    // Notification type
    type: {
      type: String,
      enum: [
        "general",
        "job_alert",
        "promotion",
        "system",
        "reminder",
        "update",
      ],
      default: "general",
    },

    // Action URL (deep link for mobile app)
    actionUrl: {
      type: String,
      trim: true,
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

    // Delivery stats (in-app + email only)
    stats: {
      totalTargeted: { type: Number, default: 0 },
      inAppDelivered: { type: Number, default: 0 },
      emailSent: { type: Number, default: 0 },
      emailFailed: { type: Number, default: 0 },
    },

    // Error tracking
    errorLog: [
      {
        channel: String,
        error: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for fast querying by mobile app
notificationSchema.index({ status: 1, createdAt: -1 });
notificationSchema.index({ targetAudience: 1 });
notificationSchema.index({ targetUserIds: 1 });
notificationSchema.index({ "sentBy.adminId": 1 });
notificationSchema.index({ scheduledAt: 1, status: 1 });

module.exports = mongoose.model("Notification", notificationSchema);