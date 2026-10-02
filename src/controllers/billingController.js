// FILE: backend/src/controllers/billingController.js
const Payment = require("../models/Payment");
const Subscription = require("../models/Subscription");
const RecruiterLimit = require("../models/RecruiterLimit");
const RecruiterProfile = require("../models/RecruiterProfile");

/**
 * Helper: Find recruiter IDs matching a text search across their profile fields
 */
const findRecruiterIdsBySearch = async (search) => {
  if (!search || !search.trim()) return null;
  try {
    const regex = new RegExp(
      search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    const recruiters = await RecruiterProfile.find({
      $or: [
        { name: regex },
        { fullName: regex },
        { email: regex },
        { companyName: regex },
        { "companyProfile.name": regex },
      ],
    })
      .select("_id")
      .lean();
    return recruiters.map((r) => r._id);
  } catch (err) {
    console.warn("Recruiter search failed:", err.message);
    return [];
  }
};

/**
 * Helper: Enrich records with recruiter details
 */
const enrichWithRecruiter = async (items) => {
  const recruiterIds = [
    ...new Set(items.map((i) => i.recruiterId).filter(Boolean).map(String)),
  ];

  if (recruiterIds.length === 0) return items.map((i) => ({ ...i, recruiter: null }));

  const recruiters = await RecruiterProfile.find({
    _id: { $in: recruiterIds },
  })
    .select("name fullName email companyName companyProfile")
    .lean();

  const recruiterMap = new Map(
    recruiters.map((r) => [
      String(r._id),
      {
        name: r.name || r.fullName || "Unknown",
        email: r.email || "N/A",
        companyName:
          r.companyName ||
          r.companyProfile?.name ||
          "N/A",
      },
    ])
  );

  return items.map((item) => ({
    ...item,
    recruiter:
      recruiterMap.get(String(item.recruiterId)) || {
        name: "Unknown",
        email: "N/A",
        companyName: "N/A",
      },
  }));
};

// ═══════════════════════════════════════════════════════════════
// GET PAYMENTS
// ═══════════════════════════════════════════════════════════════
const getPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status = "all" } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    const recruiterIds = await findRecruiterIdsBySearch(search);
    if (recruiterIds) {
      filter.recruiterId = { $in: recruiterIds };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [rawItems, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Payment.countDocuments(filter),
    ]);

    console.log(`📊 [Payments] Fetched ${rawItems.length} of ${total}`);

    const populated = await enrichWithRecruiter(rawItems);

    // Normalize each payment record
    const normalized = populated.map((p) => ({
      _id: String(p._id),
      recruiterId: p.recruiterId ? String(p.recruiterId) : null,
      razorpayPaymentId: p.razorpayPaymentId || "",
      razorpayOrderId: p.razorpayOrderId || "",
      razorpaySignature: p.razorpaySignature || "",
      amount: Number(p.amount) || 0,
      currency: p.currency || "INR",
      status: p.status || "pending",
      paymentType: p.paymentType || "one_time",
      planId: p.planId ? String(p.planId) : null,
      planSnapshot: p.planSnapshot || { name: "N/A", tier: "N/A" },
      failureReason: p.failureReason || "",
      paidAt: p.paidAt || null,
      createdAt: p.createdAt || null,
      updatedAt: p.updatedAt || null,
      recruiter: p.recruiter,
    }));

    return res.status(200).json({
      success: true,
      data: normalized,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("❌ Get Payments Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payments: " + error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════
const getSubscriptions = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status = "all" } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    const recruiterIds = await findRecruiterIdsBySearch(search);
    if (recruiterIds) {
      filter.recruiterId = { $in: recruiterIds };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [rawItems, total] = await Promise.all([
      Subscription.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Subscription.countDocuments(filter),
    ]);

    console.log(`📊 [Subscriptions] Fetched ${rawItems.length} of ${total}`);

    const populated = await enrichWithRecruiter(rawItems);

    // Normalize each subscription record
    const normalized = populated.map((s) => ({
      _id: String(s._id),
      recruiterId: s.recruiterId ? String(s.recruiterId) : null,
      planId: s.planId ? String(s.planId) : null,
      planSnapshot: s.planSnapshot || {
        name: "N/A",
        tier: "N/A",
        billingCycle: "monthly",
      },
      razorpayCustomerId: s.razorpayCustomerId || "",
      razorpaySubscriptionId: s.razorpaySubscriptionId || "",
      razorpayPlanId: s.razorpayPlanId || "",
      status: s.status || "inactive",
      amount: Number(s.amount) || 0,
      currency: s.currency || "INR",
      currentPeriodStart: s.currentPeriodStart || null,
      currentPeriodEnd: s.currentPeriodEnd || null,
      cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
      paymentStatus: s.paymentStatus || "unpaid",
      lastPaymentId: s.lastPaymentId || "",
      activatedAt: s.activatedAt || null,
      createdAt: s.createdAt || null,
      updatedAt: s.updatedAt || null,
      recruiter: s.recruiter,
    }));

    return res.status(200).json({
      success: true,
      data: normalized,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("❌ Get Subscriptions Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscriptions: " + error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET RECRUITER USAGE LIMITS
// ═══════════════════════════════════════════════════════════════
const getRecruiterLimits = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const filter = {};

    const recruiterIds = await findRecruiterIdsBySearch(search);
    if (recruiterIds) {
      filter.recruiterId = { $in: recruiterIds };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [rawItems, total] = await Promise.all([
      RecruiterLimit.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      RecruiterLimit.countDocuments(filter),
    ]);

    console.log(`📊 [Usages] Fetched ${rawItems.length} of ${total}`);

    const populated = await enrichWithRecruiter(rawItems);

    // ⚡ Normalize with fallback field names since your collection may use different names
    const normalized = populated.map((l) => {
      // Try multiple possible field names
      const jobPostsUsed =
        l.jobPostsUsed ??
        l.jobsPostedThisPeriod ??
        l.jobPostsThisPeriod ??
        0;

      const jobPostsLimit =
        l.jobPostsLimit ??
        l.maxJobPosts ??
        l.jobsAllowed ??
        0;

      const candidateViewsUsed =
        l.candidateViewsUsed ??
        l.candidatesUnlockedThisPeriod ??
        l.resumeViewsThisPeriod ??
        l.candidatesViewedThisPeriod ??
        0;

      const candidateViewsLimit =
        l.candidateViewsLimit ??
        l.maxCandidateUnlocks ??
        l.resumeViewsAllowed ??
        l.candidatesAllowed ??
        0;

      return {
        _id: String(l._id),
        recruiterId: l.recruiterId ? String(l.recruiterId) : null,
        jobPostsUsed: Number(jobPostsUsed),
        jobPostsLimit: Number(jobPostsLimit),
        candidateViewsUsed: Number(candidateViewsUsed),
        candidateViewsLimit: Number(candidateViewsLimit),
        resetAt: l.resetAt || null,
        createdAt: l.createdAt || null,
        updatedAt: l.updatedAt || null,
        recruiter: l.recruiter,
        _raw: l, // include original data for debugging
      };
    });

    return res.status(200).json({
      success: true,
      data: normalized,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("❌ Get Recruiter Limits Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch limits: " + error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// UPDATE RECRUITER LIMITS
// ═══════════════════════════════════════════════════════════════
const updateRecruiterLimits = async (req, res) => {
  try {
    const { candidateViewsLimit, jobPostsLimit } = req.body;
    const limitRecord = await RecruiterLimit.findById(req.params.id);

    if (!limitRecord) {
      return res
        .status(404)
        .json({ success: false, message: "Limit configuration not found" });
    }

    // Set on multiple possible field names to ensure it works
    const updateData = {};
    if (candidateViewsLimit !== undefined) {
      const val = Number(candidateViewsLimit);
      updateData.candidateViewsLimit = val;
      updateData.maxCandidateUnlocks = val;
      updateData.resumeViewsAllowed = val;
    }
    if (jobPostsLimit !== undefined) {
      const val = Number(jobPostsLimit);
      updateData.jobPostsLimit = val;
      updateData.maxJobPosts = val;
      updateData.jobsAllowed = val;
    }

    await RecruiterLimit.updateOne(
      { _id: limitRecord._id },
      { $set: updateData }
    );

    const updated = await RecruiterLimit.findById(limitRecord._id).lean();

    console.log(`✅ [Usages] Updated ${limitRecord._id}:`, updateData);

    return res.status(200).json({
      success: true,
      message: "Recruiter resources successfully updated",
      data: updated,
    });
  } catch (error) {
    console.error("❌ Update Recruiter Limits Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update: " + error.message,
    });
  }
};

module.exports = {
  getPayments,
  getSubscriptions,
  getRecruiterLimits,
  updateRecruiterLimits,
};