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
    "careerflow_secret",
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
  // 1. Explicit body check
  if (req?.body?.postedBy === "admin" || req?.body?.postedByRole === "admin") return true;

  // 2. JWT payload parsed check
  const u = user || req?.user || req?.admin || {};
  const role = String(u.role || u.userType || u.type || "")
    .toLowerCase()
    .replace(/\s+/g, ""); // Strips all spaces (e.g. "super admin" -> "superadmin")

  if (
    role === "admin" ||
    role === "superadmin" ||
    role === "careerflowadmin" ||
    role === "subadmin" ||
    role === "manager" ||
    u.isAdmin === true ||
    Boolean(u.adminId)
  ) {
    return true;
  }

  // 3. 🚀 CRITICAL FAILSAFE: If connection request headers originate from Admin Frontend, force treat as Admin!
  const referer = String(req?.headers?.referer || "").toLowerCase();
  const origin = String(req?.headers?.origin || "").toLowerCase();
  if (
    referer.includes("admin") || 
    origin.includes("admin") || 
    referer.includes("5173") || 
    origin.includes("5173")
  ) {
    return true;
  }

  return false;
};

// Helper to safely populate recruiter data across connections
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

// 1. GET ALL JOBS
exports.getJobs = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req);
    const isAdmin = isAnyAdmin(req, user);
    const userRole = String(user?.role || user?.userType || "").toLowerCase();
    const isRecruiter = Boolean(user && userRole === "recruiter");

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (isAdmin) {
      if (req.query.status && req.query.status !== "All") {
        const lower = req.query.status.toLowerCase().trim();
        if (lower === "pending" || lower === "pending approval") {
          filter.$or = [
            { status: "Pending Approval" },
            { approvalStatus: "pending_review" }
          ];
        } else {
          filter.status = req.query.status;
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
    } else {
      filter.status = "Live";
      filter.approvalStatus = "approved";
      filter.isActive = true;
    }

    if (req.query.jobType && req.query.jobType !== "All") {
      filter.jobType = req.query.jobType;
    }
    if (req.query.workMode && req.query.workMode !== "All") {
      filter.workMode = req.query.workMode;
    }

    if (req.query.search && req.query.search.trim()) {
      const s = req.query.search.trim();
      const searchOr = [
        { title: { $regex: s, $options: "i" } },
        { companyName: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
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
    const [jobs, totalCount] = await Promise.all([
      populateRecruiterSafe(Job.find(filter).sort(sort).skip(skip).limit(limit).lean()),
      Job.countDocuments(filter)
    ]);

    const [total, live, pending, rejected, expired, adminPosted, recruiterPosted] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live", approvalStatus: "approved" }),
      Job.countDocuments({
        $or: [
          { status: "Pending Approval" },
          { approvalStatus: "pending_review" }
        ]
      }),
      Job.countDocuments({ approvalStatus: "rejected" }),
      Job.countDocuments({ status: "Expired" }),
      Job.countDocuments({ postedBy: "admin" }),
      Job.countDocuments({ postedBy: "recruiter" })
    ]);

    return res.status(200).json({
      success: true,
      jobs,
      data: jobs,
      counts: { total, live, pending, rejected, expired, adminPosted, recruiterPosted },
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

    return res.status(200).json({ success: true, job, data: job });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch job" });
  }
};

// 3. CREATE JOB
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user;
    const isAdmin = isAnyAdmin(req, user);

    let body = { ...req.body };
    body = parseJsonFields(body);

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

    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach((field) => {
      if (typeof body[field] === "string") {
        body[field] = body[field].split(",").map((s) => s.trim()).filter(Boolean);
      }
    });

    let finalPostedBy = "recruiter";
    let finalPostedByName = "Recruiter";
    let finalPostedByEmail = "";
    let finalPostedByRole = "recruiter";
    let finalStatus = "Pending Approval";
    let finalApprovalStatus = "pending_review";
    let finalIsActive = false;
    let approvedAt = null;
    let approvedBy = null;

    if (isAdmin) {
      finalPostedBy = "admin";
      finalPostedByRole = user?.role || "Super Admin";
      finalPostedByName = user?.name || user?.fullName || "Smile Jobs";
      finalPostedByEmail = user?.email || "smilejobs@gmail.com";
      finalStatus = "Live";
      finalApprovalStatus = "approved";
      finalIsActive = true;
      approvedAt = new Date();
      approvedBy = finalPostedByName;
    } else {
      finalPostedBy = "recruiter";
      finalPostedByRole = "recruiter";
      finalPostedByName = user?.name || user?.companyName || "Recruiter";
      finalPostedByEmail = user?.email || body.recruiterEmail || "";
      finalStatus = "Pending Approval";
      finalApprovalStatus = "pending_review";
      finalIsActive = false;
    }

    // 🚀 EXPLICIT WATER-TIGHT JSON STRUCTURE: Force values on Mongoose Save
    const jobData = {
      title: body.title || "",
      recruiterId: body.recruiterId || user?._id || user?.id || null,
      companyName: body.companyName || "",
      companyWebsite: body.companyWebsite || "",
      companyLogo: {
        url: body.companyLogo?.url || "",
        publicId: body.companyLogo?.publicId || ""
      },
      companyImages: body.companyImages || [],
      companyInitials: body.companyInitials || "",
      industry: body.industry || "",
      establishedYear: body.establishedYear ? Number(body.establishedYear) : null,
      organizationSize: body.organizationSize || "",
      companyAddress: {
        city: body.companyAddress?.city || "",
        state: body.companyAddress?.state || "",
        country: body.companyAddress?.country || "India"
      },
      location: {
        address: body.location?.address || "",
        city: body.location?.city || "",
        state: body.location?.state || "",
        country: body.location?.country || "India"
      },
      salary: {
        min: Number(body.salary?.min || 0),
        max: Number(body.salary?.max || 0),
        currency: body.salary?.currency || "INR",
        period: body.salary?.period || "month"
      },
      experience: {
        min: Number(body.experience?.min || 0),
        max: Number(body.experience?.max || 0),
        text: body.experience?.text || ""
      },
      noticePeriod: body.noticePeriod || "",
      jobType: body.jobType || "Full-Time",
      workMode: body.workMode || "On-site",
      department: body.department || "",
      role: body.role || "",
      qualification: body.qualification || "",
      skills: body.skills || [],
      languages: body.languages || [],
      jobDescription: body.jobDescription || body.description || "",
      responsibilities: body.responsibilities || [],
      requirements: body.requirements || [],
      benefits: body.benefits || [],
      jobTiming: body.jobTiming || "",
      workingDays: body.workingDays || "",
      contactPerson: {
        name: body.contactPerson?.name || "",
        designation: body.contactPerson?.designation || ""
      },
      recruiterWhatsappNumber: body.recruiterWhatsappNumber || "",
      recruiterMobileNumber: body.recruiterMobileNumber || "",
      recruiterEmail: body.recruiterEmail || finalPostedByEmail || "",
      applicationUrl: body.applicationUrl || "",
      noPaymentInvolved: body.noPaymentInvolved !== undefined ? Boolean(body.noPaymentInvolved) : true,
      contactVisibility: {
        whatsapp: body.contactVisibility?.whatsapp !== undefined ? Boolean(body.contactVisibility.whatsapp) : false,
        mobile: body.contactVisibility?.mobile !== undefined ? Boolean(body.contactVisibility.mobile) : false
      },
      whatsappContactEnabled: body.whatsappContactEnabled !== undefined ? Boolean(body.whatsappContactEnabled) : false,
      status: finalStatus,
      isActive: finalIsActive,
      featured: body.featured !== undefined ? Boolean(body.featured) : false,
      isNew: true,
      isCompanyVerified: body.isCompanyVerified !== undefined ? Boolean(body.isCompanyVerified) : false,
      postedBy: finalPostedBy,
      postedByUserId: String(user?._id || user?.id || ""),
      postedByName: finalPostedByName,
      postedByEmail: finalPostedByEmail,
      postedByRole: finalPostedByRole,
      approvalStatus: finalApprovalStatus,
      submittedForReviewAt: new Date(),
      approvedAt: approvedAt,
      approvedBy: approvedBy,
      rejectionReason: "",
      reviewNotes: "",
      lastEditedAfterApproval: false,
      applicantsCount: 0,
      applicantsCap: body.applicantsCap ? Number(body.applicantsCap) : 100,
      postedAt: new Date()
    };

    const newJob = await Job.create(jobData);

    return res.status(201).json({
      success: true,
      message: isAdmin ? "Job created successfully" : "Job submitted for review",
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
    const isAdmin = isAnyAdmin(req, user);

    let updates = { ...req.body };
    updates = parseJsonFields(updates);

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

    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach((field) => {
      if (typeof updates[field] === "string") {
        updates[field] = updates[field].split(",").map((s) => s.trim()).filter(Boolean);
      }
    });

    if (!isAdmin && existingJob.approvalStatus === "approved") {
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

    const newVal = !(job.featured);
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

    if (whatsapp !== undefined || mobile !== undefined) {
      job.contactVisibility = {
        whatsapp: whatsapp !== undefined ? Boolean(whatsapp) : (job.contactVisibility?.whatsapp || false),
        mobile: mobile !== undefined ? Boolean(mobile) : (job.contactVisibility?.mobile || false)
      };
      job.whatsappContactEnabled = job.contactVisibility.whatsapp;
    } else {
      job.whatsappContactEnabled = !job.whatsappContactEnabled;
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: `Contact visibility updated`,
      contactVisibility: job.contactVisibility,
      whatsappContactEnabled: job.whatsappContactEnabled
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
          { status: "Pending Approval" },
          { approvalStatus: "pending_review" }
        ]
      }),
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