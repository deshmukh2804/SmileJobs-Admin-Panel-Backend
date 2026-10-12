// FILE: backend/src/controllers/applicationHierarchyController.js
const mongoose = require("mongoose");
const Recruiter = require("../models/Recruiter");
const Job = require("../models/Job");
const Application = require("../models/Application");

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

// ════════════════════════════════════════════════════════════════
// ✅ NEW HELPER: Convert location object → readable string
// ════════════════════════════════════════════════════════════════
const formatLocationString = (loc) => {
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  if (typeof loc === "object") {
    const parts = [loc.city, loc.state, loc.country].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
    if (loc.address) return loc.address;
  }
  return "";
};

// ════════════════════════════════════════════════════════════════
// ✅ NEW HELPER: Convert salary object → readable string
// ════════════════════════════════════════════════════════════════
const formatSalaryString = (sal) => {
  if (!sal) return "Not Disclosed";
  if (typeof sal === "string") return sal;
  if (typeof sal === "object") {
    const min = sal.min || 0;
    const max = sal.max || 0;
    const currency = sal.currency || "INR";
    const symbol = currency === "INR" ? "₹" : currency;
    const period = sal.period || "month";
    if (min || max) {
      return `${symbol}${min} - ${symbol}${max} / ${period}`;
    }
  }
  return "Not Disclosed";
};

// ════════════════════════════════════════════════════════════════
// ✅ NEW HELPER: Derive recruiter name (admin jobs fallback)
// ════════════════════════════════════════════════════════════════
const deriveRecruiterName = (j) => {
  return (
    j.recruiterName ||
    j.postedByName ||
    (j.postedBy === "admin" ? "Smile Jobs (Admin)" : "") ||
    j.contactPerson?.name ||
    "—"
  );
};

/**
 * Admin: Get all companies with recruiter & job counters
 */
exports.getCompaniesWithStats = async (req, res) => {
  try {
    const recruiters = await Recruiter.find({}).lean();
    const companyMap = new Map();

    for (const r of recruiters) {
      const companyId = r.companyId || r._id.toString();
      const companyName = r.companyProfile?.name || r.companyName || "Independent Poster";
      
      if (!companyMap.has(companyId)) {
        companyMap.set(companyId, {
          companyId: companyId.toString(),
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

    const allJobs = await Job.find({}).lean();
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
        let jobObjectId;
        try { jobObjectId = new mongoose.Types.ObjectId(jobIdStr); } catch (e) { jobObjectId = null; }

        const jobIdsArray = [j._id, jobIdStr, jobObjectId].filter(Boolean);

        const appCount = await Application.countDocuments({ jobId: { $in: jobIdsArray } });
        const pending = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Applied", "Viewed"] } });
        const short = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Shortlisted", "Interview", "Offered"] } });
        const hired = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: "Hired" });
        const rej = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Rejected", "Withdrawn"] } });

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
 * ✅ FIXED: location and salary returned as readable strings
 */
exports.getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const queryConditions = [];
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      const objId = new mongoose.Types.ObjectId(companyId);
      queryConditions.push({ companyId: objId });
      queryConditions.push({ _id: objId });
    }
    queryConditions.push({ companyId: String(companyId) });
    queryConditions.push({ _id: String(companyId) });

    const recruiters = await Recruiter.find({ $or: queryConditions }).lean();

    if (!recruiters || recruiters.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const recruiterIds = recruiters.map(r => r._id.toString());
    const recruiterObjectIds = recruiterIds.map(id => {
      try { return new mongoose.Types.ObjectId(id); } catch { return null; }
    }).filter(Boolean);

    // Build a map of recruiterId → recruiter info so we can derive recruiterName for admin UI
    const recruiterMap = {};
    for (const r of recruiters) {
      recruiterMap[r._id.toString()] = {
        name: r.name || "",
        email: r.email || "",
        companyName: r.companyProfile?.name || r.companyName || ""
      };
    }

    const jobs = await Job.find({ 
      recruiterId: { $in: [...recruiterObjectIds, ...recruiterIds] }
    }).lean();

    const enriched = [];

    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      let jobObjectId;
      try { jobObjectId = new mongoose.Types.ObjectId(jobIdStr); } catch (e) { jobObjectId = null; }

      const jobIdsArray = [j._id, jobIdStr, jobObjectId].filter(Boolean);

      const total = await Application.countDocuments({ jobId: { $in: jobIdsArray } });
      const pending = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: "Hired" });

      // ✅ Derive clean readable fields
      const recId = j.recruiterId ? j.recruiterId.toString() : null;
      const recInfo = recId ? recruiterMap[recId] : null;

      const recruiterName = (recInfo && recInfo.name) || deriveRecruiterName(j);
      const locationString = formatLocationString(j.location);
      const salaryString = formatSalaryString(j.salary);

      enriched.push({
        // original job fields preserved
        ...j,
        // ✅ Add normalized string fields the frontend expects
        jobId: jobIdStr,
        id: jobIdStr,
        location: locationString,          // ← string, no more [object Object]
        locationObject: j.location || null, // keep original object for anyone needing it
        salary: salaryString,              // ← string
        salaryRange: salaryString,
        salaryObject: j.salary || null,
        recruiterName,
        recruiterEmail: recInfo?.email || j.recruiterEmail || "",
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
    
    let jobObjectId;
    try { jobObjectId = new mongoose.Types.ObjectId(jobId); } catch (e) { jobObjectId = null; }

    const jobIdsArray = [jobId, jobObjectId].filter(Boolean);

    const apps = await Application.find({ 
      jobId: { $in: jobIdsArray } 
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
 * ✅ FIXED: location + salary strings + recruiter name
 */
exports.getRecruiterJobsForAdmin = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    let recObjectId;
    try { recObjectId = new mongoose.Types.ObjectId(recruiterId); } catch (e) { recObjectId = null; }

    // Resolve recruiter for name/email derivation
    const recruiterDoc = await Recruiter.findOne({
      $or: [
        { _id: recObjectId },
        { _id: recruiterId }
      ]
    }).lean().catch(() => null);

    const jobs = await Job.find({
      recruiterId: { $in: [recruiterId, recObjectId].filter(Boolean) }
    }).lean();

    const enriched = [];

    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      let jobObjectId;
      try { jobObjectId = new mongoose.Types.ObjectId(jobIdStr); } catch (e) { jobObjectId = null; }

      const jobIdsArray = [j._id, jobIdStr, jobObjectId].filter(Boolean);

      const total = await Application.countDocuments({ jobId: { $in: jobIdsArray } });
      const pending = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: "Hired" });

      const recruiterName = recruiterDoc?.name || deriveRecruiterName(j);
      const locationString = formatLocationString(j.location);
      const salaryString = formatSalaryString(j.salary);

      enriched.push({
        ...j,
        jobId: jobIdStr,
        id: jobIdStr,
        location: locationString,
        locationObject: j.location || null,
        salary: salaryString,
        salaryRange: salaryString,
        salaryObject: j.salary || null,
        recruiterName,
        recruiterEmail: recruiterDoc?.email || j.recruiterEmail || "",
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
 * Admin: Get ALL jobs posted directly by Admin panel with fallback detection
 * Enhanced to detect multiple possible admin-post identifiers in the database.
 * ✅ FIXED: location + salary returned as readable strings
 */
exports.getAdminPostedJobs = async (req, res) => {
  try {
    // Enhanced detection: try multiple fields where an admin post marker could live
    const query = {
      $or: [
        { postedBy: { $regex: /^admin$/i } },
        { createdBy: { $regex: /^admin$/i } },
        { source: { $regex: /^admin$/i } },
        { postedByType: { $regex: /^admin$/i } },
        { creatorType: { $regex: /^admin$/i } },
        { isAdminPost: true },
        { isAdmin: true },
        { adminPosted: true },
        { recruiterId: null },
        { recruiterId: "" },
        { recruiterId: { $exists: false } }
      ]
    };

    const totalCount = await Job.countDocuments({});
    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();

    console.log(`[AdminJobs API] Scanned DB. Total jobs: ${totalCount}. Admin-matched: ${jobs.length}`);

    const enriched = [];
    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      let jobObjectId;
      try { jobObjectId = new mongoose.Types.ObjectId(jobIdStr); } catch (e) { jobObjectId = null; }

      const jobIdsArray = [j._id, jobIdStr, jobObjectId].filter(Boolean);

      const total = await Application.countDocuments({ jobId: { $in: jobIdsArray } });
      const pending = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: "Hired" });

      const locationString = formatLocationString(j.location);
      const salaryString = formatSalaryString(j.salary);
      const recruiterName = deriveRecruiterName(j);

      // Provide a normalized shape so the frontend doesn't crash on missing fields
      enriched.push({
        _id: j._id,
        id: jobIdStr,
        jobId: jobIdStr,
        title: j.title || "Untitled Job",
        companyName: j.companyName || j.company || "Admin Platform",
        companyLogo: j.companyLogo?.url || j.companyLogo || null,
        status: j.status || "Live",
        approvalStatus: j.approvalStatus || "approved",
        jobType: j.jobType || "Full-Time",
        workMode: j.workMode || "On-site",
        postedAt: j.postedAt || j.createdAt,
        createdByAdmin: true,
        recruiterId: j.recruiterId || null,
        recruiterName,                   // ✅ derived (Smile Jobs for admin posts)
        location: locationString,        // ✅ string, no [object Object]
        locationObject: j.location || null,
        salary: salaryString,            // ✅ string
        salaryRange: salaryString,
        salaryObject: j.salary || null,
        applicationCount: total,
        pendingCount: pending,
        hiredCount: hired,
        // preserve full original fields for later use
        _raw: j
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

    const app = await Application.findById(applicationId);

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

    const updated = await Application.findByIdAndUpdate(
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
    const recruiterId = req.authUser?.id || req.user?.id;
    let recObjectId;
    try { recObjectId = new mongoose.Types.ObjectId(recruiterId); } catch (e) { recObjectId = null; }

    // Resolve recruiter doc for name mapping
    const recruiterDoc = await Recruiter.findOne({
      $or: [{ _id: recObjectId }, { _id: recruiterId }]
    }).lean().catch(() => null);

    const jobs = await Job.find({ 
      recruiterId: { $in: [recruiterId, recObjectId].filter(Boolean) } 
    }).lean();

    const data = [];
    for (const j of jobs) {
      const jobIdStr = j._id.toString();
      let jobObjectId;
      try { jobObjectId = new mongoose.Types.ObjectId(jobIdStr); } catch (e) { jobObjectId = null; }

      const jobIdsArray = [j._id, jobIdStr, jobObjectId].filter(Boolean);

      const total = await Application.countDocuments({ jobId: { $in: jobIdsArray } });
      const pending = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: { $in: ["Applied", "Viewed"] } });
      const hired = await Application.countDocuments({ jobId: { $in: jobIdsArray }, status: "Hired" });

      const locationString = formatLocationString(j.location);
      const salaryString = formatSalaryString(j.salary);
      const recruiterName = recruiterDoc?.name || deriveRecruiterName(j);

      data.push({
        ...j,
        jobId: jobIdStr,
        id: jobIdStr,
        location: locationString,
        locationObject: j.location || null,
        salary: salaryString,
        salaryRange: salaryString,
        salaryObject: j.salary || null,
        recruiterName,
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
    let jobObjectId;
    try { jobObjectId = new mongoose.Types.ObjectId(jobId); } catch (e) { jobObjectId = null; }

    const jobIdsArray = [jobId, jobObjectId].filter(Boolean);

    const apps = await Application.find({ 
      jobId: { $in: jobIdsArray } 
    }).lean();

    const formatted = apps.map(app => ({
      ...app,
      workflow: getWorkflowMeta(app.status)
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};