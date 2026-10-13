// FILE: backend/src/controllers/applicationController.js
const Application = require("../models/Application");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const User = require("../models/User");
const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// CLOUDINARY SETUP (for direct resume streaming from admin backend)
// ═══════════════════════════════════════════════════════════════
let cloudinary = null;
try {
  cloudinary = require("../config/cloudinary");
} catch (e) {
  try {
    cloudinary = require("cloudinary").v2;
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
  } catch (err) {
    console.warn("⚠️ Cloudinary not configured in admin backend. Resume streaming will fall back to raw URLs.");
  }
}

// ═══════════════════════════════════════════════════════════════
// TENANT ISOLATION HELPERS (MAPPED TO MULTI-DB PATTERN)
// ═══════════════════════════════════════════════════════════════

const getRecruiterJobIds = async (recruiterId) => {
  if (!recruiterId) return [];
  let recObjectId;
  try { recObjectId = new mongoose.Types.ObjectId(recruiterId); } catch (e) { recObjectId = null; }

  const jobs = await Job.find({ 
    recruiterId: { $in: [recruiterId, recObjectId].filter(Boolean) } 
  }).select("_id").lean();
  
  return jobs.map((j) => j._id);
};

const applyRecruiterScope = async (filter, authUser, requestedJobId = null) => {
  if (!authUser) {
    throw new Error("Authentication verification failed: User payload missing");
  }

  if (authUser.role !== "recruiter") {
    if (requestedJobId) {
      let reqJobObjectId;
      try { reqJobObjectId = new mongoose.Types.ObjectId(requestedJobId); } catch (e) { reqJobObjectId = null; }
      filter.jobId = { $in: [requestedJobId, reqJobObjectId].filter(Boolean) };
    }
    return true;
  }

  const ownedJobIds = await getRecruiterJobIds(authUser.id);
  const ownedJobIdsStr = ownedJobIds.map((id) => id.toString());

  if (requestedJobId) {
    const requestedJobIdStr = requestedJobId.toString();
    if (!ownedJobIdsStr.includes(requestedJobIdStr)) {
      return false;
    }
    let reqJobObjectId;
    try { reqJobObjectId = new mongoose.Types.ObjectId(requestedJobIdStr); } catch (e) { reqJobObjectId = null; }
    filter.jobId = { $in: [requestedJobIdStr, reqJobObjectId].filter(Boolean) };
  } else if (filter.jobId) {
    const existingJobIdStr = filter.jobId.toString();
    if (!ownedJobIdsStr.includes(existingJobIdStr)) {
      return false;
    }
    let extJobObjectId;
    try { extJobObjectId = new mongoose.Types.ObjectId(existingJobIdStr); } catch (e) { extJobObjectId = null; }
    filter.jobId = { $in: [existingJobIdStr, extJobObjectId].filter(Boolean) };
  } else {
    const ownedJobObjectIds = ownedJobIds.map(id => {
      try { return new mongoose.Types.ObjectId(id); } catch { return null; }
    }).filter(Boolean);
    filter.jobId = { $in: [...ownedJobIdsStr, ...ownedJobObjectIds] };
  }

  return true;
};

// ═══════════════════════════════════════════════════════════════
// RESUME PROXY URL BUILDER (ADMIN BACKEND SELF-HOSTED)
// ═══════════════════════════════════════════════════════════════

const getAdminBackendBaseUrl = (req) => {
  if (process.env.ADMIN_BACKEND_URL) {
    return process.env.ADMIN_BACKEND_URL.replace(/\/+$/, "");
  }
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL.replace(/\/+$/, "");
  }
  if (req) {
    const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
    const host = req.get("host") || "admin-api.smilejobs.in";
    return `${protocol}://${host}`;
  }
  return "https://admin-api.smilejobs.in";
};

const buildResumeProxyUrl = (userId, req) => {
  if (!userId) return "";
  const base = getAdminBackendBaseUrl(req);
  return `${base}/api/v1/applications/resume/view/${userId}`;
};

const buildResumeDownloadUrl = (userId, req) => {
  if (!userId) return "";
  const base = getAdminBackendBaseUrl(req);
  return `${base}/api/v1/applications/resume/download/${userId}`;
};

// ═══════════════════════════════════════════════════════════════
// CLOUDINARY URL PARSER & SIGNED URL GENERATOR
// Extracts public_id from any Cloudinary URL and generates
// signed URLs that bypass ACL restrictions.
// ═══════════════════════════════════════════════════════════════

const parseCloudinaryUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  if (!url.includes("res.cloudinary.com")) return null;

  try {
    const match = url.match(
      /res\.cloudinary\.com\/([^/]+)\/(image|raw|video|auto)\/upload\/(?:v\d+\/)?(.+?)(?:\.([a-zA-Z0-9]+))?$/
    );
    if (!match) return null;

    const cloudName = match[1];
    const resourceType = match[2];
    let publicId = match[3];
    const format = match[4] || "";

    if (format && publicId.endsWith(`.${format}`)) {
      publicId = publicId.slice(0, -(format.length + 1));
    }

    return { cloudName, resourceType, publicId, format };
  } catch (e) {
    return null;
  }
};

const generateSignedUrlCandidates = (url, publicId) => {
  const candidates = [];
  if (!cloudinary) return candidates;

  const parsed = url ? parseCloudinaryUrl(url) : null;
  const pid = publicId || (parsed ? parsed.publicId : null);

  if (!pid) return candidates;

  const resourceTypesToTry = new Set();
  if (parsed) resourceTypesToTry.add(parsed.resourceType);
  resourceTypesToTry.add("raw");
  resourceTypesToTry.add("image");
  resourceTypesToTry.add("auto");

  for (const rt of resourceTypesToTry) {
    try {
      const signedUrl = cloudinary.url(pid, {
        resource_type: rt,
        type: "upload",
        sign_url: true,
        secure: true,
      });
      if (signedUrl && !candidates.includes(signedUrl)) {
        candidates.push(signedUrl);
      }
    } catch (e) {}

    try {
      if (typeof cloudinary.utils?.private_download_url === "function") {
        const privateUrl = cloudinary.utils.private_download_url(pid, "", {
          resource_type: rt,
          type: "upload",
          expires_at: Math.floor(Date.now() / 1000) + 7200,
        });
        if (privateUrl && !candidates.includes(privateUrl)) {
          candidates.push(privateUrl);
        }
      }
    } catch (e) {}

    try {
      const authUrl = cloudinary.url(pid, {
        resource_type: rt,
        type: "authenticated",
        sign_url: true,
        secure: true,
      });
      if (authUrl && !candidates.includes(authUrl)) {
        candidates.push(authUrl);
      }
    } catch (e) {}
  }

  return candidates;
};

// ═══════════════════════════════════════════════════════════════
// SEQUENTIAL STATUS WORKFLOW DEFINITION
// ═══════════════════════════════════════════════════════════════
const STATUS_WORKFLOW = {
  Applied: ["Viewed", "Rejected", "Withdrawn"],
  Viewed: ["Shortlisted", "Rejected", "Withdrawn"],
  Shortlisted: ["Interview", "Rejected", "Withdrawn"],
  Interview: ["Offered", "Rejected", "Withdrawn"],
  Offered: ["Hired", "Rejected", "Withdrawn"],
  Hired: [],
  Rejected: [],
  Withdrawn: [],
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
// CSV HELPER
// ═══════════════════════════════════════════════════════════════
const csvEscape = (val) => {
  if (val === null || val === undefined) return "";
  let str = typeof val === "string" ? val : String(val);
  str = str.replace(/\r?\n|\r/g, " ").replace(/\t/g, " ");
  if (str.includes(",") || str.includes('"') || str.includes("'")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT HELPER
// ═══════════════════════════════════════════════════════════════
const enrichApplications = async (applications, req = null) => {
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

  let jobsMap = {};
  let recruitersMap = {};
  try {
    if (jobIds.length > 0) {
      const jobObjectIds = jobIds.map(id => {
        try { return new mongoose.Types.ObjectId(id); } catch { return null; }
      }).filter(Boolean);

      const jobs = await Job.find({ _id: { $in: [...jobObjectIds, ...jobIds] } })
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
        const recObjectIds = recruiterIds.map(id => {
          try { return new mongoose.Types.ObjectId(id); } catch { return null; }
        }).filter(Boolean);

        const recruiters = await Recruiter.find({ _id: { $in: [...recObjectIds, ...recruiterIds] } })
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

  let usersMap = {};
  try {
    if (userIds.length > 0) {
      const uObjectIds = userIds.map(id => {
        try { return new mongoose.Types.ObjectId(id); } catch { return null; }
      }).filter(Boolean);

      const users = await User.find({ _id: { $in: [...uObjectIds, ...userIds] } })
        .select("name email phone isActive createdAt resumeUrl resumePublicId resumeFileName")
        .lean();

      users.forEach((u) => {
        usersMap[u._id.toString()] = u;
      });
    }
  } catch (e) {
    console.error("Enrichment - Users lookup failed:", e.message);
  }

  return applications.map((app) => {
    const appObj = app.toObject ? app.toObject() : app;
    const jobIdStr = appObj.jobId?.toString();
    const userIdStr = appObj.userId?.toString();

    const jobData = jobIdStr ? jobsMap[jobIdStr] : null;
    const recruiterId = jobData?.recruiterId?.toString();
    const recruiterData = recruiterId ? recruitersMap[recruiterId] : null;
    const userData = userIdStr ? usersMap[userIdStr] : null;

    const currentStatus = appObj.status || "Applied";
    const allowedNextStatuses = STATUS_WORKFLOW[currentStatus] || [];

    const originalResumeUrl =
      appObj.resumeUrl ||
      userData?.resumeUrl ||
      "";

    const hasResume = !!(originalResumeUrl || userData?.resumePublicId);
    const proxyResumeUrl = userIdStr && hasResume ? buildResumeProxyUrl(userIdStr, req) : "";
    const downloadResumeUrl = userIdStr && hasResume ? buildResumeDownloadUrl(userIdStr, req) : "";

    return {
      ...appObj,
      resumeUrl: proxyResumeUrl || originalResumeUrl,
      resumeOriginalUrl: originalResumeUrl,
      resumeDownloadUrl: downloadResumeUrl,
      resumeFileName: appObj.resumeFileName || userData?.resumeFileName || "Resume.pdf",
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

// @desc    Get all applications (with filters, pagination & tenant isolation)
// @route   GET /api/v1/applications
const getApplications = async (req, res) => {
  try {
    const authUser = req.authUser;
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

    const isAuthorized = await applyRecruiterScope(filter, authUser, jobId);
    if (!isAuthorized) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 1,
        },
        counts: {
          applied: 0,
          viewed: 0,
          shortlisted: 0,
          interview: 0,
          offered: 0,
          hired: 0,
          rejected: 0,
          withdrawn: 0,
          total: 0,
        },
      });
    }

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
    
    if (userId) {
      let userObjectId;
      try { userObjectId = new mongoose.Types.ObjectId(userId); } catch (e) { userObjectId = null; }
      filter.userId = { $in: [userId, userObjectId].filter(Boolean) };
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

    const enriched = await enrichApplications(applications, req);

    const counts = {
      applied: 0,
      viewed: 0,
      shortlisted: 0,
      interview: 0,
      offered: 0,
      hired: 0,
      rejected: 0,
      withdrawn: 0,
      total: 0,
    };

    const statusCountsAgg = await Application.aggregate([
      { $match: filter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    statusCountsAgg.forEach((sc) => {
      if (sc._id) {
        const key = sc._id.toLowerCase();
        if (key in counts) {
          counts[key] = sc.count;
          counts.total += sc.count;
        }
      }
    });

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)) || 1,
      },
      counts,
    });
  } catch (error) {
    console.error("Get Applications Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching applications",
    });
  }
};

// @desc    Get single application by ID (with security scope validation)
// @route   GET /api/v1/applications/:id
const getApplicationById = async (req, res) => {
  try {
    const authUser = req.authUser;
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (authUser.role === "recruiter") {
      const ownedJobIds = await getRecruiterJobIds(authUser.id);
      const ownedJobIdsStr = ownedJobIds.map((id) => id.toString());
      if (!ownedJobIdsStr.includes(application.jobId.toString())) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You are not authorized to view this application's parent job details.",
        });
      }
    }

    const enriched = await enrichApplications([application], req);

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

// @desc    Update application status (with sequential validation & security checks)
// @route   PATCH /api/v1/applications/:id/status
const updateApplicationStatus = async (req, res) => {
  try {
    const authUser = req.authUser;
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

    if (authUser.role === "recruiter") {
      const ownedJobIds = await getRecruiterJobIds(authUser.id);
      const ownedJobIdsStr = ownedJobIds.map((id) => id.toString());
      if (!ownedJobIdsStr.includes(application.jobId.toString())) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not own the parent job posting for this application.",
        });
      }
    }

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

    const enriched = await enrichApplications([application], req);

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

// @desc    Delete application (with secure tenancy checks)
// @route   DELETE /api/v1/applications/:id
const deleteApplication = async (req, res) => {
  try {
    const authUser = req.authUser;
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (authUser.role === "recruiter") {
      const ownedJobIds = await getRecruiterJobIds(authUser.id);
      const ownedJobIdsStr = ownedJobIds.map((id) => id.toString());
      if (!ownedJobIdsStr.includes(application.jobId.toString())) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not own the parent job posting for this application.",
        });
      }
    }

    await Application.findByIdAndDelete(req.params.id);

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

// @desc    Get applications for a job (scoping validated)
// @route   GET /api/v1/applications/job/:jobId
const getApplicationsByJob = async (req, res) => {
  try {
    const authUser = req.authUser;
    const { jobId } = req.params;
    const { page = 1, limit = 50, status } = req.query;

    let jobObjectId;
    try { jobObjectId = new mongoose.Types.ObjectId(jobId); } catch (e) { jobObjectId = null; }

    const jobIdsArray = [jobId, jobObjectId].filter(Boolean);

    if (authUser.role === "recruiter") {
      const ownedJobIds = await getRecruiterJobIds(authUser.id);
      const ownedJobIdsStr = ownedJobIds.map((id) => id.toString());
      if (!ownedJobIdsStr.includes(jobId.toString())) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not own this job.",
        });
      }
    }

    const filter = { jobId: { $in: jobIdsArray } };
    if (status && status !== "all") filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Application.countDocuments(filter),
    ]);

    const enriched = await enrichApplications(applications, req);

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)) || 1,
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

// @desc    Get applications for a user (scoping validated)
// @route   GET /api/v1/applications/user/:userId
const getApplicationsByUser = async (req, res) => {
  try {
    const authUser = req.authUser;
    const { userId } = req.params;
    const { page = 1, limit = 50, status } = req.query;

    let userObjectId;
    try { userObjectId = new mongoose.Types.ObjectId(userId); } catch (e) { userObjectId = null; }

    const userIdsArray = [userId, userObjectId].filter(Boolean);
    const filter = { userId: { $in: userIdsArray } };

    const isAuthorized = await applyRecruiterScope(filter, authUser);
    if (!isAuthorized) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 1,
        },
      });
    }

    if (status && status !== "all") filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort({ appliedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Application.countDocuments(filter),
    ]);

    const enriched = await enrichApplications(applications, req);

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)) || 1,
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

// @desc    Bulk update application statuses (validated for transitions & security ownership)
// @route   PATCH /api/v1/applications/bulk-status
const bulkUpdateStatus = async (req, res) => {
  try {
    const authUser = req.authUser;
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

    const query = { _id: { $in: ids } };
    if (authUser.role === "recruiter") {
      const ownedJobIds = await getRecruiterJobIds(authUser.id);
      query.jobId = { $in: ownedJobIds };
    }

    const applications = await Application.find(query);

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

    const retrievedIdsStr = applications.map((app) => app._id.toString());
    ids.forEach((inputId) => {
      if (!retrievedIdsStr.includes(inputId.toString())) {
        skippedIds.push({
          id: inputId,
          candidate: "Unauthorized or missing application document reference",
          currentStatus: "N/A",
        });
      }
    });

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
      message: `${modifiedCount} application(s) updated to ${status}. ${skippedIds.length} skipped due to invalid workflow transition or lack of authorization.`,
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

// ═══════════════════════════════════════════════════════════════
// INTERNAL HELPER: Fetch PDF buffer from Cloudinary
// Tries signed URLs, private URLs, authenticated URLs, and raw URLs.
// Handles ACL-restricted files properly.
// ═══════════════════════════════════════════════════════════════
const fetchPdfBufferFromCloudinary = async (resumeUrl, resumePublicId) => {
  const candidateUrls = [];

  // 1. Generate signed URLs from public_id (HIGHEST PRIORITY - bypasses ACL)
  if (resumePublicId) {
    const signedCandidates = generateSignedUrlCandidates(null, resumePublicId);
    candidateUrls.push(...signedCandidates);
  }

  // 2. Generate signed URLs by parsing the raw Cloudinary URL
  if (resumeUrl && resumeUrl.includes("res.cloudinary.com")) {
    const signedFromUrl = generateSignedUrlCandidates(resumeUrl, null);
    for (const u of signedFromUrl) {
      if (!candidateUrls.includes(u)) candidateUrls.push(u);
    }
  }

  // 3. Add the raw URL as last resort (will fail if ACL restricted, but try anyway)
  if (resumeUrl) {
    if (!candidateUrls.includes(resumeUrl)) candidateUrls.push(resumeUrl);
    if (resumeUrl.includes("/image/upload/")) {
      const rawVariant = resumeUrl.replace("/image/upload/", "/raw/upload/");
      if (!candidateUrls.includes(rawVariant)) candidateUrls.push(rawVariant);
    }
  }

  console.log(`[fetchPdf] Trying ${candidateUrls.length} URL candidates...`);

  for (let i = 0; i < candidateUrls.length; i++) {
    const url = candidateUrls[i];
    try {
      const fetchRes = await fetch(url);
      if (fetchRes.ok) {
        const ab = await fetchRes.arrayBuffer();
        const buf = Buffer.from(ab);
        const isPdf = buf.slice(0, 4).toString() === "%PDF";
        const isSubstantial = buf.length > 500;
        if (isPdf || isSubstantial) {
          console.log(`[fetchPdf] ✅ Success on candidate #${i + 1}: ${url.slice(0, 100)}...`);
          return buf;
        }
        console.warn(`[fetchPdf] ⚠️ Candidate #${i + 1} returned ${buf.length} bytes (too small or not PDF)`);
      } else {
        console.warn(`[fetchPdf] ❌ Candidate #${i + 1} HTTP ${fetchRes.status}: ${url.slice(0, 100)}...`);
      }
    } catch (e) {
      console.warn(`[fetchPdf] ❌ Candidate #${i + 1} fetch error: ${e.message}`);
    }
  }

  return null;
};

// ═══════════════════════════════════════════════════════════════
// @desc    View resume PDF (stream from Cloudinary via admin backend)
// @route   GET /api/v1/applications/resume/view/:userId
// ═══════════════════════════════════════════════════════════════
const viewResume = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const user = await User.findById(userId).select(
      "resumeUrl resumeFileName resumePublicId"
    ).lean();

    if (!user || (!user.resumeUrl && !user.resumePublicId)) {
      let appResumeUrl = null;
      let appResumePublicId = null;
      try {
        let userObjectId;
        try { userObjectId = new mongoose.Types.ObjectId(userId); } catch (e) { userObjectId = null; }
        const userIdsArray = [userId, userObjectId].filter(Boolean);
        
        const appWithResume = await Application.findOne({
          userId: { $in: userIdsArray },
          $or: [
            { resumeUrl: { $exists: true, $ne: "" } },
            { resumePublicId: { $exists: true, $ne: "" } }
          ]
        }).select("resumeUrl resumePublicId resumeFileName").lean();

        if (appWithResume) {
          appResumeUrl = appWithResume.resumeUrl;
          appResumePublicId = appWithResume.resumePublicId;
        }
      } catch (e) {
        console.warn("[viewResume] Application fallback lookup failed:", e.message);
      }

      if (!appResumeUrl && !appResumePublicId) {
        return res.status(404).json({
          success: false,
          message: "Resume not found for this user",
        });
      }

      const pdfBuffer = await fetchPdfBufferFromCloudinary(appResumeUrl, appResumePublicId);
      if (!pdfBuffer) {
        return res.status(404).json({
          success: false,
          message: "Unable to retrieve resume PDF from storage.",
          code: "RESUME_FETCH_FAILED",
        });
      }

      const fileName = "Resume.pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(pdfBuffer);
    }

    const pdfBuffer = await fetchPdfBufferFromCloudinary(user.resumeUrl, user.resumePublicId);

    if (!pdfBuffer) {
      return res.status(404).json({
        success: false,
        message: "Unable to retrieve resume PDF from storage.",
        code: "RESUME_FETCH_FAILED",
      });
    }

    const fileName = (user.resumeFileName || "Resume.pdf").replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("[viewResume] error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message || "Error streaming resume",
        code: "RESUME_VIEW_ERROR",
      });
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Download resume PDF (force download attachment)
// @route   GET /api/v1/applications/resume/download/:userId
// ═══════════════════════════════════════════════════════════════
const downloadResume = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const user = await User.findById(userId).select(
      "resumeUrl resumeFileName resumePublicId"
    ).lean();

    let resumeUrl = user?.resumeUrl || "";
    let resumePublicId = user?.resumePublicId || "";
    let resumeFileName = user?.resumeFileName || "Resume.pdf";

    if (!resumeUrl && !resumePublicId) {
      try {
        let userObjectId;
        try { userObjectId = new mongoose.Types.ObjectId(userId); } catch (e) { userObjectId = null; }
        const userIdsArray = [userId, userObjectId].filter(Boolean);
        
        const appWithResume = await Application.findOne({
          userId: { $in: userIdsArray },
          $or: [
            { resumeUrl: { $exists: true, $ne: "" } },
            { resumePublicId: { $exists: true, $ne: "" } }
          ]
        }).select("resumeUrl resumePublicId resumeFileName").lean();

        if (appWithResume) {
          resumeUrl = appWithResume.resumeUrl || resumeUrl;
          resumePublicId = appWithResume.resumePublicId || resumePublicId;
          resumeFileName = appWithResume.resumeFileName || resumeFileName;
        }
      } catch (e) {}
    }

    if (!resumeUrl && !resumePublicId) {
      return res.status(404).json({
        success: false,
        message: "Resume not found",
      });
    }

    const pdfBuffer = await fetchPdfBufferFromCloudinary(resumeUrl, resumePublicId);

    if (!pdfBuffer) {
      return res.status(404).json({
        success: false,
        message: "Resume file not found",
      });
    }

    const fileName = resumeFileName.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Access-Control-Allow-Origin", "*");

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("[downloadResume] error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Export applications as CSV (respects filters + tenant isolation)
// @route   GET /api/v1/applications/export
// ═══════════════════════════════════════════════════════════════
const exportApplications = async (req, res) => {
  try {
    const authUser = req.authUser;
    const {
      search,
      status,
      category,
      jobId,
      userId,
      matchMin,
      matchMax,
      city,
      ids,
      sortBy = "appliedAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};

    const isAuthorized = await applyRecruiterScope(filter, authUser, jobId);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "Access denied for export",
      });
    }

    if (ids && typeof ids === "string") {
      const idArray = ids.split(",").map(s => s.trim()).filter(Boolean);
      if (idArray.length > 0) {
        const objectIds = idArray.map(id => {
          try { return new mongoose.Types.ObjectId(id); } catch { return null; }
        }).filter(Boolean);
        filter._id = { $in: [...idArray, ...objectIds] };
      }
    }

    if (search) {
      const searchOr = [
        { candidateName: { $regex: search, $options: "i" } },
        { candidateEmail: { $regex: search, $options: "i" } },
        { candidatePhone: { $regex: search, $options: "i" } },
        { jobTitle: { $regex: search, $options: "i" } },
        { jobCompany: { $regex: search, $options: "i" } },
      ];
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: filter.$or });
        filter.$and.push({ $or: searchOr });
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    if (status && status !== "all") filter.status = status;
    if (category && category !== "all") filter.category = category;

    if (userId) {
      let userObjectId;
      try { userObjectId = new mongoose.Types.ObjectId(userId); } catch (e) { userObjectId = null; }
      filter.userId = { $in: [userId, userObjectId].filter(Boolean) };
    }

    if (city) filter.candidateCity = { $regex: city, $options: "i" };

    if (matchMin || matchMax) {
      filter.matchPercentage = {};
      if (matchMin) filter.matchPercentage.$gte = parseInt(matchMin);
      if (matchMax) filter.matchPercentage.$lte = parseInt(matchMax);
    }

    const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const applications = await Application.find(filter)
      .sort(sortObj)
      .limit(10000);

    const enriched = await enrichApplications(applications, req);

    const headers = [
      "Application ID",
      "Applied At",
      "Status",
      "Category",
      "Match %",
      "Candidate Name",
      "Candidate Email",
      "Candidate Phone",
      "Candidate City",
      "Candidate Sub-Location",
      "Candidate Job Title",
      "Candidate Current Company",
      "Candidate Current Salary",
      "Candidate Experience (yrs)",
      "Candidate Experience Level",
      "Candidate English Level",
      "Candidate Skills",
      "Candidate Languages",
      "Candidate Assets",
      "Candidate Certifications",
      "Education Degree",
      "Education Specialization",
      "Education College",
      "Education End Year",
      "Account Active",
      "Account Member Since",
      "Job ID",
      "Job Title",
      "Job Company",
      "Job Location",
      "Job Salary",
      "Job Type",
      "Job Work Mode",
      "Recruiter ID",
      "Recruiter Name",
      "Recruiter Email",
      "Recruiter Mobile",
      "Recruiter WhatsApp",
      "Recruiter Designation",
      "Recruiter Company",
      "Recruiter Verified",
      "Job HR Name",
      "Job HR Role",
      "Job HR Phone",
      "Job HR WhatsApp",
      "Cover Note",
      "HR Notes",
      "Resume URL",
      "Resume Original URL",
      "Resume Download URL",
      "Resume File Name",
      "Created At",
    ];

    const rows = enriched.map((app) => {
      const edu = app.candidateEducation || {};
      const acc = app.candidateAccount || {};
      const job = app.jobDetails || {};
      const rec = app.recruiter || {};

      return [
        app._id,
        app.appliedAt ? new Date(app.appliedAt).toISOString() : "",
        app.status,
        app.category,
        app.matchPercentage,
        app.candidateName,
        app.candidateEmail,
        app.candidatePhone,
        app.candidateCity,
        app.candidateSubLocation,
        app.candidateJobTitle,
        app.candidateCurrentCompany,
        app.candidateCurrentSalary,
        app.candidateExperience,
        app.candidateExperienceLevel,
        app.candidateEnglishLevel,
        Array.isArray(app.candidateSkills) ? app.candidateSkills.join(" | ") : "",
        Array.isArray(app.candidateLanguages) ? app.candidateLanguages.join(" | ") : "",
        Array.isArray(app.candidateAssets) ? app.candidateAssets.join(" | ") : "",
        Array.isArray(app.candidateCertifications) ? app.candidateCertifications.join(" | ") : "",
        edu.degree,
        edu.specialization,
        edu.collegeName,
        edu.endYear,
        acc.isActive === true ? "Yes" : acc.isActive === false ? "No" : "",
        acc.memberSince ? new Date(acc.memberSince).toISOString() : "",
        app.jobId,
        app.jobTitle,
        app.jobCompany,
        app.jobLocation,
        app.jobSalary,
        job.jobType,
        job.workMode,
        rec.id || "",
        rec.name || "",
        rec.email || "",
        rec.mobileNumber || "",
        rec.whatsappNumber || "",
        rec.designation || "",
        rec.companyName || "",
        rec.verified ? "Yes" : "No",
        app.jobHrName,
        app.jobHrRole,
        app.jobHrPhone,
        app.jobHrWhatsapp,
        app.coverNote,
        app.hrNotes,
        app.resumeUrl,
        app.resumeOriginalUrl,
        app.resumeDownloadUrl,
        app.resumeFileName,
        app.createdAt ? new Date(app.createdAt).toISOString() : "",
      ].map(csvEscape).join(",");
    });

    const BOM = "\uFEFF";
    const csv = BOM + headers.map(csvEscape).join(",") + "\n" + rows.join("\n");

    const dateStr = new Date().toISOString().slice(0, 10);
    let suffix = "_all";
    if (status && status !== "all") suffix = `_${String(status).toLowerCase()}`;
    if (ids) suffix = "_selected";
    const filename = `SmileJobs_Applications${suffix}_${dateStr}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Export-Count", String(enriched.length));
    return res.status(200).send(csv);
  } catch (error) {
    console.error("Export Applications Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while exporting applications",
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
  exportApplications,
  viewResume,
  downloadResume,
};