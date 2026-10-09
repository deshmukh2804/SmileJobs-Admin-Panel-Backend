const mongoose = require("mongoose");

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
    companyImages: { type: Array, default: [] },
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
      period: { type: String, default: "month" },
    },

    // ─── EXPERIENCE ───
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      text: { type: String, default: "" },
    },

    // ─── JOB DETAILS ───
    noticePeriod: { type: String, default: "" },
    jobType: { type: String, default: "Full-Time" },
    workMode: { type: String, default: "On-site" },
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

    // ─── STATUS (Admin Default Fallbacks) ───
    status: { type: String, default: "Live" },
    isActive: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    isNew: { type: Boolean, default: true },
    isCompanyVerified: { type: Boolean, default: false },

    // ─── APPROVAL TRACKING (Admin Default Fallbacks) ───
    approvalStatus: { type: String, default: "approved", index: true },
    submittedForReviewAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: Date.now },
    approvedBy: { type: String, default: "Smile Jobs" },
    rejectionReason: { type: String, default: "" },
    reviewNotes: { type: String, default: "" },
    lastEditedAfterApproval: { type: Boolean, default: false },

    // ─── STATS ───
    applicantsCount: { type: Number, default: 0 },
    applicantsCap: { type: Number, default: 100 },
    postedAt: { type: Date, default: Date.now },

    // ─── ADMIN TRACKING FIELDS ───
    postedBy: { type: String, default: "admin", index: true },
    postedByUserId: { type: String, default: "" },
    postedByName: { type: String, default: "Smile Jobs" },
    postedByEmail: { type: String, default: "smilejobs@gmail.com" },
    postedByRole: { type: String, default: "Super Admin" },
  },
  {
    timestamps: true,
    strict: false, // 🚀 CRITICAL: Allows schema-less fallback insertion to prevent field stripping!
    minimize: false, // 🚀 CRITICAL: Prevents MongoDB from removing empty nested objects
    suppressReservedKeysWarning: true,
  }
);

// Auto-generate initials on save
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