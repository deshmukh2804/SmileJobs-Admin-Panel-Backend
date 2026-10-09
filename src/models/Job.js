const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Job title is required"],
      trim: true,
      maxlength: [150, "Job title cannot exceed 150 characters"],
      index: true
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: false,
      default: null,
      index: true
    },

    // ─── COMPANY INFO ───
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      index: true
    },
    companyWebsite: {
      type: String,
      default: ""
    },
    companyLogo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" }
    },
    companyImages: {
      type: Array,
      default: []
    },
    companyInitials: {
      type: String,
      default: ""
    },
    industry: {
      type: String,
      default: ""
    },
    establishedYear: {
      type: Number,
      default: null
    },
    organizationSize: {
      type: String,
      default: ""
    },
    companyAddress: {
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" }
    },

    // ─── LOCATION ───
    location: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" }
    },

    // ─── SALARY ───
    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      period: { type: String, default: "month" }
    },

    // ─── EXPERIENCE ───
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      text: { type: String, default: "" }
    },

    // ─── JOB DETAILS ───
    noticePeriod: {
      type: String,
      default: ""
    },
    jobType: {
      type: String,
      default: "Full-Time",
      index: true
    },
    workMode: {
      type: String,
      default: "On-site"
    },
    department: {
      type: String,
      default: "",
      index: true
    },
    role: {
      type: String,
      default: ""
    },
    qualification: {
      type: String,
      default: ""
    },
    skills: {
      type: [String],
      default: [],
      index: true
    },
    languages: {
      type: [String],
      default: []
    },

    // ─── DESCRIPTION & LISTS ───
    jobDescription: {
      type: String,
      default: ""
    },
    responsibilities: {
      type: [String],
      default: []
    },
    requirements: {
      type: [String],
      default: []
    },
    benefits: {
      type: [String],
      default: []
    },

    // ─── WORKING DETAILS ───
    jobTiming: {
      type: String,
      default: ""
    },
    workingDays: {
      type: String,
      default: ""
    },

    // ─── CONTACT ───
    contactPerson: {
      name: { type: String, default: "" },
      designation: { type: String, default: "" }
    },
    recruiterWhatsappNumber: {
      type: String,
      default: ""
    },
    recruiterMobileNumber: {
      type: String,
      default: ""
    },
    recruiterEmail: {
      type: String,
      default: ""
    },
    applicationUrl: {
      type: String,
      default: ""
    },
    noPaymentInvolved: {
      type: Boolean,
      default: true
    },
    contactVisibility: {
      whatsapp: { type: Boolean, default: false },
      mobile: { type: Boolean, default: false }
    },
    whatsappContactEnabled: {
      type: Boolean,
      default: false
    },

    // ─── JOB LIFECYCLE STATUS ───
    status: {
      type: String,
      default: "Pending Approval",
      index: true
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true
    },
    featured: {
      type: Boolean,
      default: false,
      index: true
    },
    isNew: {
      type: Boolean,
      default: true
    },
    isCompanyVerified: {
      type: Boolean,
      default: false
    },

    // ─── SOURCE TRACKING ───
    postedBy: {
      type: String,
      default: "recruiter",
      index: true
    },
    postedByUserId: {
      type: String,
      default: null
    },
    postedByName: {
      type: String,
      default: ""
    },
    postedByEmail: {
      type: String,
      default: ""
    },
    postedByRole: {
      type: String,
      default: ""
    },

    // ─── APPROVAL AUDIT FIELDS ───
    approvalStatus: {
      type: String,
      default: "pending_review",
      index: true
    },
    submittedForReviewAt: {
      type: Date,
      default: Date.now
    },
    approvedAt: {
      type: Date,
      default: null
    },
    approvedBy: {
      type: String,
      default: null
    },
    rejectionReason: {
      type: String,
      default: ""
    },
    reviewNotes: {
      type: String,
      default: ""
    },
    lastEditedAfterApproval: {
      type: Boolean,
      default: false
    },

    // ─── APPLICANT TRACKING ───
    applicantsCount: {
      type: Number,
      default: 0
    },
    applicantsCap: {
      type: Number,
      default: 100
    },

    // ─── POSTED AT ───
    postedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    minimize: false, // 🚀 VERY IMPORTANT: Prevents MongoDB from stripping out empty objects (like companyLogo, contactPerson)
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

jobSchema.index({ status: 1, approvalStatus: 1, isActive: 1, createdAt: -1 });
jobSchema.index({ postedBy: 1, status: 1 });
jobSchema.index({ title: "text", companyName: "text", jobDescription: "text" });

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