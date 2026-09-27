// FILE: backend/src/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Admin = require("../models/Admin");
const Role = require("../models/Role");

// Standardized fallback matching the rest of the application
const JWT_SECRET = process.env.JWT_SECRET || "careerflow_super_secret_jwt_key_2026_production_fallback";

/**
 * Main Auth Protection Middleware
 */
const protect = async (req, res, next) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token || token === "null" || token === "undefined") {
      console.warn("⚠️ [AUTH] No bearer token supplied in headers");
      return res.status(401).json({
        success: false,
        accountStatus: "unauthorized",
        message: "Not authorized, token missing",
      });
    }

    // Verify token with consistent secret
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error("❌ [AUTH] JWT Verification Failed:", err.message);
      return res.status(401).json({
        success: false,
        accountStatus: err.name === "TokenExpiredError" ? "expired" : "invalid",
        message: err.name === "TokenExpiredError" ? "Session expired, please login again" : "Invalid token",
      });
    }

    const userId = decoded.adminId || decoded.id || decoded._id || decoded.userId;

    if (!userId) {
      console.error("❌ [AUTH] Token payload does not contain an ID:", decoded);
      return res.status(401).json({
        success: false,
        accountStatus: "invalid",
        message: "Malformed token payload",
      });
    }

    // 1. Check Admin Portal Users database first
    let adminUser = await Admin.findById(userId).select("-password").lean();

    if (adminUser) {
      if (adminUser.isActive === false) {
        return res.status(401).json({
          success: false,
          accountStatus: "deactivated",
          message: "Your administrator account has been deactivated.",
        });
      }

      // Resolve role permissions from DB
      let permissions = [];
      if (adminUser.role && Role) {
        try {
          const roleDoc = await Role.findOne({ name: adminUser.role }).lean();
          if (roleDoc && Array.isArray(roleDoc.permissions)) {
            permissions = roleDoc.permissions;
          }
        } catch (e) {
          console.error("Failed to query role permissions:", e.message);
        }
      }

      // Attach complete object to all standard request properties
      const authPayload = {
        ...adminUser,
        _id: adminUser._id,
        id: adminUser._id,
        adminId: adminUser._id,
        permissions: permissions,
        roleRef: {
          name: adminUser.role,
          permissions: permissions,
        },
      };

      req.user = authPayload;
      req.admin = authPayload;
      req.authUser = authPayload;

      return next();
    }

    // 2. Check Candidate / Recruiter User database
    let regularUser = await User.findById(userId).select("-password").lean();
    if (regularUser) {
      if (regularUser.isActive === false) {
        return res.status(403).json({
          success: false,
          accountStatus: "deactivated",
          message: "Your account has been blocked by admin.",
        });
      }

      const authPayload = {
        ...regularUser,
        _id: regularUser._id,
        id: regularUser._id,
        permissions: [],
      };

      req.user = authPayload;
      req.authUser = authPayload;
      return next();
    }

    // User not found in any collection
    console.warn(`⚠️ [AUTH] Account ID ${userId} not found in database`);
    return res.status(401).json({
      success: false,
      accountStatus: "deleted",
      message: "Account no longer exists in database",
    });
  } catch (error) {
    console.error("❌ [AUTH] Middleware Unexpected Error:", error);
    return res.status(401).json({
      success: false,
      accountStatus: "invalid",
      message: "Authentication validation error",
    });
  }
};

/**
 * Dynamic Permission Validation Middleware
 */
const requirePermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = req.user || req.admin || req.authUser;
      if (!user) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      // Super Admin bypass
      if (user.role === "Super Admin" || (user.roleRef && user.roleRef.name === "Super Admin")) {
        return next();
      }

      // Check array
      const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
      if (userPerms.includes(requiredPermission)) {
        return next();
      }

      // Check directly in database if not cached on object
      if (user.role && Role) {
        const roleDoc = await Role.findOne({ name: user.role }).lean();
        if (roleDoc && Array.isArray(roleDoc.permissions) && roleDoc.permissions.includes(requiredPermission)) {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: `Access denied. You require the '${requiredPermission}' permission.`,
      });
    } catch (error) {
      console.error("Permission Middleware Error:", error);
      res.status(500).json({ success: false, message: "Authorization server error" });
    }
  };
};

/**
 * Multi-Role/Permission Hybrid Check
 */
const checkRecruiterOrAdminPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = req.user || req.admin || req.authUser;
      if (!user) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      if (user.role === "recruiter") {
        return next();
      }

      if (user.role === "Super Admin" || (user.roleRef && user.roleRef.name === "Super Admin")) {
        return next();
      }

      const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
      if (userPerms.includes(requiredPermission)) {
        return next();
      }

      if (user.role && Role) {
        const roleDoc = await Role.findOne({ name: user.role }).lean();
        if (roleDoc && Array.isArray(roleDoc.permissions) && roleDoc.permissions.includes(requiredPermission)) {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: `Access denied. Requires '${requiredPermission}' permission.`,
      });
    } catch (error) {
      console.error("Hybrid Auth Middleware Error:", error);
      res.status(500).json({ success: false, message: "Authorization check failed" });
    }
  };
};

module.exports = {
  protect,
  requirePermission,
  checkRecruiterOrAdminPermission,
};