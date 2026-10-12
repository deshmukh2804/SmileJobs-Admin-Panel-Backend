// FILE: backend/src/controllers/paymentController.js
const PaymentTransaction = require("../models/PaymentTransaction");
const ProfilePricing = require("../models/ProfilePricing");
const PricingAuditLog = require("../models/PricingAuditLog");

/**
 * POST /api/v1/payment-dashboard/service/transactions
 * SERVICE-TO-SERVICE endpoint
 * The Recruiter Website calls this to report a transaction event
 * Protected by X-Service-API-Key header via serviceAuth middleware
 */
exports.syncServiceTransaction = async (req, res) => {
  try {
    const {
      recruiterId,
      recruiterName,
      recruiterEmail,
      candidateId,
      candidateName,
      candidateEmail,
      amountInPaise,
      currency,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      status,
      errorCode,
      errorDescription,
      metadata,
    } = req.body;

    // ─── Validation ───
    if (!recruiterId || !recruiterEmail || !candidateId) {
      return res.status(400).json({
        success: false,
        message: "recruiterId, recruiterEmail, and candidateId are required",
      });
    }

    if (amountInPaise === undefined || amountInPaise === null) {
      return res.status(400).json({
        success: false,
        message: "amountInPaise is required",
      });
    }

    const amt = Number(amountInPaise);
    if (!Number.isInteger(amt) || amt < 0) {
      return res.status(400).json({
        success: false,
        message: "amountInPaise must be a non-negative integer",
      });
    }

    if (!status || !["pending", "captured", "failed", "refunded"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be one of: pending, captured, failed, refunded",
      });
    }

    // ─── Upsert by razorpayOrderId (preferred) or create new ───
    let transaction = null;

    if (razorpayOrderId) {
      transaction = await PaymentTransaction.findOne({ razorpayOrderId });
    }

    if (!transaction) {
      transaction = new PaymentTransaction({
        recruiterId: String(recruiterId),
        recruiterName: recruiterName || "",
        recruiterEmail: String(recruiterEmail).toLowerCase(),
        candidateId: String(candidateId),
        candidateName: candidateName || "",
        candidateEmail: candidateEmail || "",
        amountInPaise: amt,
        currency: (currency || "INR").toUpperCase(),
        razorpayOrderId: razorpayOrderId || "",
        razorpayPaymentId: razorpayPaymentId || "",
        razorpaySignature: razorpaySignature || "",
        status,
        errorCode: errorCode || "",
        errorDescription: errorDescription || "",
        accessGranted: status === "captured",
        metadata: metadata || {},
      });
    } else {
      // Update existing transaction
      transaction.status = status;
      if (razorpayPaymentId) transaction.razorpayPaymentId = razorpayPaymentId;
      if (razorpaySignature) transaction.razorpaySignature = razorpaySignature;
      if (candidateName) transaction.candidateName = candidateName;
      if (candidateEmail) transaction.candidateEmail = candidateEmail;
      if (recruiterName) transaction.recruiterName = recruiterName;
      if (errorCode) transaction.errorCode = errorCode;
      if (errorDescription) transaction.errorDescription = errorDescription;
      if (metadata) transaction.metadata = { ...transaction.metadata, ...metadata };
      if (status === "captured") transaction.accessGranted = true;
    }

    await transaction.save();

    return res.status(200).json({
      success: true,
      message: "Transaction recorded successfully",
      transaction: {
        _id: transaction._id,
        recruiterId: transaction.recruiterId,
        candidateId: transaction.candidateId,
        amountInPaise: transaction.amountInPaise,
        status: transaction.status,
        razorpayOrderId: transaction.razorpayOrderId,
        razorpayPaymentId: transaction.razorpayPaymentId,
        accessGranted: transaction.accessGranted,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ [PAYMENT] syncServiceTransaction error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to record transaction",
    });
  }
};

/**
 * GET /api/v1/payment-dashboard/transactions
 * Admin reads paginated transaction list with filters
 */
exports.getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const search = (req.query.search || "").trim();
    const status = req.query.status || "";
    const startDate = req.query.startDate || "";
    const endDate = req.query.endDate || "";

    const filter = {};

    if (status && ["pending", "captured", "failed", "refunded"].includes(status)) {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { recruiterName: { $regex: search, $options: "i" } },
        { recruiterEmail: { $regex: search, $options: "i" } },
        { candidateName: { $regex: search, $options: "i" } },
        { candidateEmail: { $regex: search, $options: "i" } },
        { razorpayOrderId: { $regex: search, $options: "i" } },
        { razorpayPaymentId: { $regex: search, $options: "i" } },
        { recruiterId: { $regex: search, $options: "i" } },
        { candidateId: { $regex: search, $options: "i" } },
      ];
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      PaymentTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PaymentTransaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("❌ [PAYMENT] getTransactions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
};

/**
 * GET /api/v1/payment-dashboard/stats
 * Admin reads aggregate payment statistics
 */
exports.getStatsSummary = async (req, res) => {
  try {
    const [
      totalPurchases,
      successfulPayments,
      pendingPayments,
      failedPayments,
      refundedPayments,
      revenueAgg,
      refundAgg,
      recentTransactions,
    ] = await Promise.all([
      PaymentTransaction.countDocuments(),
      PaymentTransaction.countDocuments({ status: "captured" }),
      PaymentTransaction.countDocuments({ status: "pending" }),
      PaymentTransaction.countDocuments({ status: "failed" }),
      PaymentTransaction.countDocuments({ status: "refunded" }),
      PaymentTransaction.aggregate([
        { $match: { status: "captured" } },
        { $group: { _id: null, total: { $sum: "$amountInPaise" } } },
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: "refunded" } },
        { $group: { _id: null, total: { $sum: "$amountInPaise" } } },
      ]),
      PaymentTransaction.find().sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    const totalRevenueInPaise = revenueAgg.length > 0 ? revenueAgg[0].total : 0;
    const totalRefundedInPaise = refundAgg.length > 0 ? refundAgg[0].total : 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalPurchases,
        successfulPayments,
        pendingPayments,
        failedPayments,
        refundedPayments,
        totalCollectedInPaise: totalRevenueInPaise,
        totalCollectedAmount: totalRevenueInPaise / 100,
        totalRefundedInPaise,
        totalRefundedAmount: totalRefundedInPaise / 100,
        netRevenueAmount: (totalRevenueInPaise - totalRefundedInPaise) / 100,
      },
      recentTransactions,
    });
  } catch (error) {
    console.error("❌ [PAYMENT] getStatsSummary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to compute payment statistics",
    });
  }
};

/**
 * POST /api/v1/payment-dashboard/transactions/:id/refund
 * Admin triggers a refund on a captured transaction
 * Records audit log; revokes candidate-profile access
 */
exports.processRefund = async (req, res) => {
  try {
    const admin = req.user || req.admin || req.authUser;
    if (!admin || !admin._id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Refund reason is required (minimum 3 characters)",
      });
    }

    const transaction = await PaymentTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    if (transaction.status !== "captured") {
      return res.status(400).json({
        success: false,
        message: `Only captured transactions can be refunded. Current status: ${transaction.status}`,
      });
    }

    const beforeSnapshot = transaction.toObject();

    // ─── Attempt real Razorpay API refund if credentials exist ───
    const pricing = await ProfilePricing.getActiveWithSecret();
    let razorpayRefundId = "";
    let razorpayError = "";

    if (pricing.razorpayKeyId && pricing.razorpayKeySecret && transaction.razorpayPaymentId) {
      try {
        const axios = require("axios");
        const authHeader = Buffer.from(
          `${pricing.razorpayKeyId}:${pricing.razorpayKeySecret}`
        ).toString("base64");

        const rzpResponse = await axios.post(
          `https://api.razorpay.com/v1/payments/${transaction.razorpayPaymentId}/refund`,
          {
            amount: transaction.amountInPaise,
            notes: {
              reason: String(reason).trim(),
              refundedBy: admin.email || "admin",
            },
          },
          {
            headers: {
              Authorization: `Basic ${authHeader}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );

        if (rzpResponse.data && rzpResponse.data.id) {
          razorpayRefundId = rzpResponse.data.id;
        }
      } catch (apiErr) {
        razorpayError = apiErr.response?.data?.error?.description || apiErr.message;
        console.warn("⚠️ [PAYMENT] Razorpay refund API failed:", razorpayError);
        // Continue with internal refund marking even if Razorpay API fails
      }
    } else {
      console.warn("⚠️ [PAYMENT] Razorpay credentials or paymentId missing — marking refund internally only");
    }

    // ─── Mark transaction as refunded ───
    transaction.status = "refunded";
    transaction.refundId = razorpayRefundId || `internal_${Date.now()}`;
    transaction.refundReason = String(reason).trim();
    transaction.refundedAt = new Date();
    transaction.refundedBy = admin._id;
    transaction.refundedByName = admin.name || "";
    transaction.accessGranted = false;
    transaction.accessRevokedAt = new Date();

    await transaction.save();

    // ─── Audit log ───
    await PricingAuditLog.create({
      actorId: admin._id,
      actorName: admin.name || "Unknown",
      actorEmail: admin.email || "",
      actorRole: admin.role || "",
      action: "TRIGGER_REFUND",
      details: `Refunded ${transaction.currency} ${(transaction.amountInPaise / 100).toFixed(2)} to recruiter ${transaction.recruiterEmail}. Reason: ${reason}${razorpayError ? ` | Razorpay API error: ${razorpayError}` : ""}`,
      changesBefore: beforeSnapshot,
      changesAfter: transaction.toObject(),
      targetId: String(transaction._id),
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      status: razorpayError ? "failed" : "success",
      errorMessage: razorpayError,
    });

    return res.status(200).json({
      success: true,
      message: razorpayError
        ? "Refund marked internally but Razorpay API failed. Please reconcile manually."
        : "Refund processed successfully.",
      transaction: transaction.toObject(),
      razorpayError: razorpayError || undefined,
    });
  } catch (error) {
    console.error("❌ [PAYMENT] processRefund error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process refund",
    });
  }
};