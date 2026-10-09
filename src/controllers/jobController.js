const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const { sendEmail } = require("../utils/mailer");

// Helper to decode JWT inline for public/flexible endpoints
const decodeUserFromRequest = (req) => {
  if (req.user && (req.user._id || req.user.id)) return req.user;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  if (!token) return null;

  const secrets = [
    process.env.JWT_SECRET,
    process.env.JWT_ADMIN_SECRET,
    process.env.ADMIN_JWT_SECRET,
    process.env.JWT_ACCESS_SECRET,
    "careerflow_secret"
  ].filter(Boolean);

  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret);
      if (decoded) return decoded;
    } catch {
      // try next secret
    }
  }
  return null;
};

// Robust Admin detection helper
const isAnyAdmin = (req, user) => {
  if (req?.body?.postedBy === "admin" || req?.body?.postedByRole === "admin") return true;

  const u = user || req?.user || req?.admin || {};
  const role = String(u.role || u.userType || u.type || "").toLowerCase();

  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "careerflow_admin" ||
    role === "subadmin" ||
    role === "manager" ||
    u.isAdmin === true ||
    Boolean(u.adminId)
  );
};

// Helper to safely populate recruiter data across connections
const populateRecruiterSafe = async (query) => {
  try {
    return await query.populate({
      path: "recruiterId",
      model: Recruiter,
      select: "name email companyName phone isVerified website logo profileImage"
    });
  } catch (err) {
    console.warn("Recruiter population fallback (running unpopulated):", err.message);
    return await query;
  }
};

// Helper to generate company initials
const generateInitials = (name) => {
  if (!name || typeof name !== "string") return "CF";
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "CF"
  );
};

// ──────────────────────────────────────────────────────────────
// Transform backend Job document → Target JSON structure
// ──────────────────────────────────────────────────────────────
const transformJobForFrontend = (job) => {
  if (!job) return null;
  const j = typeof job.toObject === "function" ? job.toObject() : job;

  const companyName = j.companyName || j.company || "";
  const initials = j.companyInitials || generateInitials(companyName);

  // Build salary range display
  let salaryRange = "Not Disclosed";
  if (j.salary && (j.salary.min || j.salary.max)) {
    const min = j.salary.min || 0;
    const max = j.salary.max || 0;
    const currency = j.salary.currency || "INR";
    const symbol = currency === "INR" ? "₹" : currency;
    if (min && max) {
      salaryRange = `${symbol} ${min.toLocaleString()} - ${max.toLocaleString()}`;
    } else if (max) {
      salaryRange = `${symbol} Up to ${max.toLocaleString()}`;
    } else if (min) {
      salaryRange = `${symbol} ${min.toLocaleString()}+`;
    }
  }

  // Build location display
  let locationDisplay = "";
  if (j.location) {
    const parts = [j.location.address, j.location.city, j.location.state].filter(Boolean);
    locationDisplay = parts.join(", ");
  }

  // Normalize company logo structure
  let logoObj = { url: "", publicId: "" };
  if (j.companyLogo) {
    if (typeof j.companyLogo === "object") {
      logoObj = {
        url: j.companyLogo.url || "",
        publicId: j.companyLogo.publicId || ""
      };
    } else if (typeof j.companyLogo === "string") {
      logoObj = { url: j.companyLogo, publicId: "" };
    }
  }

  // Normalize company gallery images
  let imagesArr = [];
  if (Array.isArray(j.companyImages)) {
    imagesArr = j.companyImages.map((img) => {
      if (typeof img === "object") {
        return {
          url: img.url || "",
          publicId: img.publicId || "",
          _id: img._id || undefined
        };
      }
      return { url: String(img), publicId: "" };
    });
  }

  // Recruiter info
  let recruiterInfo = j.recruiterId;
  if (recruiterInfo && typeof recruiterInfo === "object" && recruiterInfo._id) {
    recruiterInfo = {
      _id: recruiterInfo._id,
      name: recruiterInfo.name,
      email: recruiterInfo.email,
      companyName: recruiterInfo.companyName,
      phone: recruiterInfo.phone,
      isVerified: recruiterInfo.isVerified,
      logo: recruiterInfo.logo,
      profileImage: recruiterInfo.profileImage
    };
  }

  const desc = j.jobDescription || j.description || "";

  return {
    _id: j._id,
    id: j._id,
    title: j.title || "",
    recruiterId: recruiterInfo || null,
    companyName,
    company: companyName,
    companyWebsite: j.companyWebsite || "",
    companyLogo: logoObj,
    companyImages: imagesArr,
    companyInitials: initials,
    location: {
      address: j.location?.address || "",
      city: j.location?.city || "",
      state: j.location?.state || "",
      country: j.location?.country || "India"
    },
    locationDisplay,
    salary: {
      min: j.salary?.min || 0,
      max: j.salary?.max || 0,
      currency: j.salary?.currency || "INR",
      period: j.salary?.period || "month"
    },
    salaryRange,
    salaryPeriod: j.salary?.period || "month",
    experience: {
      min: j.experience?.min || 0,
      max: j.experience?.max || 0,
      text: j.experience?.text || ""
    },
    jobType: j.jobType || "Full-Time",
    workMode: j.workMode || j.workplaceType || "On-site",
    workplaceType: j.workplaceType || j.workMode || "On-site",
    department: j.department || "",
    role: j.role || "",
    qualification: j.qualification || "",
    skills: Array.isArray(j.skills) ? j.skills : [],
    languages: Array.isArray(j.languages) ? j.languages : [],
    jobDescription: desc,
    description: desc,
    responsibilities: Array.isArray(j.responsibilities) ? j.responsibilities : [],
    requirements: Array.isArray(j.requirements) ? j.requirements : [],
    benefits: Array.isArray(j.benefits) ? j.benefits : [],
    jobTiming: j.jobTiming || "",
    workingDays: j.workingDays || "",
    contactPerson: {
      name: j.contactPerson?.name || "",
      designation: j.contactPerson?.designation || ""
    },
    recruiterWhatsappNumber: j.recruiterWhatsappNumber || "",
    recruiterMobileNumber: j.recruiterMobileNumber || "",
    recruiterEmail: j.recruiterEmail || "",
    applicationUrl: j.applicationUrl || "",
    noPaymentInvolved: j.noPaymentInvolved !== false,
    contactVisibility: {
      whatsapp: j.contactVisibility?.whatsapp ?? !!j.whatsappContactEnabled,
      mobile: j.contactVisibility?.mobile ?? !!j.isContactVisible
    },
    whatsappContactEnabled: j.whatsappContactEnabled ?? !!j.contactVisibility?.whatsapp,
    isContactVisible: j.isContactVisible !== false,
    status: j.status || "Live",
    isActive: j.isActive !== false,
    featured: j.featured || j.isFeatured || false,
    isFeatured: j.isFeatured || j.featured || false,
    isNew:
      j.isNew !== undefined
        ? j.isNew
        : j.createdAt
        ? new Date() - new Date(j.createdAt) < 1000 * 60 * 60 * 24 * 7
        : true,
    isCompanyVerified: j.isCompanyVerified || false,
    industry: j.industry || j.jobCategory || "",
    jobCategory: j.jobCategory || j.industry || "General",
    applicantsCount: j.applicantsCount || j.stats?.applications || 0,
    applicantsCap: j.applicantsCap || 100,
    postedAt: j.postedAt || j.createdAt || new Date(),
    establishedYear: j.establishedYear || null,
    noticePeriod: j.noticePeriod || "",
    organizationSize: j.organizationSize || "",
    approvalStatus: j.approvalStatus || "pending_review",
    submittedForReviewAt: j.submittedForReviewAt || j.createdAt || new Date(),
    approvedAt: j.approvedAt || null,
    approvedBy: j.approvedBy || "",
    rejectionReason: j.rejectionReason || "",
    reviewNotes: j.reviewNotes || "",
    lastEditedAfterApproval: j.lastEditedAfterApproval || false,
    createdAt: j.createdAt || new Date(),
    updatedAt: j.updatedAt || new Date(),
    __v: j.__v ?? 0,
    companyAddress: {
      country: j.companyAddress?.country || j.location?.country || "India"
    },
    postedBy: j.postedBy || "recruiter",
    postedByEmail: j.postedByEmail || "",
    postedByName: j.postedByName || "",
    postedByRole: j.postedByRole || "",
    postedByUserId: j.postedByUserId || "",
    stats: j.stats || { views: 0, applications: 0 }
  };
};

// 1. GET ALL JOBS
exports.getJobs = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req);
    const isAuthorizedAdmin = isAnyAdmin(req, user);
    const userRole = String(user?.role || user?.userType || "").toLowerCase();
    const isRecruiter = Boolean(user && userRole === "recruiter");

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (isAuthorizedAdmin) {
      if (req.query.status && req.query.status !== "All" && req.query.status !== "") {
        filter.status = req.query.status;
      }
      if (req.query.approvalStatus && req.query.approvalStatus !== "All") {
        filter.approvalStatus = req.query.approvalStatus;
      }
      if (req.query.postedBy && req.query.postedBy !== "All") {
        filter.postedBy = req.query.postedBy.toLowerCase();
      }
    } else if (isRecruiter) {
      const recruiterId = user._id || user.id || user.recruiterId;
      if (recruiterId && mongoose.Types.ObjectId.isValid(recruiterId)) {
        filter.recruiterId = recruiterId;
      }
      if (req.query.status && req.query.status !== "All") {
        filter.status = req.query.status;
      }
    } else {
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    if (req.query.jobCategory && req.query.jobCategory !== "All") {
      filter.$or = [{ jobCategory: req.query.jobCategory }, { industry: req.query.jobCategory }];
    }
    if (req.query.jobType && req.query.jobType !== "All") {
      filter.jobType = req.query.jobType;
    }
    const workModeQ = req.query.workMode || req.query.workplaceType;
    if (workModeQ && workModeQ !== "All") {
      filter.$or = [{ workMode: workModeQ }, { workplaceType: workModeQ }];
    }
    const featuredQ = req.query.featured !== undefined ? req.query.featured : req.query.isFeatured;
    if (featuredQ !== undefined) {
      filter.$or = [
        { isFeatured: featuredQ === "true" || featuredQ === true },
        { featured: featuredQ === "true" || featuredQ === true }
      ];
    }

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
    if (req.query.sortBy === "applications") sort = { applicantsCount: -1, createdAt: -1 };
    if (req.query.sortBy === "salary") sort = { "salary.max": -1, createdAt: -1 };

    const [rawJobs, totalCount] = await Promise.all([
      populateRecruiterSafe(Job.find(filter).sort(sort).skip(skip).limit(limit)),
      Job.countDocuments(filter)
    ]);

    const jobs = rawJobs.map((j) => transformJobForFrontend(j));

    const [total, live, pending, rejected, expired, adminPosted, recruiterPosted] =
      await Promise.all([
        Job.countDocuments({}),
        Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
        Job.countDocuments({ approvalStatus: "pending_review" }),
        Job.countDocuments({ approvalStatus: "rejected" }),
        Job.countDocuments({ status: "Expired" }),
        Job.countDocuments({ $or: [{ postedBy: "admin" }, { recruiterId: null }] }),
        Job.countDocuments({ postedBy: "recruiter", recruiterId: { $ne: null } })
      ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      success: true,
      data: jobs,
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
        total: totalCount,
        totalItems: totalCount,
        pages: totalPages,
        totalPages
      }
    });
  } catch (error) {
    console.error("getJobs Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch jobs"
    });
  }
};

// 2. GET SINGLE JOB
exports.getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" });
    }

    const rawJob = await populateRecruiterSafe(Job.findById(id));
    if (!rawJob) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    const user = decodeUserFromRequest(req);
    if (!isAnyAdmin(req, user)) {
      await Job.findByIdAndUpdate(id, { $inc: { "stats.views": 1 } });
    }

    const job = transformJobForFrontend(rawJob);
    return res.status(200).json({ success: true, data: job, job });
  } catch (error) {
    console.error("getJobById Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch job"
    });
  }
};

// 3. CREATE JOB
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user;
    const isAuthorizedAdmin = isAnyAdmin(req, user);

    const body = { ...req.body };

    // 1. JSON String parsing (from multipart or stringified bodies)
    [
      "location",
      "salary",
      "experience",
      "contactPerson",
      "companyAddress",
      "contactVisibility",
      "companyLogo",
      "companyImages"
    ].forEach((f) => {
      if (typeof body[f] === "string") {
        try {
          body[f] = JSON.parse(body[f]);
        } catch {
          /* keep as string */
        }
      }
    });

    // 2. Description Sync (Crucial Fix)
    const rawDesc = body.description || body.jobDescription || "";
    body.description = rawDesc;
    body.jobDescription = rawDesc;

    // 3. Job Category & Industry Defaulting
    if (!body.jobCategory || body.jobCategory.trim() === "") {
      body.jobCategory = body.industry || body.department || body.role || "General";
    }
    if (!body.industry && body.jobCategory) {
      body.industry = body.jobCategory;
    }

    // 4. Salary & Period Normalization
    let salaryObj = typeof body.salary === "object" && body.salary !== null ? { ...body.salary } : {};
    if (body.minSalary !== undefined) salaryObj.min = Number(body.minSalary);
    if (body.maxSalary !== undefined) salaryObj.max = Number(body.maxSalary);
    if (body.currency) salaryObj.currency = body.currency;
    if (body.salaryPeriod) salaryObj.period = body.salaryPeriod;

    const rawPeriod = String(salaryObj.period || "month").toLowerCase().trim();
    const periodMap = {
      month: "month",
      monthly: "month",
      "per month": "month",
      year: "year",
      yearly: "year",
      annual: "year",
      "per year": "year",
      hour: "hour",
      hourly: "hour",
      "per hour": "hour",
      day: "day",
      daily: "day",
      "per day": "day",
      week: "week",
      weekly: "week",
      "per week": "week"
    };

    salaryObj.period = periodMap[rawPeriod] || "month";
    salaryObj.min = Number(salaryObj.min || 0);
    salaryObj.max = Number(salaryObj.max || 0);
    salaryObj.currency = salaryObj.currency || "INR";
    body.salary = salaryObj;

    // 5. Experience Normalization
    let expObj = typeof body.experience === "object" && body.experience !== null ? { ...body.experience } : {};
    if (body.minExp !== undefined) expObj.min = Number(body.minExp);
    if (body.maxExp !== undefined) expObj.max = Number(body.maxExp);
    if (body.experienceText) expObj.text = body.experienceText;
    expObj.min = Number(expObj.min || 0);
    expObj.max = Number(expObj.max || 0);
    expObj.text = expObj.text || "";
    body.experience = expObj;

    // 6. Location Normalization
    body.location = {
      address: body.address || body.location?.address || "",
      city: body.city || body.location?.city || "",
      state: body.stateName || body.state || body.location?.state || "",
      country: body.country || body.location?.country || "India"
    };

    // 7. Company Address & Initials
    body.companyAddress = {
      country: body.companyAddress?.country || body.location.country || "India"
    };
    body.companyInitials = body.companyInitials || generateInitials(body.companyName);

    // 8. Work Mode & Workplace Type Normalization
    const mode = body.workMode || body.workplaceType || "On-site";
    body.workMode = mode;
    body.workplaceType = mode;

    // 9. Contact Visibility
    const showWa = Boolean(
      body.contactVisibility?.whatsapp ?? body.whatsappContactEnabled ?? body.showWhatsapp
    );
    const showMob = Boolean(
      body.contactVisibility?.mobile ?? body.isContactVisible ?? body.showMobile
    );
    body.contactVisibility = { whatsapp: showWa, mobile: showMob };
    body.whatsappContactEnabled = showWa;
    body.isContactVisible = showMob;

    // 10. Featured flags
    const isFeat = Boolean(body.featured ?? body.isFeatured ?? false);
    body.featured = isFeat;
    body.isFeatured = isFeat;

    // 11. Array parsing
    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach(
      (field) => {
        if (typeof body[field] === "string") {
          try {
            const parsed = JSON.parse(body[field]);
            if (Array.isArray(parsed)) {
              body[field] = parsed;
              return;
            }
          } catch {
            /* fallthrough */
          }
          body[field] = body[field]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (!Array.isArray(body[field])) {
          body[field] = [];
        }
      }
    );

    // 12. Determine Auth Roles & Defaults
    let finalPostedBy = "recruiter";
    let finalPostedByName = "Recruiter";
    let finalPostedByEmail = "";
    let finalPostedByRole = "recruiter";
    let finalStatus = "Pending Approval";
    let finalApprovalStatus = "pending_review";
    let finalIsActive = false;
    let approvedAt = null;
    let approvedBy = "";

    if (isAuthorizedAdmin) {
      finalPostedBy = "admin";
      finalPostedByRole = "admin";
      finalPostedByName =
        user?.name ||
        user?.fullName ||
        body.postedByName ||
        user?.email?.split("@")[0] ||
        "Smile Jobs";
      finalPostedByEmail = user?.email || body.postedByEmail || "admin@careerflow.com";
      finalStatus = body.status && body.status !== "Pending Approval" ? body.status : "Live";
      finalApprovalStatus = finalStatus === "Live" ? "approved" : "pending_review";
      finalIsActive = finalStatus === "Live";
      if (finalApprovalStatus === "approved") {
        approvedAt = new Date();
        approvedBy = finalPostedByName;
      }
    } else {
      finalPostedBy = "recruiter";
      finalPostedByRole = "recruiter";
      finalPostedByName =
        user?.name ||
        user?.companyName ||
        body.postedByName ||
        body.companyName ||
        "Recruiter";
      finalPostedByEmail = user?.email || body.postedByEmail || "";
      finalStatus = "Pending Approval";
      finalApprovalStatus = "pending_review";
      finalIsActive = false;
    }

    const jobData = {
      ...body,
      isNew: true,
      noPaymentInvolved: true,
      applicationUrl: body.applicationUrl || "",
      isCompanyVerified: body.isCompanyVerified !== undefined ? body.isCompanyVerified : true,
      applicantsCount: Number(body.applicantsCount || 0),
      applicantsCap: Number(body.applicantsCap || 100),
      postedBy: finalPostedBy,
      postedByName: finalPostedByName,
      postedByEmail: finalPostedByEmail,
      postedByRole: finalPostedByRole,
      postedByUserId: user?._id || user?.id || "",
      recruiterId: isAuthorizedAdmin
        ? body.recruiterId && mongoose.Types.ObjectId.isValid(body.recruiterId)
          ? body.recruiterId
          : null
        : user?._id || user?.id || null,
      status: finalStatus,
      approvalStatus: finalApprovalStatus,
      isActive: finalIsActive,
      submittedForReviewAt: new Date(),
      approvedAt,
      approvedBy,
      postedAt: new Date(),
      rejectionReason: "",
      reviewNotes: body.notes || body.reviewNotes || "",
      lastEditedAfterApproval: false
    };

    const newJob = await Job.create(jobData);
    const transformed = transformJobForFrontend(newJob);

    return res.status(201).json({
      success: true,
      message: isAuthorizedAdmin
        ? "Job created and published successfully by Admin"
        : "Job submitted successfully and is pending admin approval",
      data: transformed,
      job: transformed
    });
  } catch (error) {
    console.error("createJob Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create job"
    });
  }
};

// 4. UPDATE JOB
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

    const user = decodeUserFromRequest(req) || req.user;
    const isAuthorizedAdmin = isAnyAdmin(req, user);

    const updates = { ...req.body };

    [
      "location",
      "salary",
      "experience",
      "contactPerson",
      "companyAddress",
      "contactVisibility",
      "companyLogo",
      "companyImages"
    ].forEach((f) => {
      if (typeof updates[f] === "string") {
        try {
          updates[f] = JSON.parse(updates[f]);
        } catch {
          /* keep as string */
        }
      }
    });

    if (updates.jobDescription && !updates.description) {
      updates.description = updates.jobDescription;
    }
    if (updates.description && !updates.jobDescription) {
      updates.jobDescription = updates.description;
    }

    if (updates.city || updates.state || updates.stateName || updates.address || updates.country) {
      updates.location = {
        city: updates.city || existingJob.location?.city || "",
        state: updates.stateName || updates.state || existingJob.location?.state || "",
        country: updates.country || existingJob.location?.country || "India",
        address: updates.address || existingJob.location?.address || ""
      };
    }

    if (updates.minSalary !== undefined || updates.maxSalary !== undefined || updates.salaryPeriod) {
      updates.salary = {
        min: Number(updates.minSalary ?? existingJob.salary?.min ?? 0),
        max: Number(updates.maxSalary ?? existingJob.salary?.max ?? 0),
        currency: updates.currency || existingJob.salary?.currency || "INR",
        period: updates.salaryPeriod || existingJob.salary?.period || "month",
        isNegotiable: Boolean(updates.isNegotiable ?? existingJob.salary?.isNegotiable)
      };
    }

    if (updates.workMode) {
      updates.workplaceType = updates.workMode;
    }
    if (updates.featured !== undefined) {
      updates.isFeatured = updates.featured === true || updates.featured === "true";
    }

    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach(
      (field) => {
        if (typeof updates[field] === "string") {
          try {
            const parsed = JSON.parse(updates[field]);
            if (Array.isArray(parsed)) {
              updates[field] = parsed;
              return;
            }
          } catch {
            /* fallthrough */
          }
          updates[field] = updates[field]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    );

    if (!isAuthorizedAdmin && existingJob.approvalStatus === "approved") {
      updates.lastEditedAfterApproval = true;
    }

    const updatedJob = await Job.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    const transformed = transformJobForFrontend(updatedJob);

    return res.status(200).json({
      success: true,
      message: "Job updated successfully",
      data: transformed,
      job: transformed
    });
  } catch (error) {
    console.error("updateJob Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update job"
    });
  }
};

// 5. DELETE JOB
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

    return res.status(200).json({
      success: true,
      message: "Job deleted successfully"
    });
  } catch (error) {
    console.error("deleteJob Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete job"
    });
  }
};

// 6. APPROVE JOB (ADMIN ONLY)
exports.approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const user = req.user || {};

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.status = "Live";
    job.approvalStatus = "approved";
    job.isActive = true;
    job.approvedAt = new Date();
    job.approvedBy = user.name || user.email || "Smile Jobs";
    job.rejectionReason = "";
    if (notes) job.reviewNotes = notes;

    await job.save();

    if (job.contactEmail || job.postedByEmail) {
      const emailTarget = job.contactEmail || job.postedByEmail;
      sendEmail({
        to: emailTarget,
        subject: `Job Approved: "${job.title}" is now Live`,
        text: `Congratulations! Your job posting for "${job.title}" at ${job.companyName} has been approved.`
      }).catch((err) => console.warn("Approval email warning:", err.message));
    }

    const transformed = transformJobForFrontend(job);
    return res.status(200).json({
      success: true,
      message: "Job approved and published successfully",
      data: transformed,
      job: transformed
    });
  } catch (error) {
    console.error("approveJob Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to approve job"
    });
  }
};

// 7. REJECT JOB (ADMIN ONLY)
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

    if (job.contactEmail || job.postedByEmail) {
      const emailTarget = job.contactEmail || job.postedByEmail;
      sendEmail({
        to: emailTarget,
        subject: `Update on your job submission: "${job.title}"`,
        text: `Your job posting for "${job.title}" was not approved.\nReason: ${job.rejectionReason}`
      }).catch((err) => console.warn("Rejection email warning:", err.message));
    }

    const transformed = transformJobForFrontend(job);
    return res.status(200).json({
      success: true,
      message: "Job rejected",
      data: transformed,
      job: transformed
    });
  } catch (error) {
    console.error("rejectJob Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to reject job"
    });
  }
};

// 8. SUSPEND JOB (ADMIN ONLY)
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

    const transformed = transformJobForFrontend(job);
    return res.status(200).json({
      success: true,
      message: "Job suspended successfully",
      data: transformed,
      job: transformed
    });
  } catch (error) {
    console.error("suspendJob Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to suspend job"
    });
  }
};

// 9. TOGGLE FEATURED
exports.toggleFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.isFeatured = !job.isFeatured;
    job.featured = job.isFeatured;
    await job.save();

    return res.status(200).json({
      success: true,
      message: `Job ${job.isFeatured ? "featured" : "unfeatured"} successfully`,
      isFeatured: job.isFeatured,
      featured: job.isFeatured
    });
  } catch (error) {
    console.error("toggleFeature Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle feature status"
    });
  }
};

// 10. TOGGLE ACTIVE STATUS
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
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle status"
    });
  }
};

// 11. TOGGLE CONTACT VISIBILITY
exports.updateContactVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { whatsapp, mobile } = req.body;
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (whatsapp !== undefined) {
      job.contactVisibility = job.contactVisibility || {};
      job.contactVisibility.whatsapp = Boolean(whatsapp);
      job.whatsappContactEnabled = Boolean(whatsapp);
    }
    if (mobile !== undefined) {
      job.contactVisibility = job.contactVisibility || {};
      job.contactVisibility.mobile = Boolean(mobile);
      job.isContactVisible = Boolean(mobile);
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: `Contact visibility updated`,
      contactVisibility: job.contactVisibility
    });
  } catch (error) {
    console.error("updateContactVisibility Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update visibility"
    });
  }
};

// 12. STATS
exports.getJobStats = async (req, res) => {
  try {
    const [total, live, pending, rejected, adminCount, recruiterCount] =
      await Promise.all([
        Job.countDocuments({}),
        Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
        Job.countDocuments({ approvalStatus: "pending_review" }),
        Job.countDocuments({ approvalStatus: "rejected" }),
        Job.countDocuments({ $or: [{ postedBy: "admin" }, { recruiterId: null }] }),
        Job.countDocuments({ postedBy: "recruiter", recruiterId: { $ne: null } })
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
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch stats"
    });
  }
};