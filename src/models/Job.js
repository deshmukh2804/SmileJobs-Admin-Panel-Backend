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
      type: [{
        url: { type: String, default: "" },
        publicId: { type: String, default: "" }
      }],
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
      country: { type: String, default: "India" },
      coordinates: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null }
      }
    },

    // ─── SALARY ───
    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      period: {
        type: String,
        enum: ["hour", "day", "week", "month", "year", "Per Hour", "Per Month", "Per Year"],
        default: "month"
      },
      isNegotiable: { type: Boolean, default: false },
      hideSalary: { type: Boolean, default: false }
    },

    // ─── EXPERIENCE ───
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      text: { type: String, default: "" },
      level: {
        type: String,
        enum: ["Fresher", "Junior", "Mid-Level", "Senior", "Lead", "Executive"],
        default: "Fresher"
      }
    },

    // ─── JOB DETAILS ───
    noticePeriod: {
      type: String,
      default: ""
    },
    jobType: {
      type: String,
      enum: ["Full-Time", "Part-Time", "Contract", "Internship", "Freelance"],
      default: "Full-Time",
      index: true
    },
    workMode: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
      default: "On-site"
    },
    // keep workplaceType for backward compatibility
    workplaceType: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
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
    jobCategory: {
      type: String,
      default: "",
      index: true
    },
    qualification: {
      type: String,
      default: ""
    },
    qualifications: [{ type: String }],
    skills: {
      type: [String],
      default: [],
      index: true
    },
    languages: {
      type: [String],
      default: []
    },
    vacancies: {
      type: Number,
      default: 1,
      min: 1
    },

    // ─── DESCRIPTION & LISTS ───
    jobDescription: {
      type: String,
      default: ""
    },
    description: {
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
    contactEmail: {
      type: String,
      default: ""
    },
    contactPhone: {
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
    isContactVisible: {
      type: Boolean,
      default: true
    },

    // ─── APPLICATION DEADLINE ───
    applicationDeadline: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },

    // ─── JOB LIFECYCLE STATUS ───
    status: {
      type: String,
      enum: ["Draft", "Pending Approval", "Pending", "Live", "Rejected", "Expired", "Closed"],
      default: "Pending Approval",
      index: true
    },
    approvalStatus: {
      type: String,
      enum: ["pending_review", "approved", "rejected", "suspended"],
      default: "pending_review",
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
    isFeatured: {
      type: Boolean,
      default: false,
      index: true
    },
    isNew: {
      type: Boolean,
      default: true
    },
    isUrgent: {
      type: Boolean,
      default: false
    },
    isCompanyVerified: {
      type: Boolean,
      default: false
    },

    // ─── SOURCE TRACKING ───
    postedBy: {
      type: String,
      enum: ["admin", "recruiter"],
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
      default: "recruiter"
    },

    // ─── APPROVAL AUDIT FIELDS ───
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
    },

    // ─── STATISTICS ───
    stats: {
      views: { type: Number, default: 0 },
      applications: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      shortlisted: { type: Number, default: 0 }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

jobSchema.index({ status: 1, approvalStatus: 1, isActive: 1, createdAt: -1 });
jobSchema.index({ postedBy: 1, status: 1 });
jobSchema.index({ title: "text", companyName: "text", jobDescription: "text", description: "text", skills: "text" });

// Auto-generate companyInitials if not provided
jobSchema.pre("save", function (next) {
  if (!this.companyInitials && this.companyName) {
    this.companyInitials = this.companyName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }
  // Keep featured and isFeatured in sync
  if (this.isModified("featured")) this.isFeatured = this.featured;
  if (this.isModified("isFeatured")) this.featured = this.isFeatured;
  // Keep workMode and workplaceType in sync
  if (this.isModified("workMode")) this.workplaceType = this.workMode;
  if (this.isModified("workplaceType") && !this.workMode) this.workMode = this.workplaceType;

  next();
});

module.exports = mongoose.model("Job", jobSchema);