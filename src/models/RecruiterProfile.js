// FILE: backend/src/models/RecruiterProfile.js
// Lean read-only projection of recruiter documents (supports Google login without password)
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

// Loose schema - won't enforce password/validation since docs come from mobile app
const recruiterProfileSchema = new mongoose.Schema(
  {},
  { strict: false, collection: "recruiters", timestamps: true }
);

module.exports =
  recruiterDbConnection.models.RecruiterProfile ||
  recruiterDbConnection.model("RecruiterProfile", recruiterProfileSchema);