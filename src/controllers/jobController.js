// FILE: backend/src/controllers/jobController.js
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const Admin = require("../models/Admin");
const Role = require("../models/Role");
const { sendEmail } = require("../utils/mailer");
const { uploadToCloudinary } = require("../utils/cloudinary");

const JWT_SECRET = process.env.JWT_SECRET || "careerflow_super_secret_jwt_key_2026_production_fallback";

// Helper to normalize any role string (strips spaces, underscores, dashes)
const normalizeRole = (role) => {
  if (!role) return "";
  return String(role).toLowerCase().replace(/[\s_-]+/g, "").trim();
};

// Robust helper to decode user from request headers
const decodeUserFromRequest = (req) => {
  if (req.user && (req.user._id || req.user.id)) return req.user;
  if (req.admin && (req.admin._id || req.admin.id)) return req.admin;
  if (req.authUser && (req.authUser._id || req.authUser.id)) return req.authUser;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  if (!token || token === "null" || token === "undefined") return null;

  const secrets = [
    process.env.JWT_SECRET,
    process.env.JWT_ADMIN_SECRET,
    process.env.ADMIN_JWT_SECRET,
    process.env.JWT_ACCESS_SECRET,
    JWT_SECRET,
    "careerflow_secret"
  ].filter(Boolean);

  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret);
      if (decoded) return decoded;
    } catch {
      // Continue trying fallback secrets
    }
  }
  return null;
};

// Robust Admin detection helper
const isAnyAdmin = (req, user) => {
  const u = user || decodeUserFromRequest(req) || req.user || req.admin || req.authUser || {};
  const role = normalizeRole(u.role || u.userType || u.type || "");

  const allAdminRoles = [
    "superadmin",
    "admin",
    "administrator",
    "careerflowadmin",
    "subadmin",
    "manager",
    "moderator",
    "supportagent",
    "contentmanager",
    "financemanager"
  ];

  return (
    allAdminRoles.includes(role) ||
    u.isAdmin === true ||
    Boolean(u.adminId)
  );
};

// Defensive helper to parse FormData JSON strings into real objects/arrays
const parseJsonField = (val) => {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return val;
    }
  }
  return val;
};

// Helper to safely populate recruiter data
const populateRecruiterSafe = async (query) => {
  try {
    return await query.populate({
      path: "recruiterId",
      model: Recruiter,
      select: "name email companyName phone isVerified website logo profileImage"
    });
  } catch (err) {
    console.warn("Recruiter population fallback:", err.message);
    return await query;
  }
};

// ═══════════════════════════════════════════════════════════════
// 1. GET ALL JOBS (Admin, Recruiter & Candidate Views)
// ═══════════════════════════════════════════════════════════════
exports.getJobs = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req);
    const isAuthorizedAdmin = isAnyAdmin(req, user);
    const userRole = normalizeRole(user?.role || user?.userType || "");
    const isRecruiter = !isAuthorizedAdmin && Boolean(user && userRole === "recruiter");

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (isAuthorizedAdmin) {
      // Admin View: Can query any status / approval queue
      if (req.query.status && req.query.status !== "All") {
        filter.status = req.query.status;
      }
      if (req.query.approvalStatus && req.query.approvalStatus !== "All") {
        if (req.query.approvalStatus === "pending" || req.query.approvalStatus === "pending_review") {
          filter.approvalStatus = { $in: ["pending_review", "pending"] };
        } else {
          filter.approvalStatus = req.query.approvalStatus;
        }
      }
      if (req.query.postedBy && req.query.postedBy !== "All") {
        filter.postedBy = req.query.postedBy.toLowerCase();
      }
    } else if (isRecruiter) {
      // Recruiter View: Show all jobs created by this recruiter
      const recruiterId = user._id || user.id || user.recruiterId;
      if (recruiterId && mongoose.Types.ObjectId.isValid(recruiterId)) {
        filter.$or = [
          { recruiterId: new mongoose.Types.ObjectId(recruiterId) },
          { postedByUserId: String(recruiterId) }
        ];
      }
      if (req.query.status && req.query.status !== "All") {
        filter.status = req.query.status;
      }
    } else {
      // Candidate / Public user: strictly live and approved
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    // Category / Industry filter
    if (req.query.jobCategory && req.query.jobCategory !== "All") {
      filter.$or = [
        { jobCategory: req.query.jobCategory },
        { industry: req.query.jobCategory }
      ];
    } else if (req.query.industry && req.query.industry !== "All") {
      filter.$or = [
        { jobCategory: req.query.industry },
        { industry: req.query.industry }
      ];
    }

    if (req.query.jobType && req.query.jobType !== "All") {
      filter.jobType = req.query.jobType;
    }
    if (req.query.workMode && req.query.workMode !== "All") {
      filter.$or = [
        { workMode: req.query.workMode },
        { workplaceType: req.query.workMode }
      ];
    }
    if (req.query.isFeatured !== undefined) {
      filter.isFeatured = req.query.isFeatured === "true";
    }

    // Search query
    if (req.query.search && req.query.search.trim()) {
      const s = req.query.search.trim();
      filter.$or = [
        { title: { $regex: s, $options: "i" } },
        { companyName: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
        { "location.state": { $regex: s, $options: "i" } },
        { skills: { $in: [new RegExp(s, "i")] } },
        { postedByName: { $regex: s, $options: "i" } }
      ];
    }

    let sort = { createdAt: -1 };
    if (req.query.sortBy === "views") sort = { "stats.views": -1, createdAt: -1 };
    if (req.query.sortBy === "applications") sort = { "stats.applications": -1, createdAt: -1 };
    if (req.query.sortBy === "salary") sort = { "salary.max": -1, createdAt: -1 };

    const [jobs, totalCount] = await Promise.all([
      populateRecruiterSafe(Job.find(filter).sort(sort).skip(skip).limit(limit).lean()),
      Job.countDocuments(filter)
    ]);

    // Aggregate status counts
    const [total, live, pending, rejected, expired, adminPosted, recruiterPosted] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live", approvalStatus: "approved", isActive: true }),
      Job.countDocuments({ approvalStatus: { $in: ["pending_review", "pending"] } }),
      Job.countDocuments({ approvalStatus: "rejected" }),
      Job.countDocuments({ status: "Expired" }),
      Job.countDocuments({ postedBy: "admin" }),
      Job.countDocuments({ postedBy: "recruiter" })
    ]);

    return res.status(200).json({
      success: true,
      jobs,
      counts: {
        total,
        live,
        pending,
        rejected,
        expired,
        adminPosted,
        recruiterPosted
      },
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
        totalItems: totalCount
      }
    });
  } catch (error) {
    console.error("getJobs Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch jobs" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 2. GET SINGLE JOB BY ID
// ═══════════════════════════════════════════════════════════════
exports.getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" });
    }

    const job = await populateRecruiterSafe(Job.findById(id));
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    // Increment views for non-admin viewers
    const user = decodeUserFromRequest(req);
    if (!isAnyAdmin(req, user)) {
      await Job.findByIdAndUpdate(id, { $inc: { "stats.views": 1 } });
    }

    return res.status(200).json({ success: true, job });
  } catch (error) {
    console.error("getJobById Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 3. CREATE JOB (Admin vs Recruiter Workflows)
// ═══════════════════════════════════════════════════════════════
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user || req.admin || req.authUser;
    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required to create a job" });
    }

    const isAuthorizedAdmin = isAnyAdmin(req, user);
    const body = { ...req.body };

    // 1. Handle Cloudinary File Uploads
    if (req.files) {
      // Company Logo
      if (req.files.logo && req.files.logo[0]) {
        try {
          const logoResult = await uploadToCloudinary(
            req.files.logo[0].buffer,
            "jobs/company/logos"
          );
          body.companyLogo = {
            url: logoResult.url,
            publicId: logoResult.publicId
          };
        } catch (uploadErr) {
          console.error("Cloudinary Logo Upload Failed:", uploadErr.message);
        }
      }

      // Company Showcase Images
      if (req.files.images && req.files.images.length > 0) {
        const uploadedImages = [];
        for (const file of req.files.images) {
          try {
            const imgResult = await uploadToCloudinary(
              file.buffer,
              "jobs/company/gallery"
            );
            uploadedImages.push({ url: imgResult.url, publicId: imgResult.publicId });
          } catch (uploadErr) {
            console.error("Cloudinary Image Upload Failed:", uploadErr.message);
          }
        }
        if (uploadedImages.length > 0) {
          body.companyImages = uploadedImages;
        }
      }
    }

    // 2. Parse stringified JSON fields from FormData
    [
      "location",
      "companyAddress",
      "salary",
      "experience",
      "company",
      "contactPerson",
      "contactVisibility",
      "companyLogo",
      "skills",
      "languages",
      "responsibilities",
      "requirements",
      "benefits",
      "companyImages"
    ].forEach((field) => {
      if (body[field] !== undefined) {
        body[field] = parseJsonField(body[field]);
      }
    });

    // 3. Normalize Location
    const loc = body.location || {};
    body.location = {
      address: body.locationAddress || loc.address || body.address || "",
      city: body.locationCity || loc.city || body.city || "",
      state: body.locationState || loc.state || body.state || "",
      country: body.locationCountry || loc.country || body.country || "India"
    };

    // 4. Normalize Company Address
    const compAddr = body.companyAddress || {};
    body.companyAddress = {
      address: compAddr.address || "",
      city: body.companyAddressCity || compAddr.city || "",
      state: body.companyAddressState || compAddr.state || "",
      country: body.companyAddressCountry || compAddr.country || "India"
    };

    // 5. Normalize Salary
    const sal = body.salary || {};
    body.salary = {
      min: Number(body.salaryMin ?? sal.min ?? body.minSalary ?? 0),
      max: Number(body.salaryMax ?? sal.max ?? body.maxSalary ?? 0),
      currency: body.salaryCurrency || sal.currency || body.currency || "INR",
      period: body.salaryPeriod || sal.period || "month",
      isNegotiable: Boolean(body.isNegotiable ?? sal.isNegotiable ?? false),
      hideSalary: Boolean(body.hideSalary ?? sal.hideSalary ?? false)
    };

    // 6. Normalize Experience
    const exp = body.experience || {};
    body.experience = {
      min: Number(body.experienceMin ?? exp.min ?? body.minExp ?? 0),
      max: Number(body.experienceMax ?? exp.max ?? body.maxExp ?? 0),
      level: body.experienceLevel || exp.level || "Fresher",
      text: body.experienceText || exp.text || ""
    };

    // 7. Normalize Company Details
    const comp = body.company || {};
    if (body.establishedYear || comp.establishedYear) {
      body.establishedYear = Number(body.establishedYear || comp.establishedYear);
    }
    if (body.organizationSize || comp.organizationSize) {
      body.organizationSize = String(body.organizationSize || comp.organizationSize || "").trim();
    }

    // 8. Normalize Array fields
    ["skills", "languages", "responsibilities", "requirements", "benefits", "qualifications"].forEach((field) => {
      if (typeof body[field] === "string") {
        body[field] = body[field]
          .split(field === "responsibilities" || field === "requirements" ? "\n" : ",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (!Array.isArray(body[field])) {
        body[field] = [];
      }
    });

    // 9. Normalize Contact & Recruiter info
    const cp = body.contactPerson || {};
    body.contactPerson = {
      name: body.recruiterName || cp.name || "",
      designation: body.recruiterDesignation || cp.designation || "",
      email: body.recruiterEmail || cp.email || "",
      phone: body.recruiterMobileNumber || cp.phone || "",
      whatsapp: body.recruiterWhatsappNumber || cp.whatsapp || ""
    };

    const cv = body.contactVisibility || {};
    body.contactVisibility = {
      whatsapp: Boolean(body.contactVisibilityWhatsapp ?? cv.whatsapp ?? false),
      mobile: Boolean(body.contactVisibilityMobile ?? cv.mobile ?? false)
    };

    // 10. Normalize companyLogo if passed as plain URL string
    if (typeof body.companyLogo === "string" && body.companyLogo.trim()) {
      body.companyLogo = { url: body.companyLogo.trim(), publicId: "" };
    }

    // 11. Authoritative Server-Side Workflow Enforcement
    let finalPostedBy = "recruiter";
    let finalPostedByName = "Recruiter";
    let finalPostedByEmail = "";
    let finalPostedByRole = "recruiter";
    let finalStatus = "Pending Approval";
    let finalApprovalStatus = "pending_review";
    let finalIsActive = false;
    let finalRecruiterId = null;
    let approvedAt = null;
    let approvedBy = null;
    let postedAt = null;

    if (isAuthorizedAdmin) {
      finalPostedBy = "admin";
      finalPostedByRole = user.role || "Super Admin";
      finalPostedByName = user.name || user.fullName || "Admin";
      finalPostedByEmail = user.email || "admin@careerflow.com";
      finalRecruiterId = body.recruiterId && mongoose.Types.ObjectId.isValid(body.recruiterId)
        ? new mongoose.Types.ObjectId(body.recruiterId)
        : null;

      // Admin jobs are published immediately unless explicitly saved as Draft/Closed
      finalStatus = body.status && ["Live", "Draft", "Closed"].includes(body.status) ? body.status : "Live";
      finalApprovalStatus = "approved";
      finalIsActive = finalStatus === "Live";
      approvedAt = new Date();
      approvedBy = finalPostedByName;
      postedAt = finalStatus === "Live" ? new Date() : null;
    } else {
      // Recruiter jobs always enter the review queue
      finalPostedBy = "recruiter";
      finalPostedByRole = "recruiter";
      finalPostedByName = user.name || user.companyName || body.companyName || "Recruiter";
      finalPostedByEmail = user.email || body.recruiterEmail || "";
      finalRecruiterId = user._id || user.id || null;
      finalStatus = "Pending Approval";
      finalApprovalStatus = "pending_review";
      finalIsActive = false;
      approvedAt = null;
      approvedBy = null;
      postedAt = null;
    }

    // Build finalized job document payload
    const jobData = {
      title: body.title,
      department: body.department || "",
      role: body.role || "",
      jobCategory: body.industry || body.jobCategory || "General",
      industry: body.industry || body.jobCategory || "General",
      jobType: body.jobType || "Full-Time",
      workMode: body.workMode || "On-site",
      workplaceType: body.workMode || "On-site",
      qualification: body.qualification || "",
      qualifications: body.qualifications || [],
      applicationUrl: body.applicationUrl || "",

      recruiterId: finalRecruiterId,
      companyName: body.companyName,
      companyWebsite: body.companyWebsite || "",
      companyLogo: body.companyLogo || { url: "", publicId: "" },
      companyImages: body.companyImages || [],
      companyInitials: body.companyInitials || "",
      establishedYear: body.establishedYear || null,
      organizationSize: body.organizationSize || "",
      companyAddress: body.companyAddress,

      location: body.location,
      jobTiming: body.jobTiming || "10:00 AM to 05:00 PM",
      workingDays: body.workingDays || "Mon - Fri",

      vacancies: Number(body.vacancies || 1),
      salary: body.salary,
      experience: body.experience,
      noticePeriod: body.noticePeriod || "",

      description: body.jobDescription || body.description || "",
      jobDescription: body.jobDescription || body.description || "",
      responsibilities: body.responsibilities || [],
      requirements: body.requirements || [],
      skills: body.skills || [],
      languages: body.languages || [],
      benefits: body.benefits || [],
      noPaymentInvolved: body.noPaymentInvolved !== false,

      contactPerson: body.contactPerson,
      contactEmail: body.contactPerson?.email || body.recruiterEmail || "",
      contactPhone: body.contactPerson?.phone || body.recruiterMobileNumber || "",
      recruiterWhatsappNumber: body.recruiterWhatsappNumber || "",
      recruiterMobileNumber: body.recruiterMobileNumber || "",
      recruiterEmail: body.recruiterEmail || "",
      contactVisibility: body.contactVisibility,
      isContactVisible: Boolean(body.contactVisibility?.mobile || body.contactVisibility?.whatsapp),
      whatsappContactEnabled: Boolean(body.contactVisibility?.whatsapp),

      status: finalStatus,
      approvalStatus: finalApprovalStatus,
      isActive: finalIsActive,
      featured: Boolean(body.featured || body.isFeatured),
      isFeatured: Boolean(body.featured || body.isFeatured),
      isUrgent: Boolean(body.isUrgent),
      isNew: true,
      isCompanyVerified: Boolean(body.isCompanyVerified),

      postedBy: finalPostedBy,
      postedByUserId: String(user._id || user.id || ""),
      postedByName: finalPostedByName,
      postedByEmail: finalPostedByEmail,
      postedByRole: finalPostedByRole,

      submittedForReviewAt: new Date(),
      approvedAt,
      approvedBy,
      postedAt,
      rejectionReason: "",
      reviewNotes: "",
      lastEditedAfterApproval: false,

      applicantsCount: 0,
      applicantsCap: Number(body.applicantsCap || 100),
      stats: {
        views: 0,
        applications: 0,
        shares: 0,
        shortlisted: 0
      }
    };

    const newJob = await Job.create(jobData);

    return res.status(201).json({
      success: true,
      message: isAuthorizedAdmin
        ? "Job created and published successfully by Admin"
        : "Job submitted successfully and is pending admin approval",
      job: newJob
    });
  } catch (error) {
    console.error("createJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to create job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 4. UPDATE JOB
// ═══════════════════════════════════════════════════════════════
exports.updateJob = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" });
    }

    const existingJob = await Job.findById(id);
    if (!existingJob) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    const user = decodeUserFromRequest(req) || req.user || req.admin || req.authUser;
    const isAuthorizedAdmin = isAnyAdmin(req, user);

    // Permission check for recruiters: can only edit own jobs
    if (!isAuthorizedAdmin) {
      const userId = String(user?._id || user?.id || "");
      const isOwner = String(existingJob.recruiterId) === userId || String(existingJob.postedByUserId) === userId;
      if (!isOwner) {
        return res.status(403).json({ success: false, message: "Unauthorized to edit this job listing" });
      }
    }

    const body = { ...req.body };

    // 1. Handle File Uploads during Update
    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        try {
          const logoResult = await uploadToCloudinary(req.files.logo[0].buffer, "jobs/company/logos");
          body.companyLogo = { url: logoResult.url, publicId: logoResult.publicId };
        } catch (uploadErr) {
          console.error("Cloudinary Logo Update Failed:", uploadErr.message);
        }
      }

      if (req.files.images && req.files.images.length > 0) {
        const uploadedImages = [];
        for (const file of req.files.images) {
          try {
            const imgResult = await uploadToCloudinary(file.buffer, "jobs/company/gallery");
            uploadedImages.push({ url: imgResult.url, publicId: imgResult.publicId });
          } catch (uploadErr) {
            console.error("Cloudinary Image Upload Failed:", uploadErr.message);
          }
        }
        let existingGallery = Array.isArray(body.existingImages) ? body.existingImages : existingJob.companyImages || [];
        body.companyImages = [...existingGallery, ...uploadedImages];
      }
    }

    // 2. Parse stringified JSON fields
    [
      "location",
      "companyAddress",
      "salary",
      "experience",
      "company",
      "contactPerson",
      "contactVisibility",
      "companyLogo",
      "skills",
      "languages",
      "responsibilities",
      "requirements",
      "benefits",
      "companyImages"
    ].forEach((field) => {
      if (body[field] !== undefined) {
        body[field] = parseJsonField(body[field]);
      }
    });

    // 3. Build Safe Updates Object
    const updates = {};

    if (body.title) updates.title = body.title.trim();
    if (body.department !== undefined) updates.department = body.department.trim();
    if (body.role !== undefined) updates.role = body.role.trim();
    if (body.jobCategory || body.industry) {
      updates.jobCategory = body.jobCategory || body.industry;
      updates.industry = body.industry || body.jobCategory;
    }
    if (body.jobType) updates.jobType = body.jobType;
    if (body.workMode) {
      updates.workMode = body.workMode;
      updates.workplaceType = body.workMode;
    }
    if (body.qualification !== undefined) updates.qualification = body.qualification;
    if (body.applicationUrl !== undefined) updates.applicationUrl = body.applicationUrl;
    if (body.companyName) updates.companyName = body.companyName;
    if (body.companyWebsite !== undefined) updates.companyWebsite = body.companyWebsite;
    if (body.companyLogo) updates.companyLogo = body.companyLogo;
    if (body.companyImages) updates.companyImages = body.companyImages;
    if (body.establishedYear !== undefined) updates.establishedYear = Number(body.establishedYear);
    if (body.organizationSize !== undefined) updates.organizationSize = body.organizationSize;

    if (body.location) {
      updates.location = {
        address: body.location.address ?? existingJob.location?.address ?? "",
        city: body.location.city ?? existingJob.location?.city ?? "",
        state: body.location.state ?? existingJob.location?.state ?? "",
        country: body.location.country ?? existingJob.location?.country ?? "India"
      };
    }

    if (body.salary) {
      updates.salary = {
        min: Number(body.salary.min ?? existingJob.salary?.min ?? 0),
        max: Number(body.salary.max ?? existingJob.salary?.max ?? 0),
        currency: body.salary.currency || existingJob.salary?.currency || "INR",
        period: body.salary.period || existingJob.salary?.period || "month",
        isNegotiable: Boolean(body.salary.isNegotiable ?? existingJob.salary?.isNegotiable),
        hideSalary: Boolean(body.salary.hideSalary ?? existingJob.salary?.hideSalary)
      };
    }

    if (body.experience) {
      updates.experience = {
        min: Number(body.experience.min ?? existingJob.experience?.min ?? 0),
        max: Number(body.experience.max ?? existingJob.experience?.max ?? 0),
        level: body.experience.level || existingJob.experience?.level || "Fresher",
        text: body.experience.text ?? existingJob.experience?.text ?? ""
      };
    }

    if (body.noticePeriod !== undefined) updates.noticePeriod = body.noticePeriod;
    if (body.jobDescription || body.description) {
      updates.description = body.jobDescription || body.description;
      updates.jobDescription = body.jobDescription || body.description;
    }

    ["skills", "languages", "responsibilities", "requirements", "benefits"].forEach((field) => {
      if (body[field] !== undefined) {
        updates[field] = Array.isArray(body[field]) ? body[field] : [];
      }
    });

    if (body.jobTiming) updates.jobTiming = body.jobTiming;
    if (body.workingDays) updates.workingDays = body.workingDays;
    if (body.contactPerson) updates.contactPerson = body.contactPerson;
    if (body.recruiterEmail !== undefined) updates.recruiterEmail = body.recruiterEmail;
    if (body.recruiterMobileNumber !== undefined) updates.recruiterMobileNumber = body.recruiterMobileNumber;
    if (body.recruiterWhatsappNumber !== undefined) updates.recruiterWhatsappNumber = body.recruiterWhatsappNumber;
    if (body.contactVisibility) updates.contactVisibility = body.contactVisibility;
    if (body.featured !== undefined || body.isFeatured !== undefined) {
      const feat = Boolean(body.featured ?? body.isFeatured);
      updates.featured = feat;
      updates.isFeatured = feat;
    }

    // Privilege Control: Prevent non-admins from self-approving
    if (!isAuthorizedAdmin) {
      if (existingJob.approvalStatus === "approved") {
        updates.lastEditedAfterApproval = true;
      }
      delete updates.approvalStatus;
      delete updates.approvedAt;
      delete updates.approvedBy;
      delete updates.postedBy;
      delete updates.postedByUserId;
    } else {
      if (body.status) updates.status = body.status;
      if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    }

    const updatedJob = await Job.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });

    return res.status(200).json({
      success: true,
      message: "Job listing updated successfully",
      job: updatedJob
    });
  } catch (error) {
    console.error("updateJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 5. DELETE JOB
// ═══════════════════════════════════════════════════════════════
exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" });
    }

    const job = await Job.findByIdAndDelete(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    return res.status(200).json({ success: true, message: "Job deleted successfully" });
  } catch (error) {
    console.error("deleteJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to delete job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 6. APPROVE JOB (ADMIN ONLY)
// ═══════════════════════════════════════════════════════════════
exports.approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const user = decodeUserFromRequest(req) || req.user || req.admin || req.authUser || {};

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.status = "Live";
    job.approvalStatus = "approved";
    job.isActive = true;
    job.approvedAt = new Date();
    job.approvedBy = user.name || user.fullName || user.email || "Admin";
    job.rejectionReason = "";
    job.lastEditedAfterApproval = false;
    if (!job.postedAt) job.postedAt = new Date();
    if (notes) job.reviewNotes = notes;

    await job.save();

    // Send email notification to recruiter
    const emailTarget = job.recruiterEmail || job.contactEmail || job.postedByEmail;
    if (emailTarget) {
      sendEmail({
        to: emailTarget,
        subject: `Job Approved: "${job.title}" is now Live on Smile Jobs`,
        text: `Congratulations! Your job posting for "${job.title}" at ${job.companyName} has been approved by our admin team and is now live for candidates.`
      }).catch((err) => console.warn("Approval email warning:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: "Job approved and published successfully",
      job
    });
  } catch (error) {
    console.error("approveJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to approve job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 7. REJECT JOB (ADMIN ONLY)
// ═══════════════════════════════════════════════════════════════
exports.rejectJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.status = "Rejected";
    job.approvalStatus = "rejected";
    job.isActive = false;
    job.rejectionReason = reason || "The job posting does not meet our platform guidelines.";
    if (notes) job.reviewNotes = notes;

    await job.save();

    // Send email notification to recruiter
    const emailTarget = job.recruiterEmail || job.contactEmail || job.postedByEmail;
    if (emailTarget) {
      sendEmail({
        to: emailTarget,
        subject: `Update on your job submission: "${job.title}"`,
        text: `Your job posting for "${job.title}" at ${job.companyName} was not approved.\n\nReason: ${job.rejectionReason}\n\nYou may update the details and resubmit for review.`
      }).catch((err) => console.warn("Rejection email warning:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: "Job rejected successfully",
      job
    });
  } catch (error) {
    console.error("rejectJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to reject job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 8. SUSPEND JOB (ADMIN ONLY)
// ═══════════════════════════════════════════════════════════════
exports.suspendJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.status = "Closed";
    job.approvalStatus = "suspended";
    job.isActive = false;
    if (reason) job.rejectionReason = reason;

    await job.save();

    return res.status(200).json({
      success: true,
      message: "Job suspended successfully",
      job
    });
  } catch (error) {
    console.error("suspendJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to suspend job" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 9. TOGGLE FEATURED
// ═══════════════════════════════════════════════════════════════
exports.toggleFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    const nextFeatured = !job.isFeatured;
    job.isFeatured = nextFeatured;
    job.featured = nextFeatured;
    await job.save();

    return res.status(200).json({
      success: true,
      message: `Job ${job.isFeatured ? "featured" : "unfeatured"} successfully`,
      isFeatured: job.isFeatured,
      featured: job.featured
    });
  } catch (error) {
    console.error("toggleFeature Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to toggle feature status" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 10. TOGGLE ACTIVE STATUS
// ═══════════════════════════════════════════════════════════════
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (job.status === "Live") {
      job.status = "Closed";
      job.isActive = false;
    } else {
      job.status = "Live";
      job.approvalStatus = "approved";
      job.isActive = true;
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: `Job status updated to ${job.status}`,
      status: job.status,
      isActive: job.isActive
    });
  } catch (error) {
    console.error("toggleStatus Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to toggle status" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 11. UPDATE CONTACT VISIBILITY
// ═══════════════════════════════════════════════════════════════
exports.updateContactVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { whatsapp, mobile } = req.body;

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (whatsapp !== undefined || mobile !== undefined) {
      job.contactVisibility = {
        whatsapp: whatsapp !== undefined ? Boolean(whatsapp) : job.contactVisibility?.whatsapp,
        mobile: mobile !== undefined ? Boolean(mobile) : job.contactVisibility?.mobile
      };
      job.isContactVisible = Boolean(job.contactVisibility.whatsapp || job.contactVisibility.mobile);
      job.whatsappContactEnabled = Boolean(job.contactVisibility.whatsapp);
    } else {
      job.isContactVisible = !job.isContactVisible;
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: "Contact visibility updated successfully",
      contactVisibility: job.contactVisibility,
      isContactVisible: job.isContactVisible
    });
  } catch (error) {
    console.error("updateContactVisibility Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update visibility" });
  }
};

// ═══════════════════════════════════════════════════════════════
// 12. STATS OVERVIEW
// ═══════════════════════════════════════════════════════════════
exports.getJobStats = async (req, res) => {
  try {
    const [total, live, pending, rejected, adminCount, recruiterCount] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live", approvalStatus: "approved", isActive: true }),
      Job.countDocuments({ approvalStatus: { $in: ["pending_review", "pending"] } }),
      Job.countDocuments({ approvalStatus: "rejected" }),
      Job.countDocuments({ postedBy: "admin" }),
      Job.countDocuments({ postedBy: "recruiter" })
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        total,
        live,
        pending,
        rejected,
        adminPosted: adminCount,
        recruiterPosted: recruiterCount
      }
    });
  } catch (error) {
    console.error("getJobStats Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch stats" });
  }
};