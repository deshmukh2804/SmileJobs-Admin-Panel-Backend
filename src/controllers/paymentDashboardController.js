// FILE: backend/src/controllers/paymentDashboardController.js
const ProfilePurchase = require("../models/ProfilePurchase");
const ProfileCredit = require("../models/ProfileCredit");
const Recruiter = require("../models/Recruiter");
const mongoose = require("mongoose");

// Try to load Razorpay for refunds (optional)
let Razorpay;
try {
  Razorpay = require("razorpay");
} catch (e) {
  console.warn("⚠️ Razorpay SDK not installed. Refunds will only update DB status.");
}

// Try to load pricing config for Razorpay keys
let ProfilePricing;
try {
  ProfilePricing = require("../models/ProfilePricing");
} catch (e) {
  console.warn("⚠️ ProfilePricing model not found - using env vars for Razorpay keys");
}

// Statuses considered as "successful"
const SUCCESS_STATUSES = ["captured", "paid"];

/**
 * Helper: Build enriched aggregation pipeline with recruiter lookup
 */
const buildEnrichmentPipeline = (matchStage = {}, sortStage = { createdAt: -1 }, skip = 0, limit = 0) => {
  const pipeline = [{ $match: matchStage }];

  // Lookup recruiter info from same DB (recruiter_db)
  pipeline.push({
    $lookup: {
      from: "recruiters",
      localField: "recruiterId",
      foreignField: "_id",
      as: "recruiterInfo",
    },
  });

  pipeline.push({
    $unwind: {
      path: "$recruiterInfo",
      preserveNullAndEmptyArrays: true,
    },
  });

  pipeline.push({
    $addFields: {
      recruiterName: {
        $ifNull: ["$recruiterInfo.name", "Unknown Recruiter"],
      },
      recruiterEmail: {
        $ifNull: ["$recruiterInfo.email", ""],
      },
      recruiterMobile: {
        $ifNull: ["$recruiterInfo.mobileNumber", ""],
      },
      recruiterCompany: {
        $ifNull: ["$recruiterInfo.companyName", ""],
      },
      amountInPaise: "$totalAmountInPaise",
      candidateName: {
        $cond: {
          if: { $gt: [{ $size: { $ifNull: ["$candidateIds", []] } }, 0] },
          then: {
            $concat: [
              { $toString: { $size: "$candidateIds" } },
              " Profile(s)",
            ],
          },
          else: {
            $concat: [{ $toString: "$quantity" }, " Profile(s)"],
          },
        },
      },
      candidateEmail: "",
    },
  });

  pipeline.push({
    $project: {
      recruiterInfo: 0,
      rawWebhookPayload: 0,
    },
  });

  pipeline.push({ $sort: sortStage });

  if (skip > 0) pipeline.push({ $skip: skip });
  if (limit > 0) pipeline.push({ $limit: limit });

  return pipeline;
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/payment-dashboard/stats
// ═══════════════════════════════════════════════════════════════
exports.getStatsSummary = async (req, res) => {
  try {
    // Count all purchases
    const totalPurchases = await ProfilePurchase.countDocuments();

    // Aggregate success stats
    const successAgg = await ProfilePurchase.aggregate([
      {
        $match: { status: { $in: SUCCESS_STATUSES } },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmountInPaise" },
          totalProfilesSold: { $sum: "$quantity" },
        },
      },
    ]);

    const successfulPurchases = successAgg[0]?.count || 0;
    const collectedRevenueInPaise = successAgg[0]?.totalRevenue || 0;
    const totalProfilesSold = successAgg[0]?.totalProfilesSold || 0;

    // Pending/failed/refunded counts
    const pendingPurchases = await ProfilePurchase.countDocuments({
      status: { $in: ["created", "pending"] },
    });
    const failedPurchases = await ProfilePurchase.countDocuments({ status: "failed" });
    const refundedPurchases = await ProfilePurchase.countDocuments({ status: "refunded" });

    // Credit stats (optional - from profile_credits collection)
    let creditStats = { totalCreditsIssued: 0, totalCreditsUsed: 0, activeRecruiters: 0 };
    try {
      const creditAgg = await ProfileCredit.aggregate([
        {
          $group: {
            _id: null,
            totalPurchased: { $sum: "$totalPurchased" },
            totalUsed: { $sum: "$totalUsed" },
            totalBalance: { $sum: "$balance" },
            activeCount: { $sum: 1 },
          },
        },
      ]);
      if (creditAgg[0]) {
        creditStats = {
          totalCreditsIssued: creditAgg[0].totalPurchased || 0,
          totalCreditsUsed: creditAgg[0].totalUsed || 0,
          currentBalance: creditAgg[0].totalBalance || 0,
          activeRecruiters: creditAgg[0].activeCount || 0,
        };
      }
    } catch (e) {
      console.warn("ProfileCredit stats unavailable:", e.message);
    }

    // Recent 10 transactions enriched
    const recentPipeline = buildEnrichmentPipeline({}, { createdAt: -1 }, 0, 10);
    const recentTransactions = await ProfilePurchase.aggregate(recentPipeline);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalPurchases,
          successfulPurchases,
          pendingPurchases,
          failedPurchases,
          refundedPurchases,
          collectedRevenueInPaise,
          totalProfilesSold,
          averagePricePerProfile:
            totalProfilesSold > 0 ? Math.round(collectedRevenueInPaise / totalProfilesSold) : 0,
        },
        credits: creditStats,
        recentTransactions,
      },
    });
  } catch (err) {
    console.error("❌ getStatsSummary error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/payment-dashboard/transactions
// Query: ?page=1&limit=10&search=&status=&startDate=&endDate=
// ═══════════════════════════════════════════════════════════════
exports.getTransactions = async (req, res) => {
  try {
    const {
      search = "",
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build base match
    const baseMatch = {};

    if (status && status !== "ALL" && status !== "all") {
      baseMatch.status = status.toLowerCase();
    }

    if (startDate || endDate) {
      baseMatch.createdAt = {};
      if (startDate) baseMatch.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        baseMatch.createdAt.$lte = end;
      }
    }

    // If search provided, we need to search in both razorpayOrderId directly
    // AND after lookup in recruiter name/email
    let searchFilter = null;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      searchFilter = {
        $or: [
          { razorpayOrderId: regex },
          { razorpayPaymentId: regex },
          { "recruiterInfo.name": regex },
          { "recruiterInfo.email": regex },
          { "recruiterInfo.companyName": regex },
        ],
      };
    }

    // Build pipeline manually for search support
    const pipeline = [{ $match: baseMatch }];

    pipeline.push({
      $lookup: {
        from: "recruiters",
        localField: "recruiterId",
        foreignField: "_id",
        as: "recruiterInfo",
      },
    });

    pipeline.push({
      $unwind: {
        path: "$recruiterInfo",
        preserveNullAndEmptyArrays: true,
      },
    });

    if (searchFilter) {
      pipeline.push({ $match: searchFilter });
    }

    pipeline.push({
      $addFields: {
        recruiterName: { $ifNull: ["$recruiterInfo.name", "Unknown Recruiter"] },
        recruiterEmail: { $ifNull: ["$recruiterInfo.email", ""] },
        recruiterMobile: { $ifNull: ["$recruiterInfo.mobileNumber", ""] },
        recruiterCompany: { $ifNull: ["$recruiterInfo.companyName", ""] },
        amountInPaise: "$totalAmountInPaise",
        candidateName: {
          $cond: {
            if: { $gt: [{ $size: { $ifNull: ["$candidateIds", []] } }, 0] },
            then: {
              $concat: [
                { $toString: { $size: "$candidateIds" } },
                " Profile(s) Purchased",
              ],
            },
            else: {
              $concat: [{ $toString: "$quantity" }, " Profile(s) Purchased"],
            },
          },
        },
        candidateEmail: "",
      },
    });

    pipeline.push({
      $project: {
        recruiterInfo: 0,
        rawWebhookPayload: 0,
      },
    });

    // Facet for pagination + total count
    pipeline.push({
      $facet: {
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limitNum },
        ],
        totalCount: [{ $count: "count" }],
      },
    });

    const result = await ProfilePurchase.aggregate(pipeline);

    const transactions = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    });
  } catch (err) {
    console.error("❌ getTransactions error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/payment-dashboard/transactions/:id
// ═══════════════════════════════════════════════════════════════
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid transaction ID" });
    }

    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      {
        $lookup: {
          from: "recruiters",
          localField: "recruiterId",
          foreignField: "_id",
          as: "recruiterInfo",
        },
      },
      { $unwind: { path: "$recruiterInfo", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          recruiterName: { $ifNull: ["$recruiterInfo.name", "Unknown Recruiter"] },
          recruiterEmail: { $ifNull: ["$recruiterInfo.email", ""] },
          recruiterMobile: { $ifNull: ["$recruiterInfo.mobileNumber", ""] },
          recruiterCompany: { $ifNull: ["$recruiterInfo.companyName", ""] },
          amountInPaise: "$totalAmountInPaise",
        },
      },
    ];

    const result = await ProfilePurchase.aggregate(pipeline);

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (err) {
    console.error("❌ getTransactionById error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// POST /api/v1/payment-dashboard/transactions/:id/refund
// ═══════════════════════════════════════════════════════════════
exports.refundTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid transaction ID" });
    }

    const transaction = await ProfilePurchase.findById(id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    if (!SUCCESS_STATUSES.includes(transaction.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot refund a transaction with status '${transaction.status}'. Only captured/paid transactions can be refunded.`,
      });
    }

    if (!transaction.razorpayPaymentId) {
      return res.status(400).json({
        success: false,
        message: "No Razorpay payment ID found for this transaction. Cannot process refund via gateway.",
      });
    }

    let razorpayRefundId = null;
    let refundExecutedViaGateway = false;

    // Attempt actual Razorpay refund if SDK + keys available
    if (Razorpay) {
      try {
        let keyId = process.env.RAZORPAY_KEY_ID;
        let keySecret = process.env.RAZORPAY_KEY_SECRET;

        // Try reading from DB pricing config
        if (ProfilePricing) {
          try {
            const pricingDoc = await ProfilePricing.findOne().sort({ updatedAt: -1 }).lean();
            if (pricingDoc) {
              keyId = pricingDoc.razorpayKeyId || keyId;
              keySecret = pricingDoc.razorpayKeySecret || keySecret;
            }
          } catch (e) {
            console.warn("Could not read Razorpay keys from ProfilePricing:", e.message);
          }
        }

        if (keyId && keySecret) {
          const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
          });

          const refund = await razorpay.payments.refund(transaction.razorpayPaymentId, {
            amount: transaction.totalAmountInPaise,
            notes: {
              reason: reason || "Admin initiated refund",
              refunded_by: req.authUser?.email || req.admin?.email || "admin",
            },
          });

          razorpayRefundId = refund.id;
          refundExecutedViaGateway = true;
          console.log(`✅ Razorpay refund executed: ${razorpayRefundId}`);
        } else {
          console.warn("⚠️ Razorpay keys missing - skipping gateway refund, updating DB only");
        }
      } catch (rzpErr) {
        console.error("❌ Razorpay refund failed:", rzpErr.message);
        return res.status(500).json({
          success: false,
          message: `Razorpay refund failed: ${rzpErr.message}`,
          error: rzpErr.error || rzpErr.message,
        });
      }
    }

    // Update DB regardless
    transaction.status = "refunded";
    transaction.refundedAt = new Date();
    transaction.refundReason = reason || "Admin initiated refund";
    if (razorpayRefundId) transaction.razorpayRefundId = razorpayRefundId;
    await transaction.save();

    // Also reduce credit balance if ProfileCredit exists
    try {
      const credit = await ProfileCredit.findOne({ recruiterId: transaction.recruiterId });
      if (credit) {
        credit.balance = Math.max(0, credit.balance - transaction.quantity);
        credit.totalPurchased = Math.max(0, credit.totalPurchased - transaction.quantity);
        await credit.save();
      }
    } catch (e) {
      console.warn("Credit adjustment failed:", e.message);
    }

    return res.status(200).json({
      success: true,
      message: refundExecutedViaGateway
        ? "Refund processed successfully via Razorpay"
        : "Transaction marked as refunded (gateway refund skipped)",
      data: transaction,
      gatewayRefundExecuted: refundExecutedViaGateway,
    });
  } catch (err) {
    console.error("❌ refundTransaction error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/payment-dashboard/credits
// Returns all recruiter credit balances
// ═══════════════════════════════════════════════════════════════
exports.getRecruiterCredits = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const pipeline = [
      {
        $lookup: {
          from: "recruiters",
          localField: "recruiterId",
          foreignField: "_id",
          as: "recruiterInfo",
        },
      },
      { $unwind: { path: "$recruiterInfo", preserveNullAndEmptyArrays: true } },
    ];

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      pipeline.push({
        $match: {
          $or: [
            { "recruiterInfo.name": regex },
            { "recruiterInfo.email": regex },
            { "recruiterInfo.companyName": regex },
          ],
        },
      });
    }

    pipeline.push({
      $addFields: {
        recruiterName: { $ifNull: ["$recruiterInfo.name", "Unknown"] },
        recruiterEmail: { $ifNull: ["$recruiterInfo.email", ""] },
        recruiterCompany: { $ifNull: ["$recruiterInfo.companyName", ""] },
      },
    });

    pipeline.push({ $project: { recruiterInfo: 0 } });

    pipeline.push({
      $facet: {
        data: [{ $sort: { balance: -1 } }, { $skip: skip }, { $limit: limitNum }],
        totalCount: [{ $count: "count" }],
      },
    });

    const result = await ProfileCredit.aggregate(pipeline);
    const credits = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    return res.status(200).json({
      success: true,
      data: credits,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("❌ getRecruiterCredits error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// POST /api/v1/payment-dashboard/service/sync (Service-to-service webhook)
// Kept for backward compatibility with your existing sync route
// ═══════════════════════════════════════════════════════════════
exports.syncServiceTransaction = async (req, res) => {
  try {
    const {
      recruiterId,
      candidateIds = [],
      quantity = 1,
      unitPriceInPaise,
      totalAmountInPaise,
      amountInPaise, // backward compat
      currency = "INR",
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      status = "captured",
    } = req.body;

    if (!recruiterId || !razorpayOrderId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: recruiterId, razorpayOrderId",
      });
    }

    const finalAmount = totalAmountInPaise || amountInPaise;
    if (!finalAmount) {
      return res.status(400).json({ success: false, error: "Amount is required" });
    }

    const updateData = {
      recruiterId: new mongoose.Types.ObjectId(recruiterId),
      candidateIds: candidateIds.map((id) => new mongoose.Types.ObjectId(id)),
      quantity,
      unitPriceInPaise: unitPriceInPaise || Math.floor(finalAmount / quantity),
      totalAmountInPaise: finalAmount,
      currency,
      razorpayPaymentId: razorpayPaymentId || null,
      razorpaySignature: razorpaySignature || null,
      status,
      paidAt: SUCCESS_STATUSES.includes(status) ? new Date() : null,
    };

    const transaction = await ProfilePurchase.findOneAndUpdate(
      { razorpayOrderId },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ success: true, data: transaction });
  } catch (err) {
    console.error("❌ syncServiceTransaction error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};