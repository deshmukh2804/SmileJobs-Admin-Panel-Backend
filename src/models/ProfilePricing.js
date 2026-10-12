// ============================================================================
// SmileJobs — Candidate Profile Pricing Singleton Config
// Path: backend/src/models/ProfilePricing.js
// ============================================================================

const mongoose = require("mongoose");

const ProfilePricingSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
      required: true,
    },
    priceInPaise: {
      type: Number,
      required: true,
      min: [100, "Minimum price is ₹1 (100 paise)"],
      max: [10000000, "Maximum price is ₹1,00,000 (1 crore paise)"],
      validate: {
        validator: Number.isInteger,
        message: "Price must be an integer (paise). Never store floats.",
      },
      default: 29900, // ₹299 default
    },
    currency: {
      type: String,
      enum: ["INR", "USD"],
      default: "INR",
      uppercase: true,
    },
    razorpayKeyId: {
      type: String,
      default: "",
      trim: true,
    },
    razorpayKeySecret: {
      type: String,
      default: "",
      trim: true,
      select: false, // NEVER return by default in queries
    },
    razorpayMode: {
      type: String,
      enum: ["test", "live"],
      default: "test",
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    updatedByName: {
      type: String,
      default: "System",
      trim: true,
    },
    updatedByEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    updatedByRole: {
      type: String,
      default: "System",
      trim: true,
    },
    isSingleton: {
      type: String,
      default: "ACTIVE_PRICING_CONFIG",
      unique: true,
      index: true,
    },
  },
  { timestamps: true, collection: "profile_pricings" }
);

// Pre-save hook to validate live mode has credentials
ProfilePricingSchema.pre("save", function (next) {
  if (this.razorpayMode === "live") {
    if (!this.razorpayKeyId || !this.razorpayKeyId.trim()) {
      return next(new Error("Razorpay Key ID is required for LIVE mode."));
    }
    if (!this.razorpayKeySecret || !this.razorpayKeySecret.trim()) {
      return next(new Error("Razorpay Key Secret is required for LIVE mode."));
    }
  }
  next();
});

// Static: Get active singleton config (auto-seeds if missing)
ProfilePricingSchema.statics.getActive = async function () {
  let config = await this.findOne({ isSingleton: "ACTIVE_PRICING_CONFIG" });
  if (!config) {
    config = await this.create({
      enabled: true,
      priceInPaise: 29900,
      currency: "INR",
      razorpayKeyId: "",
      razorpayKeySecret: "",
      razorpayMode: "test",
      version: 1,
      updatedByName: "System Seed",
      updatedByEmail: "system@smilejobs.com",
      updatedByRole: "System",
    });
    console.log("[ProfilePricing] Auto-seeded default config: ₹299 INR (TEST mode)");
  }
  return config;
};

// Static: Get active singleton WITH secret (for refund / server-side use)
ProfilePricingSchema.statics.getActiveWithSecret = async function () {
  let config = await this.findOne({ isSingleton: "ACTIVE_PRICING_CONFIG" }).select(
    "+razorpayKeySecret"
  );
  if (!config) {
    config = await this.create({
      enabled: true,
      priceInPaise: 29900,
      currency: "INR",
      razorpayMode: "test",
      version: 1,
      updatedByName: "System Seed",
    });
    config = await this.findOne({ isSingleton: "ACTIVE_PRICING_CONFIG" }).select(
      "+razorpayKeySecret"
    );
  }
  return config;
};

module.exports =
  mongoose.models.ProfilePricing || mongoose.model("ProfilePricing", ProfilePricingSchema);