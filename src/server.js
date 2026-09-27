require("dotenv").config();
const connectDB = require("./config/db"); // Load and prepare DB connections first
const app = require("./app");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Connect primary db (careerflow_admin)
  await connectDB();

  app.listen(PORT, () => {
    console.log(`🚀 CareerFlow Admin Backend running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Login API:    http://localhost:${PORT}/api/v1/auth/login`);
    console.log(`💼 Jobs API:     http://localhost:${PORT}/api/v1/jobs`);
  });
};

startServer();