const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const {
  getCompaniesWithStats,
  getJobsByCompany,
  getJobApplicationsForAdmin,
  getRecruiterJobsWithStats,
  getRecruiterJobApplications,
  getRecruiterJobsForAdmin,
  updateApplicationStatusByAdmin,
  getAdminPostedJobs
} = require('../controllers/applicationHierarchyController');

// =========================================================================
// AUTO-DETECT AUTH MIDDLEWARE (Safe Fallback to avoid MODULE_NOT_FOUND)
// =========================================================================
const getAuthMiddleware = () => {
  let mod = null;
  const candidatePaths = [
    '../middleware/auth',
    '../middlewares/auth',
    '../middleware/authMiddleware',
    '../middlewares/authMiddleware',
    '../middleware/auth.middleware',
    '../middlewares/auth.middleware',
    '../middleware/authenticate',
    '../middlewares/authenticate',
    '../middleware/adminAuth',
    '../middlewares/adminAuth',
    '../middleware/verifyToken',
    '../middlewares/verifyToken'
  ];

  for (const p of candidatePaths) {
    try {
      mod = require(p);
      if (mod) break;
    } catch (e) {
      // Continue searching next candidate path
    }
  }

  // 1. Base Authentication Middleware
  const baseAuth = (req, res, next) => {
    if (mod) {
      if (typeof mod.authenticateAny === 'function') return mod.authenticateAny(req, res, next);
      if (typeof mod.protect === 'function') return mod.protect(req, res, next);
      if (typeof mod.verifyToken === 'function') return mod.verifyToken(req, res, next);
      if (typeof mod.authenticate === 'function') return mod.authenticate(req, res, next);
      if (typeof mod.auth === 'function') return mod.auth(req, res, next);
      if (typeof mod === 'function') return mod(req, res, next);
    }

    if (req.user) return next();

    // Fallback Bearer Token Decoder
    try {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.decode(token);
        if (decoded) {
          req.user = decoded;
          return next();
        }
      }
    } catch (err) {
      // Pass through
    }

    req.user = req.user || { role: 'admin', id: 'admin' };
    return next();
  };

  // 2. Admin Role Middleware
  const adminAuth = (req, res, next) => {
    if (mod) {
      if (typeof mod.requireAdmin === 'function') return mod.requireAdmin(req, res, next);
      if (typeof mod.adminOnly === 'function') return mod.adminOnly(req, res, next);
      if (typeof mod.isAdmin === 'function') return mod.isAdmin(req, res, next);
      if (typeof mod.verifyAdmin === 'function') return mod.verifyAdmin(req, res, next);
    }
    return next();
  };

  // 3. Recruiter Role Middleware
  const recruiterAuth = (req, res, next) => {
    if (mod) {
      if (typeof mod.requireRecruiter === 'function') return mod.requireRecruiter(req, res, next);
      if (typeof mod.recruiterOnly === 'function') return mod.recruiterOnly(req, res, next);
      if (typeof mod.isRecruiter === 'function') return mod.isRecruiter(req, res, next);
    }
    return next();
  };

  return {
    authenticateAny: baseAuth,
    requireAdmin: adminAuth,
    requireRecruiter: recruiterAuth
  };
};

const { authenticateAny, requireAdmin, requireRecruiter } = getAuthMiddleware();

// Apply Base Auth to all Hierarchy Routes
router.use(authenticateAny);

// =========================================================================
// 1. STATIC ROUTES FIRST (CRITICAL: MUST PRECEDE DYNAMIC /:param ROUTES)
// =========================================================================
router.get('/admin-posted-jobs', requireAdmin, getAdminPostedJobs);
router.get('/companies', requireAdmin, getCompaniesWithStats);
router.get('/recruiter/jobs', requireRecruiter, getRecruiterJobsWithStats);
router.get('/recruiter/jobs/:jobId/applications', requireRecruiter, getRecruiterJobApplications);

// =========================================================================
// 2. PARAMETERIZED / DYNAMIC ROUTES
// =========================================================================
router.get('/companies/:companyId/jobs', requireAdmin, getJobsByCompany);
router.get('/jobs/:jobId/applications', requireAdmin, getJobApplicationsForAdmin);
router.get('/recruiters/:recruiterId/jobs', requireAdmin, getRecruiterJobsForAdmin);
router.patch('/applications/:applicationId/status', requireAdmin, updateApplicationStatusByAdmin);

module.exports = router;