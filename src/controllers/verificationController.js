// FILE: backend/src/controllers/verificationController.js
const Verification = require("../models/Verification");
const RecruiterProfile = require("../models/RecruiterProfile");
const { logAudit } = require("../utils/auditLogger");
const { sendEmail } = require("../utils/mailer");

// ─── Helpers ──────────────────────────────────────────────────
const getInitials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "CF";

const timeAgo = (date) => {
  if (!date) return "—";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
};

const DOC_TYPE_LABELS = {
  company_registration: "Company Registration",
  gst_certificate: "GST Certificate",
  incorporation_certificate: "Incorporation Certificate",
  pan_card: "PAN Card",
  address_proof: "Address Proof",
  authorization_letter: "Authorization Letter",
  other: "Other Document",
};

// ─── EMAIL TEMPLATES ──────────────────────────────────────────
const buildApprovalEmail = (recruiterName, companyName) => `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
  <div style="background:linear-gradient(135deg,#5F8A72 0%,#4a6f5b 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="background:rgba(255,255,255,0.2);width:64px;height:64px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
      <span style="font-size:32px;">✓</span>
    </div>
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Verification Approved!</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi <strong>${recruiterName}</strong>,</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Great news! We've successfully verified <strong style="color:#5F8A72;">${companyName}</strong>.
      Your company now has a <strong>Verified Badge</strong> on all job postings.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #5F8A72;padding:16px;border-radius:6px;margin:20px 0;">
      <p style="color:#166534;margin:0;font-size:14px;font-weight:600;">✓ Post unlimited verified jobs</p>
      <p style="color:#166534;margin:6px 0 0;font-size:14px;font-weight:600;">✓ Increased candidate trust</p>
      <p style="color:#166534;margin:6px 0 0;font-size:14px;font-weight:600;">✓ Priority listing in search</p>
    </div>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:24px 0 0;">
      — CareerFlow Compliance Team
    </p>
  </div>
</div>`;

const buildRejectionEmail = (recruiterName, companyName, reason) => `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
  <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Verification Not Approved</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi <strong>${recruiterName}</strong>,</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Unfortunately, we could not verify <strong>${companyName}</strong> at this time.
    </p>
    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:6px;margin:20px 0;">
      <p style="color:#991b1b;margin:0 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Reason for Rejection</p>
      <p style="color:#7f1d1d;margin:0;font-size:14px;line-height:1.6;">${reason || "Please contact support for details."}</p>
    </div>
    <p style="color:#334155;font-size:14px;line-height:1.6;margin:20px 0;">
      You can re-submit your verification with the correct documents from your recruiter dashboard.
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:24px 0 0;">
      — CareerFlow Compliance Team
    </p>
  </div>
</div>`;

const buildClarificationEmail = (recruiterName, companyName, message, docs) => `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
  <div style="background:linear-gradient(135deg,#d97706 0%,#b45309 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Additional Documents Needed</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi <strong>${recruiterName}</strong>,</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">
      To complete verification for <strong>${companyName}</strong>, we need you to re-upload the following documents:
    </p>
    <div style="background:#fffbeb;border-left:4px solid #d97706;padding:16px;border-radius:6px;margin:20px 0;">
      <p style="color:#78350f;margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Documents Required</p>
      <ul style="margin:0;padding-left:20px;color:#92400e;font-size:14px;line-height:1.8;">
        ${(docs || []).map((d) => `<li>${DOC_TYPE_LABELS[d] || d}</li>`).join("")}
      </ul>
    </div>
    ${
      message
        ? `<div style="background:#f1f5f9;padding:16px;border-radius:6px;margin:20px 0;">
            <p style="color:#334155;margin:0 0 8px;font-size:13px;font-weight:700;">Message from Reviewer</p>
            <p style="color:#475569;margin:0;font-size:14px;line-height:1.6;">${message}</p>
          </div>`
        : ""
    }
    <p style="color:#334155;font-size:14px;line-height:1.6;margin:20px 0;">
      Please log into your recruiter dashboard and re-upload the requested documents to complete verification.
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:24px 0 0;">
      — CareerFlow Compliance Team
    </p>
  </div>
</div>`;

// ─── DATA TRANSFORMERS ────────────────────────────────────────
const transformToListItem = (v) => {
  const companyName = v.companyName || v.companySnapshot?.name || "Unnamed Company";
  const submittedAt = v.submittedAt || v.createdAt;

  return {
    id: String(v._id),
    code: `VF-${String(v._id).slice(-6).toUpperCase()}`,
    title: companyName,
    initials: getInitials(companyName),
    type: "Employer Verification",
    priority: v.status === "pending" ? "High Priority" : "Normal Priority",
    submittedTime: timeAgo(submittedAt),
    submittedAtRaw: submittedAt,
    representativeName: v.recruiterName || "—",
    representativeEmail: v.recruiterEmail || "",
    status: v.status,
    reviewedBy: v.reviewedBy || "",
    reviewedAt: v.reviewedAt,
    rejectionReason: v.rejectionReason || "",
    documentsCount: (v.documents || []).length,
    documents: (v.documents || []).map((d) => ({
      name: DOC_TYPE_LABELS[d.docType] || d.docType,
      type: d.docType,
      verified: v.status === "approved",
    })),
  };
};

// ═══════════════════════════════════════════════════════════════
// CONTROLLERS
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/v1/verifications
 * List verifications with filters, search, pagination
 */
const getVerifications = async (req, res) => {
  try {
    const {
      status = "all",
      search = "",
      page = 1,
      limit = 20,
      sort = "oldest",
    } = req.query;

    const filter = {};
    if (status && status !== "all") filter.status = status;

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { companyName: regex },
        { recruiterName: regex },
        { recruiterEmail: regex },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const sortObj =
      sort === "newest" ? { submittedAt: -1 } : { submittedAt: 1 };

    const [items, total, counts] = await Promise.all([
      Verification.find(filter).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Verification.countDocuments(filter),
      Verification.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = {
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      clarification_requested: 0,
      total: 0,
    };
    counts.forEach((c) => {
      statusCounts[c._id] = c.count;
      statusCounts.total += c.count;
    });

    return res.status(200).json({
      success: true,
      data: items.map(transformToListItem),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      counts: statusCounts,
    });
  } catch (error) {
    console.error("Get Verifications Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch verifications",
    });
  }
};

/**
 * GET /api/v1/verifications/:id
 * Get full verification detail + recruiter profile
 */
const getVerificationById = async (req, res) => {
  try {
    const verification = await Verification.findById(req.params.id).lean();
    if (!verification) {
      return res
        .status(404)
        .json({ success: false, message: "Verification request not found" });
    }

    // Fetch full recruiter profile from recruiter_db
    let recruiter = null;
    if (verification.recruiterId) {
      recruiter = await RecruiterProfile.findById(verification.recruiterId).lean();
    }

    const companyName = verification.companyName || verification.companySnapshot?.name || "Unnamed";
    const submittedAt = verification.submittedAt || verification.createdAt;

    const detail = {
      id: String(verification._id),
      code: `VF-${String(verification._id).slice(-6).toUpperCase()}`,
      title: companyName,
      initials: getInitials(companyName),
      status: verification.status,
      submittedAt,
      submittedTime: timeAgo(submittedAt),
      reviewedAt: verification.reviewedAt,
      reviewedBy: verification.reviewedBy || "",
      rejectionReason: verification.rejectionReason || "",
      adminNotes: verification.adminNotes || "",
      clarificationDocs: verification.clarificationDocs || [],
      clarificationMessage: verification.clarificationMessage || "",

      // Company info (from snapshot + recruiter profile)
      company: {
        name: companyName,
        industry:
          verification.companySnapshot?.industry ||
          recruiter?.companyProfile?.industry ||
          "",
        website:
          verification.companySnapshot?.website ||
          recruiter?.companyProfile?.website ||
          "",
        linkedIn: recruiter?.companyProfile?.linkedInUrl || "",
        about: recruiter?.companyProfile?.about || "",
        tagline: recruiter?.companyProfile?.tagline || "",
        logoUrl:
          verification.companySnapshot?.logoUrl ||
          recruiter?.companyProfile?.logo?.url ||
          "",
        city:
          verification.companySnapshot?.city ||
          recruiter?.companyProfile?.city ||
          "",
        state:
          verification.companySnapshot?.state ||
          recruiter?.companyProfile?.state ||
          "",
        country:
          verification.companySnapshot?.country ||
          recruiter?.companyProfile?.country ||
          "",
        address: recruiter?.companyProfile?.address || "",
        headquarters: recruiter?.companyProfile?.headquarters || "",
        registrationNumber:
          verification.companySnapshot?.registrationNumber ||
          recruiter?.companyProfile?.registrationNumber ||
          "",
        gstNumber:
          verification.companySnapshot?.gstNumber ||
          recruiter?.companyProfile?.gstNumber ||
          "",
        panNumber:
          verification.companySnapshot?.panNumber ||
          recruiter?.companyProfile?.panNumber ||
          "",
        foundedYear:
          recruiter?.companyProfile?.foundedYear ||
          recruiter?.companyProfile?.establishedYear ||
          "",
        teamSize: recruiter?.companyProfile?.teamSize || "",
        organizationSize: recruiter?.companyProfile?.organizationSize || "",
        perks: recruiter?.companyProfile?.perks || [],
      },

      // Recruiter info
      recruiter: {
        id: verification.recruiterId ? String(verification.recruiterId) : null,
        name: verification.recruiterName || recruiter?.name || "",
        email: verification.recruiterEmail || recruiter?.email || "",
        avatar: recruiter?.avatar?.url || "",
        designation: recruiter?.designation || "",
        loginMethod: recruiter?.loginMethod || "email",
        role: recruiter?.role || "recruiter",
        isActive: recruiter?.isActive ?? true,
        isVerified: recruiter?.isVerified ?? false,
        verificationStatus: recruiter?.verificationStatus || "pending",
        lastLogin: recruiter?.lastLogin || null,
        contactPerson: recruiter?.companyProfile?.contactPerson || {},
        contactEmail: recruiter?.companyProfile?.contactEmail || "",
        contactPhone: recruiter?.companyProfile?.contactPhone || "",
        whatsappNumber: recruiter?.companyProfile?.whatsappNumber || "",
      },

      // Documents
      documents: (verification.documents || []).map((d) => ({
        id: String(d._id),
        docType: d.docType,
        docTypeLabel: DOC_TYPE_LABELS[d.docType] || d.docType,
        docName: d.docName,
        url: d.url,
        publicId: d.public_id,
        format: d.format || "png",
        size: d.size || 0,
        sizeFormatted: d.size ? `${(d.size / 1024).toFixed(1)} KB` : "—",
        uploadedAt: d.uploadedAt,
        uploadedTime: timeAgo(d.uploadedAt),
        isImage: ["png", "jpg", "jpeg", "webp", "gif"].includes(
          (d.format || "").toLowerCase()
        ),
      })),
    };

    return res.status(200).json({ success: true, data: detail });
  } catch (error) {
    console.error("Get Verification Detail Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch verification detail",
    });
  }
};

/**
 * PATCH /api/v1/verifications/:id/approve
 */
const approveVerification = async (req, res) => {
  try {
    const { adminNotes = "" } = req.body;
    const admin = req.authUser || req.admin;

    const verification = await Verification.findById(req.params.id);
    if (!verification) {
      return res
        .status(404)
        .json({ success: false, message: "Verification not found" });
    }

    if (verification.status === "approved") {
      return res
        .status(400)
        .json({ success: false, message: "Already approved" });
    }

    const before = verification.toObject();

    verification.status = "approved";
    verification.reviewedAt = new Date();
    verification.reviewedBy = admin?.name || admin?.email || "Admin";
    verification.adminNotes = adminNotes;
    verification.rejectionReason = "";
    await verification.save();

    // Sync recruiter profile
    if (verification.recruiterId) {
      await RecruiterProfile.findByIdAndUpdate(
        verification.recruiterId,
        {
          $set: {
            verificationStatus: "approved",
            isVerified: true,
            verificationReviewedAt: new Date(),
            reviewedBy: verification.reviewedBy,
            rejectionReason: "",
          },
        },
        { new: true }
      );
    }

    // Email recruiter
    if (verification.recruiterEmail) {
      try {
        await sendEmail({
          to: verification.recruiterEmail,
          subject: `✓ ${verification.companyName} — Verification Approved`,
          html: buildApprovalEmail(
            verification.recruiterName || "there",
            verification.companyName
          ),
        });
      } catch (mailErr) {
        console.error("Approval email failed:", mailErr.message);
      }
    }

    // Audit log
    await logAudit(req, {
      action: "APPROVE_VERIFICATION",
      category: "verification",
      targetType: "Verification",
      targetId: verification._id,
      targetName: verification.companyName,
      changesBefore: { status: before.status },
      changesAfter: { status: "approved" },
      description: `Approved verification for ${verification.companyName}`,
      status: "success",
    });

    return res.status(200).json({
      success: true,
      message: "Verification approved and recruiter notified.",
      data: transformToListItem(verification.toObject()),
    });
  } catch (error) {
    console.error("Approve Verification Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to approve verification" });
  }
};

/**
 * PATCH /api/v1/verifications/:id/reject
 */
const rejectVerification = async (req, res) => {
  try {
    const { reason = "", adminNotes = "" } = req.body;
    const admin = req.authUser || req.admin;

    if (!reason || !reason.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Rejection reason is required" });
    }

    const verification = await Verification.findById(req.params.id);
    if (!verification) {
      return res
        .status(404)
        .json({ success: false, message: "Verification not found" });
    }

    const before = verification.toObject();

    verification.status = "rejected";
    verification.reviewedAt = new Date();
    verification.reviewedBy = admin?.name || admin?.email || "Admin";
    verification.rejectionReason = reason.trim();
    verification.adminNotes = adminNotes;
    await verification.save();

    // Sync recruiter profile
    if (verification.recruiterId) {
      await RecruiterProfile.findByIdAndUpdate(verification.recruiterId, {
        $set: {
          verificationStatus: "rejected",
          isVerified: false,
          verificationReviewedAt: new Date(),
          reviewedBy: verification.reviewedBy,
          rejectionReason: reason.trim(),
        },
      });
    }

    // Email recruiter
    if (verification.recruiterEmail) {
      try {
        await sendEmail({
          to: verification.recruiterEmail,
          subject: `Verification Update — ${verification.companyName}`,
          html: buildRejectionEmail(
            verification.recruiterName || "there",
            verification.companyName,
            reason
          ),
        });
      } catch (mailErr) {
        console.error("Rejection email failed:", mailErr.message);
      }
    }

    await logAudit(req, {
      action: "REJECT_VERIFICATION",
      category: "verification",
      targetType: "Verification",
      targetId: verification._id,
      targetName: verification.companyName,
      changesBefore: { status: before.status },
      changesAfter: { status: "rejected", reason },
      description: `Rejected verification for ${verification.companyName}: ${reason}`,
      status: "success",
    });

    return res.status(200).json({
      success: true,
      message: "Verification rejected and recruiter notified.",
      data: transformToListItem(verification.toObject()),
    });
  } catch (error) {
    console.error("Reject Verification Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to reject verification" });
  }
};

/**
 * PATCH /api/v1/verifications/:id/request-clarification
 * Ask recruiter to re-upload specified documents
 */
const requestClarification = async (req, res) => {
  try {
    const { docs = [], message = "" } = req.body;
    const admin = req.authUser || req.admin;

    if (!Array.isArray(docs) || docs.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one document type to re-upload",
      });
    }

    const verification = await Verification.findById(req.params.id);
    if (!verification) {
      return res
        .status(404)
        .json({ success: false, message: "Verification not found" });
    }

    verification.status = "clarification_requested";
    verification.reviewedAt = new Date();
    verification.reviewedBy = admin?.name || admin?.email || "Admin";
    verification.clarificationDocs = docs;
    verification.clarificationMessage = message;
    await verification.save();

    // Sync recruiter profile
    if (verification.recruiterId) {
      await RecruiterProfile.findByIdAndUpdate(verification.recruiterId, {
        $set: {
          verificationStatus: "clarification_requested",
          isVerified: false,
          verificationReviewedAt: new Date(),
          reviewedBy: verification.reviewedBy,
        },
      });
    }

    // Email recruiter
    if (verification.recruiterEmail) {
      try {
        await sendEmail({
          to: verification.recruiterEmail,
          subject: `Action Required — Re-upload Documents for ${verification.companyName}`,
          html: buildClarificationEmail(
            verification.recruiterName || "there",
            verification.companyName,
            message,
            docs
          ),
        });
      } catch (mailErr) {
        console.error("Clarification email failed:", mailErr.message);
      }
    }

    await logAudit(req, {
      action: "REQUEST_CLARIFICATION",
      category: "verification",
      targetType: "Verification",
      targetId: verification._id,
      targetName: verification.companyName,
      changesAfter: { docs, message },
      description: `Requested re-upload from ${verification.companyName}: ${docs.join(", ")}`,
      status: "success",
    });

    return res.status(200).json({
      success: true,
      message: "Clarification request sent to recruiter via email.",
      data: transformToListItem(verification.toObject()),
    });
  } catch (error) {
    console.error("Request Clarification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send clarification request",
    });
  }
};

/**
 * GET /api/v1/verifications/stats/overview
 */
const getStats = async (req, res) => {
  try {
    const [statusAgg, todayCount, weekApproved] = await Promise.all([
      Verification.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Verification.countDocuments({
        submittedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
      Verification.countDocuments({
        status: "approved",
        reviewedAt: {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    const stats = {
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      clarification_requested: 0,
    };
    statusAgg.forEach((s) => (stats[s._id] = s.count));

    return res.status(200).json({
      success: true,
      data: {
        ...stats,
        submittedToday: todayCount,
        approvedThisWeek: weekApproved,
        totalPending:
          stats.pending + stats.under_review + stats.clarification_requested,
      },
    });
  } catch (error) {
    console.error("Get Stats Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch stats" });
  }
};

module.exports = {
  getVerifications,
  getVerificationById,
  approveVerification,
  rejectVerification,
  requestClarification,
  getStats,
};