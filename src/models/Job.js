const mongoose = require("mongoose");
const { jobDbConnection } = require("../config/db"); // Import Job_db connection

const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Job title is required"],
      trim: true,
      index: true,
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    companyWebsite: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+\..+/.test(v);
        },
        message: "Please provide a valid URL",
      },
    },
    companyLogo: imageSchema,
    companyImages: [imageSchema],
    companyInitials: {
      type: String,
      trim: true,
      maxlength: 4,
    },
    industry: {
      type: String,
      trim: true,
    },
    establishedYear: {
      type: Number,
      min: [1800, "Established year must be after 1800"],
      max: [new Date().getFullYear(), "Established year cannot be in the future"],
    },
    organizationSize: {
      type: String,
      trim: true,
    },
    companyAddress: {
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true, default: "India" },
    },

    location: {
      address: { type: String, trim: true },
      city: { type: String, trim: true, index: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true, default: "India" },
    },

    salary: {
      min: {
        type: Number,
        min: [0, "Salary cannot be negative"],
      },
      max: {
        type: Number,
        min: [0, "Salary cannot be negative"],
      },
      currency: {
        type: String,
        default: "INR",
        trim: true,
      },
      period: {
        type: String,
        enum: ["hour", "day", "week", "month", "year"],
        default: "month",
      },
    },

    experience: {
      min: {
        type: Number,
        min: [0, "Experience cannot be negative"],
        default: 0,
      },
      max: {
        type: Number,
        min: [0, "Experience cannot be negative"],
      },
      text: { type: String, trim: true },
    },
    noticePeriod: {
      type: String,
      trim: true,
    },

    jobType: {
      type: String,
      enum: [
        "Full-Time",
        "Part-Time",
        "Contract",
        "Internship",
        "Freelance",
        "Temporary",
      ],
      default: "Full-Time",
    },

    workMode: {
      type: String,
      enum: ["On-site", "Remote", "Hybrid"],
      default: "On-site",
    },

    department: {
      type: String,
      trim: true,
    },

    role: {
      type: String,
      trim: true,
    },

    qualification: {
      type: String,
      trim: true,
    },

    skills: [
      {
        type: String,
        trim: true,
      },
    ],

    languages: [
      {
        type: String,
        trim: true,
      },
    ],

    jobDescription: {
      type: String,
      trim: true,
    },

    responsibilities: [
      {
        type: String,
        trim: true,
      },
    ],

    requirements: [
      {
        type: String,
        trim: true,
      },
    ],

    benefits: [
      {
        type: String,
        trim: true,
      },
    ],

    jobTiming: {
      type: String,
      trim: true,
    },

    workingDays: {
      type: String,
      trim: true,
    },

    contactPerson: {
      name: { type: String, trim: true },
      designation: { type: String, trim: true },
    },

    recruiterWhatsappNumber: {
      type: String,
      trim: true,
    },

    recruiterMobileNumber: {
      type: String,
      trim: true,
    },

    recruiterEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },

    applicationUrl: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+\..+/.test(v);
        },
        message: "Please provide a valid application URL",
      },
    },

    noPaymentInvolved: {
      type: Boolean,
      default: true,
    },

    contactVisibility: {
      whatsapp: {
        type: Boolean,
        default: false,
      },
      mobile: {
        type: Boolean,
        default: false,
      },
    },

    whatsappContactEnabled: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: [
        "Draft",
        "Pending Approval",
        "Live",
        "Rejected",
        "Expired",
        "Closed",
      ],
      default: "Pending Approval",
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    featured: {
      type: Boolean,
      default: false,
    },

    isNew: {
      type: Boolean,
      default: true,
    },

    isCompanyVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  }
);

// Indexes
jobSchema.index({ status: 1, createdAt: -1 });
jobSchema.index({ recruiterId: 1, status: 1 });
jobSchema.index({ companyId: 1, status: 1 });
jobSchema.index({ "location.city": 1, status: 1 });
jobSchema.index({ skills: 1 });

// Virtuals
jobSchema.virtual("salaryRange").get(function () {
  if (!this.salary || (!this.salary.min && !this.salary.max))
    return "Not Disclosed";
  const currency = this.salary.currency === "INR" ? "₹" : this.salary.currency;
  if (this.salary.min && this.salary.max) {
    return `${currency}${this.salary.min.toLocaleString()} - ${currency}${this.salary.max.toLocaleString()}`;
  }
  if (this.salary.min) return `${currency}${this.salary.min.toLocaleString()}+`;
  return `Up to ${currency}${this.salary.max.toLocaleString()}`;
});

jobSchema.virtual("locationDisplay").get(function () {
  if (!this.location) return "";
  const parts = [
    this.location.city,
    this.location.state,
    this.location.country,
  ].filter(Boolean);
  return parts.join(", ");
});

jobSchema.virtual("postedDate").get(function () {
  if (!this.postedAt) return "";
  const now = new Date();
  const diff = now - this.postedAt;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return this.postedAt.toLocaleDateString();
});

jobSchema.set("toJSON", { virtuals: true });
jobSchema.set("toObject", { virtuals: true });

// Compile schema into the specific Job_db connection context
module.exports = jobDbConnection.model("Job", jobSchema);