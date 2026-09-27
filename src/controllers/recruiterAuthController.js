const jwt = require("jsonwebtoken");
const Recruiter = require("../models/Recruiter");

const generateToken = (recruiter) => {
  return jwt.sign(
    {
      id: recruiter._id,
      email: recruiter.email,
      role: "recruiter",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
};

const registerRecruiter = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      mobileNumber,
      whatsappNumber,
      designation,
      companyName,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email, and password",
      });
    }

    const existingRecruiter = await Recruiter.findOne({
      email: email.toLowerCase(),
    });
    if (existingRecruiter) {
      return res.status(400).json({
        success: false,
        message: "Recruiter with this email already exists",
      });
    }

    const recruiter = await Recruiter.create({
      name,
      email,
      password,
      mobileNumber,
      whatsappNumber,
      designation,
      companyName,
    });

    const token = generateToken(recruiter);

    res.status(201).json({
      success: true,
      message: "Recruiter registered successfully",
      token,
      recruiter: {
        id: recruiter._id,
        name: recruiter.name,
        email: recruiter.email,
        role: recruiter.role,
      },
    });
  } catch (error) {
    console.error("Register Recruiter Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
};

const loginRecruiter = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    const recruiter = await Recruiter.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    if (!recruiter) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!recruiter.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account has been deactivated",
      });
    }

    const isMatch = await recruiter.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken(recruiter);

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      recruiter: {
        id: recruiter._id,
        name: recruiter.name,
        email: recruiter.email,
        role: recruiter.role,
        whatsappContactEnabled: recruiter.whatsappContactEnabled,
      },
    });
  } catch (error) {
    console.error("Login Recruiter Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};

module.exports = {
  registerRecruiter,
  loginRecruiter,
};