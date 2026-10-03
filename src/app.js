// FILE: backend/src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// ROUTE IMPORTS
// ═══════════════════════════════════════════════════════════════
const authRoutes = require("./routes/authRoutes");
const jobRoutes = require("./routes/jobRoutes");
const companyRoutes = require("./routes/companyRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const recruiterAuthRoutes = require("./routes/recruiterAuthRoutes");
const userAuthRoutes = require("./routes/userAuthRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const roleRoutes = require("./routes/roleRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const appConfigRoutes = require("./routes/appConfigRoutes");
const verificationRoutes = require("./routes/verificationRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const promoEmailRoutes = require("./routes/promoEmailRoutes");
const userManagementRoutes = require("./routes/userManagementRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");

const { seedDefaultRoles } = require("./controllers/roleController");

const app = express();

// ═══════════════════════════════════════════════════════════════
// SECURITY & HEADERS
// ═══════════════════════════════════════════════════════════════
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ═══════════════════════════════════════════════════════════════
// CORS CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const getWhitelistedOrigins = () => {
  const defaults = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
  ];

  const envOrigins = [];

  if (process.env.FRONTEND_URL) {
    envOrigins.push(...process.env.FRONTEND_URL.split(",").map((o) => o.trim()));
  }
  if (process.env.ALLOWED_ORIGINS) {
    envOrigins.push(...process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()));
  }
  if (process.env.ADMIN_URL) {
    envOrigins.push(process.env.ADMIN_URL.trim());
  }

  return [...new Set([...defaults, ...envOrigins])].filter(Boolean);
};

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const whitelist = getWhitelistedOrigins();
    const cleanOrigin = origin.replace(/\/$/, "");

    const isExplicitlyAllowed = whitelist.some(
      (allowed) => allowed.replace(/\/$/, "") === cleanOrigin
    );

    const isCloudPreview =
      cleanOrigin.endsWith(".vercel.app") ||
      cleanOrigin.endsWith(".onrender.com") ||
      cleanOrigin.endsWith(".netlify.app");

    if (isExplicitlyAllowed || isCloudPreview) {
      return callback(null, true);
    }

    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "x-auth-token",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ═══════════════════════════════════════════════════════════════
// BODY PARSERS
// ═══════════════════════════════════════════════════════════════
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Smile Jobs Admin Backend is running",
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// API V1 ROUTES
// ═══════════════════════════════════════════════════════════════
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/recruiter/auth", recruiterAuthRoutes);
app.use("/api/v1/user/auth", userAuthRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/companies", companyRoutes);
app.use("/api/v1", whatsappRoutes);
app.use("/api/v1/banners", bannerRoutes);
app.use("/api/v1/subscriptions", subscriptionRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/app-config", appConfigRoutes);
app.use("/api/v1/verifications", verificationRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/promotional-emails", promoEmailRoutes);
app.use("/api/v1/user-management", userManagementRoutes);
app.use("/api/v1/applications", applicationRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/payments-and-billing", require("./routes/billingRoutes"));

// Root alias support
app.use("/jobs", jobRoutes);
app.use("/companies", companyRoutes);
app.use("/auth", authRoutes);

// ═══════════════════════════════════════════════════════════════
// 404 HANDLER
// ═══════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ═══════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLER
// ═══════════════════════════════════════════════════════════════
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
    return res.status(400).json({
      success: false,
      message: "Unexpected file field.",
    });
  }

  if (err.message && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// ═══════════════════════════════════════════════════════════════
// DATABASE SEEDER (Default Roles)
// ═══════════════════════════════════════════════════════════════
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
      console.warn("⚠️ MongoDB not connected after 30s — skipping role seed");
    }
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
  }
};

waitForDbAndSeed();

module.exports = app;