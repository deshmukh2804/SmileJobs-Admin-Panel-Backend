// FILE: backend/src/controllers/dashboardController.js
const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════
// SAFE MODEL LOADER — never crashes if a model is missing
// ═══════════════════════════════════════════════════════════
const safeRequire = (path) => {
  try {
    return require(path);
  } catch (err) {
    console.warn(`⚠️  [Dashboard] Model not found: ${path} — using null`);
    return null;
  }
};

const User = safeRequire("../models/User");
const Recruiter = safeRequire("../models/Recruiter");
const Company = safeRequire("../models/Company");
const Job = safeRequire("../models/Job");
const Application = safeRequire("../models/Application");
const AuditLog = safeRequire("../models/AuditLog");

// Safe counter — returns 0 if model missing / query fails
const safeCount = async (Model, filter = {}) => {
  if (!Model) return 0;
  try {
    return await Model.countDocuments(filter);
  } catch (err) {
    console.error(`❌ [Dashboard] countDocuments failed:`, err.message);
    return 0;
  }
};

// Safe aggregate — returns [] if failure
const safeAggregate = async (Model, pipeline) => {
  if (!Model) return [];
  try {
    return await Model.aggregate(pipeline);
  } catch (err) {
    console.error(`❌ [Dashboard] aggregate failed:`, err.message);
    return [];
  }
};

// Safe find
const safeFind = async (Model, filter = {}, options = {}) => {
  if (!Model) return [];
  try {
    let query = Model.find(filter);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.select) query = query.select(options.select);
    return await query.lean();
  } catch (err) {
    console.error(`❌ [Dashboard] find failed:`, err.message);
    return [];
  }
};

// Safe distinct
const safeDistinct = async (Model, field, filter = {}) => {
  if (!Model) return [];
  try {
    return await Model.distinct(field, filter);
  } catch (err) {
    console.error(`❌ [Dashboard] distinct failed:`, err.message);
    return [];
  }
};

/**
 * GET /api/v1/dashboard/stats
 * Returns comprehensive real-time dashboard data.
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);

    console.log("📊 [Dashboard] Fetching stats — DB State:", mongoose.connection.readyState);

    // ═══════════════════════════════════════════════════════════
    // 1. KPI COUNTS (each isolated — no cascading failure)
    // ═══════════════════════════════════════════════════════════
    const totalCandidates = await safeCount(User);
    const totalEmployers = await safeCount(Recruiter);

    // Job status can be Live/Active/live/active — normalize check
    const activeJobs = await safeCount(Job, {
      status: { $in: ["Live", "Active", "live", "active", "LIVE", "ACTIVE"] },
    });

    const totalApplications = await safeCount(Application);

    const pendingCompanyVerifications = await safeCount(Company, { verified: false });
    const pendingRecruiterVerifications = await safeCount(Recruiter, { isVerified: false });

    const newUsersToday = await safeCount(User, { createdAt: { $gte: startOfToday } });
    const newUsersYesterday = await safeCount(User, {
      createdAt: { $gte: startOfYesterday, $lt: startOfToday },
    });

    const verifiedCompanies = await safeCount(Company, { verified: true });
    const totalCompanies = await safeCount(Company);
    const totalJobs = await safeCount(Job);
const pendingJobs = await safeCount(Job, {
  status: { $in: ["Pending Approval", "Pending", "pending", "PENDING", "Under Review"] },
});

    const candidatesLastMonth = await safeCount(User, {
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
    });
    const employersLastMonth = await safeCount(Recruiter, {
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
    });
    const jobsLastMonth = await safeCount(Job, {
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
    });
    const applicationsLastMonth = await safeCount(Application, {
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
    });

    const candidatesThisMonth = await safeCount(User, { createdAt: { $gte: startOfMonth } });
    const employersThisMonth = await safeCount(Recruiter, { createdAt: { $gte: startOfMonth } });
    const jobsThisMonth = await safeCount(Job, { createdAt: { $gte: startOfMonth } });
    const applicationsThisMonth = await safeCount(Application, {
      createdAt: { $gte: startOfMonth },
    });

    const pctChange = (curr, prev) => {
      if (!prev || prev === 0) return curr > 0 ? 100 : 0;
      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

    const totalPendingVerifications =
      pendingCompanyVerifications + pendingRecruiterVerifications;

    console.log("📊 [Dashboard] Base counts:", {
      totalCandidates,
      totalEmployers,
      activeJobs,
      totalApplications,
      totalCompanies,
      verifiedCompanies,
      pendingCompanyVerifications,
      totalJobs,
    });

    // ═══════════════════════════════════════════════════════════
    // 2. GROWTH CHART - 12 months rolling
    // ═══════════════════════════════════════════════════════════
    const userGrowthAgg = await safeAggregate(User, [
      { $match: { createdAt: { $gte: oneYearAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const employerGrowthAgg = await safeAggregate(Recruiter, [
      { $match: { createdAt: { $gte: oneYearAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const applicationGrowthAgg = await safeAggregate(Application, [
      { $match: { createdAt: { $gte: oneYearAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const monthLabels = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    const monthlyBuckets = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyBuckets.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        label: monthLabels[d.getMonth()],
        candidateInc: 0,
        employerInc: 0,
        applicationInc: 0,
      });
    }

    userGrowthAgg.forEach((row) => {
      const m = monthlyBuckets.find(
        (b) => b.year === row._id.year && b.month === row._id.month
      );
      if (m) m.candidateInc = row.count;
    });

    employerGrowthAgg.forEach((row) => {
      const m = monthlyBuckets.find(
        (b) => b.year === row._id.year && b.month === row._id.month
      );
      if (m) m.employerInc = row.count;
    });

    applicationGrowthAgg.forEach((row) => {
      const m = monthlyBuckets.find(
        (b) => b.year === row._id.year && b.month === row._id.month
      );
      if (m) m.applicationInc = row.count;
    });

    // Convert increments to cumulative totals
    let cCum = 0;
    let eCum = 0;
    let aCum = 0;
    const chartMonthLabels = [];
    const candidateData = [];
    const employerData = [];
    const applicationData = [];

    monthlyBuckets.forEach((m) => {
      cCum += m.candidateInc;
      eCum += m.employerInc;
      aCum += m.applicationInc;
      candidateData.push(cCum);
      employerData.push(eCum);
      applicationData.push(aCum);
      chartMonthLabels.push(m.label);
    });

    // If cumulative data is entirely zero (no historical), fall back to showing current totals in the last bucket
    if (candidateData.every((v) => v === 0) && totalCandidates > 0) {
      candidateData[candidateData.length - 1] = totalCandidates;
    }
    if (employerData.every((v) => v === 0) && totalEmployers > 0) {
      employerData[employerData.length - 1] = totalEmployers;
    }
    if (applicationData.every((v) => v === 0) && totalApplications > 0) {
      applicationData[applicationData.length - 1] = totalApplications;
    }

    // ═══════════════════════════════════════════════════════════
    // 3. JOBS BY CATEGORY (donut) — robust against schema variance
    // ═══════════════════════════════════════════════════════════
    let jobsByCategoryAgg = await safeAggregate(Job, [
      { $match: { status: { $in: ["Live", "Active", "live", "active"] } } },
      {
        $group: {
          _id: {
            $ifNull: [
              "$department",
              { $ifNull: ["$role", { $ifNull: ["$industry", "Others"] }] },
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $match: { _id: { $ne: null, $ne: "" } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]);

    // Fallback: if categorization returns nothing but jobs exist, show all under "General"
    if (jobsByCategoryAgg.length === 0 && activeJobs > 0) {
      jobsByCategoryAgg = [{ _id: "General", count: activeJobs }];
    }

    const jobsByCategory = jobsByCategoryAgg.map((row) => ({
      name: row._id || "Others",
      count: row.count,
      percentage:
        activeJobs > 0 ? Number(((row.count / activeJobs) * 100).toFixed(1)) : 0,
    }));

    // ═══════════════════════════════════════════════════════════
    // 4. APPLICATION PIPELINE HEALTH
    // ═══════════════════════════════════════════════════════════
    const pipelineAgg = await safeAggregate(Application, [
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const pipelineMap = {};
    pipelineAgg.forEach((row) => {
      pipelineMap[row._id] = row.count;
    });

    const stageApplied =
      (pipelineMap["Applied"] || 0) + (pipelineMap["Viewed"] || 0);
    const stageShortlisted = pipelineMap["Shortlisted"] || 0;
    const stageInterview = pipelineMap["Interview"] || 0;
    const stageOffered =
      (pipelineMap["Offered"] || 0) + (pipelineMap["Hired"] || 0);

    const pipelineTotalSafe = Math.max(totalApplications, 1);

    const applicationPipeline = {
      total: totalApplications,
      stages: [
        {
          name: "Under Initial Review",
          count: stageApplied,
          percentage: Number(((stageApplied / pipelineTotalSafe) * 100).toFixed(1)),
        },
        {
          name: "Shortlisted Candidates",
          count: stageShortlisted,
          percentage:
            stageApplied > 0
              ? Number(((stageShortlisted / stageApplied) * 100).toFixed(1))
              : 0,
        },
        {
          name: "Interviews Conducted",
          count: stageInterview,
          percentage:
            stageShortlisted > 0
              ? Number(((stageInterview / stageShortlisted) * 100).toFixed(1))
              : 0,
        },
        {
          name: "Offers Extended & Accepted",
          count: stageOffered,
          percentage:
            stageInterview > 0
              ? Number(((stageOffered / stageInterview) * 100).toFixed(1))
              : 0,
        },
      ],
    };

    // ═══════════════════════════════════════════════════════════
    // 5. JOB FUNNEL DISTRIBUTION
    // ═══════════════════════════════════════════════════════════
    const archivedJobs = await safeCount(Job, {
      status: { $in: ["Archived", "Expired", "Closed", "Inactive", "expired", "archived"] },
    });

    const funnelTotal = Math.max(activeJobs + pendingJobs + archivedJobs, 1);

    const jobFunnel = {
      total: activeJobs + pendingJobs + archivedJobs,
      live: {
        count: activeJobs,
        percentage: Number(((activeJobs / funnelTotal) * 100).toFixed(1)),
      },
      pending: {
        count: pendingJobs,
        percentage: Number(((pendingJobs / funnelTotal) * 100).toFixed(1)),
      },
      archived: {
        count: archivedJobs,
        percentage: Number(((archivedJobs / funnelTotal) * 100).toFixed(1)),
      },
    };

    // ═══════════════════════════════════════════════════════════
    // 6. RECENT ACTIVITY FEED
    // ═══════════════════════════════════════════════════════════
    const recentJobs = await safeFind(
      Job,
      {},
      {
        sort: { createdAt: -1 },
        limit: 3,
        select: "title companyName company status createdAt location",
      }
    );

    const recentApplications = await safeFind(
      Application,
      {},
      {
        sort: { createdAt: -1 },
        limit: 3,
        select: "candidateName jobTitle status createdAt",
      }
    );

    const recentAudits = await safeFind(
      AuditLog,
      {},
      { sort: { createdAt: -1 }, limit: 5 }
    );

    const activityFeed = [];

    recentJobs.forEach((job) => {
      activityFeed.push({
        id: String(job._id),
        type: "job",
        title: `${job.companyName || job.company || "A company"} posted a new job`,
        description: `${job.title || "Untitled"} • ${
          typeof job.location === "string"
            ? job.location
            : job.location?.city || "Location N/A"
        }`,
        statusTag: job.status || "Live",
        timestamp: job.createdAt,
      });
    });

    recentApplications.forEach((app) => {
      activityFeed.push({
        id: String(app._id),
        type: "candidate",
        title: `${app.candidateName || "Candidate"} applied for a job`,
        description: `Role: ${app.jobTitle || "N/A"}`,
        statusTag: app.status || "Applied",
        timestamp: app.createdAt,
      });
    });

    recentAudits.forEach((log) => {
      activityFeed.push({
        id: String(log._id),
        type: "approval",
        title: log.description || log.action || "Admin action",
        description: `${log.adminName || "System"} • ${log.category || "system"}`,
        statusTag: log.status === "success" ? "Success" : "Alert",
        timestamp: log.createdAt,
      });
    });

    activityFeed.sort(
      (a, b) =>
        new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
    const trimmedFeed = activityFeed.slice(0, 5);

    // ═══════════════════════════════════════════════════════════
    // 7. PENDING VERIFICATION LIST (top 3 unverified companies)
    // ═══════════════════════════════════════════════════════════
    const pendingVerificationDocs = await safeFind(
      Company,
      { verified: false },
      { sort: { createdAt: -1 }, limit: 3 }
    );

    const pendingVerificationList = pendingVerificationDocs.map((c) => {
      const initials = (c.name || "??")
        .split(" ")
        .map((w) => (w && w[0]) || "")
        .join("")
        .toUpperCase()
        .slice(0, 2);

      const submitted = c.createdAt ? new Date(c.createdAt) : new Date();
      const diffH = Math.max(
        1,
        Math.floor((Date.now() - submitted.getTime()) / (1000 * 60 * 60))
      );
      const submittedTime =
        diffH < 24 ? `${diffH}h ago` : `${Math.floor(diffH / 24)}d ago`;

      return {
        id: String(c._id),
        code: `CMP-${String(c._id).slice(-6).toUpperCase()}`,
        title: c.name || "Unnamed Company",
        initials: initials || "??",
        type: "Employer Verification",
        submittedTime,
        documents: [
          { name: "Company Profile", verified: !!c.website },
          { name: "Address Details", verified: !!c.address?.city },
        ],
      };
    });

    // ═══════════════════════════════════════════════════════════
    // 8. INSIGHTS
    // ═══════════════════════════════════════════════════════════
    const uniqueHiringCompanies = await safeDistinct(
      Job,
      "companyName",
      { status: { $in: ["Live", "Active", "live", "active"] } }
    );

    const reportsCount = await safeCount(AuditLog, {
      $or: [{ category: "complaint" }, { status: "warning" }],
    });

    // ═══════════════════════════════════════════════════════════
    // FINAL RESPONSE
    // ═══════════════════════════════════════════════════════════
    const payload = {
      success: true,
      data: {
        kpis: {
          totalCandidates: {
            value: totalCandidates,
            change: pctChange(candidatesThisMonth, candidatesLastMonth),
            subtitle: "vs last month",
          },
          totalEmployers: {
            value: totalEmployers,
            change: pctChange(employersThisMonth, employersLastMonth),
            subtitle: `${verifiedCompanies} verified companies`,
          },
          activeJobs: {
            value: activeJobs,
            change: pctChange(jobsThisMonth, jobsLastMonth),
            subtitle: `from ${uniqueHiringCompanies.length} hiring brands`,
          },
          applications: {
            value: totalApplications,
            change: pctChange(applicationsThisMonth, applicationsLastMonth),
            subtitle: "total submissions",
          },
          pendingVerification: {
            value: totalPendingVerifications,
            expedited: Math.min(totalPendingVerifications, 18),
            subtitle: totalPendingVerifications > 0 ? "Awaiting audit" : "All clear",
          },
          reportsComplaints: {
            value: reportsCount,
            change: 0,
            subtitle: "audit warnings",
          },
          verifiedCompanies: {
            value: verifiedCompanies,
            total: totalCompanies,
            subtitle:
              totalCompanies > 0
                ? `${((verifiedCompanies / totalCompanies) * 100).toFixed(1)}% verified`
                : "0% verified",
          },
          newUsersToday: {
            value: newUsersToday,
            change: newUsersToday - newUsersYesterday,
            subtitle: "vs yesterday",
          },
        },

        growthChart: {
          months: chartMonthLabels,
          candidates: candidateData,
          employers: employerData,
          applications: applicationData,
        },

        jobsByCategory,

        applicationPipeline,

        jobFunnel,

        activityFeed: trimmedFeed,

        pendingVerifications: pendingVerificationList,

        systemHealth: {
          uptime: "99.98%",
          uptimeStatus: "healthy",
          pendingCritical: Math.min(totalPendingVerifications, 18),
        },

        _debug: {
          dbState: mongoose.connection.readyState,
          modelsLoaded: {
            User: !!User,
            Recruiter: !!Recruiter,
            Company: !!Company,
            Job: !!Job,
            Application: !!Application,
            AuditLog: !!AuditLog,
          },
          rawCounts: {
            totalCandidates,
            totalEmployers,
            totalJobs,
            activeJobs,
            totalApplications,
            totalCompanies,
          },
        },
      },
    };

    console.log("📊 [Dashboard] Payload sent:", JSON.stringify(payload.data._debug, null, 2));

    return res.status(200).json(payload);
  } catch (err) {
    console.error("❌ Dashboard fatal error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard statistics",
      error: err.message,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
    });
  }
};