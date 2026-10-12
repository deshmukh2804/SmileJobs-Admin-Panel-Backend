const PaymentTransaction = require("../models/PaymentTransaction");

exports.syncServiceTransaction = async (req, res) => {
  try {
    const {
      recruiterId, recruiterName, recruiterEmail,
      candidateId, candidateName, candidateEmail,
      amountInPaise, currency, razorpayOrderId,
      razorpayPaymentId, status
    } = req.body;

    if (!recruiterId || !candidateId || !razorpayOrderId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const transaction = await PaymentTransaction.findOneAndUpdate(
      { razorpayOrderId },
      {
        recruiterId,
        recruiterName: recruiterName || "Recruiter",
        recruiterEmail: recruiterEmail || "",
        candidateId,
        candidateName: candidateName || "Candidate",
        candidateEmail: candidateEmail || "",
        amountInPaise: Number(amountInPaise),
        currency: currency || "INR",
        razorpayPaymentId: razorpayPaymentId || "",
        status: status || "captured"
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, data: transaction });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getStatsSummary = async (req, res) => {
  try {
    const allTx = await PaymentTransaction.find();

    const counts = { total: allTx.length, successful: 0, pending: 0, failed: 0, refunded: 0 };
    let totalRevenuePaise = 0;

    allTx.forEach(tx => {
      if (tx.status === "captured") {
        counts.successful += 1;
        totalRevenuePaise += tx.amountInPaise;
      } else if (tx.status === "pending") counts.pending += 1;
      else if (tx.status === "failed") counts.failed += 1;
      else if (tx.status === "refunded") counts.refunded += 1;
    });

    const recent = await PaymentTransaction.find().sort({ createdAt: -1 }).limit(10);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalPurchases: counts.total,
          successfulPurchases: counts.successful,
          pendingPurchases: counts.pending,
          failedPurchases: counts.failed,
          refundedPurchases: counts.refunded,
          collectedRevenueInPaise: totalRevenuePaise
        },
        recentTransactions: recent
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status && status !== "ALL") query.status = status.toLowerCase();

    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { recruiterName: searchRegex },
        { recruiterEmail: searchRegex },
        { candidateName: searchRegex },
        { candidateEmail: searchRegex },
        { razorpayOrderId: searchRegex }
      ];
    }

    const total = await PaymentTransaction.countDocuments(query);
    const transactions = await PaymentTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};