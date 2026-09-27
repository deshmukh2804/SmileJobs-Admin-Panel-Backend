// FILE: backend/src/middleware/roleMiddleware.js
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Recruiter = require("../models/Recruiter");
const User = require("../models/User");

// Safely require Role model without breaking if not yet loaded
let Role;
try {
  Role = require("../models/Role");
} catch (e) {
  // Fallback
}

const JWT_SECRET = process.env.JWT_SECRET || "careerflow_super_secret_jwt_key_2026_production_fallback";

// Normalize any role string for comparison
const normalizeRole = (role) => {
  if (!role) return "";
  return role.toLowerCase().replace(/[\s_-]+/g, "").trim();
};

const SUPER_ADMIN_VARIANTS = ["Super Admin", "super_admin", "superadmin", "SuperAdmin"];
const ADMIN_VARIANTS = ["Admin", "admin", "Administrator"];

const isSuperAdmin = (role) => {
  const norm = normalizeRole(role);
  return SUPER_ADMIN_VARIANTS.some((v) => normalizeRole(v) === norm);
};

const isAnyAdmin = (role) => {
  const norm = normalizeRole(role);
  const allAdminRoles = [
    "superadmin",
    "admin",
    "moderator",
    "supportagent",
    "contentmanager",
    "financemanager",
  ];
  return allAdminRoles.includes(norm);
};

// Map URL paths to their respective role permissions
const getRequiredPermissionForPath = (path) => {
  const normPath = (path || "").toLowerCase();
  if (normPath.includes("/notifications")) return "notifications";
  if (normPath.includes("/jobs")) return "jobs";
  if (normPath.includes("/users") || normPath.includes("/candidates") || normPath.includes("/recruiters")) return "users";
  if (normPath.includes("/applications")) return "applications";
  if (normPath.includes("/resumes") || normPath.includes("/profiles")) return "resumes-and-profiles";
  if (normPath.includes("/verification")) return "verification";
  if (normPath.includes("/payments") || normPath.includes("/billing")) return "payments-and-billing";
  if (normPath.includes("/reports") || normPath.includes("/complaints")) return "reports-and-complaints";
  if (normPath.includes("/content")) return "content-management";
  if (normPath.includes("/banners")) return "banners";
  if (normPath.includes("/roles") || normPath.includes("/permissions")) return "roles-and-permissions";
  if (normPath.includes("/settings")) return "platform-settings";
  if (normPath.includes("/logs")) return "admin-activity-log";
  return "";
};

// Check if user has permission
const hasPermission = (authUser, requiredPermission) => {
  if (!authUser) return false;
  if (isSuperAdmin(authUser.role)) return true;
  if (Array.isArray(authUser.permissions)) {
    return authUser.permissions.includes(requiredPermission);
  }
  return false;
};

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATE ANY: LIVE DATABASE VERIFICATION ON EVERY REQUEST
// ═══════════════════════════════════════════════════════════════════
const authenticateAny = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        accountStatus: "unauthorized",
        message: "Not authorized, no token provided",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.adminId || decoded.id || decoded._id || decoded.userId;

    // 🛡️ 1. Check Admin Portal database (NO .populate("roleRef"))
    const adminUser = await Admin.findById(userId).lean();

    if (adminUser) {
      if (adminUser.isActive === false) {
        return res.status(401).json({
          success: false,
          accountStatus: "deactivated",
          message: "Your administrator account has been deactivated.",
        });
      }

      // Look up permissions dynamically using the role name (e.g. "fgn", "Super Admin")
      let permissions = [];
      if (adminUser.role && Role) {
        try {
          const foundRole = await Role.findOne({ name: adminUser.role }).lean();
          if (foundRole && Array.isArray(foundRole.permissions)) {
            permissions = foundRole.permissions;
          }
        } catch (err) {
          console.error("Role lookup error:", err.message);
        }
      }

      req.authUser = {
        id: adminUser._id,
        adminId: adminUser._id,
        email: adminUser.email,
        role: adminUser.role,
        name: adminUser.name,
        permissions: permissions,
      };
      req.admin = req.authUser;
      return next();
    }

    // 🛡️ 2. Check Recruiter database
    const recruiterUser = await Recruiter.findById(userId).lean();
    if (recruiterUser) {
      if (recruiterUser.isActive === false) {
        return res.status(401).json({
          success: false,
          accountStatus: "deactivated",
          message: "Your recruiter account has been deactivated.",
        });
      }

      req.authUser = {
        id: recruiterUser._id,
        email: recruiterUser.email,
        role: "recruiter",
        name: recruiterUser.name,
        permissions: [],
      };
      return next();
    }

    // 🛡️ 3. Check Candidate / Regular User database
    const regularUser = await User.findById(userId).lean();
    if (regularUser) {
      if (regularUser.isActive === false) {
        return res.status(401).json({
          success: false,
          accountStatus: "deactivated",
          message: "Your account has been deactivated.",
        });
      }

      req.authUser = {
        id: regularUser._id,
        email: regularUser.email,
        role: regularUser.role || "user",
        name: regularUser.name,
        permissions: [],
      };
      return next();
    }

    // Account not found anywhere in DB
    return res.status(401).json({
      success: false,
      accountStatus: "deleted",
      message: "Your account no longer exists or was deleted.",
    });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        accountStatus: "expired",
        message: "Session expired, please login again",
      });
    }
    return res.status(401).json({
      success: false,
      accountStatus: "invalid",
      message: "Invalid token",
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.authUser = null;
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.adminId || decoded.id || decoded._id;

    const adminUser = await Admin.findById(userId).lean();
    if (adminUser && adminUser.isActive !== false) {
      let permissions = [];
      if (adminUser.role && Role) {
        try {
          const foundRole = await Role.findOne({ name: adminUser.role }).lean();
          if (foundRole && Array.isArray(foundRole.permissions)) {
            permissions = foundRole.permissions;
          }
        } catch (e) {}
      }

      req.authUser = {
        id: adminUser._id,
        adminId: adminUser._id,
        email: adminUser.email,
        role: adminUser.role,
        name: adminUser.name,
        permissions: permissions,
      };
      req.admin = req.authUser;
      return next();
    }

    req.authUser = null;
    next();
  } catch (error) {
    req.authUser = null;
    next();
  }
};

const requireRecruiter = (req, res, next) => {
  if (!req.authUser) {
    return res.status(401).json({ success: false, accountStatus: "deleted", message: "Authentication required." });
  }
  if (isSuperAdmin(req.authUser.role)) return next();
  if (normalizeRole(req.authUser.role) !== "recruiter") {
    return res.status(403).json({ success: false, message: "Access denied. Recruiter role required." });
  }
  next();
};

const requireUser = (req, res, next) => {
  if (!req.authUser) {
    return res.status(401).json({ success: false, accountStatus: "deleted", message: "Authentication required." });
  }
  if (isSuperAdmin(req.authUser.role)) return next();
  if (normalizeRole(req.authUser.role) !== "user") {
    return res.status(403).json({ success: false, message: "Access denied. User role required." });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.authUser) {
    return res.status(401).json({ success: false, accountStatus: "deleted", message: "Authentication required." });
  }
  if (isSuperAdmin(req.authUser.role)) return next();

  // Check dynamic role permissions for custom admin roles
  if (req.admin) {
    const requiredPerm = getRequiredPermissionForPath(req.originalUrl || req.baseUrl || "");
    if (!requiredPerm || hasPermission(req.authUser, requiredPerm)) {
      return next();
    }
  }

  if (!isAnyAdmin(req.authUser.role)) {
    return res.status(403).json({ success: false, message: "Access denied. Administrator role required." });
  }
  next();
};

const requireRecruiterOrAdmin = (req, res, next) => {
  if (!req.authUser) {
    return res.status(401).json({ success: false, accountStatus: "deleted", message: "Authentication required." });
  }
  
  if (isSuperAdmin(req.authUser.role)) return next();

  // Allow custom roles (like "fgn") if they possess the permission (e.g., "notifications")
  if (req.admin) {
    const requiredPerm = getRequiredPermissionForPath(req.originalUrl || req.baseUrl || "");
    if (!requiredPerm || hasPermission(req.authUser, requiredPerm)) {
      return next();
    }
  }

  if (isAnyAdmin(req.authUser.role)) return next();
  if (normalizeRole(req.authUser.role) === "recruiter") return next();

  return res.status(403).json({
    success: false,
    message: "Access denied. Recruiter or Admin role required.",
  });
};

module.exports = {
  authenticateAny,
  optionalAuth,
  requireRecruiter,
  requireUser,
  requireAdmin,
  requireRecruiterOrAdmin,
  isSuperAdmin,
  isAnyAdmin,
  normalizeRole,
};