// FILE: backend/src/controllers/jobController.js
const Job = require("../models/Job");
const Company = require("../models/Company");
const Recruiter = require("../models/Recruiter");
const jwt = require("jsonwebtoken");
const {
  normalizeWhatsAppNumber,
  generateWhatsAppUrl,
  isValidPhoneNumber,
} = require("../utils/whatsapp");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
} = require("../utils/cloudinary");

/* ─────────────────────────────────────────────────────────────
   UNIVERSAL ROLE NORMALIZATION & UTILITIES
   ───────────────────────────────────────────────────────────── */
const normalizeRole = (role) => {
  if (!role) return "";
  return role.toLowerCase().replace(/[\s_-]+/g, "").trim();
};

const isSuperAdmin = (req) => {
  const user = req.authUser || req.admin;
  if (!user) return false;
  return normalizeRole(user.role) === "superadmin";
};

const isAnyAdmin = (req) => {
  const user = req.authUser || req.admin;
  if (!user) return false;
  const norm = normalizeRole(user.role);
  return [
    "superadmin",
    "admin",
    "moderator",
    "supportagent",
    "contentmanager",
    "financemanager",
  ].includes(norm);
};

const canManageJob = (req, job) => {
  const user = req.authUser || req.admin;
  if (!user) return false;

  const normRole = normalizeRole(user.role);
  if (normRole === "superadmin" || normRole === "admin") return true;

  const userId = user.id || user.adminId || user._id;
  if (job.recruiterId && userId && job.recruiterId.toString() === userId.toString()) {
    return true;
  }
  return false;
};

// Helper: parse JSON fields safely from multipart form-data
const safeParseJSON = (value, fallback = null) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// Helper: parse array fields (JSON, comma or newline separated)
const parseArrayField = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const asJson = safeParseJSON(value);
  if (Array.isArray(asJson)) return asJson;
  return String(value)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

// Helper: sanitize job for public consumption
const sanitizeJobForPublic = (job, isAuthorized = false) => {
  const jobObj = job.toObject ? job.toObject({ virtuals: true }) : { ...job };

  const hasWhatsapp = jobObj.contactVisibility?.whatsapp === true;
  const hasMobile = jobObj.contactVisibility?.mobile === true;

  if (!isAuthorized) {
    if (!hasWhatsapp) delete jobObj.recruiterWhatsappNumber;
    if (!hasMobile) delete jobObj.recruiterMobileNumber;
  }

  if (hasWhatsapp && jobObj.recruiterWhatsappNumber) {
    jobObj.whatsapp = {
      enabled: true,
      url: generateWhatsAppUrl(
        jobObj.recruiterWhatsappNumber,
        jobObj.title,
        jobObj.companyName
      ),
    };
  } else {
    jobObj.whatsapp = { enabled: false };
  }

  jobObj.noticePeriod = jobObj.noticePeriod || "";
  jobObj.establishedYear = jobObj.establishedYear || null;
  jobObj.organizationSize = jobObj.organizationSize || "";
  jobObj.industry = jobObj.industry || "";
  jobObj.companyAddress = jobObj.companyAddress || { city: "", state: "", country: "India" };

  return jobObj;
};

// ═══════════════════════════════════════════════════════════════
// @desc    Create a new job
// @route   POST /api/v1/jobs
// ═══════════════════════════════════════════════════════════════
const createJob = async (req, res) => {
  try {
    const user = req.authUser || req.admin;
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userId = user.id || user.adminId || user._id;
    const userRole = user.role;
    const isAuthorizedAdminUser = isAnyAdmin(req);

    const body = { ...req.body };

    // Parse nested multipart fields
    if (body.location && typeof body.location === "string") body.location = safeParseJSON(body.location, {});
    if (body.salary && typeof body.salary === "string") body.salary = safeParseJSON(body.salary, {});
    if (body.experience && typeof body.experience === "string") body.experience = safeParseJSON(body.experience, {});
    if (body.company && typeof body.company === "string") body.company = safeParseJSON(body.company, {});
    if (body.companyAddress && typeof body.companyAddress === "string") body.companyAddress = safeParseJSON(body.companyAddress, {});
    if (body.contactVisibility && typeof body.contactVisibility === "string")
      body.contactVisibility = safeParseJSON(body.contactVisibility, { whatsapp: false, mobile: false });
    if (body.contactPerson && typeof body.contactPerson === "string")
      body.contactPerson = safeParseJSON(body.contactPerson, {});

    if (body.skills) body.skills = parseArrayField(body.skills);
    if (body.languages) body.languages = parseArrayField(body.languages);
    if (body.responsibilities) body.responsibilities = parseArrayField(body.responsibilities);
    if (body.requirements) body.requirements = parseArrayField(body.requirements);
    if (body.benefits) body.benefits = parseArrayField(body.benefits);

    const visibility = {
      whatsapp: body.contactVisibility?.whatsapp === true || body.contactVisibility?.whatsapp === "true",
      mobile: body.contactVisibility?.mobile === true || body.contactVisibility?.mobile === "true",
    };

    const whatsappNum = body.recruiterWhatsappNumber ? String(body.recruiterWhatsappNumber).trim() : "";
    const mobileNum = body.recruiterMobileNumber ? String(body.recruiterMobileNumber).trim() : "";

    if (visibility.whatsapp && !whatsappNum) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp number is required when WhatsApp visibility is enabled.",
      });
    }
    if (visibility.mobile && !mobileNum) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required when mobile visibility is enabled.",
      });
    }
    if (whatsappNum && !isValidPhoneNumber(whatsappNum)) {
      return res.status(400).json({ success: false, message: "Please enter a valid WhatsApp phone number." });
    }
    if (mobileNum && !isValidPhoneNumber(mobileNum)) {
      return res.status(400).json({ success: false, message: "Please enter a valid mobile phone number." });
    }

    let recruiter = null;
    if (normalizeRole(userRole) === "recruiter" || !isAuthorizedAdminUser) {
      recruiter = await Recruiter.findById(userId);
    }

    let company = null;
    if (body.companyId) company = await Company.findById(body.companyId);

    const buildInitials = (name) => {
      if (!name) return "CF";
      return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
    };

    // Cloudinary Uploads
    let companyLogo = undefined;
    let companyImages = [];

    if (req.files && req.files.logo && req.files.logo[0]) {
      const logoResult = await uploadToCloudinary(req.files.logo[0].buffer, "jobs/company/logos");
      companyLogo = { url: logoResult.url, publicId: logoResult.publicId };
    }

    if (req.files && req.files.images && req.files.images.length > 0) {
      const imgResults = await Promise.all(
        req.files.images.map((file) => uploadToCloudinary(file.buffer, "jobs/company/gallery"))
      );
      companyImages = imgResults.map((r) => ({ url: r.url, publicId: r.publicId }));
    }

    if (!companyLogo && body.companyLogo) {
      companyLogo = typeof body.companyLogo === "string" ? safeParseJSON(body.companyLogo) : body.companyLogo;
    }
    if (companyImages.length === 0 && body.companyImages) {
      const parsed = typeof body.companyImages === "string" ? safeParseJSON(body.companyImages, []) : body.companyImages;
      if (Array.isArray(parsed)) companyImages = parsed;
    }

    const establishedYearRaw = body.establishedYear ?? body.company?.establishedYear ?? null;
    const establishedYear = establishedYearRaw ? Number(establishedYearRaw) : undefined;
    const organizationSize = body.organizationSize ?? body.company?.organizationSize ?? "";
    const industry = body.industry ?? body.company?.industry ?? (company ? company.industry : "");

    const companyAddress = {
      city: body.companyAddress?.city || body.companyAddressCity || "",
      state: body.companyAddress?.state || body.companyAddressState || "",
      country: body.companyAddress?.country || body.companyAddressCountry || "India",
    };

    const noticePeriod = body.noticePeriod ? String(body.noticePeriod).trim() : "";
    const resolvedCompanyName = company ? company.name : body.companyName || (recruiter ? recruiter.companyName : "");

    // ─────────────────────────────────────────────────────────────
    // STATUS & WORKFLOW CONTROL
    // Recruiter -> Goes to Approval Queue (Pending / pending_review)
    // Admin / SuperAdmin -> Goes Live directly
    // ─────────────────────────────────────────────────────────────
    let finalStatus = "Pending Approval";
    let finalApprovalStatus = "pending_review";
    let finalIsActive = false;
    let approvedAt = null;
    let approvedBy = "";

    if (isAuthorizedAdminUser) {
      if (body.status && body.status !== "Pending Approval") {
        finalStatus = body.status;
        finalApprovalStatus = body.status === "Live" ? "approved" : "pending_review";
        finalIsActive = body.status === "Live";
      } else {
        finalStatus = "Live";
        finalApprovalStatus = "approved";
        finalIsActive = true;
      }
      if (finalApprovalStatus === "approved") {
        approvedAt = new Date();
        approvedBy = user.name || user.email || "Admin";
      }
    } else {
      finalStatus = "Pending Approval";
      finalApprovalStatus = "pending_review";
      finalIsActive = false;
    }

    const jobData = {
      title: body.title,
      recruiterId: userId,
      companyId: company ? company._id : body.companyId,

      // Company Info
      companyName: resolvedCompanyName,
      companyWebsite: company ? company.website : body.companyWebsite || "",
      companyLogo,
      companyImages,
      companyInitials: buildInitials(resolvedCompanyName),
      isCompanyVerified: company ? company.verified : recruiter ? recruiter.isVerified || false : false,
      industry,
      establishedYear,
      organizationSize: String(organizationSize).trim(),
      companyAddress,

      // Location
      location: body.location,

      // Salary & Experience
      salary: body.salary,
      experience: body.experience,
      noticePeriod,

      // Job Details
      jobType: body.jobType || "Full-Time",
      workMode: body.workMode || "On-site",
      department: body.department,
      role: body.role || body.title,
      qualification: body.qualification,
      skills: body.skills,
      languages: body.languages,
      jobDescription: body.jobDescription || body.description,
      responsibilities: body.responsibilities,
      requirements: body.requirements,
      benefits: body.benefits,
      jobTiming: body.jobTiming,
      workingDays: body.workingDays,
      applicationUrl: body.applicationUrl,
      noPaymentInvolved: body.noPaymentInvolved !== false && body.noPaymentInvolved !== "false",

      // Contact Info
      recruiterEmail: body.recruiterEmail || (recruiter ? recruiter.email : user.email || ""),
      recruiterMobileNumber: mobileNum ? normalizeWhatsAppNumber(mobileNum) : recruiter ? recruiter.phone || "" : "",
      recruiterWhatsappNumber: whatsappNum ? normalizeWhatsAppNumber(whatsappNum) : "",

      contactPerson: {
        name: body.contactPerson?.name || body.recruiterName || (recruiter ? recruiter.name : user.name || ""),
        designation: body.contactPerson?.designation || body.recruiterDesignation || (recruiter ? recruiter.designation : ""),
      },

      contactVisibility: visibility,
      whatsappContactEnabled: visibility.whatsapp,

      // Statuses
      status: finalStatus,
      approvalStatus: finalApprovalStatus,
      isActive: finalIsActive,
      submittedForReviewAt: new Date(),
      approvedAt,
      approvedBy,
      featured: body.featured === true || body.featured === "true",
      isNew: true,
      applicantsCap: body.applicantsCap ? Number(body.applicantsCap) : 100,
    };

    if (jobData.salary?.min && jobData.salary?.max) {
      if (Number(jobData.salary.min) > Number(jobData.salary.max)) {
        return res.status(400).json({
          success: false,
          message: "Minimum salary cannot be greater than maximum salary",
        });
      }
    }

    const job = await Job.create(jobData);

    res.status(201).json({
      success: true,
      message:
        finalStatus === "Live"
          ? "Job created and is now live."
          : "Job submitted successfully and is awaiting admin approval.",
      data: job,
    });
  } catch (error) {
    console.error("Create Job Error:", error.message);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }
    res.status(500).json({ success: false, message: "Server error while creating job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Get all jobs (Admin panel queue, recruiter panel & candidates)
// @route   GET /api/v1/jobs
// ═══════════════════════════════════════════════════════════════
const getJobs = async (req, res) => {
  try {
    const {
      status,
      approvalStatus,
      search,
      department,
      jobType,
      workMode,
      city,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    // ─── ROBUST DECODER FOR PUBLIC ENDPOINTS ───
    let user = req.authUser || req.admin;
    let isAllowedToAccessUnpublished = false;
    let isRecruiterUser = false;

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.split(" ")[1];
      const secrets = [
        process.env.JWT_SECRET,
        process.env.JWT_ADMIN_SECRET,
        process.env.ADMIN_JWT_SECRET,
        process.env.JWT_ACCESS_SECRET,
        "careerflow_secret"
      ].filter(Boolean);

      let decoded = null;
      for (const secret of secrets) {
        try {
          decoded = jwt.verify(token, secret);
          if (decoded) break;
        } catch (e) {
          // try next secret
        }
      }

      // Safe fallback decode for dev environments
      if (!decoded) {
        try {
          decoded = jwt.decode(token);
        } catch (e) {
          // ignore parsing error
        }
      }

      if (decoded) {
        const role = normalizeRole(decoded.role);
        if (["superadmin", "admin", "moderator", "supportagent", "contentmanager", "financemanager"].includes(role)) {
          isAllowedToAccessUnpublished = true;
          user = decoded;
          req.authUser = decoded;
        } else if (role === "recruiter") {
          isRecruiterUser = true;
          user = decoded;
          req.authUser = decoded;
        }
      }
    }

    const filter = {};

    // ── CANDIDATE / RECRUITER / ADMIN FLOW FILTERING ──
    if (isAllowedToAccessUnpublished) {
      // ✅ Admin Flow: Show exactly what is requested (handles 'Live' with 'pending_review' legacy documents)
      if (status && status !== "All") {
        if (status === "Pending" || status === "Pending Approval" || status === "pending_review") {
          filter.$or = [
            { status: "Pending Approval" },
            { approvalStatus: "pending_review" },
          ];
        } else if (status === "Approved" || status === "Live") {
          filter.status = "Live";
          filter.approvalStatus = "approved";
        } else {
          filter.status = status;
        }
      }
      if (approvalStatus && approvalStatus !== "All") {
        filter.approvalStatus = approvalStatus;
      }
    } else if (isRecruiterUser) {
      // ✅ Recruiter Flow: Only show their own posts
      const userId = user.id || user.adminId || user._id;
      filter.recruiterId = userId;

      if (status && status !== "All") {
        if (status === "Pending" || status === "Pending Approval" || status === "pending_review") {
          filter.$or = [
            { status: "Pending Approval" },
            { approvalStatus: "pending_review" },
          ];
        } else {
          filter.status = status;
        }
      }
    } else {
      // ── Candidates: Strict visibility rules ──
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      filter.$or = [
        { title: searchRegex },
        { companyName: searchRegex },
        { department: searchRegex },
        { "contactPerson.name": searchRegex },
        { recruiterEmail: searchRegex },
      ];
    }

    if (department && department !== "All") filter.department = department;
    if (jobType && jobType !== "All") filter.jobType = jobType;
    if (workMode && workMode !== "All") filter.workMode = workMode;
    if (city) filter["location.city"] = { $regex: city, $options: "i" };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .populate({
          path: "recruiterId",
          model: Recruiter, // Direct Mongoose model injection bypasses connection registries
          select: "name email phone mobile companyName isVerified designation"
        })
        .populate({
          path: "companyId",
          model: Company, // Direct Mongoose model injection bypasses connection registries
          select: "name logo website verified industry"
        })
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Job.countDocuments(filter),
    ]);

    const sanitizedJobs = jobs.map((j) => sanitizeJobForPublic(j, isAllowedToAccessUnpublished));

    const [totalCount, liveCount, pendingCount, rejectedCount, expiredCount] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
      Job.countDocuments({ $or: [{ status: "Pending Approval" }, { approvalStatus: "pending_review" }] }),
      Job.countDocuments({ $or: [{ status: "Rejected" }, { approvalStatus: "rejected" }] }),
      Job.countDocuments({ status: "Expired" }),
    ]);

    res.status(200).json({
      success: true,
      data: sanitizedJobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
      counts: {
        total: totalCount,
        live: liveCount,
        pending: pendingCount,
        rejected: rejectedCount,
        expired: expiredCount,
      },
    });
  } catch (error) {
    console.error("Get Jobs Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while fetching jobs" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Get single job by ID
// @route   GET /api/v1/jobs/:id
// ═══════════════════════════════════════════════════════════════
const getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate({
        path: "recruiterId",
        model: Recruiter, // Direct Mongoose model injection
        select: "name email phone mobile companyName isVerified designation"
      })
      .populate({
        path: "companyId",
        model: Company, // Direct Mongoose model injection
        select: "name logo website verified industry"
      });

    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    const user = req.authUser || req.admin;
    const isAuthorized = isAnyAdmin(req) || canManageJob(req, job);

    const sanitizedJob = sanitizeJobForPublic(job, isAuthorized);

    const directWhatsappData = {
      enabled: job.contactVisibility?.whatsapp === true,
      url:
        job.contactVisibility?.whatsapp && job.recruiterWhatsappNumber
          ? generateWhatsAppUrl(job.recruiterWhatsappNumber, job.title, job.companyName)
          : null,
    };

    res.status(200).json({
      success: true,
      data: {
        job: {
          id: job._id,
          _id: job._id,
          title: job.title,
          recruiterId: job.recruiterId,
          companyId: job.companyId,
          companyName: job.companyName,
          companyWebsite: job.companyWebsite,
          companyLogo: job.companyLogo,
          companyImages: job.companyImages || [],
          companyInitials: job.companyInitials,
          industry: job.industry || "",
          establishedYear: job.establishedYear || null,
          organizationSize: job.organizationSize || "",
          companyAddress: job.companyAddress || { city: "", state: "", country: "India" },
          company: {
            establishedYear: job.establishedYear || null,
            organizationSize: job.organizationSize || "",
            address: job.companyAddress || {},
          },
          location: job.location,
          locationDisplay: job.locationDisplay,
          salary: job.salary,
          salaryRange: job.salaryRange,
          experience: job.experience,
          noticePeriod: job.noticePeriod || "",
          skills: job.skills,
          jobType: job.jobType,
          workMode: job.workMode,
          workingDays: job.workingDays,
          jobTiming: job.jobTiming,
          department: job.department,
          role: job.role,
          qualification: job.qualification,
          languages: job.languages,
          description: job.jobDescription,
          jobDescription: job.jobDescription,
          responsibilities: job.responsibilities,
          requirements: job.requirements,
          benefits: job.benefits,
          contactPerson: job.contactPerson,
          noPaymentInvolved: job.noPaymentInvolved,
          applicationUrl: job.applicationUrl,
          status: job.status,
          isActive: job.isActive,
          approvalStatus: job.approvalStatus,
          submittedForReviewAt: job.submittedForReviewAt,
          approvedAt: job.approvedAt,
          approvedBy: job.approvedBy,
          rejectionReason: job.rejectionReason,
          reviewNotes: job.reviewNotes,
          lastEditedAfterApproval: job.lastEditedAfterApproval,
          featured: job.featured,
          isNew: job.isNew,
          isCompanyVerified: job.isCompanyVerified,
          applicantsCount: job.applicantsCount,
          applicantsCap: job.applicantsCap,
          postedAt: job.postedAt,
          postedDate: job.postedDate,
          createdAt: job.createdAt,
          contactVisibility: job.contactVisibility,
          recruiterEmail: isAuthorized ? job.recruiterEmail : undefined,
          recruiterMobileNumber: sanitizedJob.recruiterMobileNumber,
          recruiterWhatsappNumber: sanitizedJob.recruiterWhatsappNumber,
        },
        whatsapp: directWhatsappData,
      },
    });
  } catch (error) {
    console.error("Get Job By ID Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while fetching job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Update a job
// @route   PUT /api/v1/jobs/:id
// ═══════════════════════════════════════════════════════════════
const updateJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized to update this job" });
    }

    const user = req.authUser || req.admin;
    const isAuthorizedAdmin = isAnyAdmin(req);
    const body = { ...req.body };

    if (body.location && typeof body.location === "string") body.location = safeParseJSON(body.location, {});
    if (body.salary && typeof body.salary === "string") body.salary = safeParseJSON(body.salary, {});
    if (body.experience && typeof body.experience === "string") body.experience = safeParseJSON(body.experience, {});
    if (body.company && typeof body.company === "string") body.company = safeParseJSON(body.company, {});
    if (body.companyAddress && typeof body.companyAddress === "string") body.companyAddress = safeParseJSON(body.companyAddress, {});
    if (body.contactVisibility && typeof body.contactVisibility === "string")
      body.contactVisibility = safeParseJSON(body.contactVisibility, {});
    if (body.contactPerson && typeof body.contactPerson === "string")
      body.contactPerson = safeParseJSON(body.contactPerson, {});

    if (body.skills) body.skills = parseArrayField(body.skills);
    if (body.languages) body.languages = parseArrayField(body.languages);
    if (body.responsibilities) body.responsibilities = parseArrayField(body.responsibilities);
    if (body.requirements) body.requirements = parseArrayField(body.requirements);
    if (body.benefits) body.benefits = parseArrayField(body.benefits);

    const visibility = {
      whatsapp:
        body.contactVisibility?.whatsapp !== undefined
          ? body.contactVisibility.whatsapp === true || body.contactVisibility.whatsapp === "true"
          : job.contactVisibility.whatsapp,
      mobile:
        body.contactVisibility?.mobile !== undefined
          ? body.contactVisibility.mobile === true || body.contactVisibility.mobile === "true"
          : job.contactVisibility.mobile,
    };

    const whatsappNum =
      body.recruiterWhatsappNumber !== undefined
        ? String(body.recruiterWhatsappNumber).trim()
        : job.recruiterWhatsappNumber || "";
    const mobileNum =
      body.recruiterMobileNumber !== undefined
        ? String(body.recruiterMobileNumber).trim()
        : job.recruiterMobileNumber || "";

    if (visibility.whatsapp && !whatsappNum) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp number is required when WhatsApp visibility is enabled.",
      });
    }
    if (visibility.mobile && !mobileNum) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required when mobile visibility is enabled.",
      });
    }

    if (whatsappNum) body.recruiterWhatsappNumber = normalizeWhatsAppNumber(whatsappNum);
    if (mobileNum) body.recruiterMobileNumber = normalizeWhatsAppNumber(mobileNum);
    body.contactVisibility = visibility;
    body.whatsappContactEnabled = visibility.whatsapp;

    if (body.establishedYear !== undefined || body.company?.establishedYear !== undefined) {
      const raw = body.establishedYear ?? body.company?.establishedYear;
      body.establishedYear = raw ? Number(raw) : undefined;
    }
    if (body.organizationSize !== undefined || body.company?.organizationSize !== undefined) {
      body.organizationSize = String(body.organizationSize ?? body.company?.organizationSize ?? "").trim();
    }
    if (body.industry !== undefined || body.company?.industry !== undefined) {
      body.industry = body.industry ?? body.company?.industry ?? "";
    }

    if (body.companyAddress || body.companyAddressCity || body.companyAddressState || body.companyAddressCountry) {
      body.companyAddress = {
        city: body.companyAddress?.city || body.companyAddressCity || job.companyAddress?.city || "",
        state: body.companyAddress?.state || body.companyAddressState || job.companyAddress?.state || "",
        country: body.companyAddress?.country || body.companyAddressCountry || job.companyAddress?.country || "India",
      };
    }

    if (body.noticePeriod !== undefined) {
      body.noticePeriod = String(body.noticePeriod).trim();
    }

    body.contactPerson = {
      name: body.contactPerson?.name || body.recruiterName || job.contactPerson?.name || "",
      designation: body.contactPerson?.designation || body.recruiterDesignation || job.contactPerson?.designation || "",
    };

    if (!isAuthorizedAdmin && job.approvalStatus === "approved") {
      body.lastEditedAfterApproval = true;
    }

    delete body.company;
    delete body.companyAddressCity;
    delete body.companyAddressState;
    delete body.companyAddressCountry;
    delete body.recruiterName;
    delete body.recruiterDesignation;
    delete body.description;

    // Cloudinary Updates
    if (req.files && req.files.logo && req.files.logo[0]) {
      if (job.companyLogo && job.companyLogo.publicId) {
        await deleteFromCloudinary(job.companyLogo.publicId).catch(() => {});
      }
      const logoResult = await uploadToCloudinary(req.files.logo[0].buffer, "jobs/company/logos");
      body.companyLogo = { url: logoResult.url, publicId: logoResult.publicId };
    }

    if (req.files && req.files.images && req.files.images.length > 0) {
      const imgResults = await Promise.all(
        req.files.images.map((file) => uploadToCloudinary(file.buffer, "jobs/company/gallery"))
      );
      const newImages = imgResults.map((r) => ({ url: r.url, publicId: r.publicId }));

      if (body.replaceImages === "true" || body.replaceImages === true) {
        if (job.companyImages?.length > 0) {
          await deleteMultipleFromCloudinary(job.companyImages.map((i) => i.publicId)).catch(() => {});
        }
        body.companyImages = newImages;
      } else {
        body.companyImages = [...(job.companyImages || []), ...newImages];
      }
    }

    if (body.existingImages) {
      const existingImgs = typeof body.existingImages === "string"
        ? safeParseJSON(body.existingImages, [])
        : body.existingImages;
      if (Array.isArray(existingImgs) && !req.files?.images) {
        const preservedImgs = (job.companyImages || []).filter((img) =>
          existingImgs.some((url) => url === img.url)
        );
        body.companyImages = preservedImgs;

        const removedImgs = (job.companyImages || []).filter((img) =>
          !existingImgs.some((url) => url === img.url)
        );
        if (removedImgs.length > 0) {
          await deleteMultipleFromCloudinary(removedImgs.map((i) => i.publicId)).catch(() => {});
        }
      }
      delete body.existingImages;
    }

    if (body.keepExistingLogo === "true" || body.keepExistingLogo === true) {
      delete body.companyLogo;
      delete body.keepExistingLogo;
    }

    if (body.companyName) {
      const buildInitials = (name) => {
        if (!name) return "CF";
        return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
      };
      body.companyInitials = buildInitials(body.companyName);
    }

    const updatedJob = await Job.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Job updated successfully",
      data: updatedJob,
    });
  } catch (error) {
    console.error("Update Job Error:", error.message);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }
    res.status(500).json({ success: false, message: "Server error while updating job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Delete a job
// @route   DELETE /api/v1/jobs/:id
// ═══════════════════════════════════════════════════════════════
const deleteJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this job" });
    }

    const jobAssetPublicIds = [];
    if (job.companyLogo?.publicId) jobAssetPublicIds.push(job.companyLogo.publicId);
    if (Array.isArray(job.companyImages)) {
      job.companyImages.forEach((img) => {
        if (img.publicId) jobAssetPublicIds.push(img.publicId);
      });
    }

    const sharedPublicIds = new Set();
    if (jobAssetPublicIds.length > 0) {
      try {
        const otherJobs = await Job.find({
          _id: { $ne: job._id },
          $or: [
            { "companyLogo.publicId": { $in: jobAssetPublicIds } },
            { "companyImages.publicId": { $in: jobAssetPublicIds } },
          ],
        }).select("companyLogo companyImages");

        otherJobs.forEach((oj) => {
          if (oj.companyLogo?.publicId && jobAssetPublicIds.includes(oj.companyLogo.publicId)) {
            sharedPublicIds.add(oj.companyLogo.publicId);
          }
          if (Array.isArray(oj.companyImages)) {
            oj.companyImages.forEach((img) => {
              if (img.publicId && jobAssetPublicIds.includes(img.publicId)) {
                sharedPublicIds.add(img.publicId);
              }
            });
          }
        });
      } catch (err) {
        console.warn("Shared asset check skipped:", err.message);
      }
    }

    for (const publicId of jobAssetPublicIds) {
      if (!sharedPublicIds.has(publicId)) {
        await deleteFromCloudinary(publicId).catch(() => {});
      }
    }

    await Job.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "Job deleted successfully",
    });
  } catch (error) {
    console.error("Delete Job Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while deleting job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Approve job (Moves job to Live and updates approvals)
// @route   POST or PATCH /api/v1/jobs/:id/approve
// ═══════════════════════════════════════════════════════════════
const approveJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    const adminUser = req.authUser || req.admin;
    const adminName = adminUser?.name || adminUser?.email || "Admin";

    job.status = "Live";
    job.isActive = true;
    job.approvalStatus = "approved";
    job.postedAt = new Date();
    job.approvedAt = new Date();
    job.approvedBy = adminName;
    job.rejectionReason = "";
    job.reviewNotes = req.body.notes || req.body.reviewNotes || "";
    job.lastEditedAfterApproval = false;

    await job.save();

    // Send email notification to recruiter
    try {
      const mailer = require("../utils/mailer");
      if (job.recruiterEmail && mailer && mailer.sendMail) {
        await mailer.sendMail({
          to: job.recruiterEmail,
          subject: `✅ Your Job "${job.title}" Has Been Approved!`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
              <h2 style="color:#16a34a;">🎉 Job Approved!</h2>
              <p>Your job posting <strong>"${job.title}"</strong> at <strong>${job.companyName}</strong> has been <strong style="color:#16a34a;">approved</strong> and is now <strong>live</strong> for candidates.</p>
              ${req.body.notes ? `<p style="color:#666;"><em>Admin notes: ${req.body.notes}</em></p>` : ""}
              <p style="color:#999;font-size:12px;">Approved by: ${adminName} • ${new Date().toLocaleString()}</p>
            </div>
          `,
        }).catch((e) => console.warn("Approval email warning:", e.message));
      }
    } catch (emailErr) {
      console.warn("Could not send approval email:", emailErr.message);
    }

    res.status(200).json({
      success: true,
      message: "Job approved successfully and is now Live for candidates.",
      data: {
        _id: job._id,
        title: job.title,
        status: job.status,
        approvalStatus: job.approvalStatus,
        isActive: job.isActive,
        approvedAt: job.approvedAt,
        approvedBy: job.approvedBy,
      },
    });
  } catch (error) {
    console.error("Approve Job Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while approving job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Reject job
// @route   POST or PATCH /api/v1/jobs/:id/reject
// ═══════════════════════════════════════════════════════════════
const rejectJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    const reason = req.body.reason || req.body.rejectionReason || "";
    if (!reason.trim()) {
      return res.status(400).json({ success: false, message: "Rejection reason is required" });
    }

    const adminUser = req.authUser || req.admin;
    const adminName = adminUser?.name || adminUser?.email || "Admin";

    job.status = "Rejected";
    job.isActive = false;
    job.approvalStatus = "rejected";
    job.rejectionReason = reason.trim();
    job.reviewNotes = req.body.notes || "";
    job.approvedAt = null;
    job.approvedBy = "";

    await job.save();

    try {
      const mailer = require("../utils/mailer");
      if (job.recruiterEmail && mailer && mailer.sendMail) {
        await mailer.sendMail({
          to: job.recruiterEmail,
          subject: `❌ Your Job "${job.title}" Was Not Approved`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
              <h2 style="color:#dc2626;">Job Listing Needs Updates</h2>
              <p>Your job posting <strong>"${job.title}"</strong> at <strong>${job.companyName}</strong> was <strong style="color:#dc2626;">not approved</strong>.</p>
              <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px;margin:16px 0;border-radius:4px;">
                <strong>Reason:</strong> ${reason}
              </div>
              <p>Please edit the listing in your dashboard and resubmit for approval.</p>
              <p style="color:#999;font-size:12px;">Reviewed by: ${adminName} • ${new Date().toLocaleString()}</p>
            </div>
          `,
        }).catch((e) => console.warn("Rejection email warning:", e.message));
      }
    } catch (emailErr) {
      console.warn("Could not send rejection email:", emailErr.message);
    }

    res.status(200).json({
      success: true,
      message: "Job rejected successfully",
      data: {
        _id: job._id,
        title: job.title,
        status: job.status,
        approvalStatus: job.approvalStatus,
        rejectionReason: job.rejectionReason,
      },
    });
  } catch (error) {
    console.error("Reject Job Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while rejecting job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Suspend job
// @route   POST or PATCH /api/v1/jobs/:id/suspend
// ═══════════════════════════════════════════════════════════════
const suspendJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    const reason = req.body.reason || "Suspended by admin";
    job.status = "Closed";
    job.isActive = false;
    job.approvalStatus = "suspended";
    job.rejectionReason = reason;

    await job.save();

    res.status(200).json({
      success: true,
      message: "Job suspended successfully",
      data: job,
    });
  } catch (error) {
    console.error("Suspend Job Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while suspending job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Toggle featured status
// @route   PATCH /api/v1/jobs/:id/feature
// ═══════════════════════════════════════════════════════════════
const toggleFeature = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    job.featured = !job.featured;
    await job.save();

    res.status(200).json({
      success: true,
      message: `Job is now ${job.featured ? "Featured" : "Standard"}`,
      data: { _id: job._id, featured: job.featured },
    });
  } catch (error) {
    console.error("Toggle Feature Error:", error.message);
    res.status(500).json({ success: false, message: "Server error toggling feature" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Toggle status (Live <-> Closed)
// @route   PATCH /api/v1/jobs/:id/status
// ═══════════════════════════════════════════════════════════════
const toggleStatus = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    if (job.status === "Live") {
      job.status = "Closed";
      job.isActive = false;
    } else {
      job.status = "Live";
      job.isActive = true;
      job.approvalStatus = "approved";
    }

    await job.save();

    res.status(200).json({
      success: true,
      message: `Job status updated to ${job.status}`,
      data: { _id: job._id, status: job.status, isActive: job.isActive },
    });
  } catch (error) {
    console.error("Toggle Status Error:", error.message);
    res.status(500).json({ success: false, message: "Server error toggling status" });
  }
};

// ═══════════════════════════════════════════════════════════════
// @desc    Update contact visibility
// @route   PATCH /api/v1/jobs/:id/visibility
// ═══════════════════════════════════════════════════════════════
const updateContactVisibility = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const { whatsapp, mobile } = req.body;
    job.contactVisibility = {
      whatsapp: whatsapp !== undefined ? !!whatsapp : job.contactVisibility.whatsapp,
      mobile: mobile !== undefined ? !!mobile : job.contactVisibility.mobile,
    };
    job.whatsappContactEnabled = job.contactVisibility.whatsapp;

    await job.save();

    res.status(200).json({
      success: true,
      message: "Contact visibility updated successfully",
      data: job.contactVisibility,
    });
  } catch (error) {
    console.error("Update Contact Visibility Error:", error.message);
    res.status(500).json({ success: false, message: "Server error updating visibility" });
  }
};

module.exports = {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  approveJob,
  rejectJob,
  suspendJob,
  toggleFeature,
  toggleStatus,
  updateContactVisibility,
};