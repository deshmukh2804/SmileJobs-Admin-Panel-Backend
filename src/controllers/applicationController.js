// FILE: backend/src/controllers/applicationController.js
const Application = require("../models/Application");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const User = require("../models/User");
const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// RESUME PROXY URL BUILDER
// Transforms raw Cloudinary resume URLs into proper proxy URLs
// that stream validated PDF buffers with correct headers.
// ═══════════════════════════════════════════════════════════════
const APPLICATION_SERVICE_BASE_URL =
  process.env.APPLICATION_SERVICE_URL ||
  process.env.APPLICATION_BACKEND_URL ||
  "https://smilejobs-application-backend.onrender.com";

const buildResumeProxyUrl = (userId) => {
  if (!userId) return "";
  const base = APPLICATION_SERVICE_BASE_URL.replace(/\/+$/, "");
  return `${base}/api/profile/resume/view/${userId}`;
};

// ═══════════════════════════════════════════════════════════════
// SEQUENTIAL STATUS WORKFLOW DEFINITION
// Enforces step-by-step progression - no skipping stages
// ═══════════════════════════════════════════════════════════════
const STATUS_WORKFLOW = {
  Applied: ["Viewed", "Rejected", "Withdrawn"],
  Viewed: ["Shortlisted", "Rejected", "Withdrawn"],
  Shortlisted: ["Interview", "Rejected", "Withdrawn"],
  Interview: ["Offered", "Rejected", "Withdrawn"],
  Offered: ["Hired", "Rejected", "Withdrawn"],
  Hired: [], // Terminal state
  Rejected: [], // Terminal state
  Withdrawn: [], // Terminal state
};

const STATUS_ORDER = [
  "Applied",
  "Viewed",
  "Shortlisted",
  "Interview",
  "Offered",
  "Hired",
];

const CATEGORY_MAP = {
  Applied: "pending",
  Viewed: "pending",
  Shortlisted: "shortlisted",
  Interview: "shortlisted",
  Offered: "shortlisted",
  Hired: "hired",
  Rejected: "rejected",
  Withdrawn: "rejected",
};

const isValidTransition = (currentStatus, newStatus) => {
  if (currentStatus === newStatus) return true;
  const allowedNext = STATUS_WORKFLOW[currentStatus] || [];
  return allowedNext.includes(newStatus);
};

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT HELPER: Attach recruiter + user info to applications
// Also transforms resume URLs to use the proxy endpoint
// ═══════════════════════════════════════════════════════════════
const enrichApplications = async (applications) => {
  if (!applications || applications.length === 0) return [];

  const jobIds = [
    ...new Set(
      applications
        .map((a) => a.jobId?.toString())
        .filter(Boolean)
    ),
  ];
  const userIds = [
    ...new Set(
      applications
        .map((a) => a.userId?.toString())
        .filter(Boolean)
    ),
  ];

  // Fetch jobs (with recruiter info)
  let jobsMap = {};
  let recruitersMap = {};
  try {
    if (jobIds.length > 0) {
      const jobs = await Job.find({ _id: { $in: jobIds } })
        .select(
          "title companyName companyLogo companyWebsite recruiterId recruiterEmail recruiterMobileNumber recruiterWhatsappNumber contactPerson location workMode jobType"
        )
        .lean();

      jobs.forEach((j) => {
        jobsMap[j._id.toString()] = j;
      });

      const recruiterIds = [
        ...new Set(
          jobs.map((j) => j.recruiterId?.toString()).filter(Boolean)
        ),
      ];

      if (recruiterIds.length > 0) {
        const recruiters = await Recruiter.find({ _id: { $in: recruiterIds } })
          .select(
            "name email mobileNumber whatsappNumber designation companyName profileImage verified"
          )
          .lean();

        recruiters.forEach((r) => {
          recruitersMap[r._id.toString()] = r;
        });
      }
    }
  } catch (e) {
    console.error("Enrichment - Jobs/Recruiters lookup failed:", e.message);
  }

  // Fetch users (candidates)
  let usersMap = {};
  try {
    if (userIds.length > 0) {
      const users = await User.find({ _id: { $in: userIds } })
        .select("name email phone isActive createdAt")
        .lean();

      users.forEach((u) => {
        usersMap[u._id.toString()] = u;
      });
    }
  } catch (e) {
    console.error("Enrichment - Users lookup failed:", e.message);
  }

  // Attach enriched data
  return applications.map((app) => {
    const appObj = app.toObject ? app.toObject() : app;
    const jobIdStr = appObj.jobId?.toString();
    const userIdStr = appObj.userId?.toString();

    const jobData = jobIdStr ? jobsMap[jobIdStr] : null;
    const recruiterId = jobData?.recruiterId?.toString();
    const recruiterData = recruiterId ? recruitersMap[recruiterId] : null;
    const userData = userIdStr ? usersMap[userIdStr] : null;

    // Compute allowed next statuses for this application
    const currentStatus = appObj.status || "Applied";
    const allowedNextStatuses = STATUS_WORKFLOW[currentStatus] || [];

    // ═══════════════════════════════════════════════════════════
    // 🔧 RESUME URL TRANSFORMATION
    // Replace raw Cloudinary URL with the mobile app backend's
    // proxy endpoint that streams a validated PDF buffer.
    // ═══════════════════════════════════════════════════════════
    const originalResumeUrl = appObj.resumeUrl || "";
    const proxyResumeUrl = userIdStr ? buildResumeProxyUrl(userIdStr) : "";

    return {
      ...appObj,
      // Replace resume URL with proxy URL (fixes "corrupted file" issue)
      resumeUrl: proxyResumeUrl || originalResumeUrl,
      // Preserve original for debugging/fallback
      resumeOriginalUrl: originalResumeUrl,
      // Recruiter (job poster) details
      recruiter: recruiterData
        ? {
            id: recruiterData._id,
            name: recruiterData.name,
            email: recruiterData.email,
            mobileNumber: recruiterData.mobileNumber,
            whatsappNumber: recruiterData.whatsappNumber,
            designation: recruiterData.designation,
            companyName: recruiterData.companyName,
            profileImageUrl: recruiterData.profileImage?.url || null,
            verified: recruiterData.verified || false,
          }
        : null,
      // Full job details
      jobDetails: jobData
        ? {
            id: jobData._id,
            title: jobData.title,
            companyName: jobData.companyName,
            companyLogo: jobData.companyLogo?.url || null,
            companyWebsite: jobData.companyWebsite,
            location: jobData.location,
            workMode: jobData.workMode,
            jobType: jobData.jobType,
            contactPerson: jobData.contactPerson,
          }
        : null,
      // Candidate user account info
      candidateAccount: userData
        ? {
            id: userData._id,
            name: userData.name,
            email: userData.email,
            phone: userData.phone,
            isActive: userData.isActive,
            memberSince: userData.createdAt,
          }
        : null,
      // Workflow metadata
      workflow: {
        currentStatus,
        allowedNextStatuses,
        currentStepIndex: STATUS_ORDER.indexOf(currentStatus),
        totalSteps: STATUS_ORDER.length,
        isTerminal:
          currentStatus === "Hired" ||
          currentStatus === "Rejected" ||
          currentStatus === "Withdrawn",
      },
    };
  });
};

// @desc    Get all applications (with filters & pagination)
// @route   GET /api/v1/applications
const getApplications = async (req, res) => {
  try {
    const {
      search,
      status,
      category,
      jobId,
      userId,
      matchMin,
      matchMax,
      city,
      page = 1,
      limit = 20,
      sortBy = "appliedAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        { candidateName: { $regex: search, $options: "i" } },
        { candidateEmail: { $regex: search, $options: "i" } },
        { candidatePhone: { $regex: search, $options: "i" } },
        { jobTitle: { $regex: search, $options: "i" } },
        { jobCompany: { $regex: search, $options: "i" } },
      ];
    }

    if (status && status !== "all") filter.status = status;
    if (category && category !== "all") filter.category = category;
    if (jobId && mongoose.Types.ObjectId.isValid(jobId)) {
      filter.jobId = new mongoose.Types.ObjectId(jobId);
    }
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      filter.userId = new mongoose.Types.ObjectId(userId);
    }
    if (city) filter.candidateCity = { $regex: city, $options: "i" };

    if (matchMin || matchMax) {
      filter.matchPercentage = {};
      if (matchMin) filter.matchPercentage.$gte = parseInt(matchMin);
      if (matchMax) filter.matchPercentage.$lte = parseInt(matchMax);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [applications, total] = await Promise.all([
      Application.find(filter).sort(sortObj).skip(skip).limit(parseInt(limit)),
      Application.countDocuments(filter),
    ]);

    // Enrich each application with recruiter + user + workflow metadata
    const enriched = await enrichApplications(applications);

    const [
      appliedCount,
      viewedCount,
      shortlistedCount,
      interviewCount,
      offeredCount,
      hiredCount,
      rejectedCount,
      withdrawnCount,
    ] = await Promise.all([
      Application.countDocuments({ status: "Applied" }),
      Application.countDocuments({ status: "Viewed" }),
      Application.countDocuments({ status: "Shortlisted" }),
      Application.countDocuments({ status: "Interview" }),
      Application.countDocuments({ status: "Offered" }),
      Application.countDocuments({ status: "Hired" }),
      Application.countDocuments({ status: "Rejected" }),
      Application.countDocuments({ status: "Withdrawn" }),
    ]);

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
      counts: {
        applied: appliedCount,
        viewed: viewedCount,
        shortlisted: shortlistedCount,
        interview: interviewCount,
        offered: offeredCount,
        hired: hiredCount,
        rejected: rejectedCount,
        withdrawn: withdrawnCount,
        total:
          appliedCount +
          viewedCount +
          shortlistedCount +
          interviewCount +
          offeredCount +
          hiredCount +
          rejectedCount +
          withdrawnCount,
      },
    });
  } catch (error) {
    console.error("Get Applications Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching applications",
    });
  }
};

// @desc    Get single application by ID
// @route   GET /api/v1/applications/:id
const getApplicationById = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const enriched = await enrichApplications([application]);

    res.status(200).json({
      success: true,
      data: enriched[0],
    });
  } catch (error) {
    console.error("Get Application Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching application",
    });
  }
};

// @desc    Update application status (with sequential validation)
// @route   PATCH /api/v1/applications/:id/status
const updateApplicationStatus = async (req, res) => {
  try {
    const { status, hrNotes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = Object.keys(STATUS_WORKFLOW);

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    // ═══════════════════════════════════════════════════════════
    // SEQUENTIAL WORKFLOW VALIDATION
    // Prevents skipping stages (e.g. Applied -> Interview directly)
    // ═══════════════════════════════════════════════════════════
    const currentStatus = application.status || "Applied";

    if (!isValidTransition(currentStatus, status)) {
      const allowedNext = STATUS_WORKFLOW[currentStatus] || [];
      return res.status(400).json({
        success: false,
        message: `Invalid workflow transition. Cannot move from "${currentStatus}" directly to "${status}". Allowed next stages: ${
          allowedNext.length > 0 ? allowedNext.join(", ") : "None (terminal state)"
        }`,
        currentStatus,
        allowedNextStatuses: allowedNext,
      });
    }

    application.status = status;
    application.category = CATEGORY_MAP[status] || "pending";

    if (hrNotes !== undefined) {
      application.hrNotes = hrNotes;
    }

    application.milestones.push({
      title: `Status changed to ${status}`,
      time: new Date().toLocaleString(),
      completed: true,
      statusText: status,
      isHighlight: true,
    });

    await application.save();

    // Return enriched version
    const enriched = await enrichApplications([application]);

    res.status(200).json({
      success: true,
      message: `Application status updated to ${status}`,
      data: enriched[0],
    });
  } catch (error) {
    console.error("Update Application Status Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating application status",
    });
  }
};

// @desc    Delete application
// @route   DELETE /api/v1/applications/:id
const deleteApplication = async (req, res) => {
  try {
    const application = await Application.findByIdAndDelete(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Application deleted successfully",
    });
  } catch (error) {
    console.error("Delete Application Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while deleting application",
    });
  }
};

// @desc    Get applications for a job
// @route   GET /api/v1/applications/job/:jobId
const getApplicationsByJob = async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const filter = { jobId: new mongoose.Types.ObjectId(req.params.jobId) };
    if (status && status !== "all") filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Application.countDocuments(filter),
    ]);

    const enriched = await enrichApplications(applications);

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get Applications By Job Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching applications for job",
    });
  }
};

// @desc    Get applications for a user
// @route   GET /api/v1/applications/user/:userId
const getApplicationsByUser = async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const filter = { userId: new mongoose.Types.ObjectId(req.params.userId) };
    if (status && status !== "all") filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Application.countDocuments(filter),
    ]);

    const enriched = await enrichApplications(applications);

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get Applications By User Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching user applications",
    });
  }
};

// @desc    Bulk update application statuses (with sequential validation)
// @route   PATCH /api/v1/applications/bulk-status
const bulkUpdateStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Application IDs array is required",
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = Object.keys(STATUS_WORKFLOW);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status.`,
      });
    }

    // Fetch each & validate transition
    const applications = await Application.find({ _id: { $in: ids } });

    const eligibleIds = [];
    const skippedIds = [];

    for (const app of applications) {
      if (isValidTransition(app.status, status)) {
        eligibleIds.push(app._id);
      } else {
        skippedIds.push({
          id: app._id,
          candidate: app.candidateName,
          currentStatus: app.status,
        });
      }
    }

    let modifiedCount = 0;
    if (eligibleIds.length > 0) {
      const result = await Application.updateMany(
        { _id: { $in: eligibleIds } },
        {
          $set: { status, category: CATEGORY_MAP[status] || "pending" },
          $push: {
            milestones: {
              title: `Bulk status change to ${status}`,
              time: new Date().toLocaleString(),
              completed: true,
              statusText: status,
              isHighlight: true,
            },
          },
        }
      );
      modifiedCount = result.modifiedCount;
    }

    res.status(200).json({
      success: true,
      message: `${modifiedCount} application(s) updated to ${status}. ${skippedIds.length} skipped due to invalid workflow transition.`,
      data: {
        modifiedCount,
        skipped: skippedIds,
      },
    });
  } catch (error) {
    console.error("Bulk Update Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while bulk updating applications",
    });
  }
};

module.exports = {
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  deleteApplication,
  getApplicationsByJob,
  getApplicationsByUser,
  bulkUpdateStatus,
};