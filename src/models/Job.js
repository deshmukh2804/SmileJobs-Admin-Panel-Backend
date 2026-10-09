const mongoose = require("mongoose");

// ─── This schema MUST match the recruiter website's jobModel.js EXACTLY ───
// plus the extra admin-only tracking fields (postedBy, postedByName, etc.)

const jobSchema = new mongoose.Schema(
  {
    // ─── CORE ───
    title: { type: String, required: true, trim: true },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      default: null,
      index: true,
    },

    // ─── COMPANY ───
    companyName: { type: String, required: true },
    companyWebsite: { type: String, default: "" },
    companyLogo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },
    companyImages: [
      {
        url: { type: String },
        publicId: { type: String },
      },
    ],
    companyInitials: { type: String, default: "" },
    industry: { type: String, default: "" },
    establishedYear: { type: Number, default: null },
    organizationSize: { type: String, default: "" },
    companyAddress: {
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" },
    },

    // ─── LOCATION ───
    location: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" },
    },

    // ─── SALARY ───
    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      period: {
        type: String,
        enum: ["month", "year", "hour"],
        default: "month",
      },
    },

    // ─── EXPERIENCE ───
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      text: { type: String, default: "" },
    },

    // ─── JOB DETAILS ───
    noticePeriod: { type: String, default: "" },
    jobType: {
      type: String,
      enum: ["Full-Time", "Part-Time", "Contract", "Internship"],
      default: "Full-Time",
    },
    workMode: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
      default: "On-site",
    },
    department: { type: String, default: "" },
    role: { type: String, default: "" },
    qualification: { type: String, default: "" },
    skills: [{ type: String }],
    languages: [{ type: String }],

    // ─── DESCRIPTION ───
    jobDescription: { type: String, default: "" },
    responsibilities: [{ type: String }],
    requirements: [{ type: String }],
    benefits: [{ type: String }],

    // ─── WORKING HOURS ───
    jobTiming: { type: String, default: "" },
    workingDays: { type: String, default: "" },

    // ─── CONTACT ───
    contactPerson: {
      name: { type: String, default: "" },
      designation: { type: String, default: "" },
    },
    recruiterWhatsappNumber: { type: String, default: "" },
    recruiterMobileNumber: { type: String, default: "" },
    recruiterEmail: { type: String, default: "" },
    applicationUrl: { type: String, default: "" },
    noPaymentInvolved: { type: Boolean, default: true },
    contactVisibility: {
      whatsapp: { type: Boolean, default: true },
      mobile: { type: Boolean, default: true },
    },
    whatsappContactEnabled: { type: Boolean, default: true },

    // ─── STATUS (matches recruiter model EXACTLY) ───
    status: {
      type: String,
      enum: [
        "Pending Approval",
        "Live",
        "Draft",
        "Paused",
        "Closed",
        "Rejected",
        "Expired",
      ],
      default: "Pending Approval",
    },
    isActive: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    isNew: { type: Boolean, default: true },
    isCompanyVerified: { type: Boolean, default: false },

    // ─── APPROVAL TRACKING (matches recruiter model EXACTLY) ───
    approvalStatus: {
      type: String,
      enum: ["pending_review", "approved", "rejected", "suspended"],
      default: "pending_review",
      index: true,
    },
    submittedForReviewAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    reviewNotes: { type: String, default: "" },
    lastEditedAfterApproval: { type: Boolean, default: false },

    // ─── STATS ───
    applicantsCount: { type: Number, default: 0 },
    applicantsCap: { type: Number, default: 100 },
    postedAt: { type: Date, default: Date.now },

    // ═══════════════════════════════════════════════════════
    // ADMIN-ONLY FIELDS (not in recruiter model, added by admin panel)
    // ═══════════════════════════════════════════════════════
    postedBy: {
      type: String,
      enum: ["admin", "recruiter"],
      default: "recruiter",
      index: true,
    },
    postedByUserId: { type: String, default: "" },
    postedByName: { type: String, default: "" },
    postedByEmail: { type: String, default: "" },
    postedByRole: { type: String, default: "" },
  },
  {
    timestamps: true,
    minimize: false, // CRITICAL: keeps empty nested objects like companyLogo: {url:"", publicId:""}
    suppressReservedKeysWarning: true,
  }
);

// ─── INDEXES (same as recruiter + admin extras) ───
jobSchema.index({ status: 1, approvalStatus: 1, isActive: 1, createdAt: -1 });
jobSchema.index({ postedBy: 1, status: 1 });
jobSchema.index({ recruiterId: 1 });
jobSchema.index({ title: "text", companyName: "text", jobDescription: "text" });

// ─── AUTO-GENERATE companyInitials ───
jobSchema.pre("save", function (next) {
  if (!this.companyInitials && this.companyName) {
    this.companyInitials = this.companyName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }
  next();
});

module.exports = mongoose.model("Job", jobSchema);