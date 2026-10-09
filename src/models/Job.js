const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Job title is required"],
      trim: true,
      index: true
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
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
    location: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" }
    },
    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      period: { type: String, default: "month" }
    },
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      text: { type: String, default: "" }
    },
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
    skills: [{ type: String, index: true }],
    languages: [{ type: String }],
    jobDescription: {
      type: String,
      default: ""
    },
    description: {
      type: String,
      default: ""
    },
    responsibilities: [{ type: String }],
    requirements: [{ type: String }],
    benefits: [{ type: String }],
    jobTiming: {
      type: String,
      default: ""
    },
    workingDays: {
      type: String,
      default: ""
    },
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
      whatsapp: { type: Boolean, default: true },
      mobile: { type: Boolean, default: true }
    },
    whatsappContactEnabled: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      default: "Live",
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
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
    postedBy: {
      type: String,
      default: "admin",
      index: true
    },
    postedByUserId: {
      type: String,
      default: ""
    },
    postedByName: {
      type: String,
      default: "Smile Jobs"
    },
    postedByEmail: {
      type: String,
      default: "smilejobs@gmail.com"
    },
    postedByRole: {
      type: String,
      default: "Super Admin"
    },
    approvalStatus: {
      type: String,
      default: "approved",
      index: true
    },
    submittedForReviewAt: {
      type: Date,
      default: Date.now
    },
    approvedAt: {
      type: Date,
      default: Date.now
    },
    approvedBy: {
      type: String,
      default: "Smile Jobs"
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
    applicantsCount: {
      type: Number,
      default: 0
    },
    applicantsCap: {
      type: Number,
      default: 100
    },
    postedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    collection: "jobs" // ✅ Explicitly binds to 'jobs' collection
  }
);

// Auto-sync virtuals & initials
jobSchema.pre("save", function (next) {
  if (this.companyName && !this.companyInitials) {
    this.companyInitials = this.companyName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (this.jobDescription && !this.description) {
    this.description = this.jobDescription;
  }
  if (this.description && !this.jobDescription) {
    this.jobDescription = this.description;
  }
  next();
});

module.exports = mongoose.model("Job", jobSchema, "jobs");