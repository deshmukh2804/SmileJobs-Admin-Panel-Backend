const mongoose = require("mongoose");

const ProfilePricingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    price: { type: Number, default: 100, required: true }, // Price in Rupees (e.g. 100)
    priceInPaise: { type: Number, default: 10000 },        // Auto-calculated (100 * 100)
    currency: { type: String, default: "INR" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProfilePricing", ProfilePricingSchema);