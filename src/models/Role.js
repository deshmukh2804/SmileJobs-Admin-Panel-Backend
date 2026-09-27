// FILE: backend/src/models/Role.js
const mongoose = require("mongoose");

// All available sections/permissions in the system
const AVAILABLE_PERMISSIONS = [
  "dashboard",
  "users",
  "jobs",
  "applications",
  "resumes-and-profiles",
  "verification",
  "payments-and-billing",
  "reports-and-complaints",
  "content-management",
  "banners",
  "notifications",
  "roles-and-permissions",
  "platform-settings",
  "admin-activity-log",
];

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Role name is required"],
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: function (perms) {
          return perms.every((p) => AVAILABLE_PERMISSIONS.includes(p));
        },
        message: "Invalid permission provided",
      },
    },
    isSystem: {
      type: Boolean,
      default: false, // System roles like "Super Admin" cannot be deleted
    },
    color: {
      type: String,
      default: "#6750A4",
    },
    icon: {
      type: String,
      default: "shield",
    },
    landingPage: {
      type: String,
      default: "dashboard",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

roleSchema.statics.AVAILABLE_PERMISSIONS = AVAILABLE_PERMISSIONS;

module.exports = mongoose.model("Role", roleSchema);
module.exports.AVAILABLE_PERMISSIONS = AVAILABLE_PERMISSIONS;