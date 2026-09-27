// FILE: backend/src/models/Transaction.js
const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  subscriberType: {
    type: String,
    enum: ['Company', 'User'],
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPlan',
    required: true
  },
  planName: {
    type: String,
    required: true
  },
  amountPaid: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  paymentGateway: {
    type: String,
    enum: ['Razorpay', 'Stripe', 'Manual_Admin_Grant'],
    default: 'Razorpay'
  },
  gatewayTransactionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['success', 'pending', 'failed', 'refunded'],
    default: 'success'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    default: 'monthly'
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transaction', TransactionSchema);