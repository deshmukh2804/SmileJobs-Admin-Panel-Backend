const mongoose = require("mongoose");
const Recruiter = require("../models/Recruiter");
const Job = require("../models/Job");
const Application = require("../models/Application");

let Company = null;
try {
  Company = require("../models/Company");
} catch (e) {
  Company = null;
}

/**
 * Helper: Creates empty status counts bucket
 */
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
  };
}

/**
 * Helper: Maps application status to bucket
 */
function accumulateStatus(statsObj, status, count = 1) {
  const s = String(status || "").trim().toLowerCase();
  statsObj.total += count;

  if (s === "applied" || s === "pending") {
    statsObj.pending += count;
  } else if (s === "viewed") {
    statsObj.viewed += count;
  } else if (s === "shortlisted") {
    statsObj.shortlisted += count;
  } else if (s === "interview" || s === "interviewing" || s === "scheduled") {
    statsObj.interview += count;
  } else if (s === "offered" || s === "offer") {
    statsObj.offered += count;
  } else if (s === "hired" || s === "accepted") {
    statsObj.hired += count;
  } else if (s === "rejected" || s === "declined" || s === "withdrawn") {
    statsObj.rejected += count;
  } else {
    statsObj.pending += count;
  }
}

/**
 * @desc    Get all companies/recruiters with aggregated job & application counts
 * @route   GET /api/v1/applications/hierarchy/companies
 * @access  Private (Admin / Super Admin)
 */
exports.getCompaniesWithStats = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, verified, industry } = req.query;

    // 1. Build Recruiter search/filter query
    const recruiterQuery = {};

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      recruiterQuery.$or = [
        { name: regex },
        { email: regex },
        { companyName: regex },
        { "companyProfile.name": regex },
        { "companyProfile.industry": regex },
        { "companyProfile.city": regex },
        { "companyProfile.headquarters": regex },
      ];
    }

    if (verified === "true") {
      recruiterQuery.$or = [
        ...(recruiterQuery.$or || []),
        { isVerified: true },
        { verificationStatus: "approved" },
      ];
    } else if (verified === "false") {
      recruiterQuery.isVerified = false;
      recruiterQuery.verificationStatus = { $ne: "approved" };
    }

    if (industry && industry.trim()) {
      recruiterQuery["companyProfile.industry"] = new RegExp(industry.trim(), "i");
    }

    // 2. Fetch Recruiters
    const [totalRecruiters, recruiters] = await Promise.all([
      Recruiter.countDocuments(recruiterQuery),
      Recruiter.find(recruiterQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    if (!recruiters || recruiters.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        pagination: {
          page,
          limit,
          totalPages: 0,
          totalResults: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
        data: [],
      });
    }

    // 3. Fetch all jobs from Job_db to match recruiters by ID, userId, or companyName
    const allJobs = await Job.find({})
      .select("_id recruiterId userId postedBy createdBy title status isActive companyName company companyProfile")
      .lean();

    // 4. Fetch and aggregate all application stats by Job ID from application_db
    const appAggregation = await Application.aggregate([
      {
        $project: {
          status: "$status",
          targetJobId: {
            $toString: { $ifNull: ["$jobId", "$job"] },
          },
        },
      },
      {
        $group: {
          _id: {
            jobId: "$targetJobId",
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const appStatsByJobId = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId;
      if (!jIdStr) return;

      if (!appStatsByJobId.has(jIdStr)) {
        appStatsByJobId.set(jIdStr, createEmptyStats());
      }
      accumulateStatus(appStatsByJobId.get(jIdStr), row._id.status, row.count);
    });

    // 5. Assemble company records with matched jobs & application stats
    const companyList = recruiters.map((recruiter) => {
      const recIdStr = recruiter._id ? recruiter._id.toString() : "";
      const profile = recruiter.companyProfile || {};
      const companyName =
        profile.name ||
        recruiter.companyName ||
        recruiter.name ||
        "Unnamed Company";

      const compNameLower = companyName.trim().toLowerCase();

      // Find all jobs belonging to this recruiter
      const recruiterJobs = allJobs.filter((job) => {
        const jRecId = job.recruiterId ? job.recruiterId.toString() : "";
        const jUserId = job.userId ? job.userId.toString() : "";
        const jPostedBy = job.postedBy ? job.postedBy.toString() : "";
        const jCreatedBy = job.createdBy ? job.createdBy.toString() : "";

        if (
          (recIdStr && (jRecId === recIdStr || jUserId === recIdStr || jPostedBy === recIdStr || jCreatedBy === recIdStr))
        ) {
          return true;
        }

        const jCompName = String(job.companyName || job.company || "").trim().toLowerCase();
        if (compNameLower && jCompName && compNameLower === jCompName) {
          return true;
        }

        return false;
      });

      // Calculate total & active jobs
      const totalJobs = recruiterJobs.length;
      const activeJobs = recruiterJobs.filter(
        (j) =>
          j.isActive !== false &&
          j.status !== "Closed" &&
          j.status !== "Draft" &&
          j.status !== "Inactive"
      ).length;

      // Sum application stats across all recruiter's jobs
      const compStats = createEmptyStats();
      recruiterJobs.forEach((job) => {
        const jIdStr = job._id ? job._id.toString() : "";
        const jobStats = appStatsByJobId.get(jIdStr);
        if (jobStats) {
          compStats.total += jobStats.total;
          compStats.pending += jobStats.pending;
          compStats.viewed += jobStats.viewed;
          compStats.shortlisted += jobStats.shortlisted;
          compStats.interview += jobStats.interview;
          compStats.offered += jobStats.offered;
          compStats.hired += jobStats.hired;
          compStats.rejected += jobStats.rejected;
        }
      });

      // Extract Company Logo
      const logo = {
        url:
          profile.logo?.url ||
          (typeof profile.logo === "string" ? profile.logo : "") ||
          recruiter.avatar?.url ||
          "",
        publicId: profile.logo?.publicId || recruiter.avatar?.public_id || "",
      };

      const industryVal = profile.industry || "General";
      const city = profile.city || profile.headquarters || "";
      const state = profile.state || "";
      const country = profile.country || "India";

      const isVerified = Boolean(
        recruiter.isVerified ||
          recruiter.verificationStatus === "approved" ||
          recruiter.verified
      );

      return {
        _id: recIdStr,
        id: recIdStr,
        name: companyName,
        companyName: companyName,
        recruiterName: recruiter.name || "",
        recruiterEmail: recruiter.email || "",
        logo: logo,
        industry: industryVal,
        address: {
          city,
          state,
          country,
        },
        verified: isVerified,
        isActive: recruiter.isActive !== false,
        recruiterId: {
          _id: recIdStr,
          name: recruiter.name || "",
          email: recruiter.email || "",
        },
        recruiterCount: 1,
        totalJobs,
        activeJobs,
        applicationStats: compStats,
        createdAt: recruiter.createdAt,
      };
    });

    const totalPages = Math.ceil(totalRecruiters / limit);

    return res.status(200).json({
      success: true,
      count: companyList.length,
      pagination: {
        page,
        limit,
        totalPages,
        totalResults: totalRecruiters,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: companyList,
    });
  } catch (error) {
    console.error("Hierarchy getCompaniesWithStats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch companies hierarchy",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get all jobs for a specific company / recruiter with application counts
 * @route   GET /api/v1/applications/hierarchy/companies/:companyId/jobs
 * @access  Private (Admin / Super Admin)
 */
exports.getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status, jobType, workMode } = req.query;

    if (!companyId || companyId === "undefined" || companyId === "null") {
      return res.status(400).json({
        success: false,
        message: "A valid companyId parameter is required",
      });
    }

    // 1. Fetch Recruiter or Company info
    let recruiter = null;
    try {
      if (mongoose.Types.ObjectId.isValid(companyId)) {
        recruiter = await Recruiter.findById(companyId).lean();
      }
    } catch (e) {
      recruiter = null;
    }

    // 2. Build Job query matching ID or company name
    const matchConditions = [];

    if (mongoose.Types.ObjectId.isValid(companyId)) {
      const objId = new mongoose.Types.ObjectId(companyId);
      matchConditions.push({ recruiterId: objId });
      matchConditions.push({ userId: objId });
      matchConditions.push({ postedBy: objId });
      matchConditions.push({ createdBy: objId });
      matchConditions.push({ companyId: objId });
    }

    matchConditions.push({ recruiterId: companyId });
    matchConditions.push({ userId: companyId });
    matchConditions.push({ postedBy: companyId });
    matchConditions.push({ createdBy: companyId });
    matchConditions.push({ companyId: companyId });

    if (recruiter) {
      const cName = recruiter.companyProfile?.name || recruiter.companyName;
      if (cName && cName.trim()) {
        const cRegex = new RegExp(`^${cName.trim()}$`, "i");
        matchConditions.push({ companyName: cRegex });
        matchConditions.push({ company: cRegex });
      }
    }

    const jobQuery = { $or: matchConditions };

    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), "i");
      jobQuery.$and = [
        ...(jobQuery.$and || []),
        {
          $or: [
            { title: sRegex },
            { "location.city": sRegex },
            { "location.address": sRegex },
            { jobType: sRegex },
          ],
        },
      ];
    }

    if (status && status !== "all") {
      jobQuery.status = status;
    }

    if (jobType && jobType !== "all") {
      jobQuery.jobType = jobType;
    }

    if (workMode && workMode !== "all") {
      jobQuery.workMode = workMode;
    }

    // 3. Fetch Jobs
    const [totalJobs, jobs] = await Promise.all([
      Job.countDocuments(jobQuery),
      Job.find(jobQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    if (!jobs || jobs.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        pagination: {
          page,
          limit,
          totalPages: 0,
          totalResults: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
        data: [],
        company: recruiter
          ? {
              _id: recruiter._id.toString(),
              id: recruiter._id.toString(),
              name:
                recruiter.companyProfile?.name ||
                recruiter.companyName ||
                recruiter.name,
              logo:
                recruiter.companyProfile?.logo || recruiter.avatar,
              email: recruiter.email,
            }
          : null,
      });
    }

    // 4. Aggregate Application Stats for these specific jobs
    const jobIds = jobs.map((j) => (j._id ? j._id.toString() : "")).filter(Boolean);
    const jobObjectIds = jobIds
      .map((id) => {
        try {
          return mongoose.Types.ObjectId.isValid(id)
            ? new mongoose.Types.ObjectId(id)
            : null;
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    const appAggregation = await Application.aggregate([
      {
        $match: {
          $or: [
            { jobId: { $in: [...jobObjectIds, ...jobIds] } },
            { job: { $in: [...jobObjectIds, ...jobIds] } },
          ],
        },
      },
      {
        $project: {
          status: "$status",
          targetJobId: {
            $toString: { $ifNull: ["$jobId", "$job"] },
          },
        },
      },
      {
        $group: {
          _id: {
            jobId: "$targetJobId",
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const statsMap = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId;
      if (!jIdStr) return;

      if (!statsMap.has(jIdStr)) {
        statsMap.set(jIdStr, createEmptyStats());
      }
      accumulateStatus(statsMap.get(jIdStr), row._id.status, row.count);
    });

    // 5. Combine jobs with application stats
    const jobsWithStats = jobs.map((job) => {
      const jIdStr = job._id ? job._id.toString() : "";
      const stats = statsMap.get(jIdStr) || createEmptyStats();

      return {
        _id: jIdStr,
        id: jIdStr,
        title: job.title || "Untitled Job",
        companyName:
          job.companyName ||
          recruiter?.companyProfile?.name ||
          recruiter?.companyName ||
          "Company",
        companyLogo:
          job.companyLogo ||
          recruiter?.companyProfile?.logo ||
          recruiter?.avatar ||
          {},
        location: job.location || { address: "", city: "", state: "", country: "India" },
        salary: job.salary || {},
        experience: job.experience || {},
        jobType: job.jobType || "Full-time",
        workMode: job.workMode || "On-site",
        status: job.status || (job.isActive ? "Live" : "Closed"),
        isActive: job.isActive !== false,
        featured: Boolean(job.featured),
        postedAt: job.postedAt || job.createdAt,
        createdAt: job.createdAt,
        applicantsCount: stats.total || job.applicantsCount || 0,
        applicationStats: stats,
      };
    });

    const totalPages = Math.ceil(totalJobs / limit);

    return res.status(200).json({
      success: true,
      count: jobsWithStats.length,
      pagination: {
        page,
        limit,
        totalPages,
        totalResults: totalJobs,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: jobsWithStats,
      company: recruiter
        ? {
            _id: recruiter._id.toString(),
            id: recruiter._id.toString(),
            name:
              recruiter.companyProfile?.name ||
              recruiter.companyName ||
              recruiter.name,
            logo:
              recruiter.companyProfile?.logo || recruiter.avatar,
            email: recruiter.email,
          }
        : null,
    });
  } catch (error) {
    console.error("Hierarchy getJobsByCompany error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company jobs",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get all applications for a specific job (Admin view)
 * @route   GET /api/v1/applications/hierarchy/jobs/:jobId/applications
 * @access  Private (Admin / Super Admin)
 */
exports.getJobApplicationsForAdmin = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, search } = req.query;

    if (!jobId || jobId === "undefined" || jobId === "null") {
      return res.status(400).json({
        success: false,
        message: "A valid jobId parameter is required",
      });
    }

    const candidateJobIds = [jobId];
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      candidateJobIds.push(new mongoose.Types.ObjectId(jobId));
    }

    const appQuery = {
      $or: [
        { jobId: { $in: candidateJobIds } },
        { job: { $in: candidateJobIds } },
      ],
    };

    if (status && status !== "all") {
      appQuery.status = status;
    }

    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), "i");
      appQuery.$and = [
        ...(appQuery.$and || []),
        {
          $or: [
            { candidateName: sRegex },
            { candidateEmail: sRegex },
            { candidatePhone: sRegex },
            { candidateSkills: sRegex },
          ],
        },
      ];
    }

    const [applications, job] = await Promise.all([
      Application.find(appQuery).sort({ appliedAt: -1, createdAt: -1 }).lean(),
      Job.findById(jobId).lean().catch(() => null),
    ]);

    return res.status(200).json({
      success: true,
      count: applications.length,
      data: applications.map((app) => ({
        ...app,
        _id: app._id ? app._id.toString() : "",
        id: app._id ? app._id.toString() : "",
      })),
      job: job
        ? {
            _id: job._id.toString(),
            id: job._id.toString(),
            title: job.title,
            companyName: job.companyName,
          }
        : null,
    });
  } catch (error) {
    console.error("Hierarchy getJobApplicationsForAdmin error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch applications for job",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get recruiter's own jobs with application stats
 * @route   GET /api/v1/applications/hierarchy/recruiter/jobs
 * @access  Private (Recruiter)
 */
exports.getRecruiterJobsWithStats = async (req, res) => {
  try {
    const recruiterId = req.user?._id;
    if (!recruiterId) {
      return res.status(401).json({
        success: false,
        message: "Not authorized as a recruiter",
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const candidateIds = [recruiterId.toString()];
    if (mongoose.Types.ObjectId.isValid(recruiterId)) {
      candidateIds.push(new mongoose.Types.ObjectId(recruiterId));
    }

    const jobQuery = {
      $or: [
        { recruiterId: { $in: candidateIds } },
        { userId: { $in: candidateIds } },
        { postedBy: { $in: candidateIds } },
      ],
    };

    if (req.query.search && req.query.search.trim()) {
      const regex = new RegExp(req.query.search.trim(), "i");
      jobQuery.$or = [{ title: regex }, { "location.city": regex }];
    }

    if (req.query.status && req.query.status !== "all") {
      jobQuery.status = req.query.status;
    }

    const [totalJobs, jobs] = await Promise.all([
      Job.countDocuments(jobQuery),
      Job.find(jobQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const jobIds = jobs.map((j) => (j._id ? j._id.toString() : "")).filter(Boolean);
    const jobObjectIds = jobIds
      .map((id) => {
        try {
          return mongoose.Types.ObjectId.isValid(id)
            ? new mongoose.Types.ObjectId(id)
            : null;
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    const appAggregation = await Application.aggregate([
      {
        $match: {
          $or: [
            { jobId: { $in: [...jobObjectIds, ...jobIds] } },
            { job: { $in: [...jobObjectIds, ...jobIds] } },
          ],
        },
      },
      {
        $project: {
          status: "$status",
          targetJobId: {
            $toString: { $ifNull: ["$jobId", "$job"] },
          },
        },
      },
      {
        $group: {
          _id: { jobId: "$targetJobId", status: "$status" },
          count: { $sum: 1 },
        },
      },
    ]);

    const statsMap = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId;
      if (!jIdStr) return;
      if (!statsMap.has(jIdStr)) statsMap.set(jIdStr, createEmptyStats());
      accumulateStatus(statsMap.get(jIdStr), row._id.status, row.count);
    });

    const jobsWithStats = jobs.map((job) => {
      const jIdStr = job._id ? job._id.toString() : "";
      const stats = statsMap.get(jIdStr) || createEmptyStats();
      return {
        ...job,
        _id: jIdStr,
        id: jIdStr,
        applicantsCount: stats.total,
        applicationStats: stats,
      };
    });

    const totalPages = Math.ceil(totalJobs / limit);

    return res.status(200).json({
      success: true,
      count: jobsWithStats.length,
      pagination: {
        page,
        limit,
        totalPages,
        totalResults: totalJobs,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: jobsWithStats,
    });
  } catch (error) {
    console.error("Hierarchy getRecruiterJobsWithStats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recruiter jobs",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get applications for a recruiter's job
 * @route   GET /api/v1/applications/hierarchy/recruiter/jobs/:jobId/applications
 * @access  Private (Recruiter)
 */
exports.getRecruiterJobApplications = async (req, res) => {
  try {
    const recruiterId = req.user?._id;
    const { jobId } = req.params;

    if (!jobId || jobId === "undefined" || jobId === "null") {
      return res.status(400).json({
        success: false,
        message: "A valid jobId parameter is required",
      });
    }

    const job = await Job.findById(jobId).lean();
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (
      job.recruiterId &&
      job.recruiterId.toString() !== recruiterId.toString() &&
      job.userId &&
      job.userId.toString() !== recruiterId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view applications for this job",
      });
    }

    const candidateJobIds = [jobId.toString()];
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      candidateJobIds.push(new mongoose.Types.ObjectId(jobId));
    }

    const appQuery = {
      $or: [
        { jobId: { $in: candidateJobIds } },
        { job: { $in: candidateJobIds } },
      ],
    };

    if (req.query.status && req.query.status !== "all") {
      appQuery.status = req.query.status;
    }

    const applications = await Application.find(appQuery)
      .sort({ appliedAt: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: applications.length,
      data: applications.map((app) => ({
        ...app,
        _id: app._id ? app._id.toString() : "",
        id: app._id ? app._id.toString() : "",
      })),
      job: {
        _id: job._id ? job._id.toString() : "",
        id: job._id ? job._id.toString() : "",
        title: job.title,
        companyName: job.companyName,
      },
    });
  } catch (error) {
    console.error("Hierarchy getRecruiterJobApplications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch job applications",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};