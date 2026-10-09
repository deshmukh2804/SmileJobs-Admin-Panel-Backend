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
    role === "super admin" ||
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

// Normalize status alias (frontend sends "Pending", schema has "Pending Approval")
const normalizeStatusFilter = (status) => {
  if (!status) return null;
  const map = {
    "pending": ["Pending Approval", "Pending"],
    "pending approval": ["Pending Approval", "Pending"],
    "live": ["Live"],
    "rejected": ["Rejected"],
    "expired": ["Expired"],
    "closed": ["Closed"],
    "draft": ["Draft"]
  };
  return map[String(status).toLowerCase()] || [status];
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
      if (req.query.status && req.query.status !== "All") {
        const statusValues = normalizeStatusFilter(req.query.status);
        if (String(req.query.status).toLowerCase() === "pending" || String(req.query.status).toLowerCase() === "pending approval") {
          // Match either status OR approvalStatus for pending
          filter.$or = [
            { status: { $in: statusValues } },
            { approvalStatus: "pending_review" }
          ];
        } else {
          filter.status = { $in: statusValues };
        }
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
        const statusValues = normalizeStatusFilter(req.query.status);
        filter.status = { $in: statusValues };
      }
    } else {
      // Candidate / Public user: strictly live and approved
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    if (req.query.jobCategory && req.query.jobCategory !== "All") {
      filter.jobCategory = req.query.jobCategory;
    }
    if (req.query.jobType && req.query.jobType !== "All") {
      filter.jobType = req.query.jobType;
    }
    if (req.query.workplaceType && req.query.workplaceType !== "All") {
      filter.$or = [
        { workplaceType: req.query.workplaceType },
        { workMode: req.query.workplaceType }
      ];
    }
    if (req.query.workMode && req.query.workMode !== "All") {
      filter.workMode = req.query.workMode;
    }
    if (req.query.isFeatured !== undefined) {
      filter.$or = [
        { isFeatured: req.query.isFeatured === "true" },
        { featured: req.query.isFeatured === "true" }
      ];
    }

    if (req.query.search && req.query.search.trim()) {
      const s = req.query.search.trim();
      const searchOr = [
        { title: { $regex: s, $options: "i" } },
        { companyName: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
        { "location.state": { $regex: s, $options: "i" } },
        { skills: { $in: [new RegExp(s, "i")] } },
        { postedByName: { $regex: s, $options: "i" } }
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    let sort = { createdAt: -1 };
    if (req.query.sortBy === "views") sort = { "stats.views": -1, createdAt: -1 };
    if (req.query.sortBy === "applications") sort = { "stats.applications": -1, createdAt: -1 };
    if (req.query.sortBy === "salary") sort = { "salary.max": -1, createdAt: -1 };

    const [jobs, totalCount] = await Promise.all([
      populateRecruiterSafe(Job.find(filter).sort(sort).skip(skip).limit(limit).lean()),
      Job.countDocuments(filter)
    ]);

    // Counts summary
    const [total, live, pending, rejected, expired, adminPosted, recruiterPosted] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
      Job.countDocuments({
        $or: [
          { status: { $in: ["Pending Approval", "Pending"] } },
          { approvalStatus: "pending_review" }
        ]
      }),
      Job.countDocuments({ approvalStatus: "rejected" }),
      Job.countDocuments({ status: "Expired" }),
      Job.countDocuments({ $or: [{ postedBy: "admin" }, { recruiterId: null }] }),
      Job.countDocuments({ postedBy: "recruiter", recruiterId: { $ne: null } })
    ]);

    return res.status(200).json({
      success: true,
      jobs,
      data: jobs, // alias so frontend using `data` also works
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

// 2. GET SINGLE JOB
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

    return res.status(200).json({ success: true, job, data: job });
  } catch (error) {
    console.error("getJobById Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch job" });
  }
};

// Helper to parse JSON-string nested fields coming from FormData
const parseJsonFields = (body) => {
  const fieldsToParse = [
    "location", "salary", "experience", "companyAddress", "companyLogo",
    "companyImages", "contactPerson", "contactVisibility", "skills",
    "requirements", "responsibilities", "qualifications", "benefits",
    "languages"
  ];
  fieldsToParse.forEach((f) => {
    if (typeof body[f] === "string") {
      const str = body[f].trim();
      if ((str.startsWith("{") && str.endsWith("}")) || (str.startsWith("[") && str.endsWith("]"))) {
        try { body[f] = JSON.parse(str); } catch { /* leave as-is */ }
      }
    }
  });
  return body;
};

// 3. CREATE JOB
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user;
    const isAuthorizedAdmin = isAnyAdmin(req, user);

    let body = { ...req.body };
    body = parseJsonFields(body);

    // Handle file uploads (logo & images) from multer
    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        const f = req.files.logo[0];
        body.companyLogo = {
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || ""
        };
      }
      if (req.files.images && req.files.images.length > 0) {
        body.companyImages = req.files.images.map((f) => ({
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || ""
        }));
      }
    }

    // Format flat location fields if passed
    if (body.city || body.state || body.address || body.country) {
      body.location = {
        address: body.address || body.location?.address || "",
        city: body.city || body.location?.city || "",
        state: body.state || body.location?.state || "",
        country: body.country || body.location?.country || "India"
      };
    }

    // Format salary (flat fields)
    if (body.minSalary !== undefined || body.maxSalary !== undefined) {
      body.salary = {
        min: Number(body.minSalary || body.salary?.min || 0),
        max: Number(body.maxSalary || body.salary?.max || 0),
        currency: body.currency || body.salary?.currency || "INR",
        period: body.salaryPeriod || body.salary?.period || "month",
        isNegotiable: Boolean(body.isNegotiable || body.salary?.isNegotiable)
      };
    }

    // Format experience (flat fields)
    if (body.minExp !== undefined || body.maxExp !== undefined) {
      body.experience = {
        min: Number(body.minExp || body.experience?.min || 0),
        max: Number(body.maxExp || body.experience?.max || 0),
        text: body.experienceText || body.experience?.text || "",
        level: body.experienceLevel || body.experience?.level || "Fresher"
      };
    }

    // Array fields parser (comma strings)
    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach((field) => {
      if (typeof body[field] === "string") {
        body[field] = body[field]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    });

    // Auto-generate companyInitials if not set
    if (!body.companyInitials && body.companyName) {
      body.companyInitials = body.companyName
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("");
    }

    // Sync workMode <-> workplaceType
    if (body.workMode && !body.workplaceType) body.workplaceType = body.workMode;
    if (body.workplaceType && !body.workMode) body.workMode = body.workplaceType;

    // Sync description aliases
    if (body.jobDescription && !body.description) body.description = body.jobDescription;
    if (body.description && !body.jobDescription) body.jobDescription = body.description;

    // Sync featured flags
    if (body.featured !== undefined && body.isFeatured === undefined) body.isFeatured = body.featured;
    if (body.isFeatured !== undefined && body.featured === undefined) body.featured = body.isFeatured;

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
      finalPostedByRole = user?.role || "Super Admin";
      finalPostedByName =
        user?.name ||
        user?.fullName ||
        body.postedByName ||
        user?.email?.split("@")[0] ||
        "Admin";
      finalPostedByEmail = user?.email || body.postedByEmail || "admin@careerflow.com";
      finalStatus = body.status && body.status !== "Pending Approval" ? body.status : "Live";
      finalApprovalStatus =
        body.approvalStatus || (finalStatus === "Live" ? "approved" : "pending_review");
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
      finalPostedByEmail = user?.email || body.postedByEmail || body.recruiterEmail || "";
      // Recruiter-posted jobs ALWAYS start as Pending Approval, regardless of client input
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
      postedByUserId: user?._id || user?.id || body.postedByUserId || null,
      recruiterId: isAuthorizedAdmin
        ? (body.recruiterId || user?._id || user?.id || null)
        : (user?._id || user?.id || body.recruiterId || null),
      status: finalStatus,
      approvalStatus: finalApprovalStatus,
      isActive: finalIsActive,
      submittedForReviewAt: new Date(),
      postedAt: new Date(),
      approvedAt,
      approvedBy,
      applicantsCount: body.applicantsCount ?? 0,
      applicantsCap: body.applicantsCap ?? 100,
      isNew: true
    };

    const newJob = await Job.create(jobData);

    return res.status(201).json({
      success: true,
      message: isAuthorizedAdmin
        ? "Job created and published successfully by Admin"
        : "Job submitted successfully and is pending admin approval",
      job: newJob,
      data: newJob
    });
  } catch (error) {
    console.error("createJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to create job" });
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

    let updates = { ...req.body };
    updates = parseJsonFields(updates);

    // Handle file uploads
    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        const f = req.files.logo[0];
        updates.companyLogo = {
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || ""
        };
      }
      if (req.files.images && req.files.images.length > 0) {
        updates.companyImages = req.files.images.map((f) => ({
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || ""
        }));
      }
    }

    // Format location if flat
    if (updates.city || updates.state || updates.address) {
      updates.location = {
        address: updates.address || existingJob.location?.address || "",
        city: updates.city || existingJob.location?.city || "",
        state: updates.state || existingJob.location?.state || "",
        country: updates.country || existingJob.location?.country || "India"
      };
    }

    // Format salary
    if (updates.minSalary !== undefined || updates.maxSalary !== undefined) {
      updates.salary = {
        min: Number(updates.minSalary ?? existingJob.salary?.min ?? 0),
        max: Number(updates.maxSalary ?? existingJob.salary?.max ?? 0),
        currency: updates.currency || existingJob.salary?.currency || "INR",
        period: updates.salaryPeriod || existingJob.salary?.period || "month",
        isNegotiable: Boolean(updates.isNegotiable ?? existingJob.salary?.isNegotiable)
      };
    }

    // Parse array fields
    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach((field) => {
      if (typeof updates[field] === "string") {
        updates[field] = updates[field]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    });

    // Sync aliases
    if (updates.workMode && !updates.workplaceType) updates.workplaceType = updates.workMode;
    if (updates.workplaceType && !updates.workMode) updates.workMode = updates.workplaceType;
    if (updates.jobDescription && !updates.description) updates.description = updates.jobDescription;
    if (updates.description && !updates.jobDescription) updates.jobDescription = updates.description;
    if (updates.featured !== undefined && updates.isFeatured === undefined) updates.isFeatured = updates.featured;
    if (updates.isFeatured !== undefined && updates.featured === undefined) updates.featured = updates.isFeatured;

    if (!isAuthorizedAdmin && existingJob.approvalStatus === "approved") {
      updates.lastEditedAfterApproval = true;
    }

    const updatedJob = await Job.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });

    return res.status(200).json({
      success: true,
      message: "Job updated successfully",
      job: updatedJob,
      data: updatedJob
    });
  } catch (error) {
    console.error("updateJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update job" });
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

    return res.status(200).json({ success: true, message: "Job deleted successfully" });
  } catch (error) {
    console.error("deleteJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to delete job" });
  }
};

// 6. APPROVE JOB (ADMIN ONLY)
exports.approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const user = req.user || decodeUserFromRequest(req) || {};

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

    // Notify recruiter via email
    const emailTarget = job.recruiterEmail || job.contactEmail || job.postedByEmail;
    if (emailTarget) {
      sendEmail({
        to: emailTarget,
        subject: `Job Approved: "${job.title}" is now Live on CareerFlow`,
        text: `Congratulations! Your job posting for "${job.title}" at ${job.companyName} has been approved by our admin team and is now live for candidates.`
      }).catch((err) => console.warn("Approval email warning:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: "Job approved and published successfully",
      job,
      data: job
    });
  } catch (error) {
    console.error("approveJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to approve job" });
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

    // Notify recruiter
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
      message: "Job rejected",
      job,
      data: job
    });
  } catch (error) {
    console.error("rejectJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to reject job" });
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

    return res.status(200).json({
      success: true,
      message: "Job suspended successfully",
      job,
      data: job
    });
  } catch (error) {
    console.error("suspendJob Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to suspend job" });
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

    const newVal = !(job.isFeatured || job.featured);
    job.isFeatured = newVal;
    job.featured = newVal;
    await job.save();

    return res.status(200).json({
      success: true,
      message: `Job ${newVal ? "featured" : "unfeatured"} successfully`,
      isFeatured: newVal,
      featured: newVal
    });
  } catch (error) {
    console.error("toggleFeature Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to toggle feature status" });
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
    return res.status(500).json({ success: false, message: error.message || "Failed to toggle status" });
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

    // Support both the toggle (no body) and the explicit body modes
    if (whatsapp !== undefined || mobile !== undefined) {
      job.contactVisibility = {
        whatsapp: whatsapp !== undefined ? Boolean(whatsapp) : (job.contactVisibility?.whatsapp || false),
        mobile: mobile !== undefined ? Boolean(mobile) : (job.contactVisibility?.mobile || false)
      };
      job.whatsappContactEnabled = job.contactVisibility.whatsapp;
    } else {
      job.isContactVisible = !job.isContactVisible;
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: `Contact visibility updated`,
      contactVisibility: job.contactVisibility,
      isContactVisible: job.isContactVisible
    });
  } catch (error) {
    console.error("updateContactVisibility Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update visibility" });
  }
};

// 12. STATS
exports.getJobStats = async (req, res) => {
  try {
    const [total, live, pending, rejected, adminCount, recruiterCount] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
      Job.countDocuments({
        $or: [
          { status: { $in: ["Pending Approval", "Pending"] } },
          { approvalStatus: "pending_review" }
        ]
      }),
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
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch stats" });
  }
};