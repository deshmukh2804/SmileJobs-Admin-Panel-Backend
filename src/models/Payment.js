// FILE: backend/src/models/Payment.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

const paymentSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    collection: "payment_transactions", // ⚡ CORRECT COLLECTION NAME
    timestamps: true,
  }
);

module.exports =
  recruiterDbConnection.models.Payment ||
  recruiterDbConnection.model("Payment", paymentSchema);