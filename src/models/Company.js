const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      index: true,
    },
    website: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+\..+/.test(v);
        },
        message: "Please provide a valid website URL",
      },
    },
    logo: imageSchema,
    images: {
      type: [imageSchema],
      validate: {
        validator: function (v) {
          return v.length <= 10;
        },
        message: "Maximum 10 company images allowed",
      },
    },
    industry: {
      type: String,
      trim: true,
    },
    establishedYear: {
      type: Number,
      min: 1800,
      max: new Date().getFullYear(),
    },
    organizationSize: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true, default: "India" },
      pincode: { type: String, trim: true },
    },
    benefits: [
      {
        type: String,
        trim: true,
      },
    ],
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recruiter",
      required: true,
      index: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

companySchema.virtual("initials").get(function () {
  if (!this.name) return "";
  return this.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
});

companySchema.set("toJSON", { virtuals: true });
companySchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Company", companySchema);