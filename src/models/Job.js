// FILE: backend/src/models/Job.js
const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" }
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    // Basic Information
    title: {
      type: String,
      required: [true, "Job title is required"],
      trim: true,
      maxlength: [150, "Job title cannot exceed 150 characters"],
      index: true
    },
    department: {
      type: String,
      default: "",
      trim: true
    },
    role: {
      type: String,
      default: "",
      trim: true
    },
    jobCategory: {
      type: String,
      default: "",
      trim: true,
      index: true
    },
    industry: {
      type: String,
      default: "",
      trim: true,
      index: true
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
    workplaceType: {
      type: String,
      enum: ["On-site", "Hybrid", "Remote"],
      default: "On-site"
    },
    qualification: {
      type: String,
      default: "",
      trim: true
    },
    qualifications: [{ type: String, trim: true }],
    applicationUrl: {
      type: String,
      default: "",
      trim: true
    },

    // Company Information
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
      default: "",
      trim: true
    },
    companyLogo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" }
    },
    companyImages: [imageSchema],
    companyInitials: {
      type: String,
      default: "",
      trim: true
    },
    establishedYear: {
      type: Number,
      default: null
    },
    organizationSize: {
      type: String,
      default: "",
      trim: true
    },
    companyAddress: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" }
    },

    // Location & Timing
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
    jobTiming: {
      type: String,
      default: "10:00 AM to 05:00 PM",
      trim: true
    },
    workingDays: {
      type: String,
      default: "Mon - Fri",
      trim: true
    },

    // Compensation & Experience
    vacancies: {
      type: Number,
      default: 1,
      min: 1
    },
    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      period: {
        type: String,
        default: "month"
      },
      isNegotiable: { type: Boolean, default: false },
      hideSalary: { type: Boolean, default: false }
    },
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      level: {
        type: String,
        enum: ["Fresher", "Junior", "Mid-Level", "Senior", "Lead", "Executive"],
        default: "Fresher"
      },
      text: { type: String, default: "" }
    },
    noticePeriod: {
      type: String,
      default: "",
      trim: true
    },

    // Job Details
    description: {
      type: String,
      default: ""
    },
    jobDescription: {
      type: String,
      default: ""
    },
    responsibilities: [{ type: String, trim: true }],
    requirements: [{ type: String, trim: true }],
    skills: [{ type: String, trim: true, index: true }],
    languages: [{ type: String, trim: true }],
    benefits: [{ type: String, trim: true }],
    applicationDeadline: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },
    noPaymentInvolved: {
      type: Boolean,
      default: true
    },

    // Recruiter & Contact Information
    contactPerson: {
      name: { type: String, default: "" },
      designation: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      whatsapp: { type: String, default: "" }
    },
    contactEmail: {
      type: String,
      default: ""
    },
    contactPhone: {
      type: String,
      default: ""
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
    contactVisibility: {
      whatsapp: { type: Boolean, default: false },
      mobile: { type: Boolean, default: false }
    },
    isContactVisible: {
      type: Boolean,
      default: true
    },
    whatsappContactEnabled: {
      type: Boolean,
      default: true
    },

    // Job Lifecycle & Status
    status: {
      type: String,
      enum: ["Draft", "Pending Approval", "Live", "Rejected", "Expired", "Closed"],
      default: "Pending Approval",
      index: true
    },
    approvalStatus: {
      type: String,
      enum: ["pending_review", "pending", "approved", "rejected", "suspended"],
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
    isUrgent: {
      type: Boolean,
      default: false
    },
    isNew: {
      type: Boolean,
      default: true
    },
    isCompanyVerified: {
      type: Boolean,
      default: false
    },

    // Source Tracking & Creator Audit
    postedBy: {
      type: String,
      enum: ["admin", "recruiter"],
      default: "recruiter",
      index: true
    },
    postedByUserId: {
      type: String,
      default: null,
      index: true
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

    // Review & Approval Audit
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
    postedAt: {
      type: Date,
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

    // Applicant Caps & Metrics
    applicantsCount: {
      type: Number,
      default: 0
    },
    applicantsCap: {
      type: Number,
      default: 100
    },
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

// Pre-save hook for field synchronization and automatic normalization
jobSchema.pre("save", function (next) {
  // Sync Description
  if (this.jobDescription && !this.description) {
    this.description = this.jobDescription;
  } else if (this.description && !this.jobDescription) {
    this.jobDescription = this.description;
  }

  // Sync Work Mode / Workplace Type
  if (this.workMode && !this.workplaceType) {
    this.workplaceType = this.workMode;
  } else if (this.workplaceType && !this.workMode) {
    this.workMode = this.workplaceType;
  }

  // Sync Industry / Job Category
  if (this.industry && !this.jobCategory) {
    this.jobCategory = this.industry;
  } else if (this.jobCategory && !this.industry) {
    this.industry = this.jobCategory;
  }

  // Sync Qualifications
  if (this.qualification && (!this.qualifications || this.qualifications.length === 0)) {
    this.qualifications = [this.qualification];
  } else if (this.qualifications && this.qualifications.length > 0 && !this.qualification) {
    this.qualification = this.qualifications.join(", ");
  }

  // Sync Featured Flags
  if (this.featured !== undefined) this.isFeatured = this.featured;
  if (this.isFeatured !== undefined) this.featured = this.isFeatured;

  // Compute Company Initials if missing
  if (!this.companyInitials && this.companyName) {
    const words = this.companyName.trim().split(/\s+/);
    if (words.length === 1) {
      this.companyInitials = words[0].slice(0, 2).toUpperCase();
    } else {
      this.companyInitials = (words[0][0] + words[1][0]).toUpperCase();
    }
  }

  // Sync Contact Details
  if (this.recruiterEmail && !this.contactEmail) this.contactEmail = this.recruiterEmail;
  if (this.contactEmail && !this.recruiterEmail) this.recruiterEmail = this.contactEmail;

  if (this.recruiterMobileNumber && !this.contactPhone) this.contactPhone = this.recruiterMobileNumber;
  if (this.contactPhone && !this.recruiterMobileNumber) this.recruiterMobileNumber = this.contactPhone;

  // Sync Contact Visibility Flags
  if (this.contactVisibility) {
    if (this.contactVisibility.mobile !== undefined || this.contactVisibility.whatsapp !== undefined) {
      this.isContactVisible = Boolean(this.contactVisibility.mobile || this.contactVisibility.whatsapp);
      this.whatsappContactEnabled = Boolean(this.contactVisibility.whatsapp);
    }
  }

  // Set postedAt timestamp on approval
  if (this.approvalStatus === "approved" && this.status === "Live" && !this.postedAt) {
    this.postedAt = this.approvedAt || new Date();
  }

  next();
});

// Database indexes for optimal query performance
jobSchema.index({ status: 1, approvalStatus: 1, isActive: 1, createdAt: -1 });
jobSchema.index({ postedBy: 1, status: 1, approvalStatus: 1 });
jobSchema.index({ recruiterId: 1, createdAt: -1 });
jobSchema.index({ "location.city": 1, "location.state": 1 });
jobSchema.index({ title: "text", companyName: "text", description: "text", skills: "text" });

module.exports = mongoose.model("Job", jobSchema);