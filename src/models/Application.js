// FILE: backend/src/models/Application.js
const mongoose = require("mongoose");

const milestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    time: { type: String },
    completed: { type: Boolean, default: false },
    statusText: { type: String, default: "" },
    isHighlight: { type: Boolean, default: false },
  },
  { _id: true }
);

const applicationSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    candidateName: { type: String, required: true, trim: true },
    candidatePhone: { type: String, trim: true },
    candidateEmail: { type: String, trim: true, lowercase: true },
    candidateCity: { type: String, trim: true },
    candidateSubLocation: { type: String, trim: true },
    candidateAvatarUrl: { type: String },
    resumeUrl: { type: String },
    resumeFileName: { type: String },
    candidateSkills: [String],
    candidateLanguages: [String],
    candidateEnglishLevel: { type: String },
    candidateExperience: { type: String },
    candidateExperienceLevel: { type: String },
    candidateJobTitle: { type: String },
    candidateCurrentCompany: { type: String },
    candidateCurrentSalary: { type: String },
    candidateEducation: {
      collegeName: String,
      degree: String,
      specialization: String,
      endYear: String,
    },
    candidateAssets: [String],
    candidateCertifications: [String],

    jobTitle: { type: String, required: true },
    jobCompany: { type: String },
    jobCompanyLogo: { type: String },
    jobSalary: { type: String },
    jobLocation: { type: String },
    jobHrName: { type: String },
    jobHrRole: { type: String },
    jobHrPhone: { type: String },
    jobHrWhatsapp: { type: String },

    matchPercentage: { type: Number, default: 0 },
    coverNote: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "Applied",
        "Viewed",
        "Shortlisted",
        "Interview",
        "Offered",
        "Hired",
        "Rejected",
        "Withdrawn",
      ],
      default: "Applied",
      index: true,
    },
    category: {
      type: String,
      enum: ["pending", "shortlisted", "rejected", "hired"],
      default: "pending",
    },
    hrNotes: { type: String, default: "" },

    milestones: [milestoneSchema],

    appliedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

applicationSchema.index({ jobId: 1, userId: 1 }, { unique: true });
applicationSchema.index({ status: 1, appliedAt: -1 });

module.exports = mongoose.model("Application", applicationSchema);