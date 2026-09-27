require("dotenv").config();
const mongoose = require("mongoose");
const Admin = require("../src/models/Admin");

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB:", mongoose.connection.name);

    const email = "admin@careerflow.com";
    const password = "Admin@123";

    // Delete any broken or existing admin to do a clean setup
    await Admin.deleteOne({ email: email.toLowerCase() });

    // Create fresh admin
    const admin = await Admin.create({
      name: "CareerFlow Admin",
      email: email.toLowerCase(),
      password: password,
      role: "admin",
      isActive: true,
    });

    console.log("=========================================");
    console.log("🎉 ADMIN ACCOUNT READY TO USE!");
    console.log(`   Email:    ${admin.email}`);
    console.log(`   Password: ${password}`);
    console.log("=========================================");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating admin:", error.message);
    process.exit(1);
  }
};

createAdmin();