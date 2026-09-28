// FILE: backend/src/utils/cloudinary.js
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Generate a signed URL for private/authenticated resources
 * Works for both raw (PDF, DOC) and image delivery types
 */
const generateSignedUrl = (publicId, options = {}) => {
  const {
    resourceType = "auto",
    type = "upload",
    format,
    expiresInSeconds = 3600,
  } = options;

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.utils.private_download_url(publicId, format || "pdf", {
    resource_type: resourceType,
    type,
    expires_at: expiresAt,
    attachment: false,
  });
};

/**
 * Get the direct URL with sign_url option for authenticated files
 */
const getAuthenticatedUrl = (publicId, options = {}) => {
  const { resourceType = "image", format = "pdf", type = "upload" } = options;
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type,
    format,
    sign_url: true,
    secure: true,
  });
};

module.exports = {
  cloudinary,
  generateSignedUrl,
  getAuthenticatedUrl,
};