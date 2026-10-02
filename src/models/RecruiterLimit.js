// FILE: backend/src/models/RecruiterLimit.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

const recruiterLimitSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    collection: "recruiter_usages", // ⚡ CORRECT COLLECTION NAME
    timestamps: true,
  }
);

module.exports =
  recruiterDbConnection.models.RecruiterLimit ||
  recruiterDbConnection.model("RecruiterLimit", recruiterLimitSchema);