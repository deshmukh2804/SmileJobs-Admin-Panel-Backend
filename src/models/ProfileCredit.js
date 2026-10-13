// FILE: backend/src/models/ProfileCredit.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

const profileCreditSchema = new mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0 },
    totalPurchased: { type: Number, default: 0 },
    totalUsed: { type: Number, default: 0 },
    totalExpended: { type: Number, default: 0 },
    lastPurchasedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "profile_credits",
  }
);

module.exports = recruiterDbConnection.model(
  "ProfileCredit",
  profileCreditSchema,
  "profile_credits"
);