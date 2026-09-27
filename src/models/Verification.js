// FILE: backend/src/models/Verification.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

const documentSchema = new mongoose.Schema(
  {
    docType: {
      type: String,
      enum: [
        "company_registration",
        "gst_certificate",
        "incorporation_certificate",
        "pan_card",
        "address_proof",
        "authorization_letter",
        "other",
      ],
      required: true,
    },
    docName: { type: String, required: true },
    public_id: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String },
    size: { type: Number },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const companySnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    industry: { type: String, default: "" },
    website: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "" },
    registrationNumber: { type: String, default: "" },
    gstNumber: { type: String, default: "" },
    panNumber: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
  },
  { _id: false }
);

const verificationSchema = new mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    recruiterName: { type: String, default: "" },
    recruiterEmail: { type: String, default: "" },
    companyName: { type: String, default: "" },

    companySnapshot: { type: companySnapshotSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ["pending", "under_review", "approved", "rejected", "clarification_requested"],
      default: "pending",
      index: true,
    },

    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "" },

    rejectionReason: { type: String, default: "" },
    adminNotes: { type: String, default: "" },

    // Documents requested for re-upload
    clarificationDocs: [{ type: String }],
    clarificationMessage: { type: String, default: "" },

    documents: [documentSchema],
  },
  { timestamps: true, collection: "verifications" }
);

verificationSchema.index({ status: 1, submittedAt: -1 });
verificationSchema.index({ companyName: "text", recruiterName: "text", recruiterEmail: "text" });

module.exports = recruiterDbConnection.model("Verification", verificationSchema);