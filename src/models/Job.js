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
    companyImages: [
      {
        url: { type: String, default: "" },
        publicId: { type: String, default: "" }
      }
    ],
    companyInitials: {
      type: String,
      default: ""
    },
    isCompanyVerified: {
      type: Boolean,
      default: false
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
      country: { type: String, default: "India" }
    },
    jobCategory: {
      type: String,
      required: false,
      default: "General",
      trim: true,
      index: true
    },
    jobType: {
      type: String,
      enum: ["Full-Time", "Part-Time", "Contract", "Internship", "Freelance"],
      default: "Full-Time",
      index: true
    },
    workplaceType: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
      default: "On-site"
    },
    workMode: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
      default: "On-site"
    },
    department: {
      type: String,
      default: ""
    },
    role: {
      type: String,
      default: ""
    },
    qualification: {
      type: String,
      default: ""
    },
    noticePeriod: {
      type: String,
      default: ""
    },
    location: {
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" },
      address: { type: String, default: "" },
      coordinates: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null }
      }
    },
    vacancies: {
      type: Number,
      default: 1,
      min: 1
    },
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
    description: {
      type: String,
      required: false,
      default: ""
    },
    jobDescription: {
      type: String,
      default: ""
    },
    responsibilities: [{ type: String }],
    requirements: [{ type: String }],
    skills: [{ type: String, index: true }],
    qualifications: [{ type: String }],
    languages: [{ type: String }],
    benefits: [{ type: String }],
    jobTiming: {
      type: String,
      default: ""
    },
    workingDays: {
      type: String,
      default: ""
    },
    applicationDeadline: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },

    // Contact Person
    contactPerson: {
      name: { type: String, default: "" },
      designation: { type: String, default: "" }
    },
    contactEmail: {
      type: String,
      default: ""
    },
    contactPhone: {
      type: String,
      default: ""
    },
    recruiterEmail: {
      type: String,
      default: ""
    },
    recruiterMobileNumber: {
      type: String,
      default: ""
    },
    recruiterWhatsappNumber: {
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
    isContactVisible: {
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

    // Job Lifecycle Status
    status: {
      type: String,
      enum: ["Draft", "Pending Approval", "Live", "Rejected", "Expired", "Closed"],
      default: "Pending Approval",
      index: true
    },
    approvalStatus: {
      type: String,
      enum: ["pending_review", "approved", "rejected", "suspended", "pending"],
      default: "pending_review",
      index: true
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true
    },
    featured: {
      type: Boolean,
      default: false
    },
    isUrgent: {
      type: Boolean,
      default: false
    },
    isNew: {
      type: Boolean,
      default: true
    },

    // Applicants
    applicantsCount: {
      type: Number,
      default: 0
    },
    applicantsCap: {
      type: Number,
      default: 100
    },

    // Posted At
    postedAt: {
      type: Date,
      default: Date.now
    },

    // Source tracking
    postedBy: {
      type: String,
      enum: ["admin", "recruiter"],
      default: "recruiter",
      index: true
    },
    postedByUserId: {
      type: String,
      default: ""
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

    // Audit fields
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

    // Statistics
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

// Auto-generate companyInitials
jobSchema.pre("save", function (next) {
  if (this.companyName && !this.companyInitials) {
    this.companyInitials = this.companyName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  // Sync description & jobDescription
  if (this.jobDescription && !this.description) {
    this.description = this.jobDescription;
  }
  if (this.description && !this.jobDescription) {
    this.jobDescription = this.description;
  }
  // Sync workMode & workplaceType
  if (this.workMode && !this.workplaceType) {
    this.workplaceType = this.workMode;
  }
  if (this.workplaceType && !this.workMode) {
    this.workMode = this.workplaceType;
  }
  // Sync featured & isFeatured
  if (this.featured !== undefined) this.isFeatured = this.featured;
  // Sync whatsappContactEnabled
  if (this.contactVisibility?.whatsapp !== undefined) {
    this.whatsappContactEnabled = this.contactVisibility.whatsapp;
  }
  next();
});

jobSchema.index({ status: 1, approvalStatus: 1, isActive: 1, createdAt: -1 });
jobSchema.index({ postedBy: 1, status: 1 });
jobSchema.index({
  title: "text",
  companyName: "text",
  description: "text",
  skills: "text"
});

module.exports = mongoose.model("Job", jobSchema);