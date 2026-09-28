// FILE: backend/src/controllers/verificationController.js
const axios = require("axios");
const Verification = require("../models/Verification");
const RecruiterProfile = require("../models/RecruiterProfile");
const { logAudit } = require("../utils/auditLogger");
const { sendEmail } = require("../utils/mailer");
const { cloudinary } = require("../utils/cloudinary");

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

const APP_NAME = process.env.APP_NAME || "Smile Jobs";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://smilejobs-admin-panel-backend.onrender.com";

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

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
    <div style="text-align:center;margin:24px 0;">
      <a href="${FRONTEND_URL}/recruiter/dashboard" style="display:inline-block;background:linear-gradient(135deg,#5F8A72,#4a6f5b);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Go to Dashboard →</a>
    </div>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:24px 0 0;">— ${APP_NAME} Compliance Team</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
</div>`;

const buildRejectionEmail = (recruiterName, companyName, reason) => `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
  <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Verification Not Approved</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi <strong>${recruiterName}</strong>,</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">Unfortunately, we could not verify <strong>${companyName}</strong> at this time.</p>
    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:6px;margin:20px 0;">
      <p style="color:#991b1b;margin:0 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Reason for Rejection</p>
      <p style="color:#7f1d1d;margin:0;font-size:14px;line-height:1.6;">${reason || "Please contact support for details."}</p>
    </div>
    <p style="color:#334155;font-size:14px;line-height:1.6;margin:20px 0;">You can re-submit your verification with the correct documents from your recruiter dashboard.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${FRONTEND_URL}/recruiter/verification" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Re-submit Verification →</a>
    </div>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:24px 0 0;">— ${APP_NAME} Compliance Team</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
</div>`;

const buildClarificationEmail = (recruiterName, companyName, message, docs) => `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
  <div style="background:linear-gradient(135deg,#d97706 0%,#b45309 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Additional Documents Needed</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi <strong>${recruiterName}</strong>,</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">To complete verification for <strong>${companyName}</strong>, we need you to re-upload the following documents:</p>
    <div style="background:#fffbeb;border-left:4px solid #d97706;padding:16px;border-radius:6px;margin:20px 0;">
      <p style="color:#78350f;margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Documents Required</p>
      <ul style="margin:0;padding-left:20px;color:#92400e;font-size:14px;line-height:1.8;">
        ${(docs || []).map((d) => `<li>${DOC_TYPE_LABELS[d] || d}</li>`).join("")}
      </ul>
    </div>
    ${message ? `<div style="background:#f1f5f9;padding:16px;border-radius:6px;margin:20px 0;"><p style="color:#334155;margin:0 0 8px;font-size:13px;font-weight:700;">Message from Reviewer</p><p style="color:#475569;margin:0;font-size:14px;line-height:1.6;">${message}</p></div>` : ""}
    <p style="color:#334155;font-size:14px;line-height:1.6;margin:20px 0;">Please log into your recruiter dashboard and re-upload the requested documents to complete verification.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${FRONTEND_URL}/recruiter/verification" style="display:inline-block;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Upload Documents →</a>
    </div>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:24px 0 0;">— ${APP_NAME} Compliance Team</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
</div>`;

const detectFormatFromUrl = (url = "", docName = "") => {
  const source = `${url} ${docName}`.toLowerCase();
  if (source.match(/\.(pdf)(\?|$|\/)/)) return "pdf";
  if (source.match(/\.(png)(\?|$|\/)/)) return "png";
  if (source.match(/\.(jpg|jpeg)(\?|$|\/)/)) return "jpg";
  if (source.match(/\.(webp)(\?|$|\/)/)) return "webp";
  if (source.match(/\.(gif)(\?|$|\/)/)) return "gif";
  if (source.match(/\.(doc|docx)(\?|$|\/)/)) return "doc";
  return "";
};

// ─── Extract public_id from a Cloudinary URL ─────────────────
const extractPublicIdFromUrl = (url) => {
  if (!url) return null;
  try {
    // Example: https://res.cloudinary.com/mqyjz7hl/image/upload/v1790598640/verihire/verification/6aba5d847b151136acadb15a/sqj3mdjrr2byfcqqxjpo.pdf
    const match = url.match(/\/(?:image|raw|video)\/(?:upload|authenticated|private)\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

const transformToListItem = (v, recruiter = null) => {
  const companyName =
    v.companyName ||
    v.companySnapshot?.name ||
    recruiter?.companyProfile?.name ||
    recruiter?.companyName ||
    "Unnamed Company";

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
    representativeName: v.recruiterName || recruiter?.name || "—",
    representativeEmail: v.recruiterEmail || recruiter?.email || "",
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

const getVerifications = async (req, res) => {
  try {
    const {
      status = "all",
      search = "",
      page = 1,
      limit = 20,
      sort = "oldest",
      includeNotSubmitted = "false",
    } = req.query;

    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    } else if (includeNotSubmitted !== "true") {
      filter.status = { $ne: "not_submitted" };
    }

    if (search && search.trim()) {
      const regex = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const searchOr = [
        { companyName: regex },
        { recruiterName: regex },
        { recruiterEmail: regex },
        { "companySnapshot.name": regex },
      ];

      if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
      else filter.$or = searchOr;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const sortObj =
      sort === "newest"
        ? { submittedAt: -1, createdAt: -1 }
        : { submittedAt: 1, createdAt: 1 };

    const [items, total, counts] = await Promise.all([
      Verification.find(filter).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Verification.countDocuments(filter),
      Verification.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const recruiterIds = items
      .filter((i) => !i.companyName && i.recruiterId)
      .map((i) => i.recruiterId);

    let recruitersMap = new Map();
    if (recruiterIds.length > 0) {
      try {
        const recruiters = await RecruiterProfile.find({
          _id: { $in: recruiterIds },
        }).lean();
        recruitersMap = new Map(recruiters.map((r) => [String(r._id), r]));
      } catch (err) {
        console.warn("Recruiter enrichment failed:", err.message);
      }
    }

    const transformed = items.map((item) => {
      const recruiter = recruitersMap.get(String(item.recruiterId)) || null;
      return transformToListItem(item, recruiter);
    });

    const statusCounts = {
      not_submitted: 0,
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      clarification_requested: 0,
      total: 0,
    };
    counts.forEach((c) => {
      statusCounts[c._id] = c.count;
      if (c._id !== "not_submitted") statusCounts.total += c.count;
    });

    return res.status(200).json({
      success: true,
      data: transformed,
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
      message: "Failed to fetch verifications: " + error.message,
    });
  }
};

const getVerificationById = async (req, res) => {
  try {
    const verification = await Verification.findById(req.params.id).lean();
    if (!verification) {
      return res
        .status(404)
        .json({ success: false, message: "Verification request not found" });
    }

    let recruiter = null;
    if (verification.recruiterId) {
      try {
        recruiter = await RecruiterProfile.findById(
          verification.recruiterId
        ).lean();
      } catch (err) {
        console.warn("Recruiter lookup failed:", err.message);
      }
    }

    const companyName =
      verification.companyName ||
      verification.companySnapshot?.name ||
      recruiter?.companyProfile?.name ||
      recruiter?.companyName ||
      "Unnamed";

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

      company: {
        name: companyName,
        industry:
          verification.companySnapshot?.industry ||
          recruiter?.companyProfile?.industry ||
          recruiter?.industry ||
          "",
        website:
          verification.companySnapshot?.website ||
          recruiter?.companyProfile?.website ||
          recruiter?.website ||
          "",
        linkedIn:
          recruiter?.companyProfile?.linkedInUrl ||
          recruiter?.linkedInUrl ||
          "",
        about:
          verification.companySnapshot?.about ||
          recruiter?.companyProfile?.about ||
          recruiter?.about ||
          "",
        tagline:
          recruiter?.companyProfile?.tagline || recruiter?.tagline || "",
        logoUrl:
          verification.companySnapshot?.logoUrl ||
          recruiter?.companyProfile?.logo?.url ||
          recruiter?.companyLogo?.url ||
          "",
        city:
          verification.companySnapshot?.city ||
          recruiter?.companyProfile?.city ||
          recruiter?.city ||
          "",
        state:
          verification.companySnapshot?.state ||
          recruiter?.companyProfile?.state ||
          recruiter?.state ||
          "",
        country:
          verification.companySnapshot?.country ||
          recruiter?.companyProfile?.country ||
          recruiter?.country ||
          "India",
        address:
          recruiter?.companyProfile?.address || recruiter?.address || "",
        headquarters:
          recruiter?.companyProfile?.headquarters ||
          recruiter?.headquarters ||
          "",
        registrationNumber:
          verification.companySnapshot?.registrationNumber ||
          recruiter?.companyProfile?.registrationNumber ||
          recruiter?.registrationNumber ||
          "",
        gstNumber:
          verification.companySnapshot?.gstNumber ||
          recruiter?.companyProfile?.gstNumber ||
          recruiter?.gstNumber ||
          "",
        panNumber:
          verification.companySnapshot?.panNumber ||
          recruiter?.companyProfile?.panNumber ||
          recruiter?.panNumber ||
          "",
        foundedYear:
          verification.companySnapshot?.establishedYear ||
          recruiter?.companyProfile?.foundedYear ||
          recruiter?.companyProfile?.establishedYear ||
          recruiter?.foundedYear ||
          "",
        teamSize:
          recruiter?.companyProfile?.teamSize || recruiter?.teamSize || "",
        organizationSize:
          verification.companySnapshot?.organizationSize ||
          recruiter?.companyProfile?.organizationSize ||
          recruiter?.organizationSize ||
          "",
        perks: recruiter?.companyProfile?.perks || recruiter?.perks || [],
      },

      recruiter: {
        id: verification.recruiterId
          ? String(verification.recruiterId)
          : null,
        name:
          verification.recruiterName ||
          recruiter?.name ||
          recruiter?.fullName ||
          "",
        email: verification.recruiterEmail || recruiter?.email || "",
        phone:
          verification.recruiterPhone ||
          recruiter?.phone ||
          recruiter?.mobileNumber ||
          "",
        avatar: recruiter?.avatar?.url || recruiter?.profilePicture?.url || "",
        designation: recruiter?.designation || "",
        loginMethod: recruiter?.loginMethod || "email",
        role: recruiter?.role || "recruiter",
        isActive: recruiter?.isActive ?? true,
        isVerified: recruiter?.isVerified ?? false,
        verificationStatus:
          recruiter?.verificationStatus || verification.status || "pending",
        lastLogin: recruiter?.lastLogin || null,
        contactPerson:
          recruiter?.companyProfile?.contactPerson || {
            name:
              verification.companySnapshot?.contactPersonName ||
              recruiter?.name ||
              "",
            designation:
              verification.companySnapshot?.contactPersonDesignation ||
              recruiter?.designation ||
              "",
          },
        contactEmail:
          verification.companySnapshot?.contactEmail ||
          recruiter?.companyProfile?.contactEmail ||
          recruiter?.email ||
          "",
        contactPhone:
          verification.companySnapshot?.contactPhone ||
          recruiter?.companyProfile?.contactPhone ||
          recruiter?.phone ||
          "",
        whatsappNumber:
          recruiter?.companyProfile?.whatsappNumber ||
          recruiter?.whatsappNumber ||
          "",
      },

      documents: (verification.documents || []).map((d) => {
        const detectedFormat = (d.format || "").toLowerCase();
        const finalFormat =
          detectedFormat || detectFormatFromUrl(d.url, d.docName) || "png";
        const isPdf = finalFormat === "pdf";
        const isImage = ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(
          finalFormat
        );
        const isDoc = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(
          finalFormat
        );

        const viewableUrl = isPdf
          ? `${BACKEND_URL}/api/v1/verifications/${verification._id}/documents/${d._id}/proxy`
          : d.url;

        return {
          id: String(d._id),
          docType: d.docType,
          docTypeLabel: DOC_TYPE_LABELS[d.docType] || d.docType,
          docName: d.docName,
          url: viewableUrl,
          downloadUrl: viewableUrl,
          originalUrl: d.url,
          publicId: d.public_id,
          format: finalFormat,
          size: d.size || 0,
          sizeFormatted: d.size
            ? d.size > 1024 * 1024
              ? `${(d.size / (1024 * 1024)).toFixed(2)} MB`
              : `${(d.size / 1024).toFixed(1)} KB`
            : "—",
          uploadedAt: d.uploadedAt,
          uploadedTime: timeAgo(d.uploadedAt),
          isImage,
          isPdf,
          isDoc,
        };
      }),
    };

    return res.status(200).json({ success: true, data: detail });
  } catch (error) {
    console.error("Get Verification Detail Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch verification detail: " + error.message,
    });
  }
};

/**
 * PDF PROXY (Admin API Method — 100% works regardless of ACL)
 * GET /api/v1/verifications/:id/documents/:docId/proxy
 */
const proxyDocument = async (req, res) => {
  try {
    const { id, docId } = req.params;

    // Remove headers that block iframe embedding
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");

    const verification = await Verification.findById(id).lean();
    if (!verification) {
      return res
        .status(404)
        .json({ success: false, message: "Verification not found" });
    }

    const doc = (verification.documents || []).find(
      (d) => String(d._id) === String(docId)
    );

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Document not found" });
    }

    // Try to extract public_id from URL if not stored properly
    const publicId =
      doc.public_id || extractPublicIdFromUrl(doc.url) || "";

    console.log(`🔍 PDF Proxy request for docId=${docId}, publicId=${publicId}`);

    // ═══════════════════════════════════════════════════════════
    // STRATEGY 1: Cloudinary Admin API (using Basic Auth)
    // This ALWAYS works because we're the account owner
    // ═══════════════════════════════════════════════════════════
    const adminApiAttempts = [
      // Try image resource type with various delivery types
      { resource_type: "image", type: "upload" },
      { resource_type: "image", type: "authenticated" },
      { resource_type: "image", type: "private" },
      { resource_type: "raw", type: "upload" },
      { resource_type: "raw", type: "authenticated" },
      { resource_type: "raw", type: "private" },
    ];

    let secureUrl = null;
    let assetInfo = null;

    for (const attempt of adminApiAttempts) {
      try {
        const adminApiUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${attempt.resource_type}/${attempt.type}/${encodeURIComponent(publicId)}`;

        const response = await axios.get(adminApiUrl, {
          auth: {
            username: CLOUDINARY_API_KEY,
            password: CLOUDINARY_API_SECRET,
          },
          timeout: 8000,
          validateStatus: (s) => s >= 200 && s < 300,
        });

        if (response.data && response.data.secure_url) {
          assetInfo = response.data;
          secureUrl = response.data.secure_url;
          console.log(`✅ Found asset via Admin API (${attempt.resource_type}/${attempt.type}): ${secureUrl}`);
          break;
        }
      } catch (err) {
        continue;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STRATEGY 2: Generate signed download URL using API secret
    // ═══════════════════════════════════════════════════════════
    if (!secureUrl && publicId) {
      try {
        // Generate signed URL manually
        const timestamp = Math.floor(Date.now() / 1000) + 3600;

        const signedUrl = cloudinary.utils.private_download_url(
          publicId,
          "pdf",
          {
            resource_type: assetInfo?.resource_type || "image",
            type: assetInfo?.type || "upload",
            expires_at: timestamp,
          }
        );

        secureUrl = signedUrl;
        console.log(`✅ Generated signed private_download_url: ${secureUrl}`);
      } catch (err) {
        console.warn("Signed URL generation failed:", err.message);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STRATEGY 3: Use the raw stored URL as final fallback
    // ═══════════════════════════════════════════════════════════
    if (!secureUrl) {
      secureUrl = doc.url;
      console.log(`⚠️ Falling back to original URL: ${secureUrl}`);
    }

    // ═══════════════════════════════════════════════════════════
    // Fetch the actual PDF bytes and stream to client
    // ═══════════════════════════════════════════════════════════
    let fetchedResponse = null;
    const fetchAttempts = [secureUrl];

    // If secureUrl differs from doc.url, also try the original as final backup
    if (secureUrl !== doc.url) {
      fetchAttempts.push(doc.url);
    }

    let lastError = null;

    for (const attemptUrl of fetchAttempts) {
      try {
        const response = await axios.get(attemptUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
          maxRedirects: 5,
          validateStatus: (s) => s >= 200 && s < 300,
        });
        if (response.data && response.data.byteLength > 0) {
          fetchedResponse = response;
          console.log(`✅ Successfully fetched PDF (${response.data.byteLength} bytes)`);
          break;
        }
      } catch (err) {
        lastError = err.message;
        console.warn(`Fetch attempt failed for ${attemptUrl.slice(0, 80)}...`, err.message);
        continue;
      }
    }

    if (!fetchedResponse) {
      console.error(`❌ ALL PDF proxy attempts failed for doc ${docId}:`, lastError);
      return res.status(502).json({
        success: false,
        message: "Failed to fetch document from secure storage",
        error: lastError,
        hint: "Please verify Cloudinary API credentials and asset access permissions",
      });
    }

    const contentType =
      fetchedResponse.headers["content-type"] || "application/pdf";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${doc.docName || "document.pdf"}"`
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.send(Buffer.from(fetchedResponse.data));
  } catch (error) {
    console.error("Proxy Document Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to proxy document",
      error: error.message,
    });
  }
};

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

    if (verification.recruiterId) {
      try {
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
      } catch (syncErr) {
        console.warn("Recruiter sync warning:", syncErr.message);
      }
    }

    if (verification.recruiterEmail) {
      try {
        const emailResult = await sendEmail({
          to: verification.recruiterEmail,
          subject: `✓ ${verification.companyName || "Your Company"} — Verification Approved | ${APP_NAME}`,
          html: buildApprovalEmail(
            verification.recruiterName || "there",
            verification.companyName || "Your Company"
          ),
          recipientName: verification.recruiterName || "Recruiter",
        });
        if (emailResult.success) {
          console.log(
            `📧 Approval email delivered to ${verification.recruiterEmail}`
          );
        }
      } catch (mailErr) {
        console.error("Approval email failed:", mailErr.message);
      }
    }

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

    if (verification.recruiterId) {
      try {
        await RecruiterProfile.findByIdAndUpdate(verification.recruiterId, {
          $set: {
            verificationStatus: "rejected",
            isVerified: false,
            verificationReviewedAt: new Date(),
            reviewedBy: verification.reviewedBy,
            rejectionReason: reason.trim(),
          },
        });
      } catch (syncErr) {
        console.warn("Recruiter sync warning:", syncErr.message);
      }
    }

    if (verification.recruiterEmail) {
      try {
        const emailResult = await sendEmail({
          to: verification.recruiterEmail,
          subject: `Verification Update — ${verification.companyName || "Your Company"} | ${APP_NAME}`,
          html: buildRejectionEmail(
            verification.recruiterName || "there",
            verification.companyName || "Your Company",
            reason
          ),
          recipientName: verification.recruiterName || "Recruiter",
        });
        if (emailResult.success) {
          console.log(
            `📧 Rejection email delivered to ${verification.recruiterEmail}`
          );
        }
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

    if (verification.recruiterId) {
      try {
        await RecruiterProfile.findByIdAndUpdate(verification.recruiterId, {
          $set: {
            verificationStatus: "clarification_requested",
            isVerified: false,
            verificationReviewedAt: new Date(),
            reviewedBy: verification.reviewedBy,
          },
        });
      } catch (syncErr) {
        console.warn("Recruiter sync warning:", syncErr.message);
      }
    }

    if (verification.recruiterEmail) {
      try {
        const emailResult = await sendEmail({
          to: verification.recruiterEmail,
          subject: `Action Required — Re-upload Documents for ${verification.companyName || "Your Company"} | ${APP_NAME}`,
          html: buildClarificationEmail(
            verification.recruiterName || "there",
            verification.companyName || "Your Company",
            message,
            docs
          ),
          recipientName: verification.recruiterName || "Recruiter",
        });
        if (emailResult.success) {
          console.log(
            `📧 Clarification email delivered to ${verification.recruiterEmail}`
          );
        }
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
      not_submitted: 0,
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      clarification_requested: 0,
    };
    statusAgg.forEach((s) => {
      stats[s._id] = s.count;
    });

    return res.status(200).json({
      success: true,
      data: {
        ...stats,
        submittedToday: todayCount,
        approvedThisWeek: weekApproved,
        totalPending:
          stats.pending +
          stats.under_review +
          stats.clarification_requested,
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
  proxyDocument,
};