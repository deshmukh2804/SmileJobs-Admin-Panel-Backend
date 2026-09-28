// FILE: backend/src/controllers/notificationController.js
const Notification = require("../models/Notification");
const User = require("../models/User");
const Recruiter = require("../models/Recruiter");
const { sendBulkEmail, isValidDeliverableEmail } = require("../utils/mailer");

const APP_NAME = process.env.APP_NAME || "Smile Jobs";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ═══════════════════════════════════════════════════════════════
// HELPER: Resolve target users based on audience and filters
// ═══════════════════════════════════════════════════════════════
const resolveTargetUsers = async (targetAudience, filters = {}, targetUserIds = []) => {
  let candidates = [];
  let recruiters = [];

  if (targetAudience === "specific" && targetUserIds.length > 0) {
    candidates = await User.find({
      _id: { $in: targetUserIds },
      isActive: { $ne: false },
    }).select("name email phone phoneNumber city state skills experienceLevel industry");

    recruiters = await Recruiter.find({
      _id: { $in: targetUserIds },
      isActive: { $ne: false },
    }).select("name email mobileNumber");

    return { candidates, recruiters };
  }

  const candidateFilter = { isActive: { $ne: false } };
  if (filters.city) candidateFilter.city = { $regex: filters.city, $options: "i" };
  if (filters.state) candidateFilter.state = { $regex: filters.state, $options: "i" };
  if (filters.experienceLevel) candidateFilter.experienceLevel = filters.experienceLevel;
  if (filters.industry) candidateFilter.industry = { $regex: filters.industry, $options: "i" };
  if (filters.skills && filters.skills.length > 0) {
    candidateFilter.skills = { $in: filters.skills };
  }

  const recruiterFilter = { isActive: { $ne: false } };

  if (targetAudience === "all" || targetAudience === "candidates") {
    candidates = await User.find(candidateFilter).select(
      "name email phone phoneNumber city state skills experienceLevel industry unsubscribedFromEmails"
    );
  }

  if (targetAudience === "all" || targetAudience === "recruiters") {
    recruiters = await Recruiter.find(recruiterFilter).select("name email mobileNumber");
  }

  return { candidates, recruiters };
};

// ═══════════════════════════════════════════════════════════════
// @desc    Get all notifications
// @route   GET /api/v1/notifications
// ═══════════════════════════════════════════════════════════════
const getNotifications = async (req, res) => {
  try {
    const {
      status,
      type,
      targetAudience,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};

    if (status && status !== "all") filter.status = status;
    if (type && type !== "all") filter.type = type;
    if (targetAudience && targetAudience !== "all") filter.targetAudience = targetAudience;

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { body: { $regex: search, $options: "i" } },
        { "sentBy.adminName": { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [notifications, total] = await Promise.all([
      Notification.find(filter).sort(sortObj).skip(skip).limit(parseInt(limit, 10)),
      Notification.countDocuments(filter),
    ]);

    const [draftCount, sentCount, scheduledCount, failedCount] = await Promise.all([
      Notification.countDocuments({ status: "draft" }),
      Notification.countDocuments({ status: "sent" }),
      Notification.countDocuments({ status: "scheduled" }),
      Notification.countDocuments({ status: "failed" }),
    ]);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10)),
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
    console.error("Get Notifications Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Get single notification by ID
// @route   GET /api/v1/notifications/:id
// ═══════════════════════════════════════════════════════════════
const getNotificationById = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({ success: true, data: notification });
  } catch (error) {
    console.error("Get Notification Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while fetching notification" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    MOBILE APP: Fetch notifications for logged-in user
// @route   GET /api/v1/notifications/user/my-notifications
// ═══════════════════════════════════════════════════════════════
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.authUser?.id || req.authUser?.userId;
    const userRole = req.authUser?.role || "user";
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const audienceConditions = [{ targetAudience: "all" }];

    if (userRole === "job_seeker" || userRole === "user" || userRole === "candidate") {
      audienceConditions.push({ targetAudience: "candidates" });
    }
    if (userRole === "recruiter") {
      audienceConditions.push({ targetAudience: "recruiters" });
    }

    audienceConditions.push({
      targetAudience: "specific",
      targetUserIds: userId,
    });

    const filter = {
      status: "sent",
      "channels.inApp": true,
      $or: audienceConditions,
    };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .select("title body imageUrl type actionUrl sentAt createdAt"),
      Notification.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error("Get My Notifications Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    MOBILE APP: Get unread notification count
// @route   GET /api/v1/notifications/user/unread-count
// ═══════════════════════════════════════════════════════════════
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.authUser?.id || req.authUser?.userId;
    const userRole = req.authUser?.role || "user";

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const audienceConditions = [{ targetAudience: "all" }];

    if (userRole === "job_seeker" || userRole === "user" || userRole === "candidate") {
      audienceConditions.push({ targetAudience: "candidates" });
    }
    if (userRole === "recruiter") {
      audienceConditions.push({ targetAudience: "recruiters" });
    }
    audienceConditions.push({
      targetAudience: "specific",
      targetUserIds: userId,
    });

    const count = await Notification.countDocuments({
      status: "sent",
      "channels.inApp": true,
      $or: audienceConditions,
    });

    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    console.error("Get Unread Count Error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Send notification (save to DB + optional email via Brevo)
// @route   POST /api/v1/notifications/send
// ═══════════════════════════════════════════════════════════════
const sendNotification = async (req, res) => {
  try {
    const adminId = req.authUser?.id || req.authUser?.adminId;
    const adminName = req.authUser?.name || "Admin";
    const adminEmail = req.authUser?.email || "";

    const {
      title,
      body,
      imageUrl,
      targetAudience = "all",
      targetUserIds = [],
      filters = {},
      channels = { inApp: true, email: false },
      type = "general",
      actionUrl,
      scheduledAt,
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "Title and body are required",
      });
    }

    const { candidates, recruiters } = await resolveTargetUsers(
      targetAudience,
      filters,
      targetUserIds
    );

    const totalTargeted = candidates.length + recruiters.length;

    const notification = await Notification.create({
      sentBy: { adminId, adminName, adminEmail },
      title,
      body,
      imageUrl,
      targetAudience,
      targetUserIds,
      filters,
      channels,
      type,
      actionUrl,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: scheduledAt ? "scheduled" : "sent",
      sentAt: scheduledAt ? undefined : new Date(),
      stats: {
        totalTargeted,
        inAppDelivered: channels.inApp ? totalTargeted : 0,
        emailSent: 0,
        emailFailed: 0,
      },
    });

    if (scheduledAt) {
      return res.status(201).json({
        success: true,
        message: `Notification scheduled for ${new Date(scheduledAt).toLocaleString()}.`,
        data: notification,
      });
    }

    // ── SEND VIA BREVO SMTP ──
    if (channels.email) {
      const allUsers = [
        ...candidates.map((u) => ({ email: u.email, name: u.name })),
        ...recruiters.map((r) => ({ email: r.email, name: r.name })),
      ].filter((u) => isValidDeliverableEmail(u.email));

      if (allUsers.length > 0) {
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 30px; text-align: center; }
              .header h1 { color: #ffffff; margin: 0; font-size: 22px; }
              .content { padding: 30px; }
              .content h2 { color: #1a1a2e; font-size: 20px; margin-bottom: 15px; }
              .content p { color: #4a4a6a; font-size: 15px; line-height: 1.6; }
              ${imageUrl ? ".hero-img { width: 100%; max-height: 300px; object-fit: cover; }" : ""}
              .cta-btn { display: inline-block; background: #4F46E5; color: #ffffff; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #888; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${APP_NAME}</h1>
              </div>
              ${imageUrl ? `<img src="${imageUrl}" alt="notification" class="hero-img" />` : ""}
              <div class="content">
                <h2>${title}</h2>
                <p>Hi {{name}},</p>
                <p>${body}</p>
                ${actionUrl ? `<a href="${actionUrl}" class="cta-btn">Take Action</a>` : ""}
              </div>
              <div class="footer">
                <p>You received this because you're a registered ${APP_NAME} user.</p>
                <p><a href="{{unsubscribeLink}}">Unsubscribe</a></p>
                <p>© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `;

        const emailResult = await sendBulkEmail(allUsers, `${APP_NAME}: ${title}`, emailHtml);

        notification.stats.emailSent = emailResult.sent;
        notification.stats.emailFailed = emailResult.failed;

        if (emailResult.errors && emailResult.errors.length > 0) {
          notification.errorLog = emailResult.errors.map((err) => ({
            channel: "email",
            error: `${err.email}: ${err.error}`,
            timestamp: new Date(),
          }));
        }

        await notification.save();
      }
    }

    res.status(201).json({
      success: true,
      message: `Notification dispatched for ${totalTargeted} user(s).${
        channels.email ? ` Sent ${notification.stats.emailSent} email(s).` : ""
      }`,
      data: notification,
    });
  } catch (error) {
    console.error("Send Notification Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while sending notification",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Preview target audience count
// @route   POST /api/v1/notifications/preview-count
// ═══════════════════════════════════════════════════════════════
const getTargetCount = async (req, res) => {
  try {
    const { targetAudience = "all", filters = {}, targetUserIds = [] } = req.body;

    const { candidates, recruiters } = await resolveTargetUsers(
      targetAudience,
      filters,
      targetUserIds
    );

    const candidateCount = candidates.length;
    const recruiterCount = recruiters.length;
    const withEmail = [...candidates, ...recruiters].filter((u) =>
      isValidDeliverableEmail(u.email)
    ).length;

    res.status(200).json({
      success: true,
      data: {
        total: candidateCount + recruiterCount,
        candidates: candidateCount,
        recruiters: recruiterCount,
        withEmail,
      },
    });
  } catch (error) {
    console.error("Preview Count Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while counting target audience",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Delete notification
// @route   DELETE /api/v1/notifications/:id
// ═══════════════════════════════════════════════════════════════
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findByIdAndDelete(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Delete Notification Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while deleting notification" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Cancel scheduled notification
// @route   PATCH /api/v1/notifications/:id/cancel
// ═══════════════════════════════════════════════════════════════
const cancelNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    if (notification.status !== "scheduled" && notification.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a notification with status "${notification.status}"`,
      });
    }

    notification.status = "cancelled";
    await notification.save();

    res.status(200).json({ success: true, message: "Notification cancelled", data: notification });
  } catch (error) {
    console.error("Cancel Notification Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while cancelling notification" });
  }
};

module.exports = {
  getNotifications,
  getNotificationById,
  getMyNotifications,
  getUnreadCount,
  sendNotification,
  getTargetCount,
  deleteNotification,
  cancelNotification,
};