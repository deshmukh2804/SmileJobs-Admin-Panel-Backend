// ============================================================================
// SmileJobs — Candidate Profile Payment Transactions
// Path: backend/src/models/PaymentTransaction.js
// ============================================================================

const mongoose = require("mongoose");

const PaymentTransactionSchema = new mongoose.Schema(
  {
    // Recruiter info
    recruiterId: { type: String, required: true, index: true, trim: true },
    recruiterName: { type: String, default: "", trim: true },
    recruiterEmail: { type: String, default: "", trim: true, lowercase: true },

    // Candidate info
    candidateId: { type: String, required: true, index: true, trim: true },
    candidateName: { type: String, default: "", trim: true },
    candidateEmail: { type: String, default: "", trim: true, lowercase: true },

    // Transaction amount (ALWAYS in paise, integer)
    amountInPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer (paise). Never store floats.",
      },
    },
    currency: {
      type: String,
      enum: ["INR", "USD"],
      default: "INR",
      uppercase: true,
    },

    // Razorpay identifiers
    razorpayOrderId: { type: String, required: true, unique: true, index: true, trim: true },
    razorpayPaymentId: { type: String, default: "", trim: true, index: true },
    razorpaySignature: { type: String, default: "", trim: true },

    // Status workflow
    status: {
      type: String,
      enum: ["pending", "captured", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    // Refund tracking
    refundId: { type: String, default: "", trim: true },
    refundReason: { type: String, default: "", trim: true },
    refundedAt: { type: Date, default: null },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    refundedByName: { type: String, default: "", trim: true },

    // Failure tracking
    errorCode: { type: String, default: "", trim: true },
    errorDescription: { type: String, default: "", trim: true },

    // Access control
    accessGranted: { type: Boolean, default: false },
    accessRevokedAt: { type: Date, default: null },

    // Free-form metadata from recruiter site
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true, collection: "payment_transactions" }
);

// Compound indexes for fast queries
PaymentTransactionSchema.index({ recruiterId: 1, status: 1 });
PaymentTransactionSchema.index({ candidateId: 1, status: 1 });
PaymentTransactionSchema.index({ createdAt: -1 });
PaymentTransactionSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.PaymentTransaction ||
  mongoose.model("PaymentTransaction", PaymentTransactionSchema);