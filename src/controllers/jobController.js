const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const { sendEmail } = require("../utils/mailer");

// Helper to decode JWT inline for public endpoints
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

// ──────────────────────────────────────────────────────────────
// Transform backend Job document → frontend-friendly shape
// This is the critical fix that makes jobs appear in Admin Panel.
// ──────────────────────────────────────────────────────────────
const transformJobForFrontend = (job) => {
  if (!job) return null;
  const j = typeof job.toObject === "function" ? job.toObject() : job;

  const companyName = j.companyName || j.company || "";
  const initials =
    companyName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "CF";

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
    const parts = [j.location.city, j.location.state].filter(Boolean);
    locationDisplay = parts.join(", ");
  }

  // Recruiter info (populated or raw)
  let recruiterInfo = j.recruiterId;
  if (recruiterInfo && typeof recruiterInfo === "object") {
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

  return {
    _id: j._id,
    id: j._id,
    title: j.title || "",
    companyName,
    company: companyName,
    companyInitials: initials,
    companyLogo: j.companyLogo || null,
    companyWebsite: j.companyWebsite || "",
    isCompanyVerified: j.isCompanyVerified || false,
    industry: j.industry || j.jobCategory || "",
    establishedYear: j.establishedYear || null,
    organizationSize: j.organizationSize || "",
    companyAddress: j.companyAddress || {},
    companyImages: Array.isArray(j.companyImages) ? j.companyImages : [],
    location: j.location || {},
    locationDisplay,
    workMode: j.workplaceType || j.workMode || "On-site",
    workplaceType: j.workplaceType || j.workMode || "On-site",
    jobType: j.jobType || "Full-Time",
    jobCategory: j.jobCategory || "",
    department: j.department || "",
    role: j.role || "",
    qualification: j.qualification || "",
    salary: j.salary || {},
    salaryRange,
    salaryPeriod: j.salary?.period || "Per Month",
    experience: j.experience || {},
    noticePeriod: j.noticePeriod || "",
    status: j.status || "Live",
    approvalStatus: j.approvalStatus || "",
    featured: j.isFeatured || false,
    isFeatured: j.isFeatured || false,
    isNew:
      j.createdAt &&
      new Date() - new Date(j.createdAt) < 1000 * 60 * 60 * 24 * 7, // last 7 days
    isActive: j.isActive !== false,
    applicantsCount: j.stats?.applications || 0,
    applicantsCap: j.applicantsCap || 100,
    contactVisibility: {
      whatsapp: !!j.isContactVisible,
      mobile: !!j.isContactVisible
    },
    isContactVisible: !!j.isContactVisible,
    description: j.description || "",
    jobDescription: j.description || "",
    requirements: Array.isArray(j.requirements) ? j.requirements : [],
    responsibilities: Array.isArray(j.responsibilities) ? j.responsibilities : [],
    qualifications: Array.isArray(j.qualifications) ? j.qualifications : [],
    benefits: Array.isArray(j.benefits) ? j.benefits : [],
    skills: Array.isArray(j.skills) ? j.skills : [],
    languages: Array.isArray(j.languages) ? j.languages : [],
    jobTiming: j.jobTiming || "",
    workingDays: j.workingDays || "",
    contactPerson: j.contactPerson || {},
    contactEmail: j.contactEmail || "",
    contactPhone: j.contactPhone || "",
    recruiterId: recruiterInfo,
    postedBy: j.postedBy || "recruiter",
    postedByUserId: j.postedByUserId || "",
    postedByName: j.postedByName || "",
    postedByEmail: j.postedByEmail || "",
    postedByRole: j.postedByRole || "",
    applicationUrl: j.applicationUrl || "",
    postedDate: j.createdAt || "",
    postedAt: j.createdAt || "",
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    rejectionReason: j.rejectionReason || "",
    reviewNotes: j.reviewNotes || "",
    approvedAt: j.approvedAt || null,
    approvedBy: j.approvedBy || null,
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
      // ADMIN sees everything; apply optional filters
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
      // Public candidates: strictly live & approved
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    // Shared optional filters
    if (req.query.jobCategory && req.query.jobCategory !== "All") {
      filter.jobCategory = req.query.jobCategory;
    }
    if (req.query.jobType && req.query.jobType !== "All") {
      filter.jobType = req.query.jobType;
    }
    // Accept both frontend aliases: workMode & workplaceType
    const workModeQ = req.query.workMode || req.query.workplaceType;
    if (workModeQ && workModeQ !== "All") {
      filter.workplaceType = workModeQ;
    }
    // Accept both featured & isFeatured
    const featuredQ =
      req.query.featured !== undefined ? req.query.featured : req.query.isFeatured;
    if (featuredQ !== undefined) {
      filter.isFeatured = featuredQ === "true" || featuredQ === true;
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
    if (req.query.sortBy === "applications")
      sort = { "stats.applications": -1, createdAt: -1 };
    if (req.query.sortBy === "salary") sort = { "salary.max": -1, createdAt: -1 };

    const [rawJobs, totalCount] = await Promise.all([
      populateRecruiterSafe(Job.find(filter).sort(sort).skip(skip).limit(limit)),
      Job.countDocuments(filter)
    ]);

    const jobs = rawJobs.map((j) => transformJobForFrontend(j));

    // Counts summary (always from entire DB, not filtered)
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
      // ✅ Provide BOTH `data` (for new frontend) and `jobs` (for backward compatibility)
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
        // ✅ Provide BOTH naming conventions
        total: totalCount,
        totalItems: totalCount,
        pages: totalPages,
        totalPages
      }
    });
  } catch (error) {
    console.error("getJobs Error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to fetch jobs" });
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

    // Increment views for non-admin viewers
    const user = decodeUserFromRequest(req);
    if (!isAnyAdmin(req, user)) {
      await Job.findByIdAndUpdate(id, { $inc: { "stats.views": 1 } });
    }

    const job = transformJobForFrontend(rawJob);

    return res.status(200).json({ success: true, data: job, job });
  } catch (error) {
    console.error("getJobById Error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to fetch job" });
  }
};

// 3. CREATE JOB
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user;
    const isAuthorizedAdmin = isAnyAdmin(req, user);

    const body = { ...req.body };

    // Parse JSON string fields coming from multipart/form-data
    ["location", "salary", "experience", "contactPerson", "companyAddress"].forEach(
      (f) => {
        if (typeof body[f] === "string") {
          try {
            body[f] = JSON.parse(body[f]);
          } catch {
            /* leave as string */
          }
        }
      }
    );

    // Format location if flat fields passed
    if (body.city || body.state || body.address || body.country) {
      body.location = {
        city: body.city || body.location?.city || "",
        state: body.state || body.location?.state || "",
        country: body.country || body.location?.country || "India",
        address: body.address || body.location?.address || ""
      };
    }

    // Format salary
    if (body.minSalary !== undefined || body.maxSalary !== undefined) {
      body.salary = {
        min: Number(body.minSalary || body.salary?.min || 0),
        max: Number(body.maxSalary || body.salary?.max || 0),
        currency: body.currency || body.salary?.currency || "INR",
        period: body.salaryPeriod || body.salary?.period || "Per Month",
        isNegotiable: Boolean(body.isNegotiable || body.salary?.isNegotiable)
      };
    }

    // Format experience
    if (body.minExp !== undefined || body.maxExp !== undefined) {
      body.experience = {
        min: Number(body.minExp || body.experience?.min || 0),
        max: Number(body.maxExp || body.experience?.max || 0),
        level: body.experienceLevel || body.experience?.level || "Fresher"
      };
    }

    // Normalize workplaceType / workMode
    if (body.workMode && !body.workplaceType) {
      body.workplaceType = body.workMode;
    }

    // Normalize featured flag
    if (body.featured !== undefined && body.isFeatured === undefined) {
      body.isFeatured = body.featured === true || body.featured === "true";
    }

    // Array fields parser
    ["skills", "requirements", "responsibilities", "qualifications", "benefits"].forEach(
      (field) => {
        if (typeof body[field] === "string") {
          // try JSON parse first
          try {
            const parsed = JSON.parse(body[field]);
            if (Array.isArray(parsed)) {
              body[field] = parsed;
              return;
            }
          } catch {
            /* fallthrough to CSV parse */
          }
          body[field] = body[field]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    );

    let finalPostedBy = "recruiter";
    let finalPostedByName = "Recruiter";
    let finalPostedByEmail = "";
    let finalPostedByRole = "recruiter";
    let finalStatus = "Pending Approval";
    let finalApprovalStatus = "pending_review";
    let finalIsActive = false;
    let approvedAt = null;
    let approvedBy = null;

    if (isAuthorizedAdmin) {
      finalPostedBy = "admin";
      finalPostedByRole = "admin";
      finalPostedByName =
        user?.name ||
        user?.fullName ||
        body.postedByName ||
        user?.email?.split("@")[0] ||
        "Admin";
      finalPostedByEmail = user?.email || body.postedByEmail || "admin@careerflow.com";
      finalStatus =
        body.status && body.status !== "Pending Approval" ? body.status : "Live";
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
      postedBy: finalPostedBy,
      postedByName: finalPostedByName,
      postedByEmail: finalPostedByEmail,
      postedByRole: finalPostedByRole,
      postedByUserId: user?._id || user?.id || null,
      recruiterId: isAuthorizedAdmin
        ? body.recruiterId || null
        : user?._id || user?.id || body.recruiterId || null,
      status: finalStatus,
      approvalStatus: finalApprovalStatus,
      isActive: finalIsActive,
      submittedForReviewAt: new Date(),
      approvedAt,
      approvedBy
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to create job" });
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

    // Parse JSON string fields
    ["location", "salary", "experience", "contactPerson", "companyAddress"].forEach(
      (f) => {
        if (typeof updates[f] === "string") {
          try {
            updates[f] = JSON.parse(updates[f]);
          } catch {
            /* leave as string */
          }
        }
      }
    );

    if (updates.city || updates.state || updates.address) {
      updates.location = {
        city: updates.city || existingJob.location?.city || "",
        state: updates.state || existingJob.location?.state || "",
        country: updates.country || existingJob.location?.country || "India",
        address: updates.address || existingJob.location?.address || ""
      };
    }

    if (updates.minSalary !== undefined || updates.maxSalary !== undefined) {
      updates.salary = {
        min: Number(updates.minSalary ?? existingJob.salary?.min ?? 0),
        max: Number(updates.maxSalary ?? existingJob.salary?.max ?? 0),
        currency: updates.currency || existingJob.salary?.currency || "INR",
        period: updates.salaryPeriod || existingJob.salary?.period || "Per Month",
        isNegotiable: Boolean(
          updates.isNegotiable ?? existingJob.salary?.isNegotiable
        )
      };
    }

    if (updates.workMode && !updates.workplaceType) {
      updates.workplaceType = updates.workMode;
    }
    if (updates.featured !== undefined && updates.isFeatured === undefined) {
      updates.isFeatured = updates.featured === true || updates.featured === "true";
    }

    ["skills", "requirements", "responsibilities", "qualifications", "benefits"].forEach(
      (field) => {
        if (typeof updates[field] === "string") {
          try {
            const parsed = JSON.parse(updates[field]);
            if (Array.isArray(parsed)) {
              updates[field] = parsed;
              return;
            }
          } catch {
            /* fallthrough to CSV parse */
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to update job" });
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

    return res
      .status(200)
      .json({ success: true, message: "Job deleted successfully" });
  } catch (error) {
    console.error("deleteJob Error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to delete job" });
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
    job.approvedBy = user.name || user.email || "Admin";
    job.rejectionReason = "";
    if (notes) job.reviewNotes = notes;

    await job.save();

    if (job.contactEmail || job.postedByEmail) {
      const emailTarget = job.contactEmail || job.postedByEmail;
      sendEmail({
        to: emailTarget,
        subject: `Job Approved: "${job.title}" is now Live on CareerFlow`,
        text: `Congratulations! Your job posting for "${job.title}" at ${job.companyName} has been approved by our admin team and is now live for candidates.`
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to approve job" });
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
    job.rejectionReason =
      reason || "The job posting does not meet our platform guidelines.";
    if (notes) job.reviewNotes = notes;

    await job.save();

    if (job.contactEmail || job.postedByEmail) {
      const emailTarget = job.contactEmail || job.postedByEmail;
      sendEmail({
        to: emailTarget,
        subject: `Update on your job submission: "${job.title}"`,
        text: `Your job posting for "${job.title}" at ${job.companyName} was not approved.\n\nReason: ${job.rejectionReason}\n\nYou may update the details and resubmit for review.`
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to reject job" });
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to suspend job" });
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to toggle status" });
  }
};

// 11. TOGGLE CONTACT VISIBILITY
exports.updateContactVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    job.isContactVisible = !job.isContactVisible;
    await job.save();

    return res.status(200).json({
      success: true,
      message: `Contact details are now ${job.isContactVisible ? "visible" : "hidden"}`,
      isContactVisible: job.isContactVisible
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
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to fetch stats" });
  }
};