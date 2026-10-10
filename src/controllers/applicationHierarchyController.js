// FILE: backend/src/controllers/applicationHierarchyController.js
// ═══════════════════════════════════════════════════════════════
// APPLICATION HIERARCHY CONTROLLER
// Provides drill-down navigation: Company → Job → Application
// Uses Option A: groups by recruiterId → companyId chain
// No schema changes required.
// ═══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const Company = require("../models/Company");
const Recruiter = require("../models/Recruiter");
const Job = require("../models/Job");
const Application = require("../models/Application"); // Corrected to uppercase 'A' to match your models/Application.js

// ═══════════════════════════════════════════════════════════════
// HELPER: Get all recruiter ObjectIds belonging to a company
// ═══════════════════════════════════════════════════════════════
const getRecruiterIdsForCompany = async (companyId) => {
  const recruiters = await Recruiter.find({ companyId })
    .select("_id")
    .lean();
  return recruiters.map((r) => r._id);
};

// ═══════════════════════════════════════════════════════════════
// HELPER: Get all recruiter ObjectIds for multiple companies
// Returns Map<companyIdString, recruiterIdObject[]>
// ═══════════════════════════════════════════════════════════════
const getRecruiterIdsForCompanies = async (companyIds) => {
  if (!companyIds.length) return new Map();

  const recruiters = await Recruiter.find({
    companyId: { $in: companyIds },
  })
    .select("_id companyId")
    .lean();

  const map = new Map();
  companyIds.forEach((cid) => map.set(cid.toString(), []));

  recruiters.forEach((r) => {
    if (r.companyId) {
      const key = r.companyId.toString();
      if (map.has(key)) {
        map.get(key).push(r._id);
      }
    }
  });

  return map;
};

// ═══════════════════════════════════════════════════════════════
// HELPER: Get application counts grouped by jobId
// Uses MongoDB aggregation for scale (500K+ records)
// ═══════════════════════════════════════════════════════════════
const getApplicationCountsByJobIds = async (jobIds) => {
  if (!jobIds.length) return new Map();

  const objectIdJobIds = jobIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) =>
      typeof id === "string" ? new mongoose.Types.ObjectId(id) : id
    );

  if (!objectIdJobIds.length) return new Map();

  const result = await Application.aggregate([
    { $match: { jobId: { $in: objectIdJobIds } } },
    {
      $group: {
        _id: "$jobId",
        total: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $eq: ["$status", "Applied"] }, 1, 0] },
        },
        viewed: {
          $sum: { $cond: [{ $eq: ["$status", "Viewed"] }, 1, 0] },
        },
        shortlisted: {
          $sum: { $cond: [{ $eq: ["$status", "Shortlisted"] }, 1, 0] },
        },
        interview: {
          $sum: { $cond: [{ $eq: ["$status", "Interview"] }, 1, 0] },
        },
        offered: {
          $sum: { $cond: [{ $eq: ["$status", "Offered"] }, 1, 0] },
        },
        hired: {
          $sum: { $cond: [{ $eq: ["$status", "Hired"] }, 1, 0] },
        },
        rejected: {
          $sum: { $cond: [{ $eq: ["$status", "Rejected"] }, 1, 0] },
        },
      },
    },
  ]);

  const map = new Map();
  result.forEach((r) => {
    map.set(r._id.toString(), {
      total: r.total,
      pending: r.pending,
      viewed: r.viewed,
      shortlisted: r.shortlisted,
      interview: r.interview,
      offered: r.offered,
      hired: r.hired,
      rejected: r.rejected,
    });
  });

  return map;
};

// ═══════════════════════════════════════════════════════════════
// ADMIN LEVEL 1: Get all companies with job & application stats
// GET /api/v1/applications/hierarchy/companies
// ═══════════════════════════════════════════════════════════════
const getCompaniesWithStats = async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 20,
      sortBy = "name",
      sortOrder = "asc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (search && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { name: { $regex: s, $options: "i" } },
        { industry: { $regex: s, $options: "i" } },
        { "address.city": { $regex: s, $options: "i" } },
      ];
    }

    const sortObj = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [companies, totalCompanies] = await Promise.all([
      Company.find(filter)
        .select(
          "name logo industry address website verified isActive recruiterId"
        )
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Company.countDocuments(filter),
    ]);

    if (companies.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCompanies,
          pages: Math.ceil(totalCompanies / limitNum) || 1,
        },
      });
    }

    const companyIds = companies.map((c) => c._id);
    const recruiterMap = await getRecruiterIdsForCompanies(companyIds);

    const allRecruiterIds = [];
    recruiterMap.forEach((rIds) => {
      rIds.forEach((rid) => allRecruiterIds.push(rid));
    });

    companies.forEach((c) => {
      if (
        c.recruiterId &&
        !allRecruiterIds.some(
          (rid) => rid.toString() === c.recruiterId.toString()
        )
      ) {
        allRecruiterIds.push(c.recruiterId);
      }
    });

    let jobsForRecruiters = [];
    if (allRecruiterIds.length > 0) {
      jobsForRecruiters = await Job.find({
        recruiterId: { $in: allRecruiterIds },
      })
        .select("_id recruiterId")
        .lean();
    }

    const recruiterJobsMap = new Map();
    jobsForRecruiters.forEach((j) => {
      if (j.recruiterId) {
        const key = j.recruiterId.toString();
        if (!recruiterJobsMap.has(key)) recruiterJobsMap.set(key, []);
        recruiterJobsMap.get(key).push(j._id.toString());
      }
    });

    const companyJobsMap = new Map();
    companies.forEach((c) => {
      const cid = c._id.toString();
      const rIds = recruiterMap.get(cid) || [];
      const allRIds = [...rIds];
      if (
        c.recruiterId &&
        !allRIds.some(
          (rid) => rid.toString() === c.recruiterId.toString()
        )
      ) {
        allRIds.push(c.recruiterId);
      }

      const jobIds = [];
      allRIds.forEach((rid) => {
        const rJobs = recruiterJobsMap.get(rid.toString()) || [];
        jobIds.push(...rJobs);
      });
      companyJobsMap.set(cid, jobIds);
    });

    const allJobIds = jobsForRecruiters.map((j) => j._id.toString());
    const appCountsMap = await getApplicationCountsByJobIds(allJobIds);

    const data = companies.map((c) => {
      const cid = c._id.toString();
      const jobIds = companyJobsMap.get(cid) || [];
      const recruiterIds = recruiterMap.get(cid) || [];

      let applicationCount = 0;
      let pendingCount = 0;
      jobIds.forEach((jid) => {
        const counts = appCountsMap.get(jid);
        if (counts) {
          applicationCount += counts.total;
          pendingCount += counts.pending;
        }
      });

      const initials = (c.name || "??")
        .split(" ")
        .map((w) => (w && w[0]) || "")
        .join("")
        .toUpperCase()
        .slice(0, 2);

      return {
        companyId: cid,
        companyName: c.name,
        companyLogo: c.logo?.url || null,
        companyInitials: initials,
        industry: c.industry || "",
        city: c.address?.city || "",
        state: c.address?.state || "",
        website: c.website || "",
        verified: c.verified || false,
        isActive: c.isActive !== false,
        recruiterCount: recruiterIds.length,
        jobCount: jobIds.length,
        applicationCount,
        pendingCount,
      };
    });

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCompanies,
        pages: Math.ceil(totalCompanies / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("Get Companies With Stats Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching company hierarchy",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// ADMIN LEVEL 2: Get jobs for a specific company with app stats
// GET /api/v1/applications/hierarchy/companies/:companyId/jobs
// ═══════════════════════════════════════════════════════════════
const getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company ID",
      });
    }

    const company = await Company.findById(companyId)
      .select("name recruiterId")
      .lean();
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const {
      search,
      status,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const recruiterIds = await getRecruiterIdsForCompany(
      new mongoose.Types.ObjectId(companyId)
    );

    if (
      company.recruiterId &&
      !recruiterIds.some(
        (rid) => rid.toString() === company.recruiterId.toString()
      )
    ) {
      recruiterIds.push(company.recruiterId);
    }

    if (recruiterIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        companyName: company.name,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          pages: 1,
        },
      });
    }

    const filter = { recruiterId: { $in: recruiterIds } };
    if (search && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { title: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
        { department: { $regex: s, $options: "i" } },
      ];
    }
    if (status && status !== "all" && status !== "All") {
      filter.status = status;
    }

    const sortObj = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [jobs, totalJobs] = await Promise.all([
      Job.find(filter)
        .select(
          "_id title recruiterId companyName status isActive jobType workMode location salary experience postedAt createdAt approvalStatus"
        )
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(filter),
    ]);

    if (jobs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        companyName: company.name,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalJobs,
          pages: Math.ceil(totalJobs / limitNum) || 1,
        },
      });
    }

    const jobIds = jobs.map((j) => j._id.toString());
    const appCountsMap = await getApplicationCountsByJobIds(jobIds);

    const recruiterDocs = await Recruiter.find({
      _id: { $in: recruiterIds },
    })
      .select("_id name")
      .lean();
    const recruiterNameMap = new Map();
    recruiterDocs.forEach((r) => {
      recruiterNameMap.set(r._id.toString(), r.name);
    });

    const data = jobs.map((j) => {
      const jid = j._id.toString();
      const counts = appCountsMap.get(jid) || {
        total: 0,
        pending: 0,
        shortlisted: 0,
        interview: 0,
        hired: 0,
        rejected: 0,
      };

      let locationDisplay = "";
      if (j.location) {
        const parts = [j.location.city, j.location.state].filter(Boolean);
        locationDisplay = parts.join(", ");
      }

      let salaryRange = "Not Disclosed";
      if (j.salary && (j.salary.min || j.salary.max)) {
        const symbol =
          j.salary.currency === "INR" ? "₹" : j.salary.currency || "₹";
        salaryRange = `${symbol} ${j.salary.min || 0} - ${j.salary.max || 0}`;
      }

      return {
        jobId: jid,
        title: j.title,
        companyName: j.companyName,
        status: j.status || "Live",
        isActive: j.isActive !== false,
        jobType: j.jobType || "Full-Time",
        workMode: j.workMode || "On-site",
        location: locationDisplay,
        salaryRange,
        experienceText: j.experience?.text || "",
        approvalStatus: j.approvalStatus || "approved",
        recruiterName:
          recruiterNameMap.get(j.recruiterId?.toString()) || "Unknown",
        recruiterId: j.recruiterId?.toString() || null,
        applicationCount: counts.total,
        pendingCount: counts.pending,
        shortlistedCount: counts.shortlisted,
        interviewCount: counts.interview,
        hiredCount: counts.hired,
        rejectedCount: counts.rejected,
        postedAt: j.postedAt || j.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      data,
      companyName: company.name,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalJobs,
        pages: Math.ceil(totalJobs / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("Get Jobs By Company Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching jobs for company",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// RECRUITER: Get authenticated recruiter's jobs with app stats
// GET /api/v1/applications/hierarchy/recruiter/jobs
// ═══════════════════════════════════════════════════════════════
const getRecruiterJobsWithStats = async (req, res) => {
  try {
    const authUser = req.authUser;
    if (!authUser || authUser.role !== "recruiter") {
      return res.status(403).json({
        success: false,
        message: "Recruiter access required",
      });
    }

    const recruiterId = new mongoose.Types.ObjectId(authUser.id);

    const {
      search,
      status,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const filter = { recruiterId };
    if (search && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { title: { $regex: s, $options: "i" } },
        { "location.city": { $regex: s, $options: "i" } },
      ];
    }
    if (status && status !== "all" && status !== "All") {
      filter.status = status;
    }

    const sortObj = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [jobs, totalJobs] = await Promise.all([
      Job.find(filter)
        .select(
          "_id title companyName status isActive jobType workMode location salary postedAt createdAt"
        )
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(filter),
    ]);

    const jobIds = jobs.map((j) => j._id.toString());
    const appCountsMap = await getApplicationCountsByJobIds(jobIds);

    const data = jobs.map((j) => {
      const jid = j._id.toString();
      const counts = appCountsMap.get(jid) || {
        total: 0,
        pending: 0,
        shortlisted: 0,
        interview: 0,
        hired: 0,
        rejected: 0,
      };

      let locationDisplay = "";
      if (j.location) {
        const parts = [j.location.city, j.location.state].filter(Boolean);
        locationDisplay = parts.join(", ");
      }

      return {
        jobId: jid,
        title: j.title,
        companyName: j.companyName,
        status: j.status || "Live",
        isActive: j.isActive !== false,
        jobType: j.jobType || "Full-Time",
        workMode: j.workMode || "On-site",
        location: locationDisplay,
        applicationCount: counts.total,
        pendingCount: counts.pending,
        shortlistedCount: counts.shortlisted,
        interviewCount: counts.interview,
        hiredCount: counts.hired,
        rejectedCount: counts.rejected,
        postedAt: j.postedAt || j.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalJobs,
        pages: Math.ceil(totalJobs / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("Get Recruiter Jobs Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching recruiter jobs",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// RECRUITER: Get applications for a specific job (with ownership)
// GET /api/v1/applications/hierarchy/recruiter/jobs/:jobId/applications
// ═══════════════════════════════════════════════════════════════
const getRecruiterJobApplications = async (req, res) => {
  try {
    const authUser = req.authUser;
    if (!authUser || authUser.role !== "recruiter") {
      return res.status(403).json({
        success: false,
        message: "Recruiter access required",
      });
    }

    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID",
      });
    }

    const job = await Job.findById(jobId)
      .select("recruiterId title companyName")
      .lean();

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (job.recruiterId?.toString() !== authUser.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this job's applications",
      });
    }

    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = "appliedAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const filter = { jobId: new mongoose.Types.ObjectId(jobId) };
    if (status && status !== "all") filter.status = status;
    if (search && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { candidateName: { $regex: s, $options: "i" } },
        { candidateEmail: { $regex: s, $options: "i" } },
        { candidatePhone: { $regex: s, $options: "i" } },
      ];
    }

    const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(filter),
    ]);

    const statusCounts = await Application.aggregate([
      { $match: { jobId: new mongoose.Types.ObjectId(jobId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const countsMap = {};
    statusCounts.forEach((sc) => {
      countsMap[sc._id] = sc.count;
    });

    res.status(200).json({
      success: true,
      data: applications,
      jobTitle: job.title,
      companyName: job.companyName,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      counts: countsMap,
    });
  } catch (error) {
    console.error("Get Recruiter Job Applications Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching applications",
    });
  }
};

module.exports = {
  getCompaniesWithStats,
  getJobsByCompany,
  getRecruiterJobsWithStats,
  getRecruiterJobApplications,
};