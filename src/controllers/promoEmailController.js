// FILE: backend/src/controllers/promoEmailController.js
const PromotionalEmail = require("../models/PromotionalEmail");
const User = require("../models/User");
const Recruiter = require("../models/Recruiter");
const { sendBulkEmail, verifyConnection } = require("../utils/mailer");

const APP_NAME = process.env.APP_NAME || "Smile Jobs";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ═══════════════════════════════════════════════════════════════
// @desc    Get all promotional email campaigns
// @route   GET /api/v1/promotional-emails
// ═══════════════════════════════════════════════════════════════
const getCampaigns = async (req, res) => {
  try {
    const {
      status,
      templateType,
      targetAudience,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (templateType && templateType !== "all")
      filter.templateType = templateType;
    if (targetAudience && targetAudience !== "all")
      filter.targetAudience = targetAudience;
    if (search) {
      filter.$or = [
        { campaignName: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [campaigns, total] = await Promise.all([
      PromotionalEmail.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      PromotionalEmail.countDocuments(filter),
    ]);

    const [draftCount, sentCount, scheduledCount, failedCount] =
      await Promise.all([
        PromotionalEmail.countDocuments({ status: "draft" }),
        PromotionalEmail.countDocuments({ status: "sent" }),
        PromotionalEmail.countDocuments({ status: "scheduled" }),
        PromotionalEmail.countDocuments({ status: "failed" }),
      ]);

    res.status(200).json({
      success: true,
      data: campaigns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
      counts: {
        draft: draftCount,
        sent: sentCount,
        scheduled: scheduledCount,
        failed: failedCount,
        total: draftCount + sentCount + scheduledCount + failedCount,
      },
    });
  } catch (error) {
    console.error("Get Campaigns Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching campaigns",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Get single campaign
// @route   GET /api/v1/promotional-emails/:id
// ═══════════════════════════════════════════════════════════════
const getCampaignById = async (req, res) => {
  try {
    const campaign = await PromotionalEmail.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    console.error("Get Campaign Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching campaign",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Create & save draft campaign
// @route   POST /api/v1/promotional-emails/draft
// ═══════════════════════════════════════════════════════════════
const createDraft = async (req, res) => {
  try {
    const adminId = req.authUser.id || req.authUser.adminId;
    const adminName = req.authUser.name || "Admin";
    const adminEmail = req.authUser.email || "";

    const {
      campaignName,
      subject,
      previewText,
      htmlContent,
      templateType = "promotion",
      targetAudience = "all",
      targetUserIds = [],
      filters = {},
      scheduledAt,
    } = req.body;

    if (!campaignName || !subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: "Campaign name, subject, and HTML content are required",
      });
    }

    const campaign = await PromotionalEmail.create({
      campaignName,
      subject,
      previewText,
      htmlContent,
      templateType,
      targetAudience,
      targetUserIds,
      filters,
      sentBy: { adminId, adminName, adminEmail },
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: scheduledAt ? "scheduled" : "draft",
    });

    res.status(201).json({
      success: true,
      message: scheduledAt
        ? "Campaign scheduled successfully"
        : "Draft saved successfully",
      data: campaign,
    });
  } catch (error) {
    console.error("Create Draft Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while creating draft",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Send promotional email campaign NOW
// @route   POST /api/v1/promotional-emails/:id/send
// ═══════════════════════════════════════════════════════════════
const sendCampaign = async (req, res) => {
  try {
    const campaign = await PromotionalEmail.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (campaign.status === "sent") {
      return res.status(400).json({
        success: false,
        message: "Campaign has already been sent",
      });
    }

    // Resolve recipients
    let recipients = [];

    if (
      campaign.targetAudience === "specific" &&
      campaign.targetUserIds.length > 0
    ) {
      const users = await User.find({
        _id: { $in: campaign.targetUserIds },
        isActive: { $ne: false },
        unsubscribedFromEmails: { $ne: true },
      }).select("name email city phone phoneNumber");

      const recs = await Recruiter.find({
        _id: { $in: campaign.targetUserIds },
        isActive: { $ne: false },
      }).select("name email");

      recipients = [
        ...users.map((u) => ({
          email: u.email,
          name: u.name,
          city: u.city || "",
          phone: u.phone || u.phoneNumber || "",
        })),
        ...recs.map((r) => ({
          email: r.email,
          name: r.name,
          city: "",
          phone: "",
        })),
      ];
    } else {
      const userFilter = {
        isActive: { $ne: false },
        unsubscribedFromEmails: { $ne: true },
      };

      // Apply filters
      if (campaign.filters?.city)
        userFilter.city = {
          $regex: campaign.filters.city,
          $options: "i",
        };
      if (campaign.filters?.state)
        userFilter.state = {
          $regex: campaign.filters.state,
          $options: "i",
        };
      if (campaign.filters?.experienceLevel)
        userFilter.experienceLevel = campaign.filters.experienceLevel;
      if (campaign.filters?.industry)
        userFilter.industry = {
          $regex: campaign.filters.industry,
          $options: "i",
        };
      if (
        campaign.filters?.skills &&
        campaign.filters.skills.length > 0
      ) {
        userFilter.skills = { $in: campaign.filters.skills };
      }
      if (campaign.filters?.registeredAfter) {
        userFilter.createdAt = {
          ...userFilter.createdAt,
          $gte: new Date(campaign.filters.registeredAfter),
        };
      }
      if (campaign.filters?.registeredBefore) {
        userFilter.createdAt = {
          ...userFilter.createdAt,
          $lte: new Date(campaign.filters.registeredBefore),
        };
      }

      if (
        campaign.targetAudience === "all" ||
        campaign.targetAudience === "candidates"
      ) {
        const users = await User.find(userFilter).select(
          "name email city phone phoneNumber"
        );
        recipients.push(
          ...users.map((u) => ({
            email: u.email,
            name: u.name,
            city: u.city || "",
            phone: u.phone || u.phoneNumber || "",
          }))
        );
      }

      if (
        campaign.targetAudience === "all" ||
        campaign.targetAudience === "recruiters"
      ) {
        const recs = await Recruiter.find({
          isActive: { $ne: false },
        }).select("name email");
        recipients.push(
          ...recs.map((r) => ({
            email: r.email,
            name: r.name,
            city: "",
            phone: "",
          }))
        );
      }
    }

    // Filter out duplicates by email
    const seen = new Set();
    recipients = recipients.filter((r) => {
      if (!r.email || seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    });

    if (recipients.length === 0) {
      campaign.status = "failed";
      campaign.stats.totalRecipients = 0;
      await campaign.save();
      return res.status(400).json({
        success: false,
        message: "No eligible recipients found for this campaign",
      });
    }

    // Update status to sending
    campaign.status = "sending";
    campaign.stats.totalRecipients = recipients.length;
    await campaign.save();

    // Send emails via Brevo SMTP
    const result = await sendBulkEmail(
      recipients,
      campaign.subject,
      campaign.htmlContent
    );

    // Update campaign with results
    campaign.status = "sent";
    campaign.sentAt = new Date();
    campaign.stats.sent = result.sent;
    campaign.stats.failed = result.failed;

    if (result.errors && result.errors.length > 0) {
      campaign.errors = result.errors.map((e) => ({
        email: e.email,
        error: e.error,
        timestamp: new Date(),
      }));
    }

    await campaign.save();

    res.status(200).json({
      success: true,
      message: `Campaign sent to ${result.sent} recipient(s). ${result.failed} failed.`,
      data: campaign,
    });
  } catch (error) {
    console.error("Send Campaign Error:", error.message);

    // Try to update campaign status
    try {
      await PromotionalEmail.findByIdAndUpdate(req.params.id, {
        status: "failed",
      });
    } catch (updateErr) {
      console.error("Failed to update campaign status:", updateErr.message);
    }

    res.status(500).json({
      success: false,
      message: "Server error while sending campaign",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Send NEW campaign directly (create + send in one go)
// @route   POST /api/v1/promotional-emails/send-now
// ═══════════════════════════════════════════════════════════════
const sendNow = async (req, res) => {
  try {
    const adminId = req.authUser.id || req.authUser.adminId;
    const adminName = req.authUser.name || "Admin";
    const adminEmail = req.authUser.email || "";

    const {
      campaignName,
      subject,
      previewText,
      htmlContent,
      templateType = "promotion",
      targetAudience = "all",
      targetUserIds = [],
      filters = {},
    } = req.body;

    if (!campaignName || !subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: "Campaign name, subject, and HTML content are required",
      });
    }

    // Create campaign record
    const campaign = await PromotionalEmail.create({
      campaignName,
      subject,
      previewText,
      htmlContent,
      templateType,
      targetAudience,
      targetUserIds,
      filters,
      sentBy: { adminId, adminName, adminEmail },
      status: "sending",
    });

    // Forward to sendCampaign logic
    req.params.id = campaign._id.toString();
    return sendCampaign(req, res);
  } catch (error) {
    console.error("Send Now Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while sending campaign",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Update draft campaign
// @route   PUT /api/v1/promotional-emails/:id
// ═══════════════════════════════════════════════════════════════
const updateCampaign = async (req, res) => {
  try {
    const campaign = await PromotionalEmail.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (campaign.status === "sent" || campaign.status === "sending") {
      return res.status(400).json({
        success: false,
        message: "Cannot edit a campaign that has already been sent",
      });
    }

    const allowedFields = [
      "campaignName",
      "subject",
      "previewText",
      "htmlContent",
      "templateType",
      "targetAudience",
      "targetUserIds",
      "filters",
      "scheduledAt",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        campaign[field] = req.body[field];
      }
    });

    if (req.body.scheduledAt) {
      campaign.status = "scheduled";
      campaign.scheduledAt = new Date(req.body.scheduledAt);
    }

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Campaign updated",
      data: campaign,
    });
  } catch (error) {
    console.error("Update Campaign Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating campaign",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Delete campaign
// @route   DELETE /api/v1/promotional-emails/:id
// ═══════════════════════════════════════════════════════════════
const deleteCampaign = async (req, res) => {
  try {
    const campaign = await PromotionalEmail.findByIdAndDelete(req.params.id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    console.error("Delete Campaign Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while deleting campaign",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Verify SMTP connection health (Brevo)
// @route   GET /api/v1/promotional-emails/smtp-health
// ═══════════════════════════════════════════════════════════════
const checkSmtpHealth = async (req, res) => {
  try {
    const result = await verifyConnection();
    res.status(200).json({
      success: true,
      data: {
        connected: result.success,
        provider: "Brevo (Sendinblue)",
        host: process.env.EMAIL_HOST || "smtp-relay.brevo.com",
        port: process.env.EMAIL_PORT || "587",
        user: process.env.EMAIL_USER
          ? `${process.env.EMAIL_USER.slice(0, 3)}***`
          : "not configured",
        fromAddress: process.env.EMAIL_FROM_ADDRESS || "not configured",
        fromName: process.env.EMAIL_FROM_NAME || "not configured",
        error: result.error || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: { connected: false, error: error.message },
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Get email templates (predefined)
// @route   GET /api/v1/promotional-emails/templates
// ═══════════════════════════════════════════════════════════════
const getTemplates = async (req, res) => {
  const templates = [
    {
      id: "welcome",
      name: "Welcome Email",
      type: "promotion",
      subject: `Welcome to ${APP_NAME}! 🚀`,
      previewText: "Your career journey starts here",
      htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',sans-serif;margin:0;padding:0;background:#f0f2f5}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.hdr{background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:40px 30px;text-align:center}
.hdr h1{color:#fff;margin:0;font-size:28px}
.hdr p{color:#c7d2fe;margin-top:8px;font-size:14px}
.body{padding:30px}
.body h2{color:#1e1b4b;font-size:22px}
.body p{color:#4b5563;font-size:15px;line-height:1.7}
.btn{display:inline-block;background:#4F46E5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px}
.ft{background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#9ca3af}
</style></head>
<body><div class="wrap">
<div class="hdr"><h1>Welcome to ${APP_NAME}!</h1><p>Your career journey starts now</p></div>
<div class="body">
<h2>Hi {{name}},</h2>
<p>Thank you for joining ${APP_NAME}! We're excited to help you find your dream job or the perfect candidate.</p>
<p>Here's what you can do next:</p>
<ul><li>Complete your profile</li><li>Browse thousands of jobs</li><li>Apply with one tap</li></ul>
<a href="${FRONTEND_URL}" class="btn">Explore Jobs →</a>
</div>
<div class="ft"><p>${APP_NAME} | <a href="{{unsubscribeLink}}">Unsubscribe</a></p></div>
</div></body></html>`,
    },
    {
      id: "new_jobs",
      name: "New Job Alert",
      type: "job_alert",
      subject: "🔥 Hot New Jobs This Week!",
      previewText: "Fresh opportunities matching your skills",
      htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',sans-serif;margin:0;padding:0;background:#f0f2f5}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.hdr{background:linear-gradient(135deg,#059669,#10b981);padding:40px 30px;text-align:center}
.hdr h1{color:#fff;margin:0;font-size:26px}
.body{padding:30px}
.body h2{color:#1e1b4b;font-size:20px}
.body p{color:#4b5563;font-size:15px;line-height:1.7}
.job-card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;background:#fafafa}
.job-card h3{margin:0;color:#4F46E5;font-size:16px}
.job-card p{margin:4px 0;font-size:13px;color:#6b7280}
.btn{display:inline-block;background:#059669;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px}
.ft{background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#9ca3af}
</style></head>
<body><div class="wrap">
<div class="hdr"><h1>🔥 Hot New Jobs!</h1></div>
<div class="body">
<h2>Hi {{name}},</h2>
<p>Here are the latest job openings matching your profile:</p>
<div class="job-card"><h3>Software Engineer</h3><p>TechCorp • Bangalore • ₹12-18 LPA</p></div>
<div class="job-card"><h3>Product Manager</h3><p>StartupX • Remote • ₹18-25 LPA</p></div>
<div class="job-card"><h3>Data Analyst</h3><p>DataCo • Mumbai • ₹8-12 LPA</p></div>
<a href="${FRONTEND_URL}/jobs" class="btn">View All Jobs →</a>
</div>
<div class="ft"><p>${APP_NAME} | <a href="{{unsubscribeLink}}">Unsubscribe</a></p></div>
</div></body></html>`,
    },
    {
      id: "premium",
      name: "Premium Upgrade",
      type: "promotion",
      subject: "⭐ Unlock Premium Features — 50% Off!",
      previewText: `Limited time offer on ${APP_NAME} Premium`,
      htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',sans-serif;margin:0;padding:0;background:#f0f2f5}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.hdr{background:linear-gradient(135deg,#7C3AED,#a78bfa);padding:40px 30px;text-align:center}
.hdr h1{color:#fff;margin:0;font-size:26px}
.hdr .badge{display:inline-block;background:#fbbf24;color:#92400e;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700;margin-top:12px}
.body{padding:30px}
.body h2{color:#1e1b4b;font-size:20px}
.body p{color:#4b5563;font-size:15px;line-height:1.7}
.feature{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:14px;color:#374151}
.feature .check{color:#059669;font-size:18px;font-weight:700}
.btn{display:inline-block;background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px}
.ft{background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#9ca3af}
</style></head>
<body><div class="wrap">
<div class="hdr"><h1>⭐ Go Premium</h1><div class="badge">50% OFF — Limited Time</div></div>
<div class="body">
<h2>Hi {{name}},</h2>
<p>Upgrade to ${APP_NAME} Premium and unlock exclusive features:</p>
<div class="feature"><span class="check">✓</span> Priority job applications</div>
<div class="feature"><span class="check">✓</span> Direct HR contact access</div>
<div class="feature"><span class="check">✓</span> Resume boost in search results</div>
<div class="feature"><span class="check">✓</span> Unlimited job alerts</div>
<div class="feature"><span class="check">✓</span> Interview preparation tools</div>
<a href="${FRONTEND_URL}/premium" class="btn">Upgrade Now — 50% Off →</a>
</div>
<div class="ft"><p>${APP_NAME} | <a href="{{unsubscribeLink}}">Unsubscribe</a></p></div>
</div></body></html>`,
    },
    {
      id: "feature_update",
      name: "New Feature Announcement",
      type: "feature_update",
      subject: "🎉 New Feature: AI Resume Builder is here!",
      previewText: "Build your perfect resume with AI",
      htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:'Segoe UI',sans-serif;margin:0;padding:0;background:#f0f2f5}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.hdr{background:linear-gradient(135deg,#2563eb,#3b82f6);padding:40px 30px;text-align:center}
.hdr h1{color:#fff;margin:0;font-size:26px}
.body{padding:30px}
.body h2{color:#1e1b4b;font-size:20px}
.body p{color:#4b5563;font-size:15px;line-height:1.7}
.btn{display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px}
.ft{background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#9ca3af}
</style></head>
<body><div class="wrap">
<div class="hdr"><h1>🎉 New Feature Launch!</h1></div>
<div class="body">
<h2>Hi {{name}},</h2>
<p>We're thrilled to announce our brand new <strong>AI Resume Builder</strong>!</p>
<p>Create a professional, ATS-friendly resume in minutes with AI-powered suggestions tailored to your industry and experience.</p>
<a href="${FRONTEND_URL}/resume-builder" class="btn">Try AI Resume Builder →</a>
</div>
<div class="ft"><p>${APP_NAME} | <a href="{{unsubscribeLink}}">Unsubscribe</a></p></div>
</div></body></html>`,
    },
  ];

  res.status(200).json({ success: true, data: templates });
};

module.exports = {
  getCampaigns,
  getCampaignById,
  createDraft,
  sendCampaign,
  sendNow,
  updateCampaign,
  deleteCampaign,
  checkSmtpHealth,
  getTemplates,
};