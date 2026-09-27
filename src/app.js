// FILE: backend/src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/authRoutes");
const jobRoutes = require("./routes/jobRoutes");
const companyRoutes = require("./routes/companyRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const recruiterAuthRoutes = require("./routes/recruiterAuthRoutes");
const userAuthRoutes = require("./routes/userAuthRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const roleRoutes = require("./routes/roleRoutes");
const { seedDefaultRoles } = require("./controllers/roleController");

// ═══════════════════════════════════════════════════════════════
// 🆕 NEW ROUTE IMPORTS
// ═══════════════════════════════════════════════════════════════
const notificationRoutes = require("./routes/notificationRoutes");
const promoEmailRoutes = require("./routes/promoEmailRoutes");
const userManagementRoutes = require("./routes/userManagementRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const verificationRoutes = require("./routes/verificationRoutes");

const app = express();

// ═══════════════════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false,
}));

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(",").map((o) => o.trim())
      : [];

    if (
      allowedOrigins.length === 0 ||
      !origin ||
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV !== "production"
    ) {
      callback(null, true);
    } else {
      callback(new Error("CORS blocked: Origin not authorized in production configuration."));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Smile Jobs Admin Backend is running",
  });
});

// Primary API v1 Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/recruiter/auth", recruiterAuthRoutes);
app.use("/api/v1/user/auth", userAuthRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/companies", companyRoutes);
app.use("/api/v1", whatsappRoutes);
app.use("/api/v1/banners", require("./routes/bannerRoutes"));
app.use("/api/v1/subscriptions", subscriptionRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/app-config", require("./routes/appConfigRoutes"));
app.use("/api/v1/verifications", verificationRoutes);


// NEW ROUTES
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/promotional-emails", promoEmailRoutes);
app.use("/api/v1/user-management", userManagementRoutes);
app.use("/api/v1/applications", applicationRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);

// Root alias support
app.use("/jobs", jobRoutes);
app.use("/companies", companyRoutes);
app.use("/auth", authRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use((err, req, res, next) => {
  console.error("Global Error:", err.message);

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: "File size too large. Maximum 5MB allowed.",
    });
  }
  if (err.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({
      success: false,
      message: "Too many files. Maximum 10 files allowed.",
    });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ success: false, message: "Unexpected file field." });
  }

  if (err.message && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({ success: false, message: err.message });
  }

  res.status(500).json({ success: false, message: "Internal server error" });
});

const mongoose = require("mongoose");

const waitForDbAndSeed = async () => {
  try {
    let attempts = 0;
    while (mongoose.connection.readyState !== 1 && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    if (mongoose.connection.readyState === 1) {
      console.log("🌱 MongoDB connected — seeding default roles...");
      await seedDefaultRoles();
    } else {
      console.warn("⚠️  MongoDB not connected after 30s — skipping role seed");
    }
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
  }
};

waitForDbAndSeed();

module.exports = app;