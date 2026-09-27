// FILE: backend/src/routes/roleRoutes.js
const express = require("express");
const router = express.Router();
const {
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
  getAvailablePermissions,
} = require("../controllers/roleController");
const { protect } = require("../middleware/authMiddleware");

router.get("/", protect, getAllRoles);
router.get("/permissions", protect, getAvailablePermissions);
router.post("/", protect, createRole);
router.put("/:id", protect, updateRole);
router.delete("/:id", protect, deleteRole);

module.exports = router;