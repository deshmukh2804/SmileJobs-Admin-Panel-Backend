// FILE: backend/src/controllers/subscriptionController.js
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Transaction = require('../models/Transaction');

// GET all subscription plans (filter by audience: recruiters/candidates)
exports.getPlans = async (req, res) => {
  try {
    const { audience, isActive } = req.query;
    const filter = {};
    if (audience) filter.audience = audience;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const plans = await SubscriptionPlan.find(filter).sort({ price: 1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// CREATE a subscription plan
exports.createPlan = async (req, res) => {
  try {
    const newPlan = new SubscriptionPlan(req.body);
    await newPlan.save();
    return res.status(201).json({ success: true, data: newPlan, message: 'Plan created successfully' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// UPDATE an existing subscription plan
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!updatedPlan) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found' });
    }
    return res.status(200).json({ success: true, data: updatedPlan, message: 'Plan updated successfully' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// TOGGLE active/inactive status
exports.togglePlanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await SubscriptionPlan.findById(id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    plan.isActive = !plan.isActive;
    await plan.save();
    return res.status(200).json({ success: true, data: plan, message: `Plan marked as ${plan.isActive ? 'Active' : 'Inactive'}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE a plan permanently
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SubscriptionPlan.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Plan not found' });
    return res.status(200).json({ success: true, message: 'Plan deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// BULK CREATE plans (used by frontend "Quick Setup" button)
exports.bulkCreatePlans = async (req, res) => {
  try {
    const { plans } = req.body;
    if (!Array.isArray(plans) || plans.length === 0) {
      return res.status(400).json({ success: false, message: 'Plans array is required' });
    }

    const created = await SubscriptionPlan.insertMany(plans);
    return res.status(201).json({
      success: true,
      data: created,
      message: `${created.length} plans created successfully`,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// GET Transaction History
exports.getTransactions = async (req, res) => {
  try {
    const { status, paymentGateway, subscriberType } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (paymentGateway) filter.paymentGateway = paymentGateway;
    if (subscriberType) filter.subscriberType = subscriberType;

    const logs = await Transaction.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: logs });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET Analytics
exports.getBillingAnalytics = async (req, res) => {
  try {
    const totalRevenueSum = await Transaction.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amountPaid' } } },
    ]);

    const activeSubscriptionsCount = await Transaction.countDocuments({
      status: 'success',
      endDate: { $gte: new Date() },
    });

    const totalPlans = await SubscriptionPlan.countDocuments();
    const activePlans = await SubscriptionPlan.countDocuments({ isActive: true });

    return res.status(200).json({
      success: true,
      data: {
        grossRevenue: totalRevenueSum[0]?.total || 0,
        activeSubscribers: activeSubscriptionsCount,
        totalPlans,
        activePlans,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Mock transaction for testing
exports.generateMockTransaction = async (req, res) => {
  try {
    const { planId, type, cycle } = req.body;
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    let calculatedAmount = cycle === 'yearly' ? (plan.priceYearly || plan.price * 12) : plan.price;
    if (plan.discountPercent > 0) {
      calculatedAmount -= (calculatedAmount * plan.discountPercent) / 100;
    }

    const durationMonths = cycle === 'yearly' ? 12 : 1;
    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(now.getMonth() + durationMonths);

    const tx = new Transaction({
      subscriberType: type,
      planId: plan._id,
      planName: `${plan.name} (${type})`,
      amountPaid: calculatedAmount,
      paymentGateway: 'Razorpay',
      gatewayTransactionId: 'pay_' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      status: 'success',
      billingCycle: cycle,
      startDate: now,
      endDate: expiry,
    });

    await tx.save();
    return res.status(201).json({ success: true, data: tx, message: 'Mock payment logged' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};