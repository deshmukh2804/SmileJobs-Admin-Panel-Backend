const mongoose = require("mongoose");

const PaymentTransactionSchema = new mongoose.Schema(
  {
    recruiterId: { type: String, required: true },
    recruiterName: { type: String, default: "Recruiter" },
    recruiterEmail: { type: String, default: "" },
    candidateId: { type: String, required: true },
    candidateName: { type: String, default: "Candidate" },
    candidateEmail: { type: String, default: "" },
    amountInPaise: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: "" },
    status: { type: String, enum: ["pending", "captured", "failed", "refunded"], default: "captured" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentTransaction", PaymentTransactionSchema);