// FILE: backend/src/models/Subscription.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

const subscriptionSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    collection: "recruiter_subscriptions", // ⚡ CORRECT COLLECTION NAME
    timestamps: true,
  }
);

module.exports =
  recruiterDbConnection.models.Subscription ||
  recruiterDbConnection.model("Subscription", subscriptionSchema);