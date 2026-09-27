const mongoose = require("mongoose");

const contactPermissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
    },
    type: {
      type: String,
      enum: ["WHATSAPP"],
      default: "WHATSAPP",
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "REVOKED"],
      default: "PENDING",
      index: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: Date,
    rejectedAt: Date,
    revokedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Compound unique index
contactPermissionSchema.index(
  { userId: 1, recruiterId: 1, jobId: 1, type: 1 },
  { unique: true }
);

contactPermissionSchema.index({ recruiterId: 1, status: 1 });
contactPermissionSchema.index({ userId: 1, jobId: 1 });

module.exports = mongoose.model("ContactPermission", contactPermissionSchema);