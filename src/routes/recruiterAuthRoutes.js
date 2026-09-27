const express = require("express");
const router = express.Router();
const {
  registerRecruiter,
  loginRecruiter,
} = require("../controllers/recruiterAuthController");

router.post("/register", registerRecruiter);
router.post("/login", loginRecruiter);

module.exports = router;