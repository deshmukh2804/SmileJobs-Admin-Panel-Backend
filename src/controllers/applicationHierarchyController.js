// FILE: backend/src/controllers/applicationHierarchyController.js
const mongoose = require("mongoose");
const { recruiterDbConnection } = require("../config/db");

// Safe lazy initialization of models to avoid OverwriteModelError
const Recruiter = recruiterDbConnection.models.Recruiter 
  || recruiterDbConnection.model("Recruiter", new mongoose.Schema({}, { strict: false, collection: "recruiters" }));

const JobDb = mongoose.connection.useDb("Job_db", { useCache: true });
const Job = JobDb.models.Job 
  || JobDb.model("Job", new mongoose.Schema({}, { strict: false, collection: "jobs" }));

let _ApplicationModel = null;
const getApplicationModel = () => {
  if (_ApplicationModel) return _ApplicationModel;
  
  const uri = process.env.MONGO_URI_APPLICATION 
    || process.env.MONGO_URI_JOBS 
    || process.env.MONGO_URI 
    || process.env.MONGODB_URI 
    || "mongodb://localhost:27017/application_db";
    
  let conn = mongoose.connections.find(c => c.name === "application_db");
  if (!conn) {
    conn = mongoose.createConnection(uri, { dbName: "application_db" });
  }
  
  _ApplicationModel = conn.models.Application 
    || conn.model("Application", new mongoose.Schema({}, { strict: false, collection: "applications" }));
  return _ApplicationModel;
};

// State Machine logic for legal workflow transitions
const WORKFLOW_TRANSITIONS = {
  Applied: ["Viewed", "Shortlisted", "Rejected"],
  Viewed: ["Shortlisted", "Rejected"],
  Shortlisted: ["Interview", "Rejected"],
  Interview: ["Offered", "Rejected"],
  Offered: ["Hired", "Rejected"],
  Hired: [],
  Rejected: [],
  Withdrawn: []
};

const getWorkflowMeta = (status) => {
  const currentStatus = status || "Applied";
  const allowed = WORKFLOW_TRANSITIONS[currentStatus] || [];
  return {
    currentStatus,
    allowedNextStatuses: allowed,
    isTerminal: allowed.length === 0
  };
};

// Sync category based on status updates (legacy backward compatibility)
const getCategoryForStatus = (status) => {
  const pending = ["Applied", "Viewed"];
  const shortlisted = ["Shortlisted", "Interview", "Offered"];
  if (pending.includes(status)) return "pending";
  if (shortlisted.includes(status)) return "shortlisted";
  if (status === "Hired") return "hired";
  return "rejected"; // Rejected, Withdrawn
};

/**
 * Admin: Get all companies with recruiter & job counters
 */
exports.getCompaniesWithStats = async (req, res) => {
  try {
    const recruiters = await Recruiter.find({}).lean();
    const JobModel = Job;
    const ApplicationModel = getApplicationModel();

    const companyMap = new Map();

    for (const r of recruiters) {
      const companyId = r.companyId || r._id.toString();
      const companyName = r.companyProfile?.name || r.companyName || "Independent Poster";
      
      if (!companyMap.has(companyId)) {
        companyMap.set(companyId, {
          companyId,
          companyName,
          companyInitials: companyName.slice(0, 2).toUpperCase(),
          companyLogo: r.companyProfile?.logo?.url || r.avatar?.url || null,
          industry: r.companyProfile?.industry || "Not Specified",
          city: r.companyProfile?.city || "Not Specified",
          state: r.companyProfile?.state || "",
          country: r.companyProfile?.country || "",
          verified: !!(r.isVerified || r.verified),
          isActive: r.isActive !== false,
          recruiterId: r._id.toString(),
          recruiterName: r.name,
          recruiterEmail: r.email,
          profileImageUrl: r.profileImage?.url || r.avatar?.url || null,
          jobCount: 0,
          applicationCount: 0,
          pendingCount: 0,
          shortlistedCount: 0,
          hiredCount: 0,
          rejectedCount: 0,
          createdAt: r.createdAt
        });
      }
    }

    const allJobs = await JobModel.find({}).lean();
    for (const j of allJobs) {
      const recId = j.recruiterId ? j.recruiterId.toString() : null;
      let targetCompany = null;
      
      if (recId) {
        for (const [id, comp] of companyMap.entries()) {
          if (comp.recruiterId === recId) {
            targetCompany = comp;
            break;
          }
        }
      }

      if (targetCompany) {
        targetCompany.jobCount += 1;
        
        const jobIdStr = j._id.toString();
        const appCount = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] } });
        const pending = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Applied", "Viewed"] } });
        const short = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Shortlisted", "Interview", "Offered"] } });
        const hired = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: "Hired" });
        const rej = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Rejected", "Withdrawn"] } });

        targetCompany.applicationCount += appCount;
        targetCompany.pendingCount += pending;
        targetCompany.shortlistedCount += short;
        targetCompany.hiredCount += hired;
        targetCompany.rejectedCount += rej;
      }
    }

    const data = Array.from(companyMap.values());
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("getCompaniesWithStats Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin: Get jobs posted by a company (via recruiter association)
 */
exports.getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const recruiters = await Recruiter.find({ 
      $or: [{ companyId }, { _id: companyId }] 
    }).lean();

    if (!recruiters || recruiters.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const recruiterIds = recruiters.map(r => r._id.toString());
    const jobs = await Job.find({ 
      recruiterId: { $in: recruiterIds.map(id => {
        try { return new mongoose.Types.ObjectId(id); } catch { return id; }
      }).concat(recruiterIds) }
    }).lean();

    const ApplicationModel = getApplicationModel();
    const enriched = [];

    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      const total = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] } });
      const pending = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: "Hired" });

      enriched.push({
        ...j,
        applicationCount: total,
        pendingCount: pending,
        hiredCount: hired
      });
    }

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error("getJobsByCompany Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin: Fetch applicants for a particular Job ID
 */
exports.getJobApplicationsForAdmin = async (req, res) => {
  try {
    const { jobId } = req.params;
    const ApplicationModel = getApplicationModel();
    
    const apps = await ApplicationModel.find({ 
      jobId: { $in: [jobId, { toString: () => jobId }] } 
    }).lean();

    const formatted = apps.map(app => ({
      ...app,
      workflow: getWorkflowMeta(app.status)
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    console.error("getJobApplicationsForAdmin Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin: Fetch jobs posted by a specific recruiter profile
 */
exports.getRecruiterJobsForAdmin = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    const queryId = recruiterId;

    const jobs = await Job.find({
      recruiterId: { $in: [queryId, { toString: () => queryId }] }
    }).lean();

    const ApplicationModel = getApplicationModel();
    const enriched = [];

    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      const total = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] } });
      const pending = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: "Hired" });

      enriched.push({
        ...j,
        applicationCount: total,
        pendingCount: pending,
        hiredCount: hired
      });
    }

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error("getRecruiterJobsForAdmin Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin: Get ALL jobs posted directly by Admin panel with aggressive fallback detection
 */
exports.getAdminPostedJobs = async (req, res) => {
  try {
    const JobModel = Job;
    const ApplicationModel = getApplicationModel();

    // Aggressive multi-field check to scan for jobs lacking active recruiter associations or explicitly flagged as Admin
    const query = {
      $or: [
        { postedBy: { $regex: /^admin$/i } },
        { createdBy: { $regex: /^admin$/i } },
        { source: { $regex: /^admin$/i } },
        { isAdminPost: true },
        { isAdmin: true },
        { recruiterId: null },
        { recruiterId: "" },
        { recruiterId: { $exists: false } }
      ]
    };

    const totalCount = await JobModel.countDocuments({});
    const jobs = await JobModel.find(query).lean();

    console.log(`[AdminJobs API] Searched Database. Total jobs in DB: ${totalCount}. Matched Admin criteria: ${jobs.length}`);

    const enriched = [];
    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      const total = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] } });
      const pending = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: "Hired" });

      enriched.push({
        ...j,
        applicationCount: total,
        pendingCount: pending,
        hiredCount: hired
      });
    }

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error("getAdminPostedJobs Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin: Mutate status workflow with legacy validation sync
 */
exports.updateApplicationStatusByAdmin = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, hrNotes } = req.body;

    const ApplicationModel = getApplicationModel();
    const app = await ApplicationModel.findById(applicationId);

    if (!app) {
      return res.status(404).json({ success: false, message: "Application record not found" });
    }

    // Ensure state machine allows the change
    const meta = getWorkflowMeta(app.status);
    if (!meta.allowedNextStatuses.includes(status) && app.status !== status) {
      return res.status(400).json({
        success: false,
        message: `Status transition from '${app.status}' to '${status}' is prohibited.`
      });
    }

    const category = getCategoryForStatus(status);

    const updated = await ApplicationModel.findByIdAndUpdate(
      applicationId,
      {
        $set: {
          status,
          category,
          hrNotes: hrNotes || app.hrNotes || "Updated by Admin Panel"
        },
        $push: {
          milestones: {
            title: `Moved to ${status}`,
            time: new Date().toLocaleString(),
            completed: true,
            statusText: status,
            isHighlight: status === "Hired" || status === "Rejected"
          }
        }
      },
      { new: true }
    ).lean();

    return res.status(200).json({
      success: true,
      data: {
        ...updated,
        workflow: getWorkflowMeta(status)
      }
    });
  } catch (err) {
    console.error("updateApplicationStatusByAdmin Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// RECRUITER SELF MANAGEMENT ENDPOINTS (LEGACY BACKWARD COMPATIBLE)
// ═══════════════════════════════════════════════════════════════
exports.getRecruiterJobsWithStats = async (req, res) => {
  try {
    const recruiterId = req.user.id;
    const jobs = await Job.find({ recruiterId }).lean();
    const ApplicationModel = getApplicationModel();

    const data = [];
    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      const total = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] } });
      const pending = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await ApplicationModel.countDocuments({ jobId: { $in: [j._id, jobIdStr] }, status: "Hired" });

      data.push({
        ...j,
        applicationCount: total,
        pendingCount: pending,
        hiredCount: hired
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRecruiterJobApplications = async (req, res) => {
  try {
    const { jobId } = req.params;
    const ApplicationModel = getApplicationModel();
    const apps = await ApplicationModel.find({ jobId }).lean();

    const formatted = apps.map(app => ({
      ...app,
      workflow: getWorkflowMeta(app.status)
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};