const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const { sendEmail } = require("../utils/mailer");

// Helper to decode JWT token
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

// Admin detection helper
const isAnyAdmin = (req, user) => {
  if (req?.body?.postedBy === "admin" || req?.body?.postedByRole === "admin" || req?.body?.postedByRole === "Super Admin") return true;

  const u = user || req?.user || req?.admin || {};
  const role = String(u.role || u.userType || u.type || "").toLowerCase();

  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "careerflow_admin" ||
    role === "subadmin" ||
    role === "manager" ||
    role === "super admin" ||
    u.isAdmin === true ||
    Boolean(u.adminId)
  );
};

// Populate recruiter safely across connections if needed
const populateRecruiterSafe = async (query) => {
  try {
    return await query.populate({
      path: "recruiterId",
      model: Recruiter,
      select: "name email companyName phone isVerified website logo profileImage"
    });
  } catch (err) {
    return await query;
  }
};

// Helper to generate company initials
const generateInitials = (name) => {
  if (!name || typeof name !== "string") return "US";
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "US"
  );
};

// Transform Job for API responses matching your exact requested format
const transformJobForFrontend = (job) => {
  if (!job) return null;
  const j = typeof job.toObject === "function" ? job.toObject() : job;

  const companyName = j.companyName || j.company || "";
  const initials = j.companyInitials || generateInitials(companyName);

  let salaryRange = "Not Disclosed";
  if (j.salary && (j.salary.min || j.salary.max)) {
    const min = j.salary.min || 0;
    const max = j.salary.max || 0;
    const currency = j.salary.currency || "INR";
    const symbol = currency === "INR" ? "₹" : currency;
    salaryRange = `${symbol} ${min} - ${max}`;
  }

  let locationDisplay = "";
  if (j.location) {
    const parts = [j.location.address, j.location.city, j.location.state].filter(Boolean);
    locationDisplay = parts.join(", ");
  }

  return {
    _id: j._id,
    id: j._id,
    title: j.title || "",
    recruiterId: j.recruiterId || null,
    companyName,
    company: companyName,
    companyWebsite: j.companyWebsite || "https://en.wikipedia.org/wiki/URL",
    companyLogo: j.companyLogo || { url: "", publicId: "" },
    companyImages: Array.isArray(j.companyImages) ? j.companyImages : [],
    companyInitials: initials,
    industry: j.industry || "I T",
    establishedYear: j.establishedYear || null,
    organizationSize: j.organizationSize || "",
    companyAddress: {
      city: j.companyAddress?.city || "",
      state: j.companyAddress?.state || "",
      country: j.companyAddress?.country || "India"
    },
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
    noticePeriod: j.noticePeriod || "30 Days / 1 Month",
    jobType: j.jobType || "Full-Time",
    workMode: j.workMode || "On-site",
    department: j.department || "Customer Service",
    role: j.role || j.title || "",
    qualification: j.qualification || "",
    skills: Array.isArray(j.skills) ? j.skills : [],
    languages: Array.isArray(j.languages) ? j.languages : [],
    jobDescription: j.jobDescription || j.description || "",
    description: j.description || j.jobDescription || "",
    responsibilities: Array.isArray(j.responsibilities) ? j.responsibilities : [],
    requirements: Array.isArray(j.requirements) ? j.requirements : [],
    benefits: Array.isArray(j.benefits) ? j.benefits : [],
    jobTiming: j.jobTiming || "10:00 AM to 05:00 PM",
    workingDays: j.workingDays || "Mon - Fri",
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
      whatsapp: j.contactVisibility?.whatsapp ?? true,
      mobile: j.contactVisibility?.mobile ?? true
    },
    whatsappContactEnabled: j.whatsappContactEnabled ?? true,
    status: j.status || "Live",
    isActive: j.isActive !== false,
    featured: Boolean(j.featured),
    isNew: true,
    isCompanyVerified: Boolean(j.isCompanyVerified),
    postedBy: j.postedBy || "admin",
    postedByUserId: j.postedByUserId || "",
    postedByName: j.postedByName || "Smile Jobs",
    postedByEmail: j.postedByEmail || "smilejobs@gmail.com",
    postedByRole: j.postedByRole || "Super Admin",
    approvalStatus: j.approvalStatus || "approved",
    submittedForReviewAt: j.submittedForReviewAt || j.createdAt || new Date(),
    approvedAt: j.approvedAt || new Date(),
    approvedBy: j.approvedBy || "Smile Jobs",
    rejectionReason: j.rejectionReason || "",
    reviewNotes: j.reviewNotes || "",
    lastEditedAfterApproval: false,
    applicantsCount: j.applicantsCount || 0,
    applicantsCap: j.applicantsCap || 100,
    postedAt: j.postedAt || j.createdAt || new Date(),
    createdAt: j.createdAt || new Date(),
    updatedAt: j.updatedAt || new Date(),
    __v: j.__v ?? 0
  };
};

// 1. GET ALL JOBS
exports.getJobs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.status && req.query.status !== "All" && req.query.status !== "") {
      filter.status = req.query.status;
    }
    if (req.query.approvalStatus && req.query.approvalStatus !== "All") {
      filter.approvalStatus = req.query.approvalStatus;
    }
    if (req.query.postedBy && req.query.postedBy !== "All") {
      filter.postedBy = req.query.postedBy.toLowerCase();
    }
    if (req.query.search && req.query.search.trim()) {
      const s = req.query.search.trim();
      filter.$or = [
        { title: { $regex: s, $options: "i" } },
        { companyName: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
        { "location.state": { $regex: s, $options: "i" } }
      ];
    }

    const [rawJobs, totalCount] = await Promise.all([
      populateRecruiterSafe(Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)),
      Job.countDocuments(filter)
    ]);

    const jobs = rawJobs.map((j) => transformJobForFrontend(j));

    const [total, live, pending, rejected] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live" }),
      Job.countDocuments({ approvalStatus: "pending_review" }),
      Job.countDocuments({ approvalStatus: "rejected" })
    ]);

    return res.status(200).json({
      success: true,
      data: jobs,
      jobs,
      counts: {
        total,
        live,
        pending,
        rejected,
        activeJobs: live
      },
      pagination: {
        page,
        limit,
        total: totalCount,
        totalItems: totalCount,
        pages: Math.ceil(totalCount / limit) || 1,
        totalPages: Math.ceil(totalCount / limit) || 1
      }
    });
  } catch (error) {
    console.error("getJobs Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. GET SINGLE JOB BY ID
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

    const job = transformJobForFrontend(rawJob);
    return res.status(200).json({ success: true, data: job, job });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. CREATE JOB
exports.createJob = async (req, res) => {
  try {
    const user = decodeUserFromRequest(req) || req.user || {};
    const body = { ...req.body };

    // JSON parsing helper
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
        } catch {}
      }
    });

    // Array field normalized parser
    ["skills", "requirements", "responsibilities", "qualifications", "benefits", "languages"].forEach(
      (field) => {
        if (typeof body[field] === "string") {
          try {
            const parsed = JSON.parse(body[field]);
            if (Array.isArray(parsed)) {
              body[field] = parsed;
              return;
            }
          } catch {}
          body[field] = body[field]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (!Array.isArray(body[field])) {
          body[field] = [];
        }
      }
    );

    const desc = body.jobDescription || body.description || "";
    const compInitials = body.companyInitials || generateInitials(body.companyName);

    let rId = null;
    if (body.recruiterId && mongoose.Types.ObjectId.isValid(body.recruiterId)) {
      rId = new mongoose.Types.ObjectId(body.recruiterId);
    } else if (user._id && mongoose.Types.ObjectId.isValid(user._id)) {
      rId = new mongoose.Types.ObjectId(user._id);
    } else {
      rId = new mongoose.Types.ObjectId();
    }

    const now = new Date();

    // Exact Target Schema Payload Generation
    const jobData = {
      title: body.title || "",
      recruiterId: rId,
      companyName: body.companyName || "",
      companyWebsite: body.companyWebsite || "https://en.wikipedia.org/wiki/URL",
      companyLogo: {
        url: body.companyLogo?.url || "",
        publicId: body.companyLogo?.publicId || ""
      },
      companyImages: Array.isArray(body.companyImages) ? body.companyImages : [],
      companyInitials: compInitials,
      industry: body.industry || "I T",
      establishedYear: body.establishedYear ? Number(body.establishedYear) : 2014,
      organizationSize: body.organizationSize || "11-50 employees",
      companyAddress: {
        city: body.companyAddress?.city || "",
        state: body.companyAddress?.state || "",
        country: body.companyAddress?.country || "India"
      },
      location: {
        address: body.location?.address || body.address || "",
        city: body.location?.city || body.city || "",
        state: body.location?.state || body.stateName || "",
        country: body.location?.country || body.country || "India"
      },
      salary: {
        min: Number(body.salary?.min ?? body.minSalary ?? 9),
        max: Number(body.salary?.max ?? body.maxSalary ?? 12),
        currency: body.salary?.currency || "INR",
        period: body.salary?.period || body.salaryPeriod || "month"
      },
      experience: {
        min: Number(body.experience?.min ?? body.experienceMin ?? 2),
        max: Number(body.experience?.max ?? body.experienceMax ?? 5),
        text: body.experience?.text || body.experienceText || ""
      },
      noticePeriod: body.noticePeriod || "30 Days / 1 Month",
      jobType: body.jobType || "Full-Time",
      workMode: body.workMode || "On-site",
      department: body.department || "Customer Service",
      role: body.role || body.title || "",
      qualification: body.qualification || "",
      skills: body.skills || [],
      languages: body.languages || [],
      jobDescription: desc,
      description: desc,
      responsibilities: body.responsibilities || [],
      requirements: body.requirements || [],
      benefits: body.benefits || [],
      jobTiming: body.jobTiming || "10:00 AM to 05:00 PM",
      workingDays: body.workingDays || "Mon - Fri",
      contactPerson: {
        name: body.contactPerson?.name || body.recruiterName || "gvhj",
        designation: body.contactPerson?.designation || body.recruiterDesignation || "HR Manager"
      },
      recruiterWhatsappNumber: body.recruiterWhatsappNumber || "",
      recruiterMobileNumber: body.recruiterMobileNumber || "",
      recruiterEmail: body.recruiterEmail || "",
      applicationUrl: body.applicationUrl || "",
      noPaymentInvolved: true,
      contactVisibility: {
        whatsapp: body.contactVisibility?.whatsapp ?? true,
        mobile: body.contactVisibility?.mobile ?? true
      },
      whatsappContactEnabled: body.whatsappContactEnabled ?? true,
      status: "Live",
      isActive: true,
      featured: Boolean(body.featured),
      isNew: true,
      isCompanyVerified: Boolean(body.isCompanyVerified),
      postedBy: body.postedBy || "admin",
      postedByUserId: String(user._id || user.id || body.postedByUserId || rId),
      postedByName: user.name || user.fullName || body.postedByName || "Smile Jobs",
      postedByEmail: user.email || body.postedByEmail || "smilejobs@gmail.com",
      postedByRole: user.role || body.postedByRole || "Super Admin",
      approvalStatus: "approved",
      submittedForReviewAt: now,
      approvedAt: now,
      approvedBy: user.name || user.fullName || "Smile Jobs",
      rejectionReason: "",
      reviewNotes: body.notes || body.reviewNotes || "",
      lastEditedAfterApproval: false,
      applicantsCount: 0,
      applicantsCap: Number(body.applicantsCap || 100),
      postedAt: now
    };

    const newJob = await Job.create(jobData);
    const transformed = transformJobForFrontend(newJob);

    return res.status(201).json({
      success: true,
      message: "Job posted successfully",
      data: transformed,
      job: transformed
    });
  } catch (error) {
    console.error("createJob Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. UPDATE JOB
exports.updateJob = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Job.findByIdAndUpdate(id, { $set: req.body }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Job not found" });

    const transformed = transformJobForFrontend(updated);
    return res.status(200).json({ success: true, data: transformed, job: transformed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. DELETE JOB
exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    await Job.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: "Job deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 6. APPROVE JOB
exports.approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "Live",
          approvalStatus: "approved",
          isActive: true,
          approvedAt: new Date(),
          approvedBy: "Smile Jobs"
        }
      },
      { new: true }
    );
    const transformed = transformJobForFrontend(job);
    return res.status(200).json({ success: true, data: transformed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 7. REJECT JOB
exports.rejectJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "Rejected",
          approvalStatus: "rejected",
          isActive: false,
          rejectionReason: req.body.reason || "Guideline violation"
        }
      },
      { new: true }
    );
    const transformed = transformJobForFrontend(job);
    return res.status(200).json({ success: true, data: transformed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 8. SUSPEND JOB
exports.suspendJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "Closed",
          approvalStatus: "suspended",
          isActive: false
        }
      },
      { new: true }
    );
    const transformed = transformJobForFrontend(job);
    return res.status(200).json({ success: true, data: transformed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 9. TOGGLE FEATURE STATUS
exports.toggleFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    job.featured = !job.featured;
    await job.save();
    return res.status(200).json({ success: true, featured: job.featured });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 10. TOGGLE ACTIVE STATUS
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    job.isActive = !job.isActive;
    job.status = job.isActive ? "Live" : "Closed";
    await job.save();
    return res.status(200).json({ success: true, status: job.status, isActive: job.isActive });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 11. TOGGLE CONTACT VISIBILITY IN BULK
exports.updateContactVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      { $set: { contactVisibility: req.body } },
      { new: true }
    );
    return res.status(200).json({ success: true, contactVisibility: job.contactVisibility });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 12. DB STATISTICS
exports.getJobStats = async (req, res) => {
  try {
    const [total, live, pending, rejected] = await Promise.all([
      Job.countDocuments({}),
      Job.countDocuments({ status: "Live" }),
      Job.countDocuments({ approvalStatus: "pending_review" }),
      Job.countDocuments({ approvalStatus: "rejected" })
    ]);

    return res.status(200).json({
      success: true,
      stats: { total, live, pending, rejected }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};