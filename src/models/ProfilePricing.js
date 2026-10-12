const mongoose = require("mongoose");

const ProfilePricingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    price: { type: Number, default: 100, required: true },
    priceInPaise: { type: Number, default: 10000 },
    currency: { type: String, default: "INR" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProfilePricing", ProfilePricingSchema);