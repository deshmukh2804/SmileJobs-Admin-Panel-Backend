const path = require("path");
// Explicitly load .env from backend root folder
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const connectDB = require("./config/db");
const app = require("./app");

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      console.error("❌ Fatal Error: MONGODB_URI is not defined in .env file!");
      console.error("Please check path: " + path.resolve(__dirname, "../.env"));
      process.exit(1);
    }

    // Connect primary db (careerflow_admin)
    await connectDB();

    app.listen(PORT, () => {
      console.log(`🚀 CareerFlow Admin Backend running on port ${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`🔐 Login API:    http://localhost:${PORT}/api/v1/auth/login`);
      console.log(`💼 Jobs API:     http://localhost:${PORT}/api/v1/jobs`);
    });
  } catch (err) {
    console.error("❌ Server startup error:", err.message);
    process.exit(1);
  }
};

startServer();