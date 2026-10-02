// FILE: backend/src/controllers/jobController.js
const Job = require("../models/Job");
const Company = require("../models/Company");
const Recruiter = require("../models/Recruiter");
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
   UNIVERSAL ROLE NORMALIZATION & BYPASS UTILITIES
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
  return ["superadmin", "admin", "moderator", "supportagent", "contentmanager", "financemanager"].includes(norm);
};

const canManageJob = (req, job) => {
  const user = req.authUser || req.admin;
  if (!user) return false;

  const normRole = normalizeRole(user.role);
  if (normRole === "superadmin") return true;
  if (normRole === "admin") return true;

  const userId = user.id || user.adminId;
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

// Helper: sanitize job for public consumption — ensures ALL fields present
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

  // ─── EXPLICITLY ENSURE ALL NEW FIELDS ARE PRESENT ───
  jobObj.noticePeriod = jobObj.noticePeriod || '';
  jobObj.establishedYear = jobObj.establishedYear || null;
  jobObj.organizationSize = jobObj.organizationSize || '';
  jobObj.industry = jobObj.industry || '';
  jobObj.companyAddress = jobObj.companyAddress || { city: '', state: '', country: 'India' };

  return jobObj;
};

// @desc    Create a new job
// @route   POST /api/v1/jobs
const createJob = async (req, res) => {
  try {
    const user = req.authUser || req.admin;
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userId = user.id || user.adminId;
    const userRole = user.role;

    // Parse nested fields when coming from multipart form-data
    const body = { ...req.body };

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

    // Toggle validation
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
    if (normalizeRole(userRole) === "recruiter") recruiter = await Recruiter.findById(userId);

    let company = null;
    if (body.companyId) company = await Company.findById(body.companyId);

    const buildInitials = (name) => {
      if (!name) return "CF";
      return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
    };

    // ========== CLOUDINARY UPLOADS ==========
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

    const isAuthorizedAdminUser = ["superadmin", "admin"].includes(normalizeRole(userRole));

    // ─── EXTRACT COMPANY INFO FROM MULTIPLE POSSIBLE SOURCES ───
    const establishedYearRaw =
      body.establishedYear ??
      body.company?.establishedYear ??
      null;
    const establishedYear = establishedYearRaw ? Number(establishedYearRaw) : undefined;

    const organizationSize =
      body.organizationSize ??
      body.company?.organizationSize ??
      "";

    const industry =
      body.industry ??
      body.company?.industry ??
      (company ? company.industry : "");

    // ─── COMPANY ADDRESS ───
    const companyAddress = {
      city: body.companyAddress?.city || body.companyAddressCity || "",
      state: body.companyAddress?.state || body.companyAddressState || "",
      country: body.companyAddress?.country || body.companyAddressCountry || "India",
    };

    // ─── NOTICE PERIOD ───
    const noticePeriod = body.noticePeriod ? String(body.noticePeriod).trim() : "";

    const jobData = {
      title: body.title,
      recruiterId: userId,
      companyId: company ? company._id : body.companyId,

      // Company Info
      companyName: company ? company.name : body.companyName || (recruiter ? recruiter.companyName : ""),
      companyWebsite: company ? company.website : body.companyWebsite || "",
      companyLogo,
      companyImages,
      companyInitials: buildInitials(company ? company.name : body.companyName),
      isCompanyVerified: company ? company.verified : false,
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
      jobType: body.jobType,
      workMode: body.workMode,
      department: body.department,
      role: body.role,
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

      // Recruiter / Contact
      recruiterEmail: body.recruiterEmail || (recruiter ? recruiter.email : ""),
      recruiterMobileNumber: mobileNum ? normalizeWhatsAppNumber(mobileNum) : "",
      recruiterWhatsappNumber: whatsappNum ? normalizeWhatsAppNumber(whatsappNum) : "",

      contactPerson: {
        name: body.contactPerson?.name || body.recruiterName || (recruiter ? recruiter.name : ""),
        designation:
          body.contactPerson?.designation || body.recruiterDesignation || (recruiter ? recruiter.designation : ""),
      },

      contactVisibility: visibility,
      whatsappContactEnabled: visibility.whatsapp,

      // Status & Settings
      status: isAuthorizedAdminUser
        ? body.status || "Live"
        : "Pending Approval",

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
      message: "Job created successfully",
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

// @desc    Get all jobs
const getJobs = async (req, res) => {
  try {
    const {
      status,
      search,
      department,
      jobType,
      workMode,
      city,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const filter = {};
    if (status && status !== "All") {
      if (status === "Pending") filter.status = "Pending Approval";
      else if (status === "Approved") filter.status = "Live";
      else filter.status = status;
    }
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { department: { $regex: search, $options: "i" } },
      ];
    }
    if (department && department !== "All") filter.department = department;
    if (jobType && jobType !== "All") filter.jobType = jobType;
    if (workMode && workMode !== "All") filter.workMode = workMode;
    if (city) filter["location.city"] = { $regex: city, $options: "i" };

    const user = req.authUser || req.admin;
    const isAllowedToAccessUnpublished =
      user && ["admin", "super_admin", "Super Admin", "Admin", "recruiter"].some(r => normalizeRole(r) === normalizeRole(user.role));

    if (!isAllowedToAccessUnpublished) {
      filter.status = "Live";
      filter.isActive = true;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [jobs, total] = await Promise.all([
      Job.find(filter).sort(sort).skip(skip).limit(parseInt(limit)),
      Job.countDocuments(filter),
    ]);

    const sanitizedJobs = jobs.map((j) => sanitizeJobForPublic(j, isAllowedToAccessUnpublished));

    const [totalCount, liveCount, pendingCount, rejectedCount, expiredCount] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live" }),
      Job.countDocuments({ status: "Pending Approval" }),
      Job.countDocuments({ status: "Rejected" }),
      Job.countDocuments({ status: "Expired" }),
    ]);

    res.status(200).json({
      success: true,
      data: sanitizedJobs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
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

// @desc    Get single job
const getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    const user = req.authUser || req.admin;
    const normRole = user ? normalizeRole(user.role) : "";

    const isAdminOrRecruiter =
      user && ["admin", "super_admin", "Super Admin", "Admin", "recruiter"].some(r => normalizeRole(r) === normRole);
    
    const isJobOwner =
      user &&
      normalizeRole(user.role) === "recruiter" &&
      job.recruiterId.toString() === (user.id || user.adminId).toString();
    
    const isAuthorized = isAdminOrRecruiter || isJobOwner || normRole === "superadmin";

    const sanitizedJob = sanitizeJobForPublic(job, isAuthorized);

    const directWhatsappData = {
      enabled: job.contactVisibility?.whatsapp === true,
      url:
        job.contactVisibility?.whatsapp && job.recruiterWhatsappNumber
          ? generateWhatsAppUrl(job.recruiterWhatsappNumber, job.title, job.companyName)
          : null,
    };

    let company = null;
    if (job.companyId) company = await Company.findById(job.companyId);

    res.status(200).json({
      success: true,
      data: {
        job: {
          id: job._id,
          _id: job._id,
          title: job.title,
          companyName: job.companyName,
          companyWebsite: job.companyWebsite,
          companyLogo: company?.logo || job.companyLogo,
          companyImages: company?.images || job.companyImages || [],
          companyInitials: job.companyInitials,
          industry: job.industry || '',
          establishedYear: job.establishedYear || null,
          organizationSize: job.organizationSize || '',
          companyAddress: job.companyAddress || { city: '', state: '', country: 'India' },
          // Nested company object (for frontend edit page compatibility)
          company: {
            establishedYear: job.establishedYear || null,
            organizationSize: job.organizationSize || '',
            address: job.companyAddress || {},
          },
          location: job.location,
          locationDisplay: job.locationDisplay,
          salary: job.salary,
          salaryRange: job.salaryRange,
          experience: job.experience,
          noticePeriod: job.noticePeriod || '',
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

// @desc    Update a job
const updateJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized to update this job" });
    }

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

    // ─── EXTRACT COMPANY INFO (support both nested & flat frontend updates) ───
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

    // ─── COMPANY ADDRESS ───
    if (body.companyAddress || body.companyAddressCity || body.companyAddressState || body.companyAddressCountry) {
      body.companyAddress = {
        city: body.companyAddress?.city || body.companyAddressCity || job.companyAddress?.city || "",
        state: body.companyAddress?.state || body.companyAddressState || job.companyAddress?.state || "",
        country: body.companyAddress?.country || body.companyAddressCountry || job.companyAddress?.country || "India",
      };
    }

    // ─── NOTICE PERIOD ───
    if (body.noticePeriod !== undefined) {
      body.noticePeriod = String(body.noticePeriod).trim();
    }

    // ─── RECRUITER CONTACT PERSON Normalization ───
    body.contactPerson = {
      name: body.contactPerson?.name || body.recruiterName || job.contactPerson?.name || "",
      designation: body.contactPerson?.designation || body.recruiterDesignation || job.contactPerson?.designation || "",
    };

    // Clean up transient properties to prevent MongoDB structural errors
    delete body.company;
    delete body.companyAddressCity;
    delete body.companyAddressState;
    delete body.companyAddressCountry;
    delete body.recruiterName;
    delete body.recruiterDesignation;
    delete body.description;

    // ========== CLOUDINARY UPLOADS ON UPDATE ==========
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

    // Preserve existing images during edit submit
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
// @desc    Delete a job (SAFE — protects shared Cloudinary assets)
// @route   DELETE /api/v1/jobs/:id
// ═══════════════════════════════════════════════════════════════
const deleteJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this job" });
    }

    // ─── Step 1: Collect all Cloudinary publicIds from THIS job ───
    const jobAssetPublicIds = [];
    if (job.companyLogo?.publicId) {
      jobAssetPublicIds.push(job.companyLogo.publicId);
    }
    if (Array.isArray(job.companyImages)) {
      job.companyImages.forEach((img) => {
        if (img.publicId) jobAssetPublicIds.push(img.publicId);
      });
    }

    // ─── Step 2: Find which assets are shared with OTHER jobs ───
    const sharedPublicIds = new Set();

    if (jobAssetPublicIds.length > 0) {
      try {
        const otherJobsUsingAssets = await Job.find({
          _id: { $ne: job._id },
          $or: [
            { "companyLogo.publicId": { $in: jobAssetPublicIds } },
            { "companyImages.publicId": { $in: jobAssetPublicIds } },
          ],
        }).select("companyLogo companyImages");

        otherJobsUsingAssets.forEach((otherJob) => {
          if (otherJob.companyLogo?.publicId && jobAssetPublicIds.includes(otherJob.companyLogo.publicId)) {
            sharedPublicIds.add(otherJob.companyLogo.publicId);
          }
          if (Array.isArray(otherJob.companyImages)) {
            otherJob.companyImages.forEach((img) => {
              if (img.publicId && jobAssetPublicIds.includes(img.publicId)) {
                sharedPublicIds.add(img.publicId);
              }
            });
          }
        });
      } catch (shareErr) {
        console.warn(`⚠️ Could not check shared assets across jobs: ${shareErr.message}`);
      }
    }

    // ─── Step 3: Check recruiter's profile for shared assets ───
    try {
      if (job.recruiterId) {
        const recruiter = await Recruiter.findById(job.recruiterId)
          .select("companyProfile companyLogo companyImages")
          .lean();

        if (recruiter) {
          // Check recruiter profile logo (multiple possible field locations)
          const profileLogoId =
            recruiter.companyProfile?.logo?.publicId ||
            recruiter.companyLogo?.publicId;
          if (profileLogoId && jobAssetPublicIds.includes(profileLogoId)) {
            sharedPublicIds.add(profileLogoId);
          }

          // Check recruiter profile gallery
          const profileGallery =
            recruiter.companyProfile?.gallery ||
            recruiter.companyImages ||
            [];
          if (Array.isArray(profileGallery)) {
            profileGallery.forEach((g) => {
              if (g.publicId && jobAssetPublicIds.includes(g.publicId)) {
                sharedPublicIds.add(g.publicId);
              }
            });
          }
        }
      }
    } catch (recruiterErr) {
      // Non-fatal: if recruiter lookup fails, proceed with caution
      console.warn(
        `⚠️ Could not check recruiter profile for shared assets: ${recruiterErr.message}`
      );
    }

    // ─── Step 4: Delete ONLY non-shared assets from Cloudinary ───
    const deletedAssets = [];
    const skippedAssets = [];

    for (const publicId of jobAssetPublicIds) {
      if (sharedPublicIds.has(publicId)) {
        console.log(
          `ℹ️ Skipping shared asset deletion (used by other jobs/profile): [${publicId}]`
        );
        skippedAssets.push(publicId);
        continue;
      }

      try {
        await deleteFromCloudinary(publicId);
        deletedAssets.push(publicId);
        console.log(`✅ Deleted Cloudinary asset: [${publicId}]`);
      } catch (cloudErr) {
        // Non-fatal: log but don't block DB deletion
        console.warn(
          `⚠️ Cloudinary deletion failed for [${publicId}]: ${cloudErr.message}`
        );
      }
    }

    // ─── Step 5: Delete the job document from MongoDB ───
    await Job.findByIdAndDelete(req.params.id);

    console.log(
      `🗑️ Job deleted: "${job.title}" [${job._id}] | Assets deleted: ${deletedAssets.length}, Skipped (shared): ${skippedAssets.length}`
    );

    res.status(200).json({
      success: true,
      message: "Job deleted successfully",
      data: {
        deletedAssets: deletedAssets.length,
        skippedSharedAssets: skippedAssets.length,
      },
    });
  } catch (error) {
    console.error("Delete Job Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while deleting job",
    });
  }
};

// @desc    Approve job
const approveJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    job.status = "Live";
    job.isActive = true;
    job.postedAt = new Date();
    await job.save();

    res.status(200).json({ success: true, message: "Job approved and is now live", data: job });
  } catch (error) {
    console.error("Approve Job Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while approving job" });
  }
};

// @desc    Reject job
const rejectJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    job.status = "Rejected";
    job.rejectionReason = req.body.reason || "";
    await job.save();

    res.status(200).json({ success: true, message: "Job has been rejected", data: job });
  } catch (error) {
    console.error("Reject Job Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while rejecting job" });
  }
};

// @desc    Toggle featured status
const toggleFeature = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!isAnyAdmin(req)) {
      return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
    }

    job.featured = !job.featured;
    await job.save();

    res.status(200).json({
      success: true,
      message: `Job ${job.featured ? "featured" : "unfeatured"} successfully`,
      data: { featured: job.featured },
    });
  } catch (error) {
    console.error("Toggle Feature Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while toggling feature" });
  }
};

// @desc    Toggle job status
const toggleStatus = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Unauthorized status change attempt." });
    }

    if (job.status === "Live") {
      job.status = "Closed";
      job.isActive = false;
    } else if (job.status === "Closed" || job.status === "Expired") {
      job.status = "Live";
      job.isActive = true;
    } else {
      return res.status(400).json({
        success: false,
        message: `Cannot toggle status for a job that is ${job.status}`,
      });
    }

    await job.save();

    res.status(200).json({
      success: true,
      message: `Job is now ${job.status}`,
      data: { status: job.status, isActive: job.isActive },
    });
  } catch (error) {
    console.error("Toggle Status Error:", error.message);
    res.status(500).json({ success: false, message: "Server error while toggling status" });
  }
};

// @desc    Update contact visibility
const updateContactVisibility = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (!canManageJob(req, job)) {
      return res.status(403).json({ success: false, message: "Not authorized to modify visibility." });
    }

    const { whatsapp, mobile } = req.body;

    if (whatsapp === true && !job.recruiterWhatsappNumber) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp number is required when WhatsApp visibility is enabled.",
      });
    }
    if (mobile === true && !job.recruiterMobileNumber) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required when mobile visibility is enabled.",
      });
    }

    if (typeof whatsapp === "boolean") {
      job.contactVisibility.whatsapp = whatsapp;
      job.whatsappContactEnabled = whatsapp;
    }
    if (typeof mobile === "boolean") {
      job.contactVisibility.mobile = mobile;
    }

    await job.save();

    res.status(200).json({
      success: true,
      message: "Contact visibility settings updated successfully",
      data: job.contactVisibility,
    });
  } catch (error) {
    console.error("Update Contact Visibility Error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
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
  toggleFeature,
  toggleStatus,
  updateContactVisibility,
};