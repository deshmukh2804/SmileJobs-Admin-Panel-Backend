// FILE: backend/src/models/ProfilePurchase.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

const profilePurchaseSchema = new mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
      index: true,
    },
    candidateIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],
    quantity: { type: Number, default: 1 },
    unitPriceInPaise: { type: Number, required: true },
    totalAmountInPaise: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    pricingConfigId: { type: mongoose.Schema.Types.ObjectId },
    pricingSnapshotAt: { type: Date },
    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },
    razorpayRefundId: { type: String, default: null },
    status: {
      type: String,
      enum: ["created", "pending", "captured", "paid", "failed", "refunded", "cancelled"],
      default: "created",
      index: true,
    },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, default: null },
    failureReason: { type: String, default: null },
    verifiedBy: { type: String, default: null },
    rawWebhookPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    notes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "profile_purchases",
  }
);

profilePurchaseSchema.index({ createdAt: -1 });
profilePurchaseSchema.index({ status: 1, createdAt: -1 });

module.exports = recruiterDbConnection.model(
  "ProfilePurchase",
  profilePurchaseSchema,
  "profile_purchases"
);