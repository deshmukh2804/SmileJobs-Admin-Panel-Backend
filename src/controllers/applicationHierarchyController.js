/**
 * Application Hierarchy Controller
 * Database: Job_db
 * Collection: Jobs / Applications / Companies
 * 
 * Provides end-to-end hierarchical drill-down APIs:
 * Admin Jobs -> Company Jobs -> Applications -> Candidate Details
 */

const mongoose = require('mongoose');

// ==========================================
// WORKFLOW STATE MACHINE
// ==========================================
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

// ==========================================
// DB CONNECTION HELPERS (Target: Job_db)
// ==========================================

/**
 * Returns a connection pointing specifically to 'Job_db'
 */
const getJobDb = () => {
  try {
    if (mongoose.connection && mongoose.connection.readyState >= 1) {
      return mongoose.connection.useDb('Job_db', { useCache: true });
    }
  } catch (err) {
    console.warn('[ApplicationHierarchy] Error switching to Job_db:', err.message);
  }
  return mongoose.connection;
};

/**
 * Safely converts string to ObjectId
 */
const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const str = String(id).trim();
  if (mongoose.Types.ObjectId.isValid(str)) {
    try {
      return new mongoose.Types.ObjectId(str);
    } catch (e) {
      return null;
    }
  }
  return null;
};

// ==========================================
// SCHEMAS & MODELS BOUND TO Job_db
// ==========================================
const genericSchema = new mongoose.Schema({}, { strict: false, timestamps: true });

const getJobModel = () => {
  const db = getJobDb();
  try {
    if (db.models && db.models.Job_db_Jobs) return db.models.Job_db_Jobs;
    return db.model('Job_db_Jobs', genericSchema, 'Jobs');
  } catch (e) {
    try {
      if (mongoose.models && mongoose.models.Job) return mongoose.models.Job;
      return mongoose.model('Job', genericSchema, 'Jobs');
    } catch (e2) {
      return null;
    }
  }
};

const getApplicationModel = () => {
  const db = getJobDb();
  try {
    if (db.models && db.models.Job_db_Applications) return db.models.Job_db_Applications;
    return db.model('Job_db_Applications', genericSchema, 'Applications');
  } catch (e) {
    try {
      if (mongoose.models && mongoose.models.Application) return mongoose.models.Application;
      return mongoose.model('Application', genericSchema, 'Applications');
    } catch (e2) {
      return null;
    }
  }
};

const getCompanyModel = () => {
  const db = getJobDb();
  try {
    if (db.models && db.models.Job_db_Companies) return db.models.Job_db_Companies;
    return db.model('Job_db_Companies', genericSchema, 'Companies');
  } catch (e) {
    try {
      if (mongoose.models && mongoose.models.Company) return mongoose.models.Company;
      return mongoose.model('Company', genericSchema, 'Companies');
    } catch (e2) {
      return null;
    }
  }
};

const getUserModel = () => {
  try {
    if (mongoose.models && mongoose.models.User) return mongoose.models.User;
    return mongoose.model('User', genericSchema, 'users');
  } catch (e) {
    return null;
  }
};

// ==========================================
// DUAL-LAYER QUERY HELPERS FOR Job_db
// ==========================================

/**
 * Queries 'Jobs' collection in Job_db with native fallback
 */
const queryJobs = async (filter = {}, sort = { createdAt: -1 }) => {
  const jobDb = getJobDb();
  
  // 1. Try native collection query in Job_db
  if (jobDb && jobDb.db) {
    try {
      const collections = await jobDb.db.listCollections().toArray();
      const colNames = collections.map(c => c.name);
      
      let targetName = 'Jobs';
      if (!colNames.includes('Jobs') && colNames.includes('jobs')) {
        targetName = 'jobs';
      }
      
      const docs = await jobDb.db.collection(targetName).find(filter).sort(sort).toArray();
      if (docs && docs.length > 0) return docs;
      
      // Fallback check lower/upper
      if (targetName === 'Jobs' && colNames.includes('jobs')) {
        const altDocs = await jobDb.db.collection('jobs').find(filter).sort(sort).toArray();
        if (altDocs && altDocs.length > 0) return altDocs;
      }
      return docs || [];
    } catch (err) {
      console.warn('[ApplicationHierarchy] queryJobs native error:', err.message);
    }
  }

  // 2. Fallback to Mongoose model on Job_db
  const Model = getJobModel();
  if (Model) {
    try {
      return await Model.find(filter).sort(sort).lean();
    } catch (e) {
      console.warn('[ApplicationHierarchy] queryJobs model error:', e.message);
    }
  }
  return [];
};

/**
 * Queries 'Applications' collection in Job_db with cross-database fallback
 */
const queryApplications = async (filter = {}, sort = { createdAt: -1 }) => {
  const jobDb = getJobDb();
  
  // 1. Try Job_db native collection
  if (jobDb && jobDb.db) {
    try {
      const collections = await jobDb.db.listCollections().toArray();
      const colNames = collections.map(c => c.name);
      
      let targetName = 'Applications';
      if (!colNames.includes('Applications') && colNames.includes('applications')) {
        targetName = 'applications';
      }
      
      const docs = await jobDb.db.collection(targetName).find(filter).sort(sort).toArray();
      if (docs && docs.length > 0) return docs;
      
      if (targetName === 'Applications' && colNames.includes('applications')) {
        const altDocs = await jobDb.db.collection('applications').find(filter).sort(sort).toArray();
        if (altDocs && altDocs.length > 0) return altDocs;
      }
    } catch (err) {
      console.warn('[ApplicationHierarchy] queryApplications native error:', err.message);
    }
  }

  // 2. Try primary connection if Job_db returned empty
  if (mongoose.connection && mongoose.connection.db && mongoose.connection.db !== jobDb?.db) {
    try {
      const mainCols = await mongoose.connection.db.listCollections().toArray();
      const mainNames = mainCols.map(c => c.name);
      const targetName = mainNames.includes('Applications') ? 'Applications' : (mainNames.includes('applications') ? 'applications' : 'applications');
      const docs = await mongoose.connection.db.collection(targetName).find(filter).sort(sort).toArray();
      if (docs && docs.length > 0) return docs;
    } catch (e) {}
  }

  // 3. Fallback to Application Model
  const Model = getApplicationModel();
  if (Model) {
    try {
      return await Model.find(filter).sort(sort).lean();
    } catch (e) {}
  }
  return [];
};

/**
 * Finds a single job document by ID from Job_db -> Jobs
 */
const findJobById = async (jobId) => {
  if (!jobId) return null;
  const objId = toObjectId(jobId);
  const idStr = String(jobId).trim();

  const orConditions = [{ _id: idStr }, { jobId: idStr }, { id: idStr }];
  if (objId) {
    orConditions.unshift({ _id: objId });
  }

  const jobs = await queryJobs({ $or: orConditions });
  return jobs && jobs.length > 0 ? jobs[0] : null;
};

/**
 * Finds all applications linked to a specific job in Job_db
 */
const findApplicationsForJob = async (jobId, extraFilter = {}) => {
  if (!jobId) return [];
  const objId = toObjectId(jobId);
  const idStr = String(jobId).trim();

  const orConditions = [
    { jobId: idStr },
    { job: idStr },
    { job_id: idStr },
    { 'job._id': idStr },
    { 'jobId._id': idStr }
  ];

  if (objId) {
    orConditions.push({ jobId: objId });
    orConditions.push({ job: objId });
    orConditions.push({ job_id: objId });
    orConditions.push({ 'job._id': objId });
    orConditions.push({ 'jobId._id': objId });
  }

  const matchFilter = Object.keys(extraFilter).length > 0
    ? { $and: [{ $or: orConditions }, extraFilter] }
    : { $or: orConditions };

  return await queryApplications(matchFilter);
};

/**
 * Updates application status and timeline in Job_db / primary db
 */
const updateApplicationDoc = async (id, updateFields) => {
  const objId = toObjectId(id);
  const idStr = String(id).trim();
  const filter = objId
    ? { $or: [{ _id: objId }, { _id: idStr }, { id: idStr }, { applicationId: idStr }] }
    : { $or: [{ _id: idStr }, { id: idStr }, { applicationId: idStr }] };

  const jobDb = getJobDb();
  
  // 1. Try Job_db
  if (jobDb && jobDb.db) {
    try {
      const collections = await jobDb.db.listCollections().toArray();
      const colNames = collections.map(c => c.name);
      const targetName = colNames.includes('Applications') ? 'Applications' : (colNames.includes('applications') ? 'applications' : 'Applications');

      const res = await jobDb.db.collection(targetName).findOneAndUpdate(
        filter,
        { $set: updateFields },
        { returnDocument: 'after' }
      );
      if (res && (res.value || res._id)) return res.value || res;
    } catch (e) {
      console.warn('[ApplicationHierarchy] updateApplicationDoc Job_db error:', e.message);
    }
  }

  // 2. Try primary connection
  if (mongoose.connection && mongoose.connection.db) {
    try {
      const res = await mongoose.connection.db.collection('applications').findOneAndUpdate(
        filter,
        { $set: updateFields },
        { returnDocument: 'after' }
      );
      if (res && (res.value || res._id)) return res.value || res;
    } catch (e) {}
  }

  // 3. Fallback Mongoose Model
  const Model = getApplicationModel();
  if (Model) {
    return await Model.findOneAndUpdate(filter, { $set: updateFields }, { new: true }).lean();
  }
  return null;
};

// ==========================================
// CONTROLLER HANDLERS
// ==========================================

/**
 * GET /api/v1/applications/hierarchy/admin-posted-jobs
 * Fetches ONLY jobs created via Admin Panel from Job_db -> Jobs collection
 */
const getAdminPostedJobs = async (req, res) => {
  try {
    // 1. Fetch all jobs from Job_db -> Jobs
    const allJobs = await queryJobs({});

    // 2. Fetch all registered recruiter IDs to distinguish Admin vs Recruiter posts
    let recruiterIds = new Set();
    try {
      const User = getUserModel();
      if (User) {
        const recruiters = await User.find(
          { role: { $regex: /^recruiter$/i } },
          '_id email'
        ).lean();
        recruiterIds = new Set(recruiters.map(r => String(r._id)));
      }
    } catch (e) {}

    // Also check Job_db Users
    const jobDb = getJobDb();
    if (jobDb && jobDb.db) {
      try {
        const dbUsers = await jobDb.db.collection('users').find({ role: { $regex: /^recruiter$/i } }).toArray();
        dbUsers.forEach(u => recruiterIds.add(String(u._id)));
      } catch (e) {}
    }

    // 3. Filter Admin-posted jobs
    const adminJobs = allJobs.filter(job => {
      // Exclude soft-deleted jobs
      if (job.isDeleted === true || String(job.status || '').toLowerCase() === 'deleted') {
        return false;
      }

      const source = String(job.source || '').toLowerCase();
      const postedBy = String(job.postedBy || job.createdBy || '').toLowerCase();
      const isAdminFlag = Boolean(job.isAdminPost || job.isAdmin || job.adminPosted);
      const recId = job.recruiterId || job.recruiter || job.userId || job.postedByRecruiter;

      if (source === 'admin' || source === 'superadmin' || source === 'careerflow_admin') return true;
      if (postedBy === 'admin' || postedBy === 'superadmin') return true;
      if (isAdminFlag) return true;

      // If no recruiter is linked, it's an admin job
      if (!recId || recId === 'admin' || recId === 'superadmin' || recId === 'null') return true;

      // If recruiter ID is not in registered recruiter list
      if (recruiterIds.size > 0 && !recruiterIds.has(String(recId))) return true;

      return false;
    });

    // 4. Enrich jobs with real-time application statistics from Job_db
    const enrichedJobs = await Promise.all(
      adminJobs.map(async (job) => {
        const jId = job._id || job.id || job.jobId;
        const apps = await findApplicationsForJob(jId);

        const appliedCount = apps.length;
        const hiredCount = apps.filter(a => String(a.status || '').toLowerCase() === 'hired').length;
        const shortlistedCount = apps.filter(a => ['shortlisted', 'interview', 'offered', 'hired'].includes(String(a.status || '').toLowerCase())).length;

        // Clean company name
        let companyDisplay = 'CareerFlow Admin';
        if (typeof job.company === 'string' && job.company.trim()) {
          companyDisplay = job.company;
        } else if (job.company && typeof job.company === 'object' && job.company.name) {
          companyDisplay = job.company.name;
        } else if (typeof job.companyName === 'string' && job.companyName.trim()) {
          companyDisplay = job.companyName;
        }

        return {
          ...job,
          _id: String(job._id || job.id || jId),
          jobId: String(job._id || job.id || jId),
          title: job.title || job.jobTitle || 'Untitled Position',
          company: companyDisplay,
          companyName: companyDisplay,
          department: job.department || 'General',
          location: job.location || 'Remote',
          salary: job.salary || job.salaryRange || 'Competitive',
          status: job.status || 'Active',
          jobType: job.jobType || job.type || 'Full-time',
          workplaceType: job.workplaceType || 'Hybrid',
          experienceLevel: job.experienceLevel || job.experience || 'Not specified',
          skills: Array.isArray(job.skills) ? job.skills : (Array.isArray(job.requiredSkills) ? job.requiredSkills : []),
          description: job.description || job.jobDescription || '',
          requirements: Array.isArray(job.requirements) ? job.requirements : [],
          responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
          appliedCount,
          hiredCount,
          shortlistedCount,
          createdAt: job.createdAt || new Date().toISOString(),
          updatedAt: job.updatedAt || new Date().toISOString(),
          source: 'Admin'
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedJobs.length,
      data: enrichedJobs
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getAdminPostedJobs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin jobs from Job_db',
      error: error.message
    });
  }
};

/**
 * GET /api/v1/applications/hierarchy/companies
 * Fetches all companies with job & application metrics from Job_db
 */
const getCompaniesWithStats = async (req, res) => {
  try {
    const { search } = req.query;

    // 1. Fetch all non-deleted jobs from Job_db -> Jobs
    const allJobs = await queryJobs({ isDeleted: { $ne: true } });

    // 2. Fetch registered companies if available
    let registeredCompanies = [];
    const jobDb = getJobDb();
    if (jobDb && jobDb.db) {
      try {
        const collections = await jobDb.db.listCollections().toArray();
        const colNames = collections.map(c => c.name);
        const compTarget = colNames.includes('Companies') ? 'Companies' : (colNames.includes('companies') ? 'companies' : null);
        if (compTarget) {
          registeredCompanies = await jobDb.db.collection(compTarget).find({}).toArray();
        }
      } catch (e) {}
    }

    // 3. Aggregate jobs by company
    const companyMap = new Map();

    // Seed with registered companies
    registeredCompanies.forEach(comp => {
      const id = String(comp._id || comp.id);
      const name = comp.name || comp.companyName || 'Unknown Company';
      companyMap.set(id, {
        companyId: id,
        companyName: name,
        logo: comp.logo || comp.logoUrl || '',
        industry: comp.industry || 'Technology',
        location: comp.location || 'Global',
        jobs: [],
        totalJobsCount: 0,
        activeJobsCount: 0,
        totalApplicationsCount: 0,
        hiredCount: 0,
        shortlistedCount: 0
      });
    });

    // Group jobs
    allJobs.forEach(job => {
      let compId = null;
      let compName = 'CareerFlow Jobs';

      if (job.companyId) {
        compId = String(job.companyId);
      } else if (job.company && typeof job.company === 'object' && job.company._id) {
        compId = String(job.company._id);
        compName = job.company.name || compName;
      } else if (typeof job.company === 'string' && job.company.trim()) {
        compName = job.company.trim();
        compId = compName.toLowerCase().replace(/\s+/g, '-');
      } else if (typeof job.companyName === 'string' && job.companyName.trim()) {
        compName = job.companyName.trim();
        compId = compName.toLowerCase().replace(/\s+/g, '-');
      } else {
        compId = 'default-company';
      }

      if (!companyMap.has(compId)) {
        companyMap.set(compId, {
          companyId: compId,
          companyName: compName,
          logo: job.companyLogo || '',
          industry: job.industry || 'Technology',
          location: typeof job.location === 'string' ? job.location : 'Multiple Locations',
          jobs: [],
          totalJobsCount: 0,
          activeJobsCount: 0,
          totalApplicationsCount: 0,
          hiredCount: 0,
          shortlistedCount: 0
        });
      }

      const compRecord = companyMap.get(compId);
      compRecord.jobs.push(job);
      compRecord.totalJobsCount += 1;
      const statusLower = String(job.status || '').toLowerCase();
      if (statusLower === 'active' || statusLower === 'open') {
        compRecord.activeJobsCount += 1;
      }
    });

    // 4. Calculate application counts per company
    const companies = Array.from(companyMap.values());

    for (const comp of companies) {
      let appCount = 0;
      let hired = 0;
      let shortlisted = 0;

      for (const job of comp.jobs) {
        const jId = job._id || job.id;
        const apps = await findApplicationsForJob(jId);
        appCount += apps.length;
        hired += apps.filter(a => String(a.status || '').toLowerCase() === 'hired').length;
        shortlisted += apps.filter(a => ['shortlisted', 'interview', 'offered', 'hired'].includes(String(a.status || '').toLowerCase())).length;
      }

      comp.totalApplicationsCount = appCount;
      comp.hiredCount = hired;
      comp.shortlistedCount = shortlisted;
      delete comp.jobs; // remove raw jobs array from list payload
    }

    // Filter by search if provided
    let filtered = companies;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = companies.filter(c => 
        c.companyName.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q)
      );
    }

    // Sort companies by total applications / jobs
    filtered.sort((a, b) => b.totalJobsCount - a.totalJobsCount);

    return res.status(200).json({
      success: true,
      count: filtered.length,
      data: filtered
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getCompaniesWithStats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch companies from Job_db',
      error: error.message
    });
  }
};

/**
 * GET /api/v1/applications/hierarchy/companies/:companyId/jobs
 * Fetches all jobs for a specific company from Job_db -> Jobs
 */
const getJobsByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Valid company ID is required' });
    }

    const compObjId = toObjectId(companyId);
    const idStr = String(companyId).trim();
    const nameRegex = new RegExp(`^${idStr.replace(/-/g, ' ')}$`, 'i');

    const filterConditions = [
      { companyId: idStr },
      { 'company._id': idStr },
      { company: idStr },
      { companyName: idStr },
      { company: nameRegex },
      { companyName: nameRegex }
    ];

    if (compObjId) {
      filterConditions.push({ companyId: compObjId });
      filterConditions.push({ 'company._id': compObjId });
      filterConditions.push({ _id: compObjId });
    }

    const jobs = await queryJobs({
      $and: [
        { isDeleted: { $ne: true } },
        { $or: filterConditions }
      ]
    });

    // Enrich jobs with application counts
    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        const jId = job._id || job.id || job.jobId;
        const apps = await findApplicationsForJob(jId);

        return {
          ...job,
          _id: String(job._id || job.id || jId),
          jobId: String(job._id || job.id || jId),
          title: job.title || job.jobTitle || 'Untitled Position',
          company: typeof job.company === 'string' ? job.company : (job.company?.name || job.companyName || 'Company'),
          department: job.department || 'General',
          location: job.location || 'Remote',
          salary: job.salary || job.salaryRange || 'Competitive',
          status: job.status || 'Active',
          appliedCount: apps.length,
          hiredCount: apps.filter(a => String(a.status || '').toLowerCase() === 'hired').length,
          shortlistedCount: apps.filter(a => ['shortlisted', 'interview', 'offered'].includes(String(a.status || '').toLowerCase())).length,
          createdAt: job.createdAt || new Date().toISOString()
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedJobs.length,
      data: enrichedJobs
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getJobsByCompany:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch company jobs from Job_db',
      error: error.message
    });
  }
};

/**
 * GET /api/v1/applications/hierarchy/jobs/:jobId/applications
 * Fetches all applications for a specific job with full candidate details from Job_db
 */
const getJobApplicationsForAdmin = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, search } = req.query;

    if (!jobId || jobId === 'undefined' || jobId === 'null') {
      return res.status(400).json({ success: false, message: 'Valid job ID is required' });
    }

    // 1. Fetch job document from Job_db -> Jobs
    const job = await findJobById(jobId);

    // 2. Fetch all applications linked to this job from Job_db
    const rawApps = await findApplicationsForJob(jobId);

    // 3. Format application records with clean structure
    let formattedApps = rawApps.map(app => {
      const appId = String(app._id || app.id || app.applicationId);
      const cand = app.candidate || app.candidateId || app.applicant || {};
      const user = app.userId || {};

      const candidateName = app.candidateName || app.fullName || app.name || cand.fullName || cand.name || user.name || 'Candidate';
      const candidateEmail = app.candidateEmail || app.email || cand.email || user.email || 'N/A';
      const candidatePhone = app.candidatePhone || app.phone || app.mobile || cand.phone || user.phone || 'N/A';
      const candidateLocation = app.candidateLocation || app.location || cand.location || 'N/A';

      // Resume URL extraction
      const resumeUrl = app.resumeUrl || app.resume || cand.resumeUrl || cand.resume || app.attachments?.[0]?.url || '';

      // Timeline / Status History
      let timeline = Array.isArray(app.timeline) ? app.timeline : (Array.isArray(app.statusHistory) ? app.statusHistory : []);
      if (timeline.length === 0) {
        timeline = [{
          status: app.status || 'Applied',
          date: app.appliedAt || app.createdAt || new Date().toISOString(),
          notes: 'Application submitted',
          updatedBy: 'Candidate'
        }];
      }

      return {
        ...app,
        _id: appId,
        id: appId,
        applicationId: appId,
        jobId: String(jobId),
        jobTitle: job?.title || job?.jobTitle || app.jobTitle || 'Position',
        companyName: job?.company || job?.companyName || app.companyName || 'CareerFlow',
        candidateName,
        candidateEmail,
        candidatePhone,
        candidateLocation,
        currentCompany: app.currentCompany || cand.currentCompany || '',
        currentRole: app.currentRole || cand.currentRole || '',
        experienceYears: app.experienceYears ?? cand.experienceYears ?? app.experience ?? 0,
        skills: Array.isArray(app.skills) ? app.skills : (Array.isArray(cand.skills) ? cand.skills : []),
        resumeUrl,
        portfolioUrl: app.portfolioUrl || cand.portfolioUrl || '',
        linkedinUrl: app.linkedinUrl || cand.linkedinUrl || '',
        githubUrl: app.githubUrl || cand.githubUrl || '',
        status: app.status || 'Applied',
        appliedAt: app.appliedAt || app.createdAt || new Date().toISOString(),
        updatedAt: app.updatedAt || new Date().toISOString(),
        timeline,
        hrNotes: app.hrNotes || app.notes || '',
        coverLetter: app.coverLetter || cand.coverLetter || '',
        education: Array.isArray(app.education) ? app.education : (Array.isArray(cand.education) ? cand.education : []),
        experience: Array.isArray(app.experience) ? app.experience : (Array.isArray(cand.experience) ? cand.experience : [])
      };
    });

    // 4. Apply status filter
    if (status && status !== 'All') {
      formattedApps = formattedApps.filter(a => String(a.status).toLowerCase() === String(status).toLowerCase());
    }

    // 5. Apply search filter
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      formattedApps = formattedApps.filter(a =>
        a.candidateName.toLowerCase().includes(q) ||
        a.candidateEmail.toLowerCase().includes(q) ||
        a.candidatePhone.toLowerCase().includes(q) ||
        a.skills.some(s => String(s).toLowerCase().includes(q))
      );
    }

    return res.status(200).json({
      success: true,
      count: formattedApps.length,
      data: formattedApps,
      job: job ? {
        _id: String(job._id || job.id || jobId),
        title: job.title || job.jobTitle || 'Position',
        company: job.company || job.companyName || 'CareerFlow',
        location: job.location || 'Remote',
        status: job.status || 'Active'
      } : null
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getJobApplicationsForAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch job applications from Job_db',
      error: error.message
    });
  }
};

/**
 * GET /api/v1/applications/hierarchy/recruiters/:recruiterId/jobs
 * Fetches all jobs posted by a specific recruiter from Job_db -> Jobs
 */
const getRecruiterJobsForAdmin = async (req, res) => {
  try {
    const { recruiterId } = req.params;
    if (!recruiterId) {
      return res.status(400).json({ success: false, message: 'Valid recruiter ID is required' });
    }

    const recObjId = toObjectId(recruiterId);
    const idStr = String(recruiterId).trim();

    const filterConditions = [
      { recruiterId: idStr },
      { recruiter: idStr },
      { userId: idStr },
      { postedByRecruiter: idStr },
      { 'recruiter._id': idStr },
      { createdBy: idStr }
    ];

    if (recObjId) {
      filterConditions.push({ recruiterId: recObjId });
      filterConditions.push({ recruiter: recObjId });
      filterConditions.push({ userId: recObjId });
      filterConditions.push({ 'recruiter._id': recObjId });
      filterConditions.push({ createdBy: recObjId });
    }

    const jobs = await queryJobs({
      $and: [
        { isDeleted: { $ne: true } },
        { $or: filterConditions }
      ]
    });

    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        const jId = job._id || job.id || job.jobId;
        const apps = await findApplicationsForJob(jId);

        return {
          ...job,
          _id: String(job._id || job.id || jId),
          jobId: String(job._id || job.id || jId),
          title: job.title || job.jobTitle || 'Untitled Position',
          company: typeof job.company === 'string' ? job.company : (job.company?.name || job.companyName || 'Recruiter Company'),
          department: job.department || 'General',
          location: job.location || 'Remote',
          salary: job.salary || job.salaryRange || 'Competitive',
          status: job.status || 'Active',
          appliedCount: apps.length,
          hiredCount: apps.filter(a => String(a.status || '').toLowerCase() === 'hired').length,
          createdAt: job.createdAt || new Date().toISOString()
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedJobs.length,
      data: enrichedJobs
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getRecruiterJobsForAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recruiter jobs from Job_db',
      error: error.message
    });
  }
};

/**
 * GET /api/v1/applications/hierarchy/recruiter/jobs
 * Recruiter Portal: Fetches authenticated recruiter's jobs with application metrics from Job_db
 */
const getRecruiterJobsWithStats = async (req, res) => {
  try {
    const recruiterId = req.user?.id || req.user?._id || req.user?.userId;
    if (!recruiterId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const recObjId = toObjectId(recruiterId);
    const idStr = String(recruiterId).trim();

    const filterConditions = [
      { recruiterId: idStr },
      { recruiter: idStr },
      { userId: idStr },
      { postedByRecruiter: idStr },
      { 'recruiter._id': idStr },
      { createdBy: idStr }
    ];

    if (recObjId) {
      filterConditions.push({ recruiterId: recObjId });
      filterConditions.push({ recruiter: recObjId });
      filterConditions.push({ userId: recObjId });
      filterConditions.push({ 'recruiter._id': recObjId });
      filterConditions.push({ createdBy: recObjId });
    }

    const jobs = await queryJobs({
      $and: [
        { isDeleted: { $ne: true } },
        { $or: filterConditions }
      ]
    });

    const enrichedJobs = await Promise.all(
      jobs.map(async (job) => {
        const jId = job._id || job.id || job.jobId;
        const apps = await findApplicationsForJob(jId);

        return {
          ...job,
          _id: String(job._id || job.id || jId),
          jobId: String(job._id || job.id || jId),
          title: job.title || job.jobTitle || 'Untitled Position',
          company: typeof job.company === 'string' ? job.company : (job.company?.name || job.companyName || 'My Company'),
          department: job.department || 'General',
          location: job.location || 'Remote',
          salary: job.salary || job.salaryRange || 'Competitive',
          status: job.status || 'Active',
          appliedCount: apps.length,
          hiredCount: apps.filter(a => String(a.status || '').toLowerCase() === 'hired').length,
          createdAt: job.createdAt || new Date().toISOString()
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedJobs.length,
      data: enrichedJobs
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getRecruiterJobsWithStats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recruiter jobs from Job_db',
      error: error.message
    });
  }
};

/**
 * GET /api/v1/applications/hierarchy/recruiter/jobs/:jobId/applications
 * Recruiter Portal: Fetches applications for authenticated recruiter's job from Job_db
 */
const getRecruiterJobApplications = async (req, res) => {
  try {
    const recruiterId = req.user?.id || req.user?._id || req.user?.userId;
    const { jobId } = req.params;
    const { status, search } = req.query;

    if (!recruiterId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!jobId || jobId === 'undefined' || jobId === 'null') {
      return res.status(400).json({ success: false, message: 'Valid job ID is required' });
    }

    // Verify ownership of the job in Job_db
    const job = await findJobById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found in Job_db' });
    }

    const jobRecId = String(job.recruiterId || job.recruiter || job.userId || job.postedByRecruiter || job.createdBy || '');
    const userRole = String(req.user?.role || '').toLowerCase();
    
    if (userRole !== 'admin' && userRole !== 'superadmin' && jobRecId && jobRecId !== String(recruiterId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized: You do not own this job' });
    }

    // Fetch applications from Job_db
    const rawApps = await findApplicationsForJob(jobId);

    let formattedApps = rawApps.map(app => {
      const appId = String(app._id || app.id || app.applicationId);
      const cand = app.candidate || app.candidateId || app.applicant || {};
      const user = app.userId || {};

      return {
        ...app,
        _id: appId,
        id: appId,
        applicationId: appId,
        jobId: String(jobId),
        candidateName: app.candidateName || app.fullName || app.name || cand.fullName || cand.name || user.name || 'Candidate',
        candidateEmail: app.candidateEmail || app.email || cand.email || user.email || 'N/A',
        candidatePhone: app.candidatePhone || app.phone || cand.phone || user.phone || 'N/A',
        resumeUrl: app.resumeUrl || app.resume || cand.resumeUrl || cand.resume || '',
        skills: Array.isArray(app.skills) ? app.skills : (Array.isArray(cand.skills) ? cand.skills : []),
        status: app.status || 'Applied',
        appliedAt: app.appliedAt || app.createdAt || new Date().toISOString(),
        timeline: Array.isArray(app.timeline) ? app.timeline : [],
        hrNotes: app.hrNotes || app.notes || ''
      };
    });

    if (status && status !== 'All') {
      formattedApps = formattedApps.filter(a => String(a.status).toLowerCase() === String(status).toLowerCase());
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      formattedApps = formattedApps.filter(a =>
        a.candidateName.toLowerCase().includes(q) ||
        a.candidateEmail.toLowerCase().includes(q) ||
        a.skills.some(s => String(s).toLowerCase().includes(q))
      );
    }

    return res.status(200).json({
      success: true,
      count: formattedApps.length,
      data: formattedApps,
      job: {
        _id: String(job._id || job.id || jobId),
        title: job.title || job.jobTitle || 'Position',
        company: job.company || job.companyName || 'Company'
      }
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in getRecruiterJobApplications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch applications from Job_db',
      error: error.message
    });
  }
};

/**
 * PATCH /api/v1/applications/hierarchy/applications/:applicationId/status
 * Updates application status and persists timeline milestone in Job_db
 */
const updateApplicationStatusByAdmin = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, hrNotes } = req.body;

    if (!applicationId || !status) {
      return res.status(400).json({ success: false, message: 'Application ID and new status are required' });
    }

    // Find current application
    const appObjId = toObjectId(applicationId);
    const idStr = String(applicationId).trim();
    const filter = appObjId
      ? { $or: [{ _id: appObjId }, { _id: idStr }, { id: idStr }, { applicationId: idStr }] }
      : { $or: [{ _id: idStr }, { id: idStr }, { applicationId: idStr }] };

    const apps = await queryApplications(filter);
    if (!apps || apps.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found in Job_db' });
    }

    const currentApp = apps[0];
    const currentStatus = currentApp.status || 'Applied';

    // Validate workflow transition
    const validTransitions = WORKFLOW_TRANSITIONS[currentStatus] || [];
    if (currentStatus !== status && validTransitions.length > 0 && !validTransitions.includes(status)) {
      const isAdmin = String(req.user?.role || '').toLowerCase().includes('admin');
      if (!isAdmin) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from "${currentStatus}" to "${status}". Allowed: ${validTransitions.join(', ')}`
        });
      }
    }

    // Append to timeline
    const existingTimeline = Array.isArray(currentApp.timeline)
      ? currentApp.timeline
      : (Array.isArray(currentApp.statusHistory) ? currentApp.statusHistory : []);

    const newMilestone = {
      status,
      date: new Date().toISOString(),
      notes: hrNotes || `Status updated to ${status}`,
      updatedBy: req.user?.name || req.user?.email || 'Admin'
    };

    const updateFields = {
      status,
      timeline: [...existingTimeline, newMilestone],
      updatedAt: new Date().toISOString()
    };

    if (hrNotes !== undefined) {
      updateFields.hrNotes = hrNotes;
    }

    const updatedApp = await updateApplicationDoc(applicationId, updateFields);

    return res.status(200).json({
      success: true,
      message: `Application status successfully updated to "${status}" in Job_db`,
      data: updatedApp || { ...currentApp, ...updateFields }
    });
  } catch (error) {
    console.error('[ApplicationHierarchy] Error in updateApplicationStatusByAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update application status in Job_db',
      error: error.message
    });
  }
};

module.exports = {
  getAdminPostedJobs,
  getCompaniesWithStats,
  getJobsByCompany,
  getJobApplicationsForAdmin,
  getRecruiterJobsForAdmin,
  getRecruiterJobsWithStats,
  getRecruiterJobApplications,
  updateApplicationStatusByAdmin
};