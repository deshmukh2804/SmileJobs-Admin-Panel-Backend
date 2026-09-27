// FILE: backend/src/utils/resetAllAdmins.js
const path = require("path");
const mongoose = require("mongoose");
const Admin = require("../models/Admin");

// Load .env
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config();

const adminsToSeed = [
  {
    name: "Bhavuk Deshmukh (Super Admin)",
    email: "superadmin@careerflow.com",
    password: "SuperAdmin@123",
    role: "Super Admin",
    department: "Executive Leadership",
    isActive: true,
  },
  {
    name: "General Admin",
    email: "admin@careerflow.com",
    password: "Admin@123",
    role: "Admin",
    department: "Platform Operations",
    isActive: true,
  },
  {
    name: "KYC Moderator",
    email: "moderator@careerflow.com",
    password: "Moderator@123",
    role: "Moderator",
    department: "Compliance & Verification",
    isActive: true,
  },
  {
    name: "Customer Support Agent",
    email: "support@careerflow.com",
    password: "Support@123",
    role: "Support Agent",
    department: "Dispute Mediation",
    isActive: true,
  },
  {
    name: "Content Manager",
    email: "content@careerflow.com",
    password: "Content@123",
    role: "Content Manager",
    department: "Editorial & Spotlight",
    isActive: true,
  },
  {
    name: "Finance Manager",
    email: "finance@careerflow.com",
    password: "Finance@123",
    role: "Finance Manager",
    department: "Revenue & Billing",
    isActive: true,
  },
];

const run = async () => {
  try {
    const mongoUri =
      process.argv[2] ||
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL;

    if (!mongoUri) {
      console.error("\n❌ MongoDB connection URI not found in .env");
      process.exit(1);
    }

    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("✅ MongoDB Connected");

    for (const item of adminsToSeed) {
      await Admin.deleteOne({ email: item.email.toLowerCase() });

      const user = new Admin({
        name: item.name,
        email: item.email.toLowerCase(),
        password: item.password,
        role: item.role,
        department: item.department,
        isActive: true,
      });

      await user.save();
      console.log(`✅ [${item.role}] -> ${item.email} (Password: ${item.password})`);
    }

    console.log("\n=======================================================");
    console.log("🎉 All 6 Admin accounts created / refreshed!");
    console.log("=======================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error resetting admin accounts:", err.message);
    process.exit(1);
  }
};

run();