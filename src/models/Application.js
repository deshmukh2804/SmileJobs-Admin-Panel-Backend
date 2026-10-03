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
// DEDICATED CONNECTION TO application_db
// This creates (or reuses) a separate MongoDB connection pointing
// specifically to the "application_db" database where the 13
// real applications live under the "applications" collection.
// ═══════════════════════════════════════════════════════════════
let applicationConnection = null;

const getApplicationConnection = () => {
  if (applicationConnection && applicationConnection.readyState === 1) {
    return applicationConnection;
  }

  // Check if a connection to application_db already exists
  const existingConn = mongoose.connections.find(
    (conn) => conn.name && conn.name.toLowerCase() === "application_db"
  );

  if (existingConn && existingConn.readyState === 1) {
    applicationConnection = existingConn;
    return applicationConnection;
  }

  // Build URI for application_db from env
  const baseUri =
    process.env.MONGO_URI_APPLICATION ||
    process.env.MONGO_URI_JOBS ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI;

  if (!baseUri) {
    console.error(
      "❌ No MongoDB URI found in env for application_db. Set MONGO_URI_APPLICATION."
    );
    return null;
  }

  // Replace the db name in the URI with "application_db"
  let appUri = baseUri;
  try {
    // Replace existing database name in URI with application_db
    const parsed = new URL(baseUri);
    // Extract the path (e.g. /careerflow_admin?retryWrites=true)
    const pathParts = parsed.pathname.split("?");
    parsed.pathname = "/application_db";
    // Preserve query string
    if (baseUri.includes("?")) {
      const queryStart = baseUri.indexOf("?");
      appUri = `${baseUri.substring(0, baseUri.lastIndexOf("/"))}/application_db${baseUri.substring(queryStart)}`;
    } else {
      appUri = `${baseUri.substring(0, baseUri.lastIndexOf("/"))}/application_db`;
    }
  } catch (e) {
    // Fallback simple replace
    appUri = baseUri.replace(/\/[^/?]+(\?|$)/, "/application_db$1");
  }

  console.log("🔌 Connecting to application_db...");
  applicationConnection = mongoose.createConnection(appUri, {
    serverSelectionTimeoutMS: 10000,
  });

  applicationConnection.on("connected", () => {
    console.log(
      `✅ MongoDB Connected (Application DB): ${applicationConnection.host}/application_db`
    );
  });

  applicationConnection.on("error", (err) => {
    console.error("❌ Application DB connection error:", err.message);
  });

  return applicationConnection;
};

// ═══════════════════════════════════════════════════════════════
// MODEL FACTORY — Compile model on the application_db connection
// ═══════════════════════════════════════════════════════════════
const getApplicationModel = () => {
  const conn = getApplicationConnection();

  if (!conn) {
    // Fallback: use default mongoose (will produce wrong data but won't crash)
    if (mongoose.models["Application"]) return mongoose.models["Application"];
    return mongoose.model("Application", applicationSchema);
  }

  if (conn.models["Application"]) {
    return conn.models["Application"];
  }

  return conn.model("Application", applicationSchema);
};

// ═══════════════════════════════════════════════════════════════
// EXPORT PROXY — Transparently routes all Mongoose operations
// to the application_db connection without any controller changes.
// ═══════════════════════════════════════════════════════════════
const ApplicationProxy = new Proxy(function () {}, {
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
  },
  apply(target, thisArg, args) {
    const Model = getApplicationModel();
    return new Model(...args);
  },
});

module.exports = ApplicationProxy;