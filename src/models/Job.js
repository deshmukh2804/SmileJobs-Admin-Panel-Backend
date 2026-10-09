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
    companyLogo: {
      type: String,
      default: ""
    },
    companyWebsite: {
      type: String,
      default: ""
    },
    jobCategory: {
      type: String,
      required: [true, "Job category is required"],
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
        enum: ["Per Hour", "Per Month", "Per Year"],
        default: "Per Month"
      },
      isNegotiable: { type: Boolean, default: false },
      hideSalary: { type: Boolean, default: false }
    },
    description: {
      type: String,
      required: [true, "Job description is required"]
    },
    responsibilities: [{ type: String }],
    requirements: [{ type: String }],
    skills: [{ type: String, index: true }],
    qualifications: [{ type: String }],
    benefits: [{ type: String }],
    applicationDeadline: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },
    contactEmail: {
      type: String,
      default: ""
    },
    contactPhone: {
      type: String,
      default: ""
    },
    isContactVisible: {
      type: Boolean,
      default: true
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
      enum: ["pending_review", "approved", "rejected", "suspended"],
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
    isUrgent: {
      type: Boolean,
      default: false
    },

    // Source tracking: admin vs recruiter
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

jobSchema.index({ status: 1, approvalStatus: 1, isActive: 1, createdAt: -1 });
jobSchema.index({ postedBy: 1, status: 1 });
jobSchema.index({ title: "text", companyName: "text", description: "text", skills: "text" });

module.exports = mongoose.model("Job", jobSchema);