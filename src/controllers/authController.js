// FILE: backend/src/controllers/authController.js
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const AuditLog = require("../models/AuditLog");
const { logAudit } = require("../utils/auditLogger");
const { getRoleByName } = require("./roleController");

const JWT_SECRET = process.env.JWT_SECRET || "careerflow_super_secret_jwt_key_2026_production_fallback";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// ═══════════════════════════════════════════════════════════════════
// INSTANT REAL-TIME SSE CLIENT REGISTRY (0ms Push Notification)
// ═══════════════════════════════════════════════════════════════════
// Map: adminId -> Set of active SSE response streams
const activeAdminStreams = new Map();

/**
 * Instantly broadcasts a kill-signal to a target admin's open browser tab(s)
 */
const notifyAdminRevoked = (adminId, reason = "Your account has been deleted or deactivated.") => {
  const targetId = String(adminId);
  const clientStreams = activeAdminStreams.get(targetId);

  if (clientStreams && clientStreams.size > 0) {
    const payload = JSON.stringify({
      type: "FORCE_LOGOUT",
      reason,
      timestamp: Date.now(),
    });

    clientStreams.forEach((res) => {
      try {
        res.write(`data: ${payload}\n\n`);
      } catch (err) {
        console.warn("Could not push SSE kill signal:", err.message);
      }
    });

    console.log(`⚡ [INSTANT LOGOUT] Push notification delivered to adminId: ${targetId}`);
  }
};

/**
 * SSE Endpoint: GET /api/v1/auth/stream
 * Keeps a persistent, low-overhead HTTP connection open with the admin browser
 */
const streamAdminEvents = async (req, res) => {
  try {
    // Read token from query string or headers
    const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(" ")[1]);

    if (!token) {
      return res.status(401).json({ success: false, message: "Token required for live stream" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const adminId = String(decoded.adminId || decoded.id);

    // Verify admin exists in DB
    const admin = await Admin.findById(adminId);
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: "Account inactive or deleted" });
    }

    // Configure headers for Server-Sent Events (SSE)
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`data: ${JSON.stringify({ type: "CONNECTED", adminId })}\n\n`);

    // Register active stream
    if (!activeAdminStreams.has(adminId)) {
      activeAdminStreams.set(adminId, new Set());
    }
    activeAdminStreams.get(adminId).add(res);

    // Keepalive ping every 25 seconds to prevent timeout through proxies
    const keepAliveTimer = setInterval(() => {
      try {
        res.write(`: keepalive\n\n`);
      } catch {
        clearInterval(keepAliveTimer);
      }
    }, 25000);

    // Clean up when admin closes the tab
    req.on("close", () => {
      clearInterval(keepAliveTimer);
      const set = activeAdminStreams.get(adminId);
      if (set) {
        set.delete(res);
        if (set.size === 0) activeAdminStreams.delete(adminId);
      }
    });
  } catch (error) {
    console.error("SSE stream error:", error);
    res.status(500).end();
  }
};

const generateToken = (admin) => {
  return jwt.sign(
    {
      adminId: admin._id,
      id: admin._id,
      email: admin.email,
      role: admin.role,
      name: admin.name,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// ═══════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Please provide email and password" });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Auto-seed default Super Admin if DB is completely empty
    const totalAdmins = await Admin.countDocuments();
    if (totalAdmins === 0) {
      const defaultSuperAdmin = new Admin({
        name: "Bhavuk Deshmukh",
        email: "superadmin@careerflow.com",
        password: "SuperAdmin@123",
        role: "Super Admin",
        department: "Executive Leadership",
        isActive: true,
      });
      await defaultSuperAdmin.save();
    }

    let admin = await Admin.findOne({ email: cleanEmail }).select("+password");

    if (!admin && cleanEmail === "superadmin@careerflow.com") {
      admin = new Admin({
        name: "Bhavuk Deshmukh",
        email: "superadmin@careerflow.com",
        password: "SuperAdmin@123",
        role: "Super Admin",
        department: "Executive Leadership",
        isActive: true,
      });
      await admin.save();
      admin = await Admin.findOne({ email: cleanEmail }).select("+password");
    }

    if (!admin) {
      logAudit(req, {
        action: "LOGIN_FAILED",
        category: "auth",
        adminName: "Unknown",
        adminEmail: cleanEmail,
        adminRole: "None",
        description: `Failed login attempt: ${cleanEmail}`,
        status: "failed",
      }).catch(() => {});

      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (admin.isActive === false) {
      return res.status(403).json({
        success: false,
        message: `Account deactivated. ${admin.disabledReason ? "(" + admin.disabledReason + ")" : ""}`,
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      logAudit(req, {
        action: "LOGIN_FAILED",
        category: "auth",
        adminId: admin._id,
        adminName: admin.name,
        adminEmail: admin.email,
        adminRole: admin.role,
        description: `Wrong password for ${admin.email}`,
        status: "failed",
      }).catch(() => {});

      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // Update session timestamp
    await Admin.findByIdAndUpdate(admin._id, {
      $set: {
        lastLoginAt: new Date(),
        lastLoginIP: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
        lastLoginUserAgent: req.headers["user-agent"] || "",
      },
      $inc: { loginCount: 1 },
    });

    const token = generateToken(admin);

    // ═══════════════════════════════════════════════════════════════
    // FETCH DYNAMIC PERMISSIONS FROM ROLE MODEL
    // ═══════════════════════════════════════════════════════════════
 // Just before return res.status(200).json(...)

// ═══════════════════════════════════════════════════════════════
// FETCH DYNAMIC PERMISSIONS FROM ROLE MODEL
// ═══════════════════════════════════════════════════════════════
const roleDoc = await getRoleByName(admin.role);
const permissions = roleDoc ? roleDoc.permissions : [];
const landingPage = roleDoc ? roleDoc.landingPage : "dashboard";

console.log(`\n🔐 LOGIN: ${admin.email} → Role: "${admin.role}"`);
console.log(`   Permissions found in DB: [${permissions.join(", ")}]`);
console.log(`   Landing page: ${landingPage}\n`);

logAudit(req, {
  action: "LOGIN_SUCCESS",
  category: "auth",
  adminId: admin._id,
  adminName: admin.name,
  adminEmail: admin.email,
  adminRole: admin.role,
  targetType: "Admin",
  targetId: admin._id,
  targetName: admin.name,
  description: `${admin.name} (${admin.role}) logged in successfully`,
}).catch(() => {});

return res.status(200).json({
  success: true,
  message: "Login successful",
  token,
  admin: {
    id: admin._id,
    adminId: admin._id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    department: admin.department,
    avatarUrl: admin.avatarUrl,
    permissions,      // ← CRITICAL
    landingPage,      // ← CRITICAL
  },
});
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// GET ME (with dynamic permissions)
// ═══════════════════════════════════════════════════════════════════
const getMe = async (req, res) => {
  try {
    const adminId = req.admin?.adminId || req.admin?.id;
    const admin = await Admin.findById(adminId).select("-password");

    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, accountStatus: "deleted", message: "Account is no longer active" });
    }

    // ═══════════════════════════════════════════════════════════════
    // FETCH FRESH PERMISSIONS FROM ROLE MODEL
    // ═══════════════════════════════════════════════════════════════
    const roleDoc = await getRoleByName(admin.role);
    const permissions = roleDoc ? roleDoc.permissions : [];
    const landingPage = roleDoc ? roleDoc.landingPage : "dashboard";

    return res.status(200).json({
      success: true,
      admin: {
        id: admin._id,
        adminId: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        department: admin.department,
        avatarUrl: admin.avatarUrl,
        phone: admin.phone,
        isActive: admin.isActive,
        lastLoginAt: admin.lastLoginAt,
        loginCount: admin.loginCount,
        permissions,
        landingPage,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════════
const logout = async (req, res) => {
  try {
    logAudit(req, {
      action: "LOGOUT",
      category: "auth",
      targetType: "Admin",
      targetId: req.admin?.adminId,
      description: `${req.admin?.email || "Admin"} logged out`,
    }).catch(() => {});
    return res.status(200).json({ success: true, message: "Logged out" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Logout error" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// GET ALL ADMINS
// ═══════════════════════════════════════════════════════════════════
const getAllAdmins = async (req, res) => {
  try {
    const { role, isActive, search } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const admins = await Admin.find(filter).select("-password").sort({ createdAt: -1 });
    const stats = {
      total: await Admin.countDocuments(),
      active: await Admin.countDocuments({ isActive: true }),
      inactive: await Admin.countDocuments({ isActive: false }),
    };

    return res.status(200).json({ success: true, data: admins, stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
// CREATE ADMIN
// ═══════════════════════════════════════════════════════════════════
const createAdmin = async (req, res) => {
  try {
    const { name, email, password, role, department, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password required" });
    }

    const existing = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email is already registered" });
    }

    const newAdmin = new Admin({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || "Admin",
      department: department || "Operations",
      phone: phone || "",
      createdBy: req.admin?.adminId || null,
    });
    await newAdmin.save();

    logAudit(req, {
      action: "ADMIN_CREATED",
      category: "admin",
      targetType: "Admin",
      targetId: newAdmin._id,
      targetName: newAdmin.name,
      description: `Created new ${newAdmin.role}: ${newAdmin.name} (${newAdmin.email})`,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: `${newAdmin.role} account created successfully`,
      admin: newAdmin,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
// UPDATE ADMIN
// ═══════════════════════════════════════════════════════════════════
const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, department, phone } = req.body;

    const updated = await Admin.findByIdAndUpdate(
      id,
      { $set: { name, role, department, phone } },
      { new: true, runValidators: true }
    ).select("-password");

    logAudit(req, {
      action: "ADMIN_UPDATED",
      category: "admin",
      targetType: "Admin",
      targetId: id,
      targetName: updated?.name,
      description: `Admin profile updated: ${updated?.name}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, data: updated, message: "Admin updated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
// TOGGLE STATUS: EMITS INSTANT KILL SIGNAL IF DEACTIVATED
// ═══════════════════════════════════════════════════════════════════
const toggleAdminStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const admin = await Admin.findById(id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    admin.isActive = !admin.isActive;
    admin.disabledReason = !admin.isActive ? (reason || "Deactivated by Super Admin") : "";
    await admin.save();

    // ⚡ INSTANT KILL SIGNAL: If deactivated, disconnect immediately in 0ms
    if (!admin.isActive) {
      notifyAdminRevoked(admin._id, `Your account was deactivated. Reason: ${admin.disabledReason}`);
    }

    logAudit(req, {
      action: admin.isActive ? "ADMIN_ACTIVATED" : "ADMIN_DEACTIVATED",
      category: "admin",
      targetType: "Admin",
      targetId: admin._id,
      targetName: admin.name,
      description: `${admin.isActive ? "Activated" : "Deactivated"} admin: ${admin.name}`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Admin ${admin.isActive ? "activated" : "deactivated"}`,
      admin,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
// RESET ADMIN PASSWORD
// ═══════════════════════════════════════════════════════════════════
const resetAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const admin = await Admin.findById(id).select("+password");
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    admin.password = newPassword;
    await admin.save();

    // ⚡ Force the user to log in again with the new password
    notifyAdminRevoked(admin._id, "Your password was reset by a Super Admin. Please log in again.");

    logAudit(req, {
      action: "ADMIN_PASSWORD_RESET",
      category: "admin",
      targetType: "Admin",
      targetId: admin._id,
      targetName: admin.name,
      description: `Password reset for ${admin.name}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, message: `Password reset for ${admin.name}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
// DELETE ADMIN: EMITS INSTANT KILL SIGNAL BEFORE DELETING FROM DB
// ═══════════════════════════════════════════════════════════════════
const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    // ⚡ INSTANT KILL SIGNAL: Kill the session in 0ms
    notifyAdminRevoked(id, `Your account (${admin.email}) was permanently removed by Super Admin.`);

    await Admin.findByIdAndDelete(id);

    logAudit(req, {
      action: "ADMIN_DELETED",
      category: "admin",
      targetType: "Admin",
      targetId: id,
      targetName: admin.name,
      description: `Deleted admin: ${admin.name} (${admin.email})`,
    }).catch(() => {});

    return res.status(200).json({ success: true, message: "Admin deleted permanently" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════
const getAuditLogs = async (req, res) => {
  try {
    const { category, search, limit = 100 } = req.query;
    const filter = {};
    if (category && category !== "all") filter.category = category;
    if (search) {
      filter.$or = [
        { adminName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(Number(limit) || 100);
    const stats = {
      total: await AuditLog.countDocuments(),
      today: await AuditLog.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
      failed: await AuditLog.countDocuments({ status: "failed" }),
    };

    return res.status(200).json({ success: true, data: logs, stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  login,
  logout,
  getMe,
  streamAdminEvents,
  getAllAdmins,
  createAdmin,
  updateAdmin,
  toggleAdminStatus,
  resetAdminPassword,
  deleteAdmin,
  getAuditLogs,
};