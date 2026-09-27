// FILE: backend/src/models/Admin.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      default: "Super Admin", // Flexible role string
      trim: true,
    },
    department: {
      type: String,
      default: "Executive Leadership",
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    avatarUrl: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIP: {
      type: String,
      default: "",
    },
    lastLoginUserAgent: {
      type: String,
      default: "",
    },
    loginCount: {
      type: Number,
      default: 0,
    },
    disabledReason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before save
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
adminSchema.methods.comparePassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("Admin", adminSchema);