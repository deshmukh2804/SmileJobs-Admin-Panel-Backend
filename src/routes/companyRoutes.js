const express = require("express");
const router = express.Router();
const {
  createCompany,
  getCompanyById,
  updateCompany,
} = require("../controllers/companyController");
const {
  authenticateAny,
  requireRecruiterOrAdmin,
} = require("../middleware/roleMiddleware");
const { uploadCompanyFiles } = require("../utils/uploadMiddleware");

router.get("/:id", getCompanyById);
router.post(
  "/",
  authenticateAny,
  requireRecruiterOrAdmin,
  uploadCompanyFiles,
  createCompany
);
router.put(
  "/:id",
  authenticateAny,
  requireRecruiterOrAdmin,
  uploadCompanyFiles,
  updateCompany
);

module.exports = router;