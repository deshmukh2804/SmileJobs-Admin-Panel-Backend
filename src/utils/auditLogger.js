// FILE: backend/src/utils/auditLogger.js
const AuditLog = require("../models/AuditLog");

const logAudit = async (req = {}, options = {}) => {
  try {
    const adminInfo = req.admin || req.authUser || {};
    const adminId = options.adminId || adminInfo.adminId || adminInfo.id || null;

    const log = new AuditLog({
      adminId: adminId || null,
      adminName: options.adminName || adminInfo.name || "System",
      adminEmail: options.adminEmail || adminInfo.email || "system@careerflow",
      adminRole: options.adminRole || adminInfo.role || "None",

      action: options.action || "OTHER",
      category: options.category || "system",

      targetType: options.targetType || "",
      targetId: options.targetId ? String(options.targetId) : "",
      targetName: options.targetName || "",

      changesBefore: options.changesBefore || null,
      changesAfter: options.changesAfter || null,

      description: options.description || "",
      ipAddress:
        req.headers?.["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        req.ip ||
        "",
      userAgent: req.headers?.["user-agent"] || "",
      endpoint: req.originalUrl || "",
      method: req.method || "",

      status: options.status || "success",
      errorMessage: options.errorMessage || "",
    });

    await log.save();
    return log;
  } catch (err) {
    console.error("❌ Audit log failed:", err.message);
    return null;
  }
};

const getDiff = (before, after) => {
  if (!before || !after) return { before, after };
  const diff = { before: {}, after: {} };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.forEach((key) => {
    if (["password", "__v", "_id", "updatedAt"].includes(key)) return;
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diff.before[key] = b;
      diff.after[key] = a;
    }
  });
  return diff;
};

module.exports = { logAudit, getDiff };