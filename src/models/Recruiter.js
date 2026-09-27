// FILE: backend/src/models/Recruiter.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { recruiterDbConnection } = require("../config/db");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false }
);

const recruiterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Recruiter name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    mobileNumber: {
      type: String,
      trim: true,
    },
    whatsappNumber: {
      type: String,
      trim: true,
    },
    profileImage: imageSchema,
    designation: {
      type: String,
      trim: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
    },
    companyName: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      default: "recruiter",
    },
    whatsappContactEnabled: {
      type: Boolean,
      default: false,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

recruiterSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

recruiterSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = recruiterDbConnection.model("Recruiter", recruiterSchema);