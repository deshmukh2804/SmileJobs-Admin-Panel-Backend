const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const { sendEmail } = require("../utils/mailer");

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

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
    "careerflow_secret",
  ].filter(Boolean);

  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret);
      if (decoded) return decoded;
    } catch {
      // try next
    }
  }
  return null;
};

// 🚀 FIX: .replace(/\s+/g, "") so "Super Admin" becomes "superadmin" and MATCHES
const isAnyAdmin = (req, user) => {
  if (req?.body?.postedBy === "admin") return true;

  const u = user || req?.user || req?.admin || {};
  const role = String(u.role || u.userType || u.type || "")
    .toLowerCase()
    .replace(/\s+/g, "");

  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "careerflowadmin" ||
    role === "subadmin" ||
    role === "manager" ||
    u.isAdmin === true ||
    Boolean(u.adminId)
  );
};

const populateRecruiterSafe = async (query) => {
  try {
    return await query.populate({
      path: "recruiterId",
      model: Recruiter,
      select: "name email companyName phone isVerified website logo profileImage",
    });
  } catch (err) {
    return await query;
  }
};

const parseJsonFields = (body) => {
  const fields = [
    "location", "salary", "experience", "companyAddress", "companyLogo",
    "companyImages", "contactPerson", "contactVisibility",
    "skills", "requirements", "responsibilities", "benefits", "languages",
  ];
  fields.forEach((f) => {
    if (typeof body[f] === "string") {
      const s = body[f].trim();
      if (
        (s.startsWith("{") && s.endsWith("}")) ||
        (s.startsWith("[") && s.endsWith("]"))
      ) {
        try { body[f] = JSON.parse(s); } catch {}
      }
    }
  });
  return body;
};

// ═══════════════════════════════════════════════════════
// 1. GET ALL JOBS
// ═══════════════════════════════════════════════════════
exports.getJobs = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req);
    const isAdmin = isAnyAdmin(req, user);
    const userRole = String(user?.role || user?.userType || "").toLowerCase();
    const isRecruiter = userRole === "recruiter";

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (isAdmin) {
      // ─── ADMIN FILTERING ───
      const rawStatus = req.query.status || "";
      const rawApproval = req.query.approvalStatus || "";

      if (rawStatus && rawStatus !== "All") {
        const lower = rawStatus.toLowerCase().trim();

        if (lower === "pending" || lower === "pending approval") {
          // 🚀 KEY FIX: Match BOTH status AND approvalStatus for pending jobs
          filter.$or = [
            { status: "Pending Approval" },
            { approvalStatus: "pending_review" },
          ];
        } else if (lower === "live") {
          filter.status = "Live";
        } else if (lower === "rejected") {
          filter.$or = [
            { status: "Rejected" },
            { approvalStatus: "rejected" },
          ];
        } else {
          filter.status = rawStatus;
        }
      }

      if (rawApproval && rawApproval !== "All") {
        filter.approvalStatus = rawApproval;
      }

      if (req.query.postedBy && req.query.postedBy !== "All") {
        filter.postedBy = req.query.postedBy.toLowerCase();
      }
    } else if (isRecruiter) {
      const rid = user._id || user.id || user.recruiterId;
      if (rid && mongoose.Types.ObjectId.isValid(rid)) {
        filter.recruiterId = rid;
      }
    } else {
      // Public / Candidate: only live + approved
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    // Common filters
    if (req.query.jobType && req.query.jobType !== "All") {
      filter.jobType = req.query.jobType;
    }
    if (req.query.workMode && req.query.workMode !== "All") {
      filter.workMode = req.query.workMode;
    }
    if (req.query.featured !== undefined) {
      filter.featured = req.query.featured === "true";
    }
    if (req.query.search && req.query.search.trim()) {
      const s = req.query.search.trim();
      const searchOr = [
        { title: { $regex: s, $options: "i" } },
        { companyName: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
        { skills: { $in: [new RegExp(s, "i")] } },
        { postedByName: { $regex: s, $options: "i" } },
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

    const [jobs, totalCount] = await Promise.all([
      populateRecruiterSafe(
        Job.find(filter).sort(sort).skip(skip).limit(limit).lean()
      ),
      Job.countDocuments(filter),
    ]);

    // Counts
    const [total, live, pending, rejected, expired, adminPosted, recruiterPosted] =
      await Promise.all([
        Job.countDocuments({}),
        Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
        Job.countDocuments({
          $or: [
            { status: "Pending Approval" },
            { approvalStatus: "pending_review" },
          ],
        }),
        Job.countDocuments({
          $or: [{ status: "Rejected" }, { approvalStatus: "rejected" }],
        }),
        Job.countDocuments({ status: "Expired" }),
        Job.countDocuments({ postedBy: "admin" }),
        Job.countDocuments({ postedBy: "recruiter" }),
      ]);

    return res.status(200).json({
      success: true,
      jobs,
      data: jobs, // 🚀 alias so frontend res.data works
      counts: { total, live, pending, rejected, expired, adminPosted, recruiterPosted },
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
        totalItems: totalCount,
      },
    });
  } catch (error) {
    console.error("getJobs Error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to fetch jobs" });
  }
};

// ═══════════════════════════════════════════════════════
// 2. GET SINGLE JOB
// ═══════════════════════════════════════════════════════
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

    return res.status(200).json({ success: true, job, data: job });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to fetch job" });
  }
};

// ═══════════════════════════════════════════════════════
// 3. CREATE JOB (Admin Panel creates → auto-approved)
// ═══════════════════════════════════════════════════════
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user;
    const isAdmin = isAnyAdmin(req, user);

    let body = { ...req.body };
    body = parseJsonFields(body);

    // Handle file uploads
    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        const f = req.files.logo[0];
        body.companyLogo = {
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || "",
        };
      }
      if (req.files.images && req.files.images.length > 0) {
        body.companyImages = req.files.images.map((f) => ({
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || "",
        }));
      }
    }

    // Parse comma-separated strings into arrays
    ["skills", "requirements", "responsibilities", "benefits", "languages"].forEach(
      (field) => {
        if (typeof body[field] === "string") {
          body[field] = body[field]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    );

    // ─── Determine admin vs recruiter ───
    let finalPostedBy = "recruiter";
    let finalPostedByName = "";
    let finalPostedByEmail = "";
    let finalPostedByRole = "";
    let finalStatus = "Pending Approval";
    let finalApprovalStatus = "pending_review";
    let finalIsActive = true;
    let finalApprovedAt = null;
    let finalApprovedBy = "";

    if (isAdmin) {
      finalPostedBy = "admin";
      finalPostedByRole = user?.role || "Super Admin";
      finalPostedByName =
        user?.name || user?.fullName || body.postedByName || "Smile Jobs";
      finalPostedByEmail =
        user?.email || body.postedByEmail || "smilejobs@gmail.com";
      // Admin-created jobs are auto-approved
      finalStatus = "Live";
      finalApprovalStatus = "approved";
      finalIsActive = true;
      finalApprovedAt = new Date();
      finalApprovedBy = finalPostedByName;
    } else {
      finalPostedBy = "recruiter";
      finalPostedByRole = "recruiter";
      finalPostedByName =
        user?.name || user?.companyName || body.postedByName || "Recruiter";
      finalPostedByEmail = user?.email || body.recruiterEmail || "";
      // Recruiter jobs ALWAYS pending
      finalStatus = "Pending Approval";
      finalApprovalStatus = "pending_review";
      finalIsActive = true;
      finalApprovedAt = null;
      finalApprovedBy = "";
    }

    // ─── BUILD EXACT JSON STRUCTURE matching recruiter model ───
    const jobData = {
      title: body.title || "",
      recruiterId:
        body.recruiterId || user?._id || user?.id || null,
      companyName: body.companyName || "",
      companyWebsite: body.companyWebsite || "",
      companyLogo: {
        url: body.companyLogo?.url || "",
        publicId: body.companyLogo?.publicId || "",
      },
      companyImages: body.companyImages || [],
      companyInitials: body.companyInitials || "",
      industry: body.industry || "",
      establishedYear: body.establishedYear
        ? Number(body.establishedYear)
        : null,
      organizationSize: body.organizationSize || "",
      companyAddress: {
        city: body.companyAddress?.city || "",
        state: body.companyAddress?.state || "",
        country: body.companyAddress?.country || "India",
      },
      location: {
        address: body.location?.address || "",
        city: body.location?.city || "",
        state: body.location?.state || "",
        country: body.location?.country || "India",
      },
      salary: {
        min: Number(body.salary?.min || 0),
        max: Number(body.salary?.max || 0),
        currency: body.salary?.currency || "INR",
        period: body.salary?.period || "month",
      },
      experience: {
        min: Number(body.experience?.min || 0),
        max: Number(body.experience?.max || 0),
        text: body.experience?.text || "",
      },
      noticePeriod: body.noticePeriod || "",
      jobType: body.jobType || "Full-Time",
      workMode: body.workMode || "On-site",
      department: body.department || "",
      role: body.role || "",
      qualification: body.qualification || "",
      skills: body.skills || [],
      languages: body.languages || [],
      jobDescription: body.jobDescription || "",
      responsibilities: body.responsibilities || [],
      requirements: body.requirements || [],
      benefits: body.benefits || [],
      jobTiming: body.jobTiming || "",
      workingDays: body.workingDays || "",
      contactPerson: {
        name: body.contactPerson?.name || "",
        designation: body.contactPerson?.designation || "",
      },
      recruiterWhatsappNumber: body.recruiterWhatsappNumber || "",
      recruiterMobileNumber: body.recruiterMobileNumber || "",
      recruiterEmail: body.recruiterEmail || finalPostedByEmail || "",
      applicationUrl: body.applicationUrl || "",
      noPaymentInvolved:
        body.noPaymentInvolved !== undefined
          ? Boolean(body.noPaymentInvolved)
          : true,
      contactVisibility: {
        whatsapp:
          body.contactVisibility?.whatsapp !== undefined
            ? Boolean(body.contactVisibility.whatsapp)
            : true,
        mobile:
          body.contactVisibility?.mobile !== undefined
            ? Boolean(body.contactVisibility.mobile)
            : true,
      },
      whatsappContactEnabled:
        body.whatsappContactEnabled !== undefined
          ? Boolean(body.whatsappContactEnabled)
          : true,
      status: finalStatus,
      isActive: finalIsActive,
      featured: Boolean(body.featured) || false,
      isNew: true,
      isCompanyVerified: Boolean(body.isCompanyVerified) || false,
      approvalStatus: finalApprovalStatus,
      submittedForReviewAt: new Date(),
      approvedAt: finalApprovedAt,
      approvedBy: finalApprovedBy,
      rejectionReason: "",
      reviewNotes: "",
      lastEditedAfterApproval: false,
      applicantsCount: 0,
      applicantsCap: body.applicantsCap ? Number(body.applicantsCap) : 100,
      postedAt: new Date(),
      // Admin-only fields
      postedBy: finalPostedBy,
      postedByUserId: String(user?._id || user?.id || ""),
      postedByName: finalPostedByName,
      postedByEmail: finalPostedByEmail,
      postedByRole: finalPostedByRole,
    };

    const newJob = await Job.create(jobData);

    return res.status(201).json({
      success: true,
      message: isAdmin
        ? "Job created and published by Admin"
        : "Job submitted for admin approval",
      job: newJob,
      data: newJob,
    });
  } catch (error) {
    console.error("createJob Error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to create job" });
  }
};

// ═══════════════════════════════════════════════════════
// 4. UPDATE JOB
// ═══════════════════════════════════════════════════════
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
    const isAdmin = isAnyAdmin(req, user);

    let updates = { ...req.body };
    updates = parseJsonFields(updates);

    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        const f = req.files.logo[0];
        updates.companyLogo = {
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || "",
        };
      }
      if (req.files.images && req.files.images.length > 0) {
        updates.companyImages = req.files.images.map((f) => ({
          url: f.path || f.secure_url || f.location || "",
          publicId: f.filename || f.public_id || "",
        }));
      }
    }

    ["skills", "requirements", "responsibilities", "benefits", "languages"].forEach(
      (field) => {
        if (typeof updates[field] === "string") {
          updates[field] = updates[field]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
    );

    if (!isAdmin && existingJob.approvalStatus === "approved") {
      updates.lastEditedAfterApproval = true;
    }

    const updatedJob = await Job.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Job updated successfully",
      job: updatedJob,
      data: updatedJob,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to update job" });
  }
};

// ═══════════════════════════════════════════════════════
// 5. DELETE JOB
// ═══════════════════════════════════════════════════════
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
    return res.status(200).json({ success: true, message: "Job deleted" });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to delete job" });
  }
};

// ═══════════════════════════════════════════════════════
// 6. APPROVE JOB (Admin clicks "Approve" in approval queue)
// ═══════════════════════════════════════════════════════
exports.approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const user = req.user || decodeUserFromRequest(req) || {};

    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    // 🚀 THIS is what makes the job go LIVE after admin review
    job.status = "Live";
    job.approvalStatus = "approved";
    job.isActive = true;
    job.approvedAt = new Date();
    job.approvedBy = user.name || user.email || "Admin";
    job.rejectionReason = "";
    if (notes) job.reviewNotes = notes;

    await job.save();

    // Email recruiter
    const emailTarget =
      job.recruiterEmail || job.contactEmail || job.postedByEmail;
    if (emailTarget) {
      sendEmail({
        to: emailTarget,
        subject: `Job Approved: "${job.title}" is now Live`,
        text: `Your job "${job.title}" at ${job.companyName} has been approved and is now live.`,
      }).catch((err) => console.warn("Email warning:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: "Job approved and is now Live",
      job,
      data: job,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to approve" });
  }
};

// ═══════════════════════════════════════════════════════
// 7. REJECT JOB
// ═══════════════════════════════════════════════════════
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
      reason || "Does not meet platform guidelines.";
    if (notes) job.reviewNotes = notes;

    await job.save();

    const emailTarget =
      job.recruiterEmail || job.contactEmail || job.postedByEmail;
    if (emailTarget) {
      sendEmail({
        to: emailTarget,
        subject: `Job Rejected: "${job.title}"`,
        text: `Your job "${job.title}" was not approved.\nReason: ${job.rejectionReason}`,
      }).catch((err) => console.warn("Email warning:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: "Job rejected",
      job,
      data: job,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to reject" });
  }
};

// ═══════════════════════════════════════════════════════
// 8. SUSPEND JOB
// ═══════════════════════════════════════════════════════
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
      message: "Job suspended",
      job,
      data: job,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message || "Failed to suspend" });
  }
};

// ═══════════════════════════════════════════════════════
// 9. TOGGLE FEATURED
// ═══════════════════════════════════════════════════════
exports.toggleFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, message: "Not found" });

    job.featured = !job.featured;
    await job.save();

    return res.status(200).json({
      success: true,
      message: `Job ${job.featured ? "featured" : "unfeatured"}`,
      featured: job.featured,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════
// 10. TOGGLE STATUS
// ═══════════════════════════════════════════════════════
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, message: "Not found" });

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
      message: `Status: ${job.status}`,
      status: job.status,
      isActive: job.isActive,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════
// 11. CONTACT VISIBILITY
// ═══════════════════════════════════════════════════════
exports.updateContactVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { whatsapp, mobile } = req.body;

    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, message: "Not found" });

    if (whatsapp !== undefined || mobile !== undefined) {
      job.contactVisibility = {
        whatsapp:
          whatsapp !== undefined
            ? Boolean(whatsapp)
            : job.contactVisibility?.whatsapp || false,
        mobile:
          mobile !== undefined
            ? Boolean(mobile)
            : job.contactVisibility?.mobile || false,
      };
      job.whatsappContactEnabled = job.contactVisibility.whatsapp;
    } else {
      job.whatsappContactEnabled = !job.whatsappContactEnabled;
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: "Contact visibility updated",
      contactVisibility: job.contactVisibility,
      whatsappContactEnabled: job.whatsappContactEnabled,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════
// 12. STATS
// ═══════════════════════════════════════════════════════
exports.getJobStats = async (req, res) => {
  try {
    const [total, live, pending, rejected, adminCount, recruiterCount] =
      await Promise.all([
        Job.countDocuments({}),
        Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
        Job.countDocuments({
          $or: [
            { status: "Pending Approval" },
            { approvalStatus: "pending_review" },
          ],
        }),
        Job.countDocuments({
          $or: [{ status: "Rejected" }, { approvalStatus: "rejected" }],
        }),
        Job.countDocuments({ postedBy: "admin" }),
        Job.countDocuments({ postedBy: "recruiter" }),
      ]);

    return res.status(200).json({
      success: true,
      stats: { total, live, pending, rejected, adminPosted: adminCount, recruiterPosted: recruiterCount },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};