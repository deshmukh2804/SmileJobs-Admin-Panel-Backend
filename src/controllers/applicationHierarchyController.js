const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

// ═══════════════════════════════════════════════════════════
// MODEL CONNECTIONS (safe re-use to avoid OverwriteModelError)
// ═══════════════════════════════════════════════════════════
const Recruiter = recruiterDbConnection.models.Recruiter
  || recruiterDbConnection.model("Recruiter", new mongoose.Schema({}, { strict: false, collection: "recruiters" }));

const JobDb = mongoose.connection.useDb("Job_db", { useCache: true });
const Job = JobDb.models.Job
  || JobDb.model("Job", new mongoose.Schema({}, { strict: false, collection: "jobs" }));

// Lazy-cached Application model
let _ApplicationModel = null;
const getApplicationModel = () => {
  if (_ApplicationModel) return _ApplicationModel;

  const uri =
    process.env.MONGO_URI_APPLICATION ||
    process.env.MONGO_URI_JOBS ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/application_db";

  let conn = mongoose.connections.find((c) => c.name === "application_db");
  if (!conn) {
    conn = mongoose.createConnection(uri, { dbName: "application_db" });
  }

  _ApplicationModel =
    conn.models.Application ||
    conn.model("Application", new mongoose.Schema({}, { strict: false, collection: "applications" }));

  return _ApplicationModel;
};

// ═══════════════════════════════════════════════════════════
// WORKFLOW STATE MACHINE
// ═══════════════════════════════════════════════════════════
const WORKFLOW_TRANSITIONS = {
  Applied: ["Viewed", "Shortlisted", "Rejected"],
  Viewed: ["Shortlisted", "Rejected"],
  Shortlisted: ["Interview", "Rejected"],
  Interview: ["Offered", "Rejected"],
  Offered: ["Hired", "Rejected"],
  Hired: [],
  Rejected: [],
  Withdrawn: [],
};

// Helper to build stats shape consistently
const buildStats = (apps = []) => {
  const stats = {
    total: apps.length,
    pending: 0,
    viewed: 0,
    shortlisted: 0,
    interview: 0,
    offered: 0,
    hired: 0,
    rejected: 0,
    withdrawn: 0,
  };
  apps.forEach((app) => {
    const s = (app.status || "Applied").toLowerCase();
    if (s === "applied" || s === "pending") stats.pending++;
    else if (s === "viewed") stats.viewed++;
    else if (s === "shortlisted") stats.shortlisted++;
    else if (s === "interview") stats.interview++;
    else if (s === "offered") stats.offered++;
    else if (s === "hired") stats.hired++;
    else if (s === "rejected") stats.rejected++;
    else if (s === "withdrawn") stats.withdrawn++;
  });
  return stats;
};

// ═══════════════════════════════════════════════════════════
// COMPANIES (RECRUITERS AS COMPANIES)
// ═══════════════════════════════════════════════════════════
exports.getCompaniesWithStats = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || "";

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { "companyProfile.name": { $regex: search, $options: "i" } },
      ];
    }

    const totalRecruiters = await Recruiter.countDocuments(query);
    const recruiters = await Recruiter.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const Application = getApplicationModel();

    const enriched = await Promise.all(
      recruiters.map(async (r) => {
        const companyId = r._id.toString();
        const companyName = r.companyProfile?.name || r.companyName;

        const jobQuery = {
          $or: [
            { recruiterId: companyId },
            { userId: companyId },
            { createdBy: companyId },
            { postedBy: companyId },
          ],
        };
        if (companyName) {
          jobQuery.$or.push({ companyName: companyName });
          jobQuery.$or.push({ company: companyName });
        }

        const recruiterJobs = await Job.find(jobQuery).select("_id status").lean();
        const jobIds = recruiterJobs.map((j) => j._id.toString());

        let appStats = buildStats([]);
        if (jobIds.length > 0) {
          const apps = await Application.find({ jobId: { $in: jobIds } }).select("status").lean();
          appStats = buildStats(apps);
        }

        const activeJobs = recruiterJobs.filter((j) => j.status === "Live").length;

        return {
          _id: r._id,
          id: r._id,
          companyId: r._id,
          recruiterId: r._id,
          companyName: companyName || "Unnamed Company",
          name: companyName || r.name,
          companyInitials:
            r.companyProfile?.companyInitials ||
            (companyName || r.name || "C").slice(0, 2).toUpperCase(),
          companyLogo:
            r.companyProfile?.logo?.url ||
            r.companyProfile?.logo ||
            r.avatar?.url ||
            r.profileImage?.url ||
            null,
          logo: r.companyProfile?.logo || null,
          industry: r.companyProfile?.industry || r.industry || "Not Specified",
          city: r.companyProfile?.city || r.city || "Remote",
          state: r.companyProfile?.state || "",
          country: r.companyProfile?.country || "India",
          address: {
            city: r.companyProfile?.city || "",
            state: r.companyProfile?.state || "",
            country: r.companyProfile?.country || "",
          },
          verified: r.verified || r.isVerified || false,
          isActive: r.isActive !== false,
          recruiterCount: 1,
          jobCount: recruiterJobs.length,
          totalJobs: recruiterJobs.length,
          activeJobs,
          applicationCount: appStats.total,
          pendingCount: appStats.pending,
          shortlistedCount: appStats.shortlisted,
          hiredCount: appStats.hired,
          rejectedCount: appStats.rejected,
          applicationStats: appStats,
          recruiterName: r.name,
          recruiterEmail: r.email,
          profileImageUrl: r.profileImage?.url || r.avatar?.url || null,
          createdAt: r.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        page,
        limit,
        pages: Math.ceil(totalRecruiters / limit),
        total: totalRecruiters,
        totalPages: Math.ceil(totalRecruiters / limit),
        totalResults: totalRecruiters,
        hasNextPage: page * limit < totalRecruiters,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    console.error("[getCompaniesWithStats]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// JOBS BY COMPANY
// ═══════════════════════════════════════════════════════════
exports.getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!companyId || companyId === "undefined" || companyId === "null") {
      return res.status(400).json({ success: false, message: "Invalid Company ID parameter" });
    }

    const recruiter = await Recruiter.findById(companyId).lean();
    const companyName = recruiter?.companyProfile?.name || recruiter?.companyName;

    const query = {
      $or: [
        { recruiterId: companyId },
        { userId: companyId },
        { createdBy: companyId },
        { postedBy: companyId },
      ],
    };
    if (companyName) {
      query.$or.push({ companyName: companyName });
      query.$or.push({ company: companyName });
    }

    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();
    const Application = getApplicationModel();

    const enrichedJobs = await Promise.all(
      jobs.map(async (j) => {
        const jobIdStr = j._id.toString();
        const apps = await Application.find({ jobId: jobIdStr }).select("status").lean();
        const stats = buildStats(apps);

        let locationStr = "Remote";
        let locationObj = {};
        if (j.location) {
          if (typeof j.location === "object") {
            locationObj = j.location;
            locationStr =
              [j.location.city, j.location.state].filter(Boolean).join(", ") || "Remote";
          } else {
            locationStr = j.location;
          }
        }

        let salaryRange = "Not Disclosed";
        if (j.salary && (j.salary.min || j.salary.max)) {
          const period = j.salary.period || "month";
          salaryRange = `₹${j.salary.min || 0} - ₹${j.salary.max || 0} / ${period}`;
        }

        return {
          _id: j._id,
          id: j._id,
          jobId: j._id,
          title: j.title || "Untitled Job",
          companyName: j.companyName || companyName || "Unnamed Company",
          companyLogo: j.companyLogo?.url || j.companyLogo || null,
          location: locationStr,
          locationObj,
          salary: j.salary || {},
          salaryRange,
          experience: j.experience?.text || `${j.experience?.min || 0}-${j.experience?.max || 0} Yrs`,
          jobType: j.jobType || "Full-Time",
          workMode: j.workMode || "On-site",
          status: j.status || "Live",
          approvalStatus: j.approvalStatus || "approved",
          isActive: j.isActive !== false,
          featured: j.featured || false,
          recruiterId: j.recruiterId || companyId,
          recruiterName: recruiter?.name || j.postedBy || "Recruiter",
          postedAt: j.postedAt || j.createdAt,
          createdAt: j.createdAt,
          applicantsCount: j.applicantsCount || stats.total,
          applicationCount: stats.total,
          pendingCount: stats.pending,
          shortlistedCount: stats.shortlisted,
          interviewCount: stats.interview,
          hiredCount: stats.hired,
          rejectedCount: stats.rejected,
          applicationStats: stats,
        };
      })
    );

    return res.status(200).json({ success: true, data: enrichedJobs });
  } catch (err) {
    console.error("[getJobsByCompany]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// APPLICATIONS FOR A JOB (ADMIN)
// ═══════════════════════════════════════════════════════════
exports.getJobApplicationsForAdmin = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!jobId || jobId === "undefined" || jobId === "null") {
      return res.status(400).json({ success: false, message: "Invalid Job ID parameter" });
    }

    const job = await Job.findById(jobId).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: "Job post not found" });
    }

    const Application = getApplicationModel();
    const applications = await Application.find({ jobId }).sort({ appliedAt: -1 }).lean();

    let recruiter = null;
    if (job.recruiterId) {
      try {
        recruiter = await Recruiter.findById(job.recruiterId)
          .select("name email mobileNumber whatsappNumber designation companyProfile profileImage avatar verified isVerified")
          .lean();
      } catch (e) {
        // ignore invalid ObjectId
      }
    }

    const enriched = applications.map((app) => {
      const currentStatus = app.status || "Applied";
      const allowedNext = WORKFLOW_TRANSITIONS[currentStatus] || [];
      return {
        ...app,
        _id: app._id,
        id: app._id,
        jobId: app.jobId,
        userId: app.userId,
        candidateName: app.candidateName || "Anonymous Candidate",
        candidateEmail: app.candidateEmail || "—",
        candidatePhone: app.candidatePhone || "—",
        candidateCity: app.candidateCity || "Not Provided",
        candidateAvatarUrl: app.candidateAvatarUrl || null,
        candidateSkills: app.candidateSkills || [],
        candidateLanguages: app.candidateLanguages || [],
        candidateJobTitle: app.candidateJobTitle || "",
        candidateExperience: app.candidateExperience || "",
        candidateEducation: app.candidateEducation || {},
        matchPercentage: app.matchPercentage || 0,
        appliedAt: app.appliedAt || app.createdAt,
        status: currentStatus,
        milestones: app.milestones || [],
        recruiter: recruiter
          ? {
              id: recruiter._id,
              name: recruiter.name,
              email: recruiter.email,
              mobileNumber: recruiter.mobileNumber,
              whatsappNumber: recruiter.whatsappNumber,
              designation: recruiter.designation,
              companyName: recruiter.companyProfile?.name || job.companyName,
              profileImageUrl:
                recruiter.profileImage?.url || recruiter.avatar?.url || null,
              verified: recruiter.verified || recruiter.isVerified || false,
            }
          : null,
        jobDetails: {
          id: job._id,
          title: job.title,
          companyName: job.companyName,
          companyLogo: job.companyLogo?.url || job.companyLogo || null,
          location:
            typeof job.location === "object" ? job.location.city : job.location,
          workMode: job.workMode,
          jobType: job.jobType,
        },
        workflow: {
          currentStatus,
          allowedNextStatuses: allowedNext,
          isTerminal: allowedNext.length === 0,
        },
      };
    });

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error("[getJobApplicationsForAdmin]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// JOBS BY SPECIFIC RECRUITER (ADMIN VIEW)
// ═══════════════════════════════════════════════════════════
exports.getRecruiterJobsForAdmin = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    if (!recruiterId || recruiterId === "undefined" || recruiterId === "null") {
      return res.status(400).json({ success: false, message: "Invalid Recruiter ID" });
    }

    const recruiter = await Recruiter.findById(recruiterId).lean();
    if (!recruiter) {
      return res.status(404).json({ success: false, message: "Recruiter not found" });
    }

    const companyName = recruiter.companyProfile?.name || recruiter.companyName;
    const query = {
      $or: [
        { recruiterId },
        { userId: recruiterId },
        { createdBy: recruiterId },
        { postedBy: recruiterId },
      ],
    };
    if (companyName) {
      query.$or.push({ companyName });
      query.$or.push({ company: companyName });
    }

    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();
    const Application = getApplicationModel();

    const enriched = await Promise.all(
      jobs.map(async (j) => {
        const apps = await Application.find({ jobId: j._id.toString() }).select("status").lean();
        const stats = buildStats(apps);

        return {
          _id: j._id,
          id: j._id,
          title: j.title || "Untitled Job",
          companyName: j.companyName || companyName || "",
          status: j.status || "Live",
          approvalStatus: j.approvalStatus || "approved",
          jobType: j.jobType || "Full-Time",
          workMode: j.workMode || "On-site",
          location:
            typeof j.location === "object"
              ? [j.location.city, j.location.state].filter(Boolean).join(", ")
              : j.location || "Remote",
          postedAt: j.postedAt || j.createdAt,
          applicationCount: stats.total,
          pendingCount: stats.pending,
          shortlistedCount: stats.shortlisted,
          interviewCount: stats.interview,
          hiredCount: stats.hired,
          rejectedCount: stats.rejected,
          applicationStats: stats,
        };
      })
    );

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error("[getRecruiterJobsForAdmin]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// ADMIN-POSTED JOBS (jobs with no recruiter OR postedBy=admin)
// ═══════════════════════════════════════════════════════════
exports.getAdminPostedJobs = async (req, res) => {
  try {
    const query = {
      $or: [
        { postedBy: "admin" },
        { postedBy: "Admin" },
        { postedBy: "ADMIN" },
        { createdBy: "admin" },
        { createdBy: "Admin" },
        { source: "admin" },
        { isAdminPost: true },
        { recruiterId: { $exists: false } },
        { recruiterId: null },
        { recruiterId: "" },
      ],
    };

    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();
    const Application = getApplicationModel();

    const enriched = await Promise.all(
      jobs.map(async (j) => {
        const apps = await Application.find({ jobId: j._id.toString() }).select("status").lean();
        const stats = buildStats(apps);

        let locationStr = "Remote";
        if (j.location) {
          if (typeof j.location === "object") {
            locationStr =
              [j.location.city, j.location.state].filter(Boolean).join(", ") || "Remote";
          } else {
            locationStr = j.location;
          }
        }

        return {
          _id: j._id,
          id: j._id,
          title: j.title || "Untitled Job",
          companyName: j.companyName || "Smile Jobs (Admin)",
          companyLogo: j.companyLogo?.url || j.companyLogo || null,
          location: locationStr,
          status: j.status || "Live",
          approvalStatus: j.approvalStatus || "approved",
          jobType: j.jobType || "Full-Time",
          workMode: j.workMode || "On-site",
          postedAt: j.postedAt || j.createdAt,
          createdAt: j.createdAt,
          applicationCount: stats.total,
          pendingCount: stats.pending,
          shortlistedCount: stats.shortlisted,
          hiredCount: stats.hired,
          rejectedCount: stats.rejected,
          applicationStats: stats,
        };
      })
    );

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error("[getAdminPostedJobs]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// UPDATE APPLICATION STATUS (ADMIN WORKFLOW TRANSITION)
// ═══════════════════════════════════════════════════════════
exports.updateApplicationStatusByAdmin = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, hrNotes } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: "New status is required" });
    }

    const validStatuses = Object.keys(WORKFLOW_TRANSITIONS);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${validStatuses.join(", ")}`,
      });
    }

    const Application = getApplicationModel();
    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    // Backward-compatible legacy category mapping
    let category = "pending";
    const lowerS = status.toLowerCase();
    if (lowerS === "applied" || lowerS === "viewed") category = "pending";
    else if (lowerS === "shortlisted" || lowerS === "interview" || lowerS === "offered")
      category = "shortlisted";
    else if (lowerS === "hired") category = "hired";
    else if (lowerS === "rejected" || lowerS === "withdrawn") category = "rejected";

    const milestone = {
      title: `Moved to ${status}`,
      time: new Date(),
      completed: true,
      statusText: hrNotes || "Status updated by Admin Panel",
      isHighlight: ["Shortlisted", "Interview", "Offered", "Hired"].includes(status),
    };

    const updateDoc = {
      $set: {
        status,
        category,
        ...(hrNotes ? { hrNotes } : {}),
      },
      $push: { milestones: milestone },
    };

    const updated = await Application.findByIdAndUpdate(applicationId, updateDoc, {
      new: true,
    }).lean();

    return res.status(200).json({
      success: true,
      message: `Application successfully transitioned to ${status}`,
      data: updated,
    });
  } catch (err) {
    console.error("[updateApplicationStatusByAdmin]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// RECRUITER SELF ENDPOINTS (LEGACY)
// ═══════════════════════════════════════════════════════════
exports.getRecruiterJobsWithStats = async (req, res) => {
  try {
    const recruiterId = req.user?.id || req.user?._id;
    if (!recruiterId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const jobs = await Job.find({ recruiterId: recruiterId.toString() })
      .sort({ createdAt: -1 })
      .lean();
    const Application = getApplicationModel();

    const data = await Promise.all(
      jobs.map(async (j) => {
        const apps = await Application.find({ jobId: j._id.toString() }).select("status").lean();
        const stats = buildStats(apps);

        return {
          ...j,
          applicationCount: stats.total,
          pendingCount: stats.pending,
          shortlistedCount: stats.shortlisted,
          hiredCount: stats.hired,
          rejectedCount: stats.rejected,
          applicationStats: stats,
        };
      })
    );

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("[getRecruiterJobsWithStats]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRecruiterJobApplications = async (req, res) => {
  try {
    const { jobId } = req.params;
    const Application = getApplicationModel();
    const applications = await Application.find({ jobId }).sort({ appliedAt: -1 }).lean();
    return res.status(200).json({ success: true, data: applications });
  } catch (err) {
    console.error("[getRecruiterJobApplications]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};