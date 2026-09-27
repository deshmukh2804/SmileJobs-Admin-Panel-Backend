const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Banner title is required"],
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: [200, "Subtitle cannot exceed 200 characters"],
      default: "",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
      default: "",
    },

    // ✅ PRIMARY IMAGE (first / cover)
    image: {
      url: { type: String, required: [true, "Banner image is required"] },
      publicId: { type: String, required: true },
    },

    // ✅ ADDITIONAL IMAGES (up to 4 more → total 5)
    images: {
      type: [imageSchema],
      default: [],
      validate: {
        validator: function (arr) {
          return arr.length <= 4;
        },
        message: "Cannot have more than 4 additional images (5 total with primary)",
      },
    },

    // ✅ MOBILE IMAGE (optional separate image for mobile devices)
    mobileImage: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    linkUrl: { type: String, trim: true, default: "" },
    linkType: {
      type: String,
      enum: ["external", "internal", "deep_link", "none"],
      default: "external",
    },
    ctaLabel: {
      type: String,
      trim: true,
      maxlength: [30, "CTA label cannot exceed 30 characters"],
      default: "Learn More",
    },
    openInNewTab: { type: Boolean, default: true },
    priority: { type: Number, default: 1, min: 1, max: 100 },
    slot: { type: Number, min: 1, max: 5, default: 1 },
    platform: {
      type: [String],
      enum: ["web", "mobile", "both"],
      default: ["both"],
    },
    targetAudience: {
      type: String,
      enum: ["all", "candidates", "recruiters", "premium", "new_users"],
      default: "all",
    },
    placement: {
      type: String,
      enum: [
        "home_hero",
        "home_middle",
        "job_listing_top",
        "job_listing_sidebar",
        "profile_page",
        "app_splash",
        "notification_popup",
      ],
      default: "home_hero",
    },
    category: {
      type: String,
      enum: [
        "promotional",
        "campus_drive",
        "hackathon",
        "premium_upgrade",
        "new_feature",
        "partner_spotlight",
        "seasonal",
        "announcement",
      ],
      default: "promotional",
    },
    tags: [{ type: String, trim: true }],
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["draft", "scheduled", "live", "paused", "expired", "archived"],
      default: "draft",
    },
    isActive: { type: Boolean, default: true },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    lastClickedAt: { type: Date, default: null },
    variant: {
      type: String,
      enum: ["A", "B", "control", "none"],
      default: "none",
    },
    experimentId: { type: String, default: "" },
    backgroundColor: { type: String, default: "#6750A4" },
    textColor: { type: String, default: "#FFFFFF" },
    overlayOpacity: { type: Number, default: 0.3, min: 0, max: 1 },
    notes: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

bannerSchema.index({ placement: 1, slot: 1 });

bannerSchema.virtual("ctr").get(function () {
  if (!this.impressions || this.impressions === 0) return 0;
  return parseFloat(((this.clicks / this.impressions) * 100).toFixed(2));
});

bannerSchema.virtual("daysRemaining").get(function () {
  if (!this.endDate) return null;
  const diff = new Date(this.endDate) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

bannerSchema.virtual("totalImages").get(function () {
  return 1 + (this.images?.length || 0);
});

module.exports = mongoose.model("Banner", bannerSchema);