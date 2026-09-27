// FILE: backend/src/models/SubscriptionPlan.js
const mongoose = require('mongoose');

const SubscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  tier: {
    type: String,
    enum: ['basic', 'pro', 'enterprise'],
    required: true
  },
  audience: {
    type: String,
    enum: ['recruiters', 'candidates', 'both'],
    default: 'recruiters'
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  priceYearly: {
    type: Number,
    min: 0,
    default: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    default: 'monthly'
  },
  description: {
    type: String,
    trim: true
  },
  features: [{
    type: String,
    trim: true
  }],
  advantages: [{
    type: String,
    trim: true
  }],
  jobPostLimit: {
    type: Number,
    default: 0 // 0 represents unlimited
  },
  resumeViewLimit: {
    type: Number,
    default: 0
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  trialDays: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SubscriptionPlan', SubscriptionPlanSchema);