// FILE: backend/src/controllers/userManagementController.js
const User = require("../models/User");
const Recruiter = require("../models/Recruiter");
const Application = require("../models/Application");

// ═══════════════════════════════════════════════════════════════
// CANDIDATES (Mobile app users with role: job_seeker / user)
// ═══════════════════════════════════════════════════════════════

// @desc    Get all candidates
// @route   GET /api/v1/user-management/candidates
const getCandidates = async (req, res) => {
  try {
    const {
      search,
      city,
      state,
      experienceLevel,
      isActive,
      isVerified,
      skills,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { city: { $regex: search, $options: "i" } },
      ];
    }

    if (city) filter.city = { $regex: city, $options: "i" };
    if (state) filter.state = { $regex: state, $options: "i" };
    if (experienceLevel) filter.experienceLevel = experienceLevel;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (isVerified !== undefined) filter.isVerified = isVerified === "true";
    if (skills) {
      const skillArray = skills.split(",").map((s) => s.trim());
      filter.skills = { $in: skillArray };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [candidates, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    const [totalActive, totalInactive, totalVerified] = await Promise.all([
      User.countDocuments({ isActive: { $ne: false } }),
      User.countDocuments({ isActive: false }),
      User.countDocuments({ isVerified: true }),
    ]);

    res.status(200).json({
      success: true,
      data: candidates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
      stats: {
        total: totalActive + totalInactive,
        active: totalActive,
        inactive: totalInactive,
        verified: totalVerified,
      },
    });
  } catch (error) {
    console.error("Get Candidates Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching candidates",
    });
  }
};

// @desc    Get single candidate by ID
// @route   GET /api/v1/user-management/candidates/:id
const getCandidateById = async (req, res) => {
  try {
    const candidate = await User.findById(req.params.id).select("-password");
    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    const applicationCount = await Application.countDocuments({
      userId: candidate._id,
    });

    res.status(200).json({
      success: true,
      data: {
        ...candidate.toObject(),
        applicationCount,
      },
    });
  } catch (error) {
    console.error("Get Candidate Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching candidate",
    });
  }
};

// @desc    Block/Unblock candidate
// @route   PATCH /api/v1/user-management/candidates/:id/toggle-status
const toggleCandidateStatus = async (req, res) => {
  try {
    const candidate = await User.findById(req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    candidate.isActive =
      candidate.isActive === undefined ? false : !candidate.isActive;
    await candidate.save();

    res.status(200).json({
      success: true,
      message: `Candidate ${candidate.isActive ? "unblocked" : "blocked"} successfully`,
      data: {
        id: candidate._id,
        name: candidate.name,
        isActive: candidate.isActive,
      },
    });
  } catch (error) {
    console.error("Toggle Candidate Status Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating candidate status",
    });
  }
};

// @desc    Delete candidate
// @route   DELETE /api/v1/user-management/candidates/:id
const deleteCandidate = async (req, res) => {
  try {
    const candidate = await User.findByIdAndDelete(req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    await Application.deleteMany({ userId: req.params.id });

    res.status(200).json({
      success: true,
      message: "Candidate and associated applications deleted successfully",
    });
  } catch (error) {
    console.error("Delete Candidate Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while deleting candidate",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// RECRUITERS
// ═══════════════════════════════════════════════════════════════

// @desc    Get all recruiters
// @route   GET /api/v1/user-management/recruiters
const getRecruiters = async (req, res) => {
  try {
    const {
      search,
      isActive,
      verified,
      companyName,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { mobileNumber: { $regex: search, $options: "i" } },
      ];
    }

    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (verified !== undefined) filter.verified = verified === "true";
    if (companyName)
      filter.companyName = { $regex: companyName, $options: "i" };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [recruiters, total] = await Promise.all([
      Recruiter.find(filter)
        .select("-password")
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit)),
      Recruiter.countDocuments(filter),
    ]);

    const [totalActive, totalInactive, totalVerified] = await Promise.all([
      Recruiter.countDocuments({ isActive: { $ne: false } }),
      Recruiter.countDocuments({ isActive: false }),
      Recruiter.countDocuments({ verified: true }),
    ]);

    res.status(200).json({
      success: true,
      data: recruiters,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
      stats: {
        total: totalActive + totalInactive,
        active: totalActive,
        inactive: totalInactive,
        verified: totalVerified,
      },
    });
  } catch (error) {
    console.error("Get Recruiters Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching recruiters",
    });
  }
};

// @desc    Get single recruiter by ID
// @route   GET /api/v1/user-management/recruiters/:id
const getRecruiterById = async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.params.id).select(
      "-password"
    );
    if (!recruiter) {
      return res.status(404).json({
        success: false,
        message: "Recruiter not found",
      });
    }

    const Job = require("../models/Job");
    const jobCount = await Job.countDocuments({ recruiterId: recruiter._id });

    res.status(200).json({
      success: true,
      data: {
        ...recruiter.toObject(),
        jobCount,
      },
    });
  } catch (error) {
    console.error("Get Recruiter Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching recruiter",
    });
  }
};

// @desc    Block/Unblock recruiter
// @route   PATCH /api/v1/user-management/recruiters/:id/toggle-status
const toggleRecruiterStatus = async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.params.id);
    if (!recruiter) {
      return res.status(404).json({
        success: false,
        message: "Recruiter not found",
      });
    }

    recruiter.isActive =
      recruiter.isActive === undefined ? false : !recruiter.isActive;
    await recruiter.save();

    res.status(200).json({
      success: true,
      message: `Recruiter ${recruiter.isActive ? "unblocked" : "blocked"} successfully`,
      data: {
        id: recruiter._id,
        name: recruiter.name,
        isActive: recruiter.isActive,
      },
    });
  } catch (error) {
    console.error("Toggle Recruiter Status Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating recruiter status",
    });
  }
};

// @desc    Delete recruiter
// @route   DELETE /api/v1/user-management/recruiters/:id
const deleteRecruiter = async (req, res) => {
  try {
    const recruiter = await Recruiter.findByIdAndDelete(req.params.id);
    if (!recruiter) {
      return res.status(404).json({
        success: false,
        message: "Recruiter not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Recruiter deleted successfully",
    });
  } catch (error) {
    console.error("Delete Recruiter Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while deleting recruiter",
    });
  }
};

// @desc    Toggle recruiter verification
// @route   PATCH /api/v1/user-management/recruiters/:id/toggle-verification
const toggleRecruiterVerification = async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.params.id);
    if (!recruiter) {
      return res.status(404).json({
        success: false,
        message: "Recruiter not found",
      });
    }

    recruiter.verified = !recruiter.verified;
    await recruiter.save();

    res.status(200).json({
      success: true,
      message: `Recruiter ${recruiter.verified ? "verified" : "unverified"} successfully`,
      data: {
        id: recruiter._id,
        name: recruiter.name,
        verified: recruiter.verified,
      },
    });
  } catch (error) {
    console.error("Toggle Verification Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating verification",
    });
  }
};

module.exports = {
  getCandidates,
  getCandidateById,
  toggleCandidateStatus,
  deleteCandidate,
  getRecruiters,
  getRecruiterById,
  toggleRecruiterStatus,
  deleteRecruiter,
  toggleRecruiterVerification,
};