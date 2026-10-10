const mongoose = require('mongoose');

// Helper to safely get or create models
const getModel = (name) => {
  try {
    return mongoose.model(name);
  } catch (e) {
    const emptySchema = new mongoose.Schema({}, { strict: false });
    return mongoose.model(name, emptySchema);
  }
};

const Job = getModel('Job');
const Application = getModel('Application');
const Recruiter = getModel('Recruiter');
const User = getModel('User');
const Company = getModel('Company');

// State Machine for Application Workflow
const WORKFLOW_TRANSITIONS = {
  Applied: ['Viewed', 'Shortlisted', 'Rejected'],
  Viewed: ['Shortlisted', 'Rejected'],
  Shortlisted: ['Interview', 'Rejected'],
  Interview: ['Offered', 'Rejected'],
  Offered: ['Hired', 'Rejected'],
  Hired: [],
  Rejected: [],
  Withdrawn: []
};

// ==========================================
// 1. GET ALL COMPANIES WITH STATS (ADMIN)
// ==========================================
const getCompaniesWithStats = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const recruiters = await Recruiter.find().lean();
    const companies = await Company.find().lean();

    const companyMap = new Map();

    companies.forEach((c) => {
      const id = c._id.toString();
      companyMap.set(id, {
        companyId: id,
        name: c.companyName || c.name || 'Unnamed Company',
        logo: c.logo || c.companyLogo || null,
        industry: c.industry || 'General',
        website: c.website || '',
        location: c.location || '',
        recruitersCount: 0,
        jobsCount: 0,
        activeJobsCount: 0,
        applicationsCount: 0,
        hiredCount: 0
      });
    });

    recruiters.forEach((r) => {
      const compId = r.companyId ? r.companyId.toString() : r._id.toString();
      const compName = r.companyName || (r.company && r.company.name) || r.name || 'Independent Recruiter';

      if (!companyMap.has(compId)) {
        companyMap.set(compId, {
          companyId: compId,
          name: compName,
          logo: r.companyLogo || (r.company && r.company.logo) || null,
          industry: r.industry || 'General',
          website: r.website || '',
          location: r.location || '',
          recruitersCount: 1,
          jobsCount: 0,
          activeJobsCount: 0,
          applicationsCount: 0,
          hiredCount: 0
        });
      } else {
        const item = companyMap.get(compId);
        item.recruitersCount += 1;
      }
    });

    const allJobs = await Job.find().lean();
    const allApps = await Application.find().lean();

    const jobAppStats = new Map();
    allApps.forEach((app) => {
      const jId = app.jobId ? app.jobId.toString() : null;
      if (jId) {
        if (!jobAppStats.has(jId)) {
          jobAppStats.set(jId, { total: 0, hired: 0 });
        }
        const s = jobAppStats.get(jId);
        s.total += 1;
        if (app.status === 'Hired') s.hired += 1;
      }
    });

    allJobs.forEach((job) => {
      const jId = job._id.toString();
      const rId = job.recruiterId ? job.recruiterId.toString() : null;
      const cId = job.companyId ? job.companyId.toString() : null;

      let targetCompany = null;
      if (cId && companyMap.has(cId)) {
        targetCompany = companyMap.get(cId);
      } else if (rId && companyMap.has(rId)) {
        targetCompany = companyMap.get(rId);
      }

      if (targetCompany) {
        targetCompany.jobsCount += 1;
        if (job.status === 'Live' || job.status === 'Active' || job.status === 'Published') {
          targetCompany.activeJobsCount += 1;
        }
        const appStat = jobAppStats.get(jId);
        if (appStat) {
          targetCompany.applicationsCount += appStat.total;
          targetCompany.hiredCount += appStat.hired;
        }
      }
    });

    let results = Array.from(companyMap.values());

    if (search) {
      const s = search.toLowerCase();
      results = results.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.industry.toLowerCase().includes(s) ||
          c.location.toLowerCase().includes(s)
      );
    }

    const total = results.length;
    const paginated = results.slice(skip, skip + parseInt(limit));

    return res.status(200).json({
      success: true,
      data: paginated,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('getCompaniesWithStats error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. GET JOBS BY COMPANY (ADMIN)
// ==========================================
const getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { status, search } = req.query;

    let query = {
      $or: [
        { companyId: companyId },
        { recruiterId: companyId }
      ]
    };

    if (mongoose.Types.ObjectId.isValid(companyId)) {
      query.$or.push(
        { companyId: new mongoose.Types.ObjectId(companyId) },
        { recruiterId: new mongoose.Types.ObjectId(companyId) }
      );
    }

    if (status && status !== 'All') {
      query.status = status;
    }

    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();
    const jobIds = jobs.map((j) => j._id);
    const jobIdsStr = jobs.map((j) => j._id.toString());

    const apps = await Application.find({
      $or: [
        { jobId: { $in: jobIds } },
        { jobId: { $in: jobIdsStr } }
      ]
    }).lean();

    const appMap = new Map();
    apps.forEach((a) => {
      const key = a.jobId ? a.jobId.toString() : '';
      if (!appMap.has(key)) {
        appMap.set(key, { total: 0, applied: 0, viewed: 0, shortlisted: 0, interview: 0, offered: 0, hired: 0, rejected: 0 });
      }
      const st = appMap.get(key);
      st.total += 1;
      const s = (a.status || 'Applied').toLowerCase();
      if (s === 'applied') st.applied += 1;
      if (s === 'viewed') st.viewed += 1;
      if (s === 'shortlisted') st.shortlisted += 1;
      if (s === 'interview') st.interview += 1;
      if (s === 'offered') st.offered += 1;
      if (s === 'hired') st.hired += 1;
      if (s === 'rejected') st.rejected += 1;
    });

    const enrichedJobs = jobs.map((job) => {
      const stats = appMap.get(job._id.toString()) || {
        total: 0, applied: 0, viewed: 0, shortlisted: 0, interview: 0, offered: 0, hired: 0, rejected: 0
      };
      return {
        ...job,
        jobId: job._id.toString(),
        applicantCount: stats.total,
        pipelineStats: stats
      };
    });

    return res.status(200).json({
      success: true,
      data: enrichedJobs
    });
  } catch (error) {
    console.error('getJobsByCompany error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. GET JOB APPLICATIONS FOR ADMIN
// ==========================================
const getJobApplicationsForAdmin = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, search, page = 1, limit = 20 } = req.query;

    if (!jobId || jobId === 'undefined' || jobId === 'null') {
      return res.status(400).json({ success: false, message: 'Valid Job ID is required' });
    }

    const jobQuery = {
      $or: [{ _id: jobId }]
    };
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      jobQuery.$or.push({ _id: new mongoose.Types.ObjectId(jobId) });
    }
    const job = await Job.findOne(jobQuery).lean();

    const appQuery = {
      $or: [{ jobId: jobId }, { jobId: jobId.toString() }]
    };
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      appQuery.$or.push({ jobId: new mongoose.Types.ObjectId(jobId) });
    }

    if (status && status !== 'All') {
      appQuery.status = status;
    }

    let applications = await Application.find(appQuery).sort({ createdAt: -1 }).lean();

    const userIds = applications.map((a) => a.userId || a.candidateId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    let enrichedApps = applications.map((app) => {
      const uId = (app.userId || app.candidateId || '').toString();
      const user = userMap.get(uId) || {};

      return {
        ...app,
        candidateName: app.candidateName || user.name || user.fullName || 'Anonymous Candidate',
        candidateEmail: app.candidateEmail || user.email || 'No email provided',
        candidatePhone: app.candidatePhone || user.phone || user.mobile || 'N/A',
        candidateAvatar: app.candidateAvatar || user.avatar || user.profileImage || null,
        experience: app.experience || user.experience || 'Not specified',
        skills: app.skills || user.skills || [],
        resumeUrl: app.resumeUrl || app.resume?.url || user.resumeUrl || null,
        workflowHistory: app.workflowHistory || [
          { status: app.status || 'Applied', changedAt: app.createdAt || new Date(), changedBy: 'System' }
        ],
        allowedTransitions: WORKFLOW_TRANSITIONS[app.status || 'Applied'] || []
      };
    });

    if (search) {
      const s = search.toLowerCase();
      enrichedApps = enrichedApps.filter(
        (a) =>
          a.candidateName.toLowerCase().includes(s) ||
          a.candidateEmail.toLowerCase().includes(s)
      );
    }

    const total = enrichedApps.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginated = enrichedApps.slice(skip, skip + parseInt(limit));

    return res.status(200).json({
      success: true,
      job: job || null,
      data: paginated,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('getJobApplicationsForAdmin error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. GET RECRUITER'S OWN JOBS WITH STATS
// ==========================================
const getRecruiterJobsWithStats = async (req, res) => {
  try {
    const recruiterId = req.user?.id || req.user?._id;
    if (!recruiterId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { status, search } = req.query;

    let query = {
      $or: [{ recruiterId: recruiterId }, { recruiterId: recruiterId.toString() }]
    };
    if (mongoose.Types.ObjectId.isValid(recruiterId)) {
      query.$or.push({ recruiterId: new mongoose.Types.ObjectId(recruiterId) });
    }

    if (status && status !== 'All') {
      query.status = status;
    }
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();
    const jobIds = jobs.map((j) => j._id);
    const jobIdsStr = jobs.map((j) => j._id.toString());

    const apps = await Application.find({
      $or: [{ jobId: { $in: jobIds } }, { jobId: { $in: jobIdsStr } }]
    }).lean();

    const appMap = new Map();
    apps.forEach((a) => {
      const key = a.jobId ? a.jobId.toString() : '';
      if (!appMap.has(key)) {
        appMap.set(key, { total: 0, applied: 0, viewed: 0, shortlisted: 0, interview: 0, offered: 0, hired: 0, rejected: 0 });
      }
      const st = appMap.get(key);
      st.total += 1;
      const s = (a.status || 'Applied').toLowerCase();
      if (s === 'applied') st.applied += 1;
      if (s === 'viewed') st.viewed += 1;
      if (s === 'shortlisted') st.shortlisted += 1;
      if (s === 'interview') st.interview += 1;
      if (s === 'offered') st.offered += 1;
      if (s === 'hired') st.hired += 1;
      if (s === 'rejected') st.rejected += 1;
    });

    const enriched = jobs.map((job) => {
      const stats = appMap.get(job._id.toString()) || {
        total: 0, applied: 0, viewed: 0, shortlisted: 0, interview: 0, offered: 0, hired: 0, rejected: 0
      };
      return {
        ...job,
        jobId: job._id.toString(),
        applicantCount: stats.total,
        pipelineStats: stats
      };
    });

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    console.error('getRecruiterJobsWithStats error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. GET RECRUITER JOB APPLICATIONS
// ==========================================
const getRecruiterJobApplications = async (req, res) => {
  try {
    const recruiterId = req.user?.id || req.user?._id;
    const { jobId } = req.params;
    const { status, search } = req.query;

    const jobQuery = {
      _id: mongoose.Types.ObjectId.isValid(jobId) ? new mongoose.Types.ObjectId(jobId) : jobId,
      $or: [
        { recruiterId: recruiterId },
        { recruiterId: recruiterId.toString() },
        { recruiterId: mongoose.Types.ObjectId.isValid(recruiterId) ? new mongoose.Types.ObjectId(recruiterId) : null }
      ]
    };

    const job = await Job.findOne(jobQuery).lean();
    if (!job && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Access denied: You do not own this job' });
    }

    const appQuery = {
      $or: [{ jobId: jobId }, { jobId: jobId.toString() }]
    };
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      appQuery.$or.push({ jobId: new mongoose.Types.ObjectId(jobId) });
    }
    if (status && status !== 'All') {
      appQuery.status = status;
    }

    const applications = await Application.find(appQuery).sort({ createdAt: -1 }).lean();
    const userIds = applications.map((a) => a.userId || a.candidateId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    let enriched = applications.map((app) => {
      const uId = (app.userId || app.candidateId || '').toString();
      const user = userMap.get(uId) || {};
      return {
        ...app,
        candidateName: app.candidateName || user.name || user.fullName || 'Anonymous Candidate',
        candidateEmail: app.candidateEmail || user.email || 'N/A',
        candidatePhone: app.candidatePhone || user.phone || 'N/A',
        candidateAvatar: app.candidateAvatar || user.avatar || null,
        experience: app.experience || user.experience || 'Not specified',
        skills: app.skills || user.skills || [],
        resumeUrl: app.resumeUrl || app.resume?.url || user.resumeUrl || null,
        workflowHistory: app.workflowHistory || [],
        allowedTransitions: WORKFLOW_TRANSITIONS[app.status || 'Applied'] || []
      };
    });

    if (search) {
      const s = search.toLowerCase();
      enriched = enriched.filter(
        (a) =>
          a.candidateName.toLowerCase().includes(s) ||
          a.candidateEmail.toLowerCase().includes(s)
      );
    }

    return res.status(200).json({ success: true, job, data: enriched });
  } catch (error) {
    console.error('getRecruiterJobApplications error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 6. GET RECRUITER JOBS FOR ADMIN
// ==========================================
const getRecruiterJobsForAdmin = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    let query = {
      $or: [{ recruiterId: recruiterId }, { recruiterId: recruiterId.toString() }]
    };
    if (mongoose.Types.ObjectId.isValid(recruiterId)) {
      query.$or.push({ recruiterId: new mongoose.Types.ObjectId(recruiterId) });
    }

    const jobs = await Job.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    console.error('getRecruiterJobsForAdmin error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 7. UPDATE APPLICATION STATUS (ADMIN/HR)
// ==========================================
const updateApplicationStatusByAdmin = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, hrNotes, rejectionReason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'New status is required' });
    }

    const appQuery = {
      $or: [{ _id: applicationId }]
    };
    if (mongoose.Types.ObjectId.isValid(applicationId)) {
      appQuery.$or.push({ _id: new mongoose.Types.ObjectId(applicationId) });
    }

    const application = await Application.findOne(appQuery);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const currentStatus = application.status || 'Applied';
    const allowed = WORKFLOW_TRANSITIONS[currentStatus] || [];

    // Super Admin can override, but we record the timeline
    const historyEntry = {
      fromStatus: currentStatus,
      toStatus: status,
      changedAt: new Date(),
      changedBy: req.user?.email || req.user?.name || 'Admin',
      notes: hrNotes || rejectionReason || ''
    };

    const updateDoc = {
      $set: {
        status: status,
        updatedAt: new Date()
      },
      $push: {
        workflowHistory: historyEntry
      }
    };

    if (hrNotes) updateDoc.$set.hrNotes = hrNotes;
    if (rejectionReason) updateDoc.$set.rejectionReason = rejectionReason;

    const updatedApp = await Application.findOneAndUpdate(appQuery, updateDoc, { new: true });

    return res.status(200).json({
      success: true,
      message: `Status transitioned from ${currentStatus} to ${status}`,
      data: updatedApp
    });
  } catch (error) {
    console.error('updateApplicationStatusByAdmin error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 8. GET ADMIN-POSTED JOBS ONLY (ADMIN)
// ==========================================
const getAdminPostedJobs = async (req, res) => {
  try {
    // 1. Fetch all recruiters to get recruiter IDs and user IDs
    const recruiters = await Recruiter.find().lean();
    const recruiterIds = new Set();

    recruiters.forEach((r) => {
      if (r._id) recruiterIds.add(r._id.toString());
      if (r.userId) recruiterIds.add(r.userId.toString());
      if (r.id) recruiterIds.add(r.id.toString());
    });

    // 2. Query all jobs from DB
    const allJobs = await Job.find().sort({ createdAt: -1 }).lean();

    // 3. Filter for admin-posted jobs:
    // Criteria:
    // a) postedBy / createdBy is 'admin' OR
    // b) isAdminPost / isAdmin / adminPosted is true OR
    // c) recruiterId is null / undefined / empty OR
    // d) recruiterId is NOT in the recruiterIds set
    const adminJobs = allJobs.filter((j) => {
      const postedBy = String(j.postedBy || j.createdBy || j.source || j.postedByType || j.creatorType || '').toLowerCase();
      if (postedBy === 'admin' || postedBy === 'superadmin') return true;
      if (j.isAdminPost === true || j.isAdmin === true || j.adminPosted === true) return true;

      const rId = j.recruiterId ? j.recruiterId.toString() : null;
      if (!rId || rId === '' || rId === 'admin') return true;

      // If recruiterId does not belong to any registered recruiter, treat as admin job
      if (!recruiterIds.has(rId)) return true;

      return false;
    });

    // 4. Enrich each admin job with application counts
    const adminJobIds = adminJobs.map((j) => j._id);
    const adminJobIdsStr = adminJobs.map((j) => j._id.toString());

    const apps = await Application.find({
      $or: [
        { jobId: { $in: adminJobIds } },
        { jobId: { $in: adminJobIdsStr } }
      ]
    }).lean();

    const appMap = new Map();
    apps.forEach((a) => {
      const k = a.jobId ? a.jobId.toString() : '';
      if (!appMap.has(k)) {
        appMap.set(k, { total: 0, pending: 0, hired: 0, rejected: 0, shortlisted: 0, interview: 0, viewed: 0 });
      }
      const st = appMap.get(k);
      st.total += 1;
      const s = (a.status || 'Applied').toLowerCase();
      if (s === 'applied' || s === 'pending') st.pending += 1;
      else if (s === 'hired') st.hired += 1;
      else if (s === 'rejected') st.rejected += 1;
      else if (s === 'shortlisted') st.shortlisted += 1;
      else if (s === 'interview') st.interview += 1;
      else if (s === 'viewed') st.viewed += 1;
    });

    const enriched = adminJobs.map((j) => {
      const jobIdStr = j._id.toString();
      const stats = appMap.get(jobIdStr) || { total: 0, pending: 0, hired: 0, rejected: 0, shortlisted: 0, interview: 0, viewed: 0 };

      return {
        _id: j._id,
        id: jobIdStr,
        jobId: jobIdStr,
        title: j.title || 'Untitled Admin Job',
        companyName: j.companyName || j.company || 'Platform Admin Posting',
        companyLogo: j.companyLogo?.url || j.companyLogo || null,
        status: j.status || 'Live',
        approvalStatus: j.approvalStatus || 'approved',
        jobType: j.jobType || j.type || 'Full-Time',
        workMode: j.workMode || j.workplaceType || 'On-site',
        location: j.location || (typeof j.location === 'object' ? `${j.location.city || ''}, ${j.location.country || ''}` : 'Remote'),
        salary: j.salary || (j.salaryRange ? `${j.salaryRange.min || ''} - ${j.salaryRange.max || ''} ${j.salaryRange.currency || ''}` : 'Competitive'),
        postedAt: j.postedAt || j.createdAt || new Date(),
        createdByAdmin: true,
        recruiterId: j.recruiterId || null,
        applicationCount: stats.total,
        pendingCount: stats.pending,
        hiredCount: stats.hired,
        shortlistedCount: stats.shortlisted,
        pipelineStats: stats,
        _raw: j
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length
    });
  } catch (error) {
    console.error('getAdminPostedJobs error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCompaniesWithStats,
  getJobsByCompany,
  getJobApplicationsForAdmin,
  getRecruiterJobsWithStats,
  getRecruiterJobApplications,
  getRecruiterJobsForAdmin,
  updateApplicationStatusByAdmin,
  getAdminPostedJobs
};