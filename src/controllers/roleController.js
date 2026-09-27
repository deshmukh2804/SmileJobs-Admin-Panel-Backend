// FILE: backend/src/controllers/roleController.js
const Role = require("../models/Role");
const Admin = require("../models/Admin");
const { AVAILABLE_PERMISSIONS } = require("../models/Role");
const { logAudit } = require("../utils/auditLogger");
const { isSuperAdmin } = require("../middleware/roleMiddleware");

// ═══════════════════════════════════════════════════════════════
// SEED DEFAULT SYSTEM ROLES (called on server start)
// ═══════════════════════════════════════════════════════════════
const seedDefaultRoles = async () => {
  try {
    const defaults = [
      {
        name: "Super Admin",
        description: "Unrestricted enterprise control, security policies, billing & global oversight.",
        permissions: AVAILABLE_PERMISSIONS,
        isSystem: true,
        color: "#7C3AED",
        icon: "shield",
        landingPage: "dashboard",
      },
      {
        name: "Admin",
        description: "Operational administration across jobs, users, applications, and general queues.",
        permissions: [
          "dashboard", "users", "jobs", "applications", "resumes-and-profiles",
          "verification", "reports-and-complaints", "content-management",
          "banners", "notifications", "admin-activity-log",
        ],
        isSystem: true,
        color: "#2563EB",
        icon: "admin_panel_settings",
        landingPage: "dashboard",
      },
      {
        name: "Moderator",
        description: "Compliance auditing, KYC inspection, employer verification & trust safety.",
        permissions: ["verification", "jobs", "users", "resumes-and-profiles", "reports-and-complaints", "admin-activity-log"],
        isSystem: true,
        color: "#059669",
        icon: "verified_user",
        landingPage: "verification",
      },
      {
        name: "Support Agent",
        description: "Candidate assistance, employer tickets, dispute mediation & incident resolution.",
        permissions: ["reports-and-complaints", "users", "resumes-and-profiles", "applications", "notifications"],
        isSystem: true,
        color: "#D97706",
        icon: "support_agent",
        landingPage: "reports-and-complaints",
      },
      {
        name: "Content Manager",
        description: "Editorial guides, spotlight banners, marketing campaigns & notifications.",
        permissions: ["content-management", "banners", "notifications", "resumes-and-profiles"],
        isSystem: true,
        color: "#DB2777",
        icon: "edit_note",
        landingPage: "content-management",
      },
      {
        name: "Finance Manager",
        description: "Corporate billing, Razorpay/Stripe reconciliation, invoices & revenue audit.",
        permissions: ["payments-and-billing", "dashboard", "reports-and-complaints"],
        isSystem: true,
        color: "#0891B2",
        icon: "account_balance",
        landingPage: "payments-and-billing",
      },
      {
        name: "Jobs Only",
        description: "Restricted access to Jobs Management section only.",
        permissions: ["jobs"],
        isSystem: false,
        color: "#EA580C",
        icon: "work",
        landingPage: "jobs",
      },
    ];

    let seeded = 0;
    for (const def of defaults) {
      const existing = await Role.findOne({ name: def.name });
      if (!existing) {
        await Role.create(def);
        console.log(`✅ Seeded default role: ${def.name} (${def.permissions.length} permissions)`);
        seeded++;
      } else {
        // Update permissions for system roles in case they changed
        if (def.isSystem) {
          existing.permissions = def.permissions;
          existing.description = def.description;
          existing.landingPage = def.landingPage;
          await existing.save();
          console.log(`🔄 Updated system role: ${def.name}`);
        }
      }
    }

    const totalRoles = await Role.countDocuments();
    console.log(`\n📋 Total roles in DB: ${totalRoles} (${seeded} newly seeded)\n`);
  } catch (err) {
    console.error("❌ Error seeding default roles:", err.message);
  }
};

// ═══════════════════════════════════════════════════════════════
// GET ALL ROLES
// ═══════════════════════════════════════════════════════════════
const getAllRoles = async (req, res) => {
  try {
    const roles = await Role.find({}).sort({ isSystem: -1, createdAt: 1 });

    const rolesWithCount = await Promise.all(
      roles.map(async (role) => {
        const userCount = await Admin.countDocuments({ role: role.name });
        return { ...role.toObject(), userCount };
      })
    );

    return res.status(200).json({
      success: true,
      data: rolesWithCount,
      availablePermissions: AVAILABLE_PERMISSIONS,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET SINGLE ROLE BY NAME (case-insensitive) — used by login
// ═══════════════════════════════════════════════════════════════
const getRoleByName = async (roleName) => {
  try {
    if (!roleName) return null;

    // Try exact match first
    let role = await Role.findOne({ name: roleName, isActive: true });

    // Try case-insensitive match
    if (!role) {
      role = await Role.findOne({
        name: { $regex: new RegExp(`^${roleName.trim()}$`, "i") },
        isActive: true,
      });
    }

    if (!role) {
      console.warn(`⚠️  Role "${roleName}" not found in DB. User will have NO permissions.`);
    } else {
      console.log(`✅ Role "${roleName}" found → ${role.permissions.length} permissions: [${role.permissions.join(", ")}]`);
    }

    return role;
  } catch (error) {
    console.error("getRoleByName error:", error.message);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════
// CREATE ROLE (Super Admin only)
// ═══════════════════════════════════════════════════════════════
const createRole = async (req, res) => {
  try {
    if (!isSuperAdmin(req.admin?.role)) {
      return res.status(403).json({ success: false, message: "Only Super Admin can create roles" });
    }

    const { name, description, permissions, color, icon, landingPage } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Role name is required" });
    }
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({ success: false, message: "At least one permission must be selected" });
    }

    const invalidPerms = permissions.filter((p) => !AVAILABLE_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      return res.status(400).json({ success: false, message: `Invalid permissions: ${invalidPerms.join(", ")}` });
    }

    const existing = await Role.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: `Role "${name}" already exists` });
    }

    const newRole = await Role.create({
      name: name.trim(),
      description: description || "",
      permissions,
      color: color || "#6750A4",
      icon: icon || "shield",
      landingPage: landingPage || permissions[0] || "dashboard",
      createdBy: req.admin?.adminId,
      isSystem: false,
    });

    logAudit(req, {
      action: "ROLE_CREATED",
      category: "admin",
      targetType: "Role",
      targetId: newRole._id,
      targetName: newRole.name,
      description: `Created new role: ${newRole.name} with ${permissions.length} permissions`,
    }).catch(() => {});

    return res.status(201).json({ success: true, message: `Role "${newRole.name}" created successfully`, data: newRole });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// UPDATE ROLE
// ═══════════════════════════════════════════════════════════════
const updateRole = async (req, res) => {
  try {
    if (!isSuperAdmin(req.admin?.role)) {
      return res.status(403).json({ success: false, message: "Only Super Admin can update roles" });
    }

    const { id } = req.params;
    const { description, permissions, color, icon, landingPage, isActive } = req.body;

    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    if (role.name === "Super Admin") {
      role.permissions = AVAILABLE_PERMISSIONS;
    } else if (Array.isArray(permissions)) {
      const invalid = permissions.filter((p) => !AVAILABLE_PERMISSIONS.includes(p));
      if (invalid.length > 0) {
        return res.status(400).json({ success: false, message: `Invalid permissions: ${invalid.join(", ")}` });
      }
      if (permissions.length === 0) {
        return res.status(400).json({ success: false, message: "Role must have at least one permission" });
      }
      role.permissions = permissions;
    }

    if (description !== undefined) role.description = description;
    if (color) role.color = color;
    if (icon) role.icon = icon;
    if (landingPage) role.landingPage = landingPage;
    if (isActive !== undefined && !role.isSystem) role.isActive = isActive;

    await role.save();

    logAudit(req, {
      action: "ROLE_UPDATED",
      category: "admin",
      targetType: "Role",
      targetId: role._id,
      targetName: role.name,
      description: `Updated role: ${role.name}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, message: `Role "${role.name}" updated`, data: role });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE ROLE
// ═══════════════════════════════════════════════════════════════
const deleteRole = async (req, res) => {
  try {
    if (!isSuperAdmin(req.admin?.role)) {
      return res.status(403).json({ success: false, message: "Only Super Admin can delete roles" });
    }

    const { id } = req.params;
    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    if (role.isSystem) {
      return res.status(400).json({ success: false, message: `System role "${role.name}" cannot be deleted` });
    }

    const userCount = await Admin.countDocuments({ role: role.name });
    if (userCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role "${role.name}" — ${userCount} admin(s) are currently using it. Reassign them first.`,
      });
    }

    await Role.findByIdAndDelete(id);

    logAudit(req, {
      action: "ROLE_DELETED",
      category: "admin",
      targetType: "Role",
      targetId: id,
      targetName: role.name,
      description: `Deleted role: ${role.name}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, message: `Role "${role.name}" deleted` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET AVAILABLE PERMISSIONS (metadata)
// ═══════════════════════════════════════════════════════════════
const getAvailablePermissions = async (req, res) => {
  const permissionsMeta = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard", group: "Overview", description: "View analytics, KPIs & platform metrics" },
    { id: "users", label: "Users Management", icon: "group", group: "Management", description: "Manage candidates and employers" },
    { id: "jobs", label: "Jobs Management", icon: "work", group: "Management", description: "Post, approve, edit & moderate jobs" },
    { id: "applications", label: "Applications", icon: "description", group: "Management", description: "View & manage job applications" },
    { id: "resumes-and-profiles", label: "Resumes & Profiles", icon: "badge", group: "Management", description: "Access candidate resumes" },
    { id: "verification", label: "Verification Queue", icon: "verified", group: "Operations", description: "Review & approve KYC documents" },
    { id: "payments-and-billing", label: "Payments & Billing", icon: "credit_card", group: "Operations", description: "Subscription plans & transactions" },
    { id: "reports-and-complaints", label: "Reports & Complaints", icon: "warning", group: "Operations", description: "Handle user reports & disputes" },
    { id: "content-management", label: "Content Management", icon: "view_kanban", group: "Operations", description: "Manage editorial content" },
    { id: "banners", label: "Banners", icon: "image", group: "Operations", description: "Manage promotional banners" },
    { id: "notifications", label: "Notifications", icon: "notifications", group: "Operations", description: "Send platform-wide notifications" },
    { id: "roles-and-permissions", label: "Roles & Permissions", icon: "security", group: "System", description: "Manage admin roles & access", critical: true },
    { id: "platform-settings", label: "Platform Settings", icon: "settings", group: "System", description: "Global platform configuration", critical: true },
    { id: "admin-activity-log", label: "Admin Activity Log", icon: "history", group: "System", description: "View audit trail of admin actions" },
  ];

  return res.status(200).json({ success: true, data: permissionsMeta });
};

module.exports = {
  seedDefaultRoles,
  getAllRoles,
  getRoleByName,
  createRole,
  updateRole,
  deleteRole,
  getAvailablePermissions,
};