const ContactPermission = require("../models/ContactPermission");
const Job = require("../models/Job");
const Recruiter = require("../models/Recruiter");
const mongoose = require("mongoose");
const { generateWhatsAppUrl } = require("../utils/whatsapp");

// @desc    User requests WhatsApp contact
// @route   POST /api/v1/jobs/:jobId/whatsapp/request
const requestWhatsAppContact = async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Check job-level WhatsApp visibility
    if (!job.contactVisibility?.whatsapp) {
      return res.status(403).json({
        success: false,
        message: "WhatsApp contact is disabled for this job",
      });
    }

    const existingPermission = await ContactPermission.findOne({
      userId,
      recruiterId: job.recruiterId,
      jobId,
      type: "WHATSAPP",
    });

    if (existingPermission) {
      if (existingPermission.status === "PENDING") {
        return res.status(400).json({
          success: false,
          message: "You already have a pending WhatsApp request for this job",
        });
      }
      if (existingPermission.status === "APPROVED") {
        return res.status(400).json({
          success: false,
          message: "Your WhatsApp contact request is already approved",
        });
      }
      if (existingPermission.status === "REJECTED" || existingPermission.status === "REVOKED") {
        existingPermission.status = "PENDING";
        existingPermission.requestedAt = new Date();
        existingPermission.rejectedAt = null;
        existingPermission.revokedAt = null;
        await existingPermission.save();

        return res.status(200).json({
          success: true,
          message: "WhatsApp contact request re-submitted successfully",
          data: existingPermission,
        });
      }
    }

    const permission = await ContactPermission.create({
      userId,
      recruiterId: job.recruiterId,
      jobId,
      companyId: job.companyId,
      type: "WHATSAPP",
      status: "PENDING",
      requestedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message:
        "WhatsApp contact request submitted. Waiting for recruiter approval.",
      data: permission,
    });
  } catch (error) {
    console.error("Request WhatsApp Error:", error.message);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate WhatsApp contact request",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error while requesting WhatsApp contact",
    });
  }
};

// @desc    Get WhatsApp status for a job
// @route   GET /api/v1/jobs/:jobId/whatsapp/status
const getWhatsAppStatus = async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    const whatsappEnabled = job.contactVisibility?.whatsapp || false;

    const permission = await ContactPermission.findOne({
      userId,
      jobId,
      type: "WHATSAPP",
    });

    const response = {
      enabled: whatsappEnabled,
      permissionStatus: permission ? permission.status : null,
      canRequest: !permission && whatsappEnabled,
      canMessage: permission ? permission.status === "APPROVED" : false,
    };

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error("Get WhatsApp Status Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching WhatsApp status",
    });
  }
};

// @desc    Get WhatsApp contact URL — ONLY if approved
// @route   GET /api/v1/jobs/:jobId/whatsapp/contact
const getWhatsAppContact = async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // SECURITY: Check job-level visibility
    if (!job.contactVisibility?.whatsapp) {
      return res.status(403).json({
        success: false,
        message: "WhatsApp contact is disabled for this job",
      });
    }

    // SECURITY: Verify APPROVED permission
    const permission = await ContactPermission.findOne({
      userId,
      jobId,
      type: "WHATSAPP",
      status: "APPROVED",
    });

    if (!permission) {
      return res.status(403).json({
        success: false,
        message: "WhatsApp contact permission has not been approved",
      });
    }

    const whatsappNumber = job.recruiterWhatsappNumber;

    if (!whatsappNumber) {
      return res.status(404).json({
        success: false,
        message: "Recruiter WhatsApp number not available",
      });
    }

    const whatsappUrl = generateWhatsAppUrl(
      whatsappNumber,
      job.title,
      job.companyName
    );

    res.status(200).json({
      success: true,
      data: {
        whatsappUrl,
        contactPerson: job.contactPerson,
      },
    });
  } catch (error) {
    console.error("Get WhatsApp Contact Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching WhatsApp contact",
    });
  }
};

// @desc    Recruiter gets WhatsApp requests
// @route   GET /api/v1/recruiter/whatsapp/requests
const getRecruiterWhatsAppRequests = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;
    const { status, page = 1, limit = 20 } = req.query;

    const filter = { recruiterId, type: "WHATSAPP" };

    if (status && status !== "All") filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      ContactPermission.find(filter)
        .populate("userId", "name email phone")
        .populate("jobId", "title companyName")
        .sort("-requestedAt")
        .skip(skip)
        .limit(parseInt(limit)),
      ContactPermission.countDocuments(filter),
    ]);

    const [pendingCount, approvedCount, rejectedCount, revokedCount] =
      await Promise.all([
        ContactPermission.countDocuments({
          recruiterId,
          type: "WHATSAPP",
          status: "PENDING",
        }),
        ContactPermission.countDocuments({
          recruiterId,
          type: "WHATSAPP",
          status: "APPROVED",
        }),
        ContactPermission.countDocuments({
          recruiterId,
          type: "WHATSAPP",
          status: "REJECTED",
        }),
        ContactPermission.countDocuments({
          recruiterId,
          type: "WHATSAPP",
          status: "REVOKED",
        }),
      ]);

    res.status(200).json({
      success: true,
      data: requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
      counts: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        revoked: revokedCount,
        total: pendingCount + approvedCount + rejectedCount + revokedCount,
      },
    });
  } catch (error) {
    console.error("Get Recruiter Requests Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching WhatsApp requests",
    });
  }
};

// @desc    Approve WhatsApp request
// @route   PATCH /api/v1/recruiter/whatsapp/requests/:requestId/approve
const approveWhatsAppRequest = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;
    const permission = await ContactPermission.findById(req.params.requestId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    if (permission.recruiterId.toString() !== recruiterId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to approve this request",
      });
    }

    if (permission.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Request is already ${permission.status}`,
      });
    }

    permission.status = "APPROVED";
    permission.approvedAt = new Date();
    await permission.save();

    res.status(200).json({
      success: true,
      message: "WhatsApp contact permission approved",
      data: permission,
    });
  } catch (error) {
    console.error("Approve Request Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while approving request",
    });
  }
};

// @desc    Reject WhatsApp request
// @route   PATCH /api/v1/recruiter/whatsapp/requests/:requestId/reject
const rejectWhatsAppRequest = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;
    const permission = await ContactPermission.findById(req.params.requestId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    if (permission.recruiterId.toString() !== recruiterId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to reject this request",
      });
    }

    if (permission.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Request is already ${permission.status}`,
      });
    }

    permission.status = "REJECTED";
    permission.rejectedAt = new Date();
    await permission.save();

    res.status(200).json({
      success: true,
      message: "WhatsApp contact permission rejected",
      data: permission,
    });
  } catch (error) {
    console.error("Reject Request Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while rejecting request",
    });
  }
};

// @desc    Revoke WhatsApp permission
// @route   PATCH /api/v1/recruiter/whatsapp/requests/:requestId/revoke
const revokeWhatsAppRequest = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;
    const permission = await ContactPermission.findById(req.params.requestId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    if (permission.recruiterId.toString() !== recruiterId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to revoke this request",
      });
    }

    if (permission.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Can only revoke approved permissions",
      });
    }

    permission.status = "REVOKED";
    permission.revokedAt = new Date();
    await permission.save();

    res.status(200).json({
      success: true,
      message: "WhatsApp contact permission revoked",
      data: permission,
    });
  } catch (error) {
    console.error("Revoke Request Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while revoking request",
    });
  }
};

// @desc    Recruiter global WhatsApp settings
// @route   PATCH /api/v1/recruiter/whatsapp-settings
const updateWhatsAppSettings = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;
    const recruiter = await Recruiter.findById(recruiterId);

    if (!recruiter) {
      return res.status(404).json({
        success: false,
        message: "Recruiter not found",
      });
    }

    if (typeof req.body.whatsappContactEnabled === "boolean") {
      recruiter.whatsappContactEnabled = req.body.whatsappContactEnabled;
    } else {
      recruiter.whatsappContactEnabled = !recruiter.whatsappContactEnabled;
    }

    if (req.body.whatsappNumber) {
      recruiter.whatsappNumber = req.body.whatsappNumber;
    }

    await recruiter.save();

    res.status(200).json({
      success: true,
      message: `WhatsApp contact is now ${
        recruiter.whatsappContactEnabled ? "enabled" : "disabled"
      }`,
      data: {
        whatsappContactEnabled: recruiter.whatsappContactEnabled,
        whatsappNumber: recruiter.whatsappNumber,
      },
    });
  } catch (error) {
    console.error("Update WhatsApp Settings Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating WhatsApp settings",
    });
  }
};

// @desc    Recruiter dashboard
// @route   GET /api/v1/recruiter/dashboard
const getRecruiterDashboard = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;

    const [
      totalJobs,
      liveJobs,
      pendingJobs,
      expiredJobs,
      totalWhatsAppRequests,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
    ] = await Promise.all([
      Job.countDocuments({ recruiterId }),
      Job.countDocuments({ recruiterId, status: "Live" }),
      Job.countDocuments({ recruiterId, status: "Pending Approval" }),
      Job.countDocuments({ recruiterId, status: "Expired" }),
      ContactPermission.countDocuments({ recruiterId, type: "WHATSAPP" }),
      ContactPermission.countDocuments({
        recruiterId,
        type: "WHATSAPP",
        status: "PENDING",
      }),
      ContactPermission.countDocuments({
        recruiterId,
        type: "WHATSAPP",
        status: "APPROVED",
      }),
      ContactPermission.countDocuments({
        recruiterId,
        type: "WHATSAPP",
        status: "REJECTED",
      }),
    ]);

    const recruiter = await Recruiter.findById(recruiterId).select(
      "whatsappContactEnabled whatsappNumber"
    );

    const totalApplicants = await Job.aggregate([
      { $match: { recruiterId: new mongoose.Types.ObjectId(recruiterId) } },
      { $group: { _id: null, total: { $sum: "$applicantsCount" } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        jobs: {
          total: totalJobs,
          live: liveJobs,
          pending: pendingJobs,
          expired: expiredJobs,
        },
        applicants: {
          total: totalApplicants.length > 0 ? totalApplicants[0].total : 0,
        },
        whatsapp: {
          enabled: recruiter ? recruiter.whatsappContactEnabled : false,
          requests: {
            total: totalWhatsAppRequests,
            pending: pendingRequests,
            approved: approvedRequests,
            rejected: rejectedRequests,
          },
        },
      },
    });
  } catch (error) {
    console.error("Recruiter Dashboard Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching dashboard data",
    });
  }
};

module.exports = {
  requestWhatsAppContact,
  getWhatsAppStatus,
  getWhatsAppContact,
  getRecruiterWhatsAppRequests,
  approveWhatsAppRequest,
  rejectWhatsAppRequest,
  revokeWhatsAppRequest,
  updateWhatsAppSettings,
  getRecruiterDashboard,
};