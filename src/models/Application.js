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

// ═══════════════════════════════════════════════════════════════
// DYNAMIC MULTI-CONNECTION ROUTER
// Automatically locates the connection pointing to "Job_db"
// ═══════════════════════════════════════════════════════════════
const getApplicationModel = () => {
  // Find the database connection that connects to "Job_db"
  const targetConn = mongoose.connections.find(
    (conn) => conn.name && conn.name.toLowerCase() === "job_db"
  );

  if (targetConn) {
    // Return existing model if it's already compiled on this connection
    if (targetConn.models["Application"]) {
      return targetConn.models["Application"];
    }
    // Compile the model on the "Job_db" connection
    return targetConn.model("Application", applicationSchema);
  }

  // Fallback to primary default connection
  if (mongoose.models["Application"]) {
    return mongoose.models["Application"];
  }
  return mongoose.model("Application", applicationSchema);
};

// Export a Proxy that intercepts calls and routes them to the correct connection
const ApplicationProxy = new Proxy({}, {
  get(target, prop) {
    const model = getApplicationModel();
    const value = model[prop];
    if (typeof value === "function") {
      return value.bind(model);
    }
    return value;
  },
  construct(target, args) {
    const Model = getApplicationModel();
    return new Model(...args);
  }
});

module.exports = ApplicationProxy;