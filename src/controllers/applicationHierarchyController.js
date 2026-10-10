const mongoose = require("mongoose");
const Recruiter = require("../models/Recruiter");
const Job = require("../models/Job");
const Application = require("../models/Application");

/* ──────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────── */
function createEmptyStats() {
  return {
    total: 0,
    pending: 0,
    viewed: 0,
    shortlisted: 0,
    interview: 0,
    offered: 0,
    hired: 0,
    rejected: 0,
    withdrawn: 0,
  };
}

function accumulateStatus(stats, status, count = 1) {
  const s = String(status || "").trim().toLowerCase();
  stats.total += count;
  if (s === "applied" || s === "pending") stats.pending += count;
  else if (s === "viewed") stats.viewed += count;
  else if (s === "shortlisted") stats.shortlisted += count;
  else if (s === "interview" || s === "interviewing" || s === "scheduled") stats.interview += count;
  else if (s === "offered" || s === "offer") stats.offered += count;
  else if (s === "hired" || s === "accepted") stats.hired += count;
  else if (s === "rejected" || s === "declined") stats.rejected += count;
  else if (s === "withdrawn") stats.withdrawn += count;
  else stats.pending += count;
}

function getInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function allowedNextStatuses(current) {
  const c = String(current || "Applied").trim();
  switch (c) {
    case "Applied": return ["Viewed", "Shortlisted", "Rejected"];
    case "Viewed": return ["Shortlisted", "Rejected"];
    case "Shortlisted": return ["Interview", "Rejected"];
    case "Interview": return ["Offered", "Rejected"];
    case "Offered": return ["Hired", "Rejected"];
    case "Hired":
    case "Rejected":
    case "Withdrawn": return [];
    default: return ["Viewed", "Shortlisted", "Rejected"];
  }
}

function isTerminalStatus(status) {
  return ["Hired", "Rejected", "Withdrawn"].includes(String(status || ""));
}

/* ──────────────────────────────────────────────────────────
   LEVEL 1 — COMPANIES
   GET /api/v1/applications/hierarchy/companies
   ────────────────────────────────────────────────────────── */
exports.getCompaniesWithStats = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const { search, verified, industry } = req.query;

    const recruiterQuery = {};
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      recruiterQuery.$or = [
        { name: regex }, { email: regex }, { companyName: regex },
        { "companyProfile.name": regex }, { "companyProfile.industry": regex },
        { "companyProfile.city": regex }, { "companyProfile.headquarters": regex },
      ];
    }
    if (verified === "true") {
      recruiterQuery.$or = [...(recruiterQuery.$or || []), { isVerified: true }, { verificationStatus: "approved" }];
    } else if (verified === "false") {
      recruiterQuery.isVerified = false;
      recruiterQuery.verificationStatus = { $ne: "approved" };
    }
    if (industry && industry.trim()) {
      recruiterQuery["companyProfile.industry"] = new RegExp(industry.trim(), "i");
    }

    const [totalRecruiters, recruiters] = await Promise.all([
      Recruiter.countDocuments(recruiterQuery),
      Recruiter.find(recruiterQuery).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    if (!recruiters.length) {
      return res.status(200).json({
        success: true, count: 0,
        pagination: { page, limit, pages: 0, total: 0, totalPages: 0, totalResults: 0, hasNextPage: false, hasPrevPage: false },
        data: [],
      });
    }

    // Fetch ALL jobs (cross-DB) so we can match by recruiterId OR companyName
    const allJobs = await Job.find({})
      .select("_id recruiterId userId postedBy createdBy title status isActive companyName company")
      .lean();

    // Aggregate ALL application status counts, convert jobId -> string for universal matching
    const appAggregation = await Application.aggregate([
      {
        $project: {
          status: "$status",
          targetJobId: { $toString: { $ifNull: ["$jobId", "$job"] } },
        },
      },
      { $group: { _id: { jobId: "$targetJobId", status: "$status" }, count: { $sum: 1 } } },
    ]);

    const appStatsByJobId = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId;
      if (!jIdStr) return;
      if (!appStatsByJobId.has(jIdStr)) appStatsByJobId.set(jIdStr, createEmptyStats());
      accumulateStatus(appStatsByJobId.get(jIdStr), row._id.status, row.count);
    });

    const companyList = recruiters.map((recruiter) => {
      const recIdStr = recruiter._id.toString();
      const profile = recruiter.companyProfile || {};
      const companyName = profile.name || recruiter.companyName || recruiter.name || "Unnamed Company";
      const compNameLower = companyName.trim().toLowerCase();

      // Find all jobs for this recruiter
      const recruiterJobs = allJobs.filter((job) => {
        const jRecId = job.recruiterId ? job.recruiterId.toString() : "";
        const jUserId = job.userId ? job.userId.toString() : "";
        const jPostedBy = job.postedBy ? job.postedBy.toString() : "";
        const jCreatedBy = job.createdBy ? job.createdBy.toString() : "";
        if (jRecId === recIdStr || jUserId === recIdStr || jPostedBy === recIdStr || jCreatedBy === recIdStr) return true;
        const jCompName = String(job.companyName || job.company || "").trim().toLowerCase();
        if (compNameLower && jCompName && compNameLower === jCompName) return true;
        return false;
      });

      const jobCount = recruiterJobs.length;
      const activeJobs = recruiterJobs.filter((j) =>
        j.isActive !== false && j.status !== "Closed" && j.status !== "Draft" && j.status !== "Inactive"
      ).length;

      const compStats = createEmptyStats();
      recruiterJobs.forEach((job) => {
        const jIdStr = job._id.toString();
        const s = appStatsByJobId.get(jIdStr);
        if (s) {
          compStats.total += s.total; compStats.pending += s.pending; compStats.viewed += s.viewed;
          compStats.shortlisted += s.shortlisted; compStats.interview += s.interview;
          compStats.offered += s.offered; compStats.hired += s.hired; compStats.rejected += s.rejected;
          compStats.withdrawn += s.withdrawn;
        }
      });

      const companyLogo =
        profile.logo?.url ||
        (typeof profile.logo === "string" ? profile.logo : "") ||
        recruiter.avatar?.url || "";

      const isVerified = Boolean(recruiter.isVerified || recruiter.verificationStatus === "approved" || recruiter.verified);

      return {
        // IDs — companyId is the recruiter's _id (that's our pivot)
        _id: recIdStr,
        id: recIdStr,
        companyId: recIdStr,
        recruiterId: recIdStr,

        // Display
        companyName,
        name: companyName,
        companyInitials: getInitials(companyName),
        companyLogo,
        logo: { url: companyLogo, publicId: profile.logo?.publicId || recruiter.avatar?.public_id || "" },

        industry: profile.industry || "General",
        city: profile.city || profile.headquarters || "",
        state: profile.state || "",
        country: profile.country || "India",
        address: {
          city: profile.city || profile.headquarters || "",
          state: profile.state || "",
          country: profile.country || "India",
        },

        verified: isVerified,
        isActive: recruiter.isActive !== false,

        // Recruiter info
        recruiterName: recruiter.name || "",
        recruiterEmail: recruiter.email || "",
        recruiterCount: 1,

        // Stats expected by frontend UI
        jobCount,
        totalJobs: jobCount,
        activeJobs,
        applicationCount: compStats.total,
        pendingCount: compStats.pending,
        shortlistedCount: compStats.shortlisted,
        hiredCount: compStats.hired,
        rejectedCount: compStats.rejected,
        applicationStats: compStats,

        createdAt: recruiter.createdAt,
      };
    });

    const totalPages = Math.ceil(totalRecruiters / limit);

    return res.status(200).json({
      success: true,
      count: companyList.length,
      pagination: {
        page, limit,
        pages: totalPages, total: totalRecruiters,
        totalPages, totalResults: totalRecruiters,
        hasNextPage: page < totalPages, hasPrevPage: page > 1,
      },
      data: companyList,
    });
  } catch (error) {
    console.error("Hierarchy getCompaniesWithStats error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch companies hierarchy", error: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
};

/* ──────────────────────────────────────────────────────────
   LEVEL 2 — JOBS BY COMPANY
   GET /api/v1/applications/hierarchy/companies/:companyId/jobs
   ────────────────────────────────────────────────────────── */
exports.getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const { search, status, jobType, workMode } = req.query;

    if (!companyId || companyId === "undefined" || companyId === "null") {
      return res.status(400).json({ success: false, message: "A valid companyId parameter is required" });
    }

    let recruiter = null;
    try {
      if (mongoose.Types.ObjectId.isValid(companyId)) {
        recruiter = await Recruiter.findById(companyId).lean();
      }
    } catch (e) { recruiter = null; }

    const matchConditions = [];
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      const objId = new mongoose.Types.ObjectId(companyId);
      matchConditions.push({ recruiterId: objId }, { userId: objId }, { postedBy: objId }, { createdBy: objId }, { companyId: objId });
    }
    matchConditions.push({ recruiterId: companyId }, { userId: companyId }, { postedBy: companyId }, { createdBy: companyId }, { companyId: companyId });

    if (recruiter) {
      const cName = recruiter.companyProfile?.name || recruiter.companyName;
      if (cName && cName.trim()) {
        const cRegex = new RegExp(`^${cName.trim()}$`, "i");
        matchConditions.push({ companyName: cRegex }, { company: cRegex });
      }
    }

    const jobQuery = { $or: matchConditions };

    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), "i");
      jobQuery.$and = [...(jobQuery.$and || []), { $or: [{ title: sRegex }, { "location.city": sRegex }, { "location.address": sRegex }] }];
    }
    if (status && status !== "all") jobQuery.status = status;
    if (jobType && jobType !== "all") jobQuery.jobType = jobType;
    if (workMode && workMode !== "all") jobQuery.workMode = workMode;

    const [totalJobs, jobs] = await Promise.all([
      Job.countDocuments(jobQuery),
      Job.find(jobQuery).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    if (!jobs.length) {
      return res.status(200).json({
        success: true, count: 0,
        pagination: { page, limit, pages: 0, total: 0, totalPages: 0, totalResults: 0, hasNextPage: false, hasPrevPage: false },
        data: [],
        company: recruiter ? {
          _id: recruiter._id.toString(), id: recruiter._id.toString(),
          name: recruiter.companyProfile?.name || recruiter.companyName || recruiter.name,
          logo: recruiter.companyProfile?.logo || recruiter.avatar,
          email: recruiter.email,
        } : null,
      });
    }

    const jobIds = jobs.map((j) => j._id.toString());
    const jobObjectIds = jobIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null)).filter(Boolean);

    const appAggregation = await Application.aggregate([
      { $match: { $or: [{ jobId: { $in: [...jobObjectIds, ...jobIds] } }, { job: { $in: [...jobObjectIds, ...jobIds] } }] } },
      { $project: { status: "$status", targetJobId: { $toString: { $ifNull: ["$jobId", "$job"] } } } },
      { $group: { _id: { jobId: "$targetJobId", status: "$status" }, count: { $sum: 1 } } },
    ]);

    const statsMap = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId;
      if (!jIdStr) return;
      if (!statsMap.has(jIdStr)) statsMap.set(jIdStr, createEmptyStats());
      accumulateStatus(statsMap.get(jIdStr), row._id.status, row.count);
    });

    const recruiterName = recruiter?.name || "";
    const companyLogo = recruiter?.companyProfile?.logo?.url || recruiter?.avatar?.url || "";

    const jobsWithStats = jobs.map((job) => {
      const jIdStr = job._id.toString();
      const stats = statsMap.get(jIdStr) || createEmptyStats();

      // Build location string
      const loc = job.location || {};
      const locationStr = [loc.city, loc.state].filter(Boolean).join(", ") || loc.address || "";

      // Build salary range string
      const sal = job.salary || {};
      let salaryRange = "Not disclosed";
      if (sal.min && sal.max) salaryRange = `₹${sal.min} - ₹${sal.max} ${sal.period || ""}`.trim();
      else if (sal.min) salaryRange = `₹${sal.min}+ ${sal.period || ""}`.trim();

      return {
        _id: jIdStr, id: jIdStr, jobId: jIdStr,
        title: job.title || "Untitled Job",
        companyName: job.companyName || recruiter?.companyProfile?.name || recruiter?.companyName || "Company",
        companyLogo: (typeof job.companyLogo === "string" ? job.companyLogo : job.companyLogo?.url) || companyLogo,

        location: locationStr,
        locationObj: loc,

        salary: sal,
        salaryRange,

        experience: job.experience || {},
        jobType: job.jobType || "Full-time",
        workMode: job.workMode || "On-site",

        status: job.status || (job.isActive ? "Live" : "Closed"),
        approvalStatus: job.approvalStatus || "approved",
        isActive: job.isActive !== false,
        featured: Boolean(job.featured),

        recruiterId: job.recruiterId ? job.recruiterId.toString() : "",
        recruiterName: recruiterName,

        postedAt: job.postedAt || job.createdAt,
        createdAt: job.createdAt,

        applicantsCount: stats.total || job.applicantsCount || 0,
        applicationCount: stats.total || 0,
        pendingCount: stats.pending || 0,
        shortlistedCount: stats.shortlisted || 0,
        interviewCount: stats.interview || 0,
        hiredCount: stats.hired || 0,
        rejectedCount: stats.rejected || 0,
        applicationStats: stats,
      };
    });

    const totalPages = Math.ceil(totalJobs / limit);

    return res.status(200).json({
      success: true,
      count: jobsWithStats.length,
      pagination: {
        page, limit, pages: totalPages, total: totalJobs,
        totalPages, totalResults: totalJobs,
        hasNextPage: page < totalPages, hasPrevPage: page > 1,
      },
      data: jobsWithStats,
      company: recruiter ? {
        _id: recruiter._id.toString(), id: recruiter._id.toString(),
        name: recruiter.companyProfile?.name || recruiter.companyName || recruiter.name,
        logo: recruiter.companyProfile?.logo || recruiter.avatar,
        email: recruiter.email,
      } : null,
    });
  } catch (error) {
    console.error("Hierarchy getJobsByCompany error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch company jobs", error: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
};

/* ──────────────────────────────────────────────────────────
   LEVEL 3 — APPLICATIONS BY JOB (ADMIN)
   GET /api/v1/applications/hierarchy/jobs/:jobId/applications
   ────────────────────────────────────────────────────────── */
exports.getJobApplicationsForAdmin = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    if (!jobId || jobId === "undefined" || jobId === "null") {
      return res.status(400).json({ success: false, message: "A valid jobId parameter is required" });
    }

    const candidateJobIds = [jobId];
    if (mongoose.Types.ObjectId.isValid(jobId)) candidateJobIds.push(new mongoose.Types.ObjectId(jobId));

    const appQuery = { $or: [{ jobId: { $in: candidateJobIds } }, { job: { $in: candidateJobIds } }] };
    if (status && status !== "all") appQuery.status = status;
    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), "i");
      appQuery.$and = [...(appQuery.$and || []), { $or: [{ candidateName: sRegex }, { candidateEmail: sRegex }, { candidatePhone: sRegex }, { candidateSkills: sRegex }] }];
    }

    const [totalApps, applications, job] = await Promise.all([
      Application.countDocuments(appQuery),
      Application.find(appQuery).sort({ appliedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Job.findById(jobId).lean().catch(() => null),
    ]);

    // Fetch recruiter info for enrichment
    let recruiter = null;
    if (job && job.recruiterId) {
      try { recruiter = await Recruiter.findById(job.recruiterId).lean(); } catch (e) { recruiter = null; }
    }

    const recruiterPayload = recruiter ? {
      id: recruiter._id.toString(),
      name: recruiter.name || "",
      email: recruiter.email || "",
      mobileNumber: recruiter.mobileNumber || recruiter.companyProfile?.contactPhone || "",
      whatsappNumber: recruiter.whatsappNumber || recruiter.companyProfile?.whatsappNumber || "",
      designation: recruiter.designation || recruiter.companyProfile?.contactPerson?.designation || "",
      companyName: recruiter.companyProfile?.name || recruiter.companyName || "",
      profileImageUrl: recruiter.profileImage?.url || recruiter.avatar?.url || null,
      verified: Boolean(recruiter.isVerified || recruiter.verificationStatus === "approved"),
    } : null;

    const jobDetails = job ? {
      id: job._id.toString(),
      title: job.title || "",
      companyName: job.companyName || "",
      companyLogo: (typeof job.companyLogo === "string" ? job.companyLogo : job.companyLogo?.url) || null,
      location: job.location || {},
      workMode: job.workMode || "",
      jobType: job.jobType || "",
    } : null;

    const enriched = applications.map((app) => {
      const currentStatus = app.status || "Applied";
      return {
        ...app,
        _id: app._id.toString(),
        id: app._id.toString(),
        jobId: app.jobId ? app.jobId.toString() : "",
        userId: app.userId ? app.userId.toString() : "",
        candidateAvatarUrl: app.candidateAvatarUrl || "",
        candidateSkills: Array.isArray(app.candidateSkills) ? app.candidateSkills : [],
        candidateLanguages: Array.isArray(app.candidateLanguages) ? app.candidateLanguages : [],
        milestones: Array.isArray(app.milestones) ? app.milestones : [],
        matchPercentage: app.matchPercentage || 0,
        recruiter: recruiterPayload,
        jobDetails,
        workflow: {
          currentStatus,
          allowedNextStatuses: allowedNextStatuses(currentStatus),
          isTerminal: isTerminalStatus(currentStatus),
        },
      };
    });

    const totalPages = Math.ceil(totalApps / limit);

    return res.status(200).json({
      success: true,
      count: enriched.length,
      pagination: {
        page, limit, pages: totalPages, total: totalApps,
        totalPages, totalResults: totalApps,
        hasNextPage: page < totalPages, hasPrevPage: page > 1,
      },
      data: enriched,
      job: jobDetails,
    });
  } catch (error) {
    console.error("Hierarchy getJobApplicationsForAdmin error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch applications for job", error: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
};

/* ──────────────────────────────────────────────────────────
   RECRUITER — OWN JOBS
   GET /api/v1/applications/hierarchy/recruiter/jobs
   ────────────────────────────────────────────────────────── */
exports.getRecruiterJobsWithStats = async (req, res) => {
  try {
    const recruiterId = req.user?._id;
    if (!recruiterId) return res.status(401).json({ success: false, message: "Not authorized as a recruiter" });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const candidateIds = [recruiterId.toString()];
    if (mongoose.Types.ObjectId.isValid(recruiterId)) candidateIds.push(new mongoose.Types.ObjectId(recruiterId));

    const jobQuery = { $or: [{ recruiterId: { $in: candidateIds } }, { userId: { $in: candidateIds } }, { postedBy: { $in: candidateIds } }] };
    if (req.query.search && req.query.search.trim()) {
      const regex = new RegExp(req.query.search.trim(), "i");
      jobQuery.$and = [{ $or: [{ title: regex }, { "location.city": regex }] }];
    }
    if (req.query.status && req.query.status !== "all") jobQuery.status = req.query.status;

    const [totalJobs, jobs] = await Promise.all([
      Job.countDocuments(jobQuery),
      Job.find(jobQuery).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const jobIds = jobs.map((j) => j._id.toString());
    const jobObjectIds = jobIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null)).filter(Boolean);

    const appAggregation = await Application.aggregate([
      { $match: { $or: [{ jobId: { $in: [...jobObjectIds, ...jobIds] } }, { job: { $in: [...jobObjectIds, ...jobIds] } }] } },
      { $project: { status: "$status", targetJobId: { $toString: { $ifNull: ["$jobId", "$job"] } } } },
      { $group: { _id: { jobId: "$targetJobId", status: "$status" }, count: { $sum: 1 } } },
    ]);

    const statsMap = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId;
      if (!jIdStr) return;
      if (!statsMap.has(jIdStr)) statsMap.set(jIdStr, createEmptyStats());
      accumulateStatus(statsMap.get(jIdStr), row._id.status, row.count);
    });

    const jobsWithStats = jobs.map((job) => {
      const jIdStr = job._id.toString();
      const stats = statsMap.get(jIdStr) || createEmptyStats();
      return {
        ...job,
        _id: jIdStr, id: jIdStr, jobId: jIdStr,
        applicantsCount: stats.total,
        applicationCount: stats.total,
        pendingCount: stats.pending,
        hiredCount: stats.hired,
        applicationStats: stats,
      };
    });

    const totalPages = Math.ceil(totalJobs / limit);
    return res.status(200).json({
      success: true, count: jobsWithStats.length,
      pagination: { page, limit, pages: totalPages, total: totalJobs, totalPages, totalResults: totalJobs, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
      data: jobsWithStats,
    });
  } catch (error) {
    console.error("Hierarchy getRecruiterJobsWithStats error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch recruiter jobs", error: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
};

/* ──────────────────────────────────────────────────────────
   RECRUITER — APPLICATIONS BY JOB
   GET /api/v1/applications/hierarchy/recruiter/jobs/:jobId/applications
   ────────────────────────────────────────────────────────── */
exports.getRecruiterJobApplications = async (req, res) => {
  try {
    const recruiterId = req.user?._id;
    const { jobId } = req.params;

    if (!jobId || jobId === "undefined" || jobId === "null") {
      return res.status(400).json({ success: false, message: "A valid jobId parameter is required" });
    }

    const job = await Job.findById(jobId).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (job.recruiterId && job.recruiterId.toString() !== recruiterId.toString() &&
        job.userId && job.userId.toString() !== recruiterId.toString()) {
      return res.status(403).json({ success: false, message: "You are not authorized to view applications for this job" });
    }

    const candidateJobIds = [jobId.toString()];
    if (mongoose.Types.ObjectId.isValid(jobId)) candidateJobIds.push(new mongoose.Types.ObjectId(jobId));

    const appQuery = { $or: [{ jobId: { $in: candidateJobIds } }, { job: { $in: candidateJobIds } }] };
    if (req.query.status && req.query.status !== "all") appQuery.status = req.query.status;

    const applications = await Application.find(appQuery).sort({ appliedAt: -1, createdAt: -1 }).lean();

    const enriched = applications.map((app) => {
      const currentStatus = app.status || "Applied";
      return {
        ...app,
        _id: app._id.toString(), id: app._id.toString(),
        workflow: {
          currentStatus,
          allowedNextStatuses: allowedNextStatuses(currentStatus),
          isTerminal: isTerminalStatus(currentStatus),
        },
      };
    });

    return res.status(200).json({
      success: true, count: enriched.length, data: enriched,
      job: { _id: job._id.toString(), id: job._id.toString(), title: job.title, companyName: job.companyName },
    });
  } catch (error) {
    console.error("Hierarchy getRecruiterJobApplications error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch job applications", error: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
};