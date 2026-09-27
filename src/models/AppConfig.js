const mongoose = require("mongoose");

const mobileBottomNavItemSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ["home", "allJobs", "activity", "premium", "profile"],
    },
    label: { type: String, required: true },
    icon: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const mobileNavSizeSchema = new mongoose.Schema(
  {
    barHeight: { type: Number, default: 60, min: 40, max: 120 },
    iconSize: { type: Number, default: 24, min: 14, max: 48 },
    fontSize: { type: Number, default: 11, min: 8, max: 20 },
    borderRadius: { type: Number, default: 0, min: 0, max: 40 },
    horizontalPadding: { type: Number, default: 8, min: 0, max: 32 },
    iconLabelGap: { type: Number, default: 4, min: 0, max: 16 },
  },
  { _id: false }
);

const mobileNavColorSchema = new mongoose.Schema(
  {
    backgroundColor: { type: String, default: "#FFFFFF" },
    activeColor: { type: String, default: "#4F46E5" },
    inactiveColor: { type: String, default: "#9CA3AF" },
    badgeColor: { type: String, default: "#EF4444" },
    shadowColor: { type: String, default: "#000000" },
    shadowOpacity: { type: Number, default: 0.1, min: 0, max: 1 },
  },
  { _id: false }
);

const appConfigSchema = new mongoose.Schema(
  {
    configType: {
      type: String,
      required: true,
      unique: true,
      enum: ["mobileBottomNav"],
    },
    bottomNav: {
      items: {
        type: [mobileBottomNavItemSchema],
        default: [
          { key: "home", label: "Home", icon: "Home", enabled: true, order: 1 },
          { key: "allJobs", label: "All Jobs", icon: "Briefcase", enabled: true, order: 2 },
          { key: "activity", label: "Activity", icon: "Activity", enabled: true, order: 3 },
          { key: "premium", label: "Premium", icon: "Crown", enabled: true, order: 4 },
          { key: "profile", label: "Profile", icon: "User", enabled: true, order: 5 },
        ],
      },
      size: {
        type: mobileNavSizeSchema,
        default: () => ({}),
      },
      colors: {
        type: mobileNavColorSchema,
        default: () => ({}),
      },
      isVisible: { type: Boolean, default: true },
      showLabels: { type: Boolean, default: true },
      showBadges: { type: Boolean, default: true },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppConfig", appConfigSchema);