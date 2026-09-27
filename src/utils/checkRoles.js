// FILE: backend/src/utils/checkRoles.js
const path = require("path");
const mongoose = require("mongoose");
const Admin = require("../models/Admin");
const Role = require("../models/Role");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config();

const run = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
    await mongoose.connect(uri);
    console.log("\n✅ Connected to MongoDB\n");

    // 1. Check the specific user
    const user = await Admin.findOne({ email: "bhavuk11@gmail.com" });
    if (!user) {
      console.log("❌ User bhavuk11@gmail.com NOT FOUND in Admin collection");
    } else {
      console.log("👤 USER FOUND:");
      console.log("   Name:", user.name);
      console.log("   Email:", user.email);
      console.log("   Role (string):", `"${user.role}"`);
      console.log("   IsActive:", user.isActive);
    }

    // 2. Check what roles exist in DB
    const allRoles = await Role.find({});
    console.log(`\n📋 TOTAL ROLES IN DB: ${allRoles.length}\n`);
    allRoles.forEach(r => {
      console.log(`   • "${r.name}" → ${r.permissions.length} perms → [${r.permissions.join(", ")}]  Active: ${r.isActive}`);
    });

    // 3. Check if user's role matches any DB role
    if (user) {
      const matchingRole = await Role.findOne({
        name: { $regex: new RegExp(`^${user.role}$`, "i") },
      });
      if (matchingRole) {
        console.log(`\n✅ MATCH FOUND: Role "${user.role}" exists in DB with permissions:`);
        console.log(`   → [${matchingRole.permissions.join(", ")}]`);
      } else {
        console.log(`\n❌ NO MATCH: User has role "${user.role}" but this role does NOT exist in the Role collection!`);
        console.log(`   👉 This is why they see everything — the frontend falls back to defaults.`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
};

run();