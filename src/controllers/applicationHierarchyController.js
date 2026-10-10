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
 * Helper: Normalizes application status counts into standardized buckets
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

    const { search, status, verified, industry } = req.query;

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

    // 2. Fetch Recruiters matching query
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

    // 3. Collect recruiter IDs (both ObjectId and String formats for bulletproof matching)
    const recruiterIds = [];
    const recruiterIdStrings = [];
    recruiters.forEach((r) => {
      recruiterIds.push(r._id);
      recruiterIdStrings.push(r._id.toString());
    });

    // 4. Fetch all jobs belonging to these recruiters from Job_db
    const allJobs = await Job.find({
      $or: [
        { recruiterId: { $in: recruiterIds } },
        { recruiterId: { $in: recruiterIdStrings } },
      ],
    })
      .select("_id recruiterId title status isActive companyName")
      .lean();

    // Group jobs by recruiter ID
    const jobsByRecruiter = new Map();
    const allJobIds = [];

    allJobs.forEach((job) => {
      const recIdStr = job.recruiterId ? job.recruiterId.toString() : null;
      if (recIdStr) {
        if (!jobsByRecruiter.has(recIdStr)) {
          jobsByRecruiter.set(recIdStr, []);
        }
        jobsByRecruiter.get(recIdStr).push(job);
      }
      allJobIds.push(job._id);
    });

    // 5. Aggregate Application stats for all these job IDs from application_db
    const appStatsByJobId = new Map();

    if (allJobIds.length > 0) {
      const jobObjectIds = allJobIds
        .map((id) => {
          try {
            return mongoose.Types.ObjectId.isValid(id)
              ? new mongoose.Types.ObjectId(id)
              : id;
          } catch (e) {
            return id;
          }
        })
        .filter(Boolean);

      const appAggregation = await Application.aggregate([
        {
          $match: {
            jobId: { $in: jobObjectIds },
          },
        },
        {
          $group: {
            _id: {
              jobId: "$jobId",
              status: "$status",
            },
            count: { $sum: 1 },
          },
        },
      ]);

      appAggregation.forEach((row) => {
        const jIdStr = row._id.jobId ? row._id.jobId.toString() : "";
        if (!jIdStr) return;

        if (!appStatsByJobId.has(jIdStr)) {
          appStatsByJobId.set(jIdStr, createEmptyStats());
        }
        accumulateStatus(appStatsByJobId.get(jIdStr), row._id.status, row.count);
      });
    }

    // 6. Assemble company records with live aggregated stats
    const companyList = recruiters.map((recruiter) => {
      const recIdStr = recruiter._id.toString();
      const recruiterJobs = jobsByRecruiter.get(recIdStr) || [];

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
        const jIdStr = job._id.toString();
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

      // Extract Company Name & Logo with multiple fallbacks
      const profile = recruiter.companyProfile || {};
      const companyName =
        profile.name ||
        recruiter.companyName ||
        recruiter.name ||
        "Unnamed Company";

      const logo = {
        url:
          profile.logo?.url ||
          profile.logo ||
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
        _id: recruiter._id,
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
          _id: recruiter._id,
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

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId parameter is required",
      });
    }

    // 1. Fetch Recruiter or Company info for header display
    let recruiter = null;
    try {
      if (mongoose.Types.ObjectId.isValid(companyId)) {
        recruiter = await Recruiter.findById(companyId).lean();
      }
    } catch (e) {
      recruiter = null;
    }

    // 2. Build Job search criteria
    const candidateIds = [companyId];
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      candidateIds.push(new mongoose.Types.ObjectId(companyId));
    }

    const jobQuery = {
      $or: [
        { recruiterId: { $in: candidateIds } },
        { companyId: { $in: candidateIds } },
      ],
    };

    // If recruiter has a known companyName and no recruiterId matches, fallback to companyName
    if (recruiter && (recruiter.companyName || recruiter.companyProfile?.name)) {
      const cName = recruiter.companyProfile?.name || recruiter.companyName;
      jobQuery.$or.push({
        companyName: new RegExp(`^${cName.trim()}$`, "i"),
      });
    }

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

    // 3. Fetch Jobs with pagination
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
              _id: recruiter._id,
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

    // 4. Aggregate Application Stats for these jobs
    const jobIds = jobs.map((j) => j._id);
    const jobObjectIds = jobIds
      .map((id) => {
        try {
          return mongoose.Types.ObjectId.isValid(id)
            ? new mongoose.Types.ObjectId(id)
            : id;
        } catch (e) {
          return id;
        }
      })
      .filter(Boolean);

    const appAggregation = await Application.aggregate([
      {
        $match: {
          jobId: { $in: jobObjectIds },
        },
      },
      {
        $group: {
          _id: {
            jobId: "$jobId",
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const statsMap = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId ? row._id.jobId.toString() : "";
      if (!jIdStr) return;

      if (!statsMap.has(jIdStr)) {
        statsMap.set(jIdStr, createEmptyStats());
      }
      accumulateStatus(statsMap.get(jIdStr), row._id.status, row.count);
    });

    // 5. Combine jobs with application stats
    const jobsWithStats = jobs.map((job) => {
      const jIdStr = job._id.toString();
      const stats = statsMap.get(jIdStr) || createEmptyStats();

      return {
        _id: job._id,
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
            _id: recruiter._id,
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

    const candidateIds = [recruiterId];
    if (mongoose.Types.ObjectId.isValid(recruiterId)) {
      candidateIds.push(new mongoose.Types.ObjectId(recruiterId));
    }

    const jobQuery = {
      recruiterId: { $in: candidateIds },
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

    const jobIds = jobs.map((j) => j._id);
    const jobObjectIds = jobIds
      .map((id) => {
        try {
          return mongoose.Types.ObjectId.isValid(id)
            ? new mongoose.Types.ObjectId(id)
            : id;
        } catch (e) {
          return id;
        }
      })
      .filter(Boolean);

    const appAggregation = await Application.aggregate([
      { $match: { jobId: { $in: jobObjectIds } } },
      {
        $group: {
          _id: { jobId: "$jobId", status: "$status" },
          count: { $sum: 1 },
        },
      },
    ]);

    const statsMap = new Map();
    appAggregation.forEach((row) => {
      const jIdStr = row._id.jobId ? row._id.jobId.toString() : "";
      if (!jIdStr) return;
      if (!statsMap.has(jIdStr)) statsMap.set(jIdStr, createEmptyStats());
      accumulateStatus(statsMap.get(jIdStr), row._id.status, row.count);
    });

    const jobsWithStats = jobs.map((job) => {
      const jIdStr = job._id.toString();
      const stats = statsMap.get(jIdStr) || createEmptyStats();
      return {
        ...job,
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

    const job = await Job.findById(jobId).lean();
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (
      job.recruiterId &&
      job.recruiterId.toString() !== recruiterId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view applications for this job",
      });
    }

    const candidateJobIds = [jobId];
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      candidateJobIds.push(new mongoose.Types.ObjectId(jobId));
    }

    const appQuery = {
      jobId: { $in: candidateJobIds },
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
      data: applications,
      job: {
        _id: job._id,
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