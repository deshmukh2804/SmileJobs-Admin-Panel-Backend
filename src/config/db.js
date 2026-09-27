// FILE: backend/src/config/db.js
const mongoose = require("mongoose");

const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error("❌ MONGODB_URI environment variable is missing!");
  process.exit(1);
}

// ─── SECONDARY CONNECTION: Job_db (Synchronous Instantiation) ───
const jobDbConnection = mongoose.createConnection(mongoURI, {
  dbName: "Job_db",
});

jobDbConnection.on("connected", () => {
  console.log(
    `✅ MongoDB Connected (Jobs DB): ${jobDbConnection.host}/${jobDbConnection.name}`
  );
});

jobDbConnection.on("error", (err) => {
  console.error(`❌ Job_db Connection Error: ${err.message}`);
});

// ─── THIRD CONNECTION: recruiter_db (Synchronous Instantiation) ───
const recruiterDbConnection = mongoose.createConnection(mongoURI, {
  dbName: "recruiter_db",
});

recruiterDbConnection.on("connected", () => {
  console.log(
    `✅ MongoDB Connected (Recruiter DB): ${recruiterDbConnection.host}/${recruiterDbConnection.name}`
  );
});

recruiterDbConnection.on("error", (err) => {
  console.error(`❌ recruiter_db Connection Error: ${err.message}`);
});

// ─── PRIMARY CONNECTION FUNCTION: careerflow_admin ───
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoURI, {
      dbName: "careerflow_admin",
    });

    console.log(
      `✅ MongoDB Connected (Primary): ${conn.connection.host}/${conn.connection.name}`
    );

    if (conn.connection.name !== "careerflow_admin") {
      console.warn(
        `⚠️ WARNING: Connected to '${conn.connection.name}' instead of 'careerflow_admin'!`
      );
    }
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
module.exports.jobDbConnection = jobDbConnection;
module.exports.recruiterDbConnection = recruiterDbConnection;