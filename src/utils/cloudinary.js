// FILE: backend/src/utils/cloudinary.js
const { Readable } = require("stream");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Uploads a file buffer directly to Cloudinary using native Node streams
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {string} folder - Folder name in Cloudinary
 * @param {object} options - Custom options for upload
 */
const uploadToCloudinary = (buffer, folder = "uploads", options = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

/**
 * Deletes a single asset from Cloudinary
 * @param {string} publicId - Cloudinary asset ID
 * @param {object} options - Options containing resourceType
 */
const deleteFromCloudinary = async (publicId, options = {}) => {
  try {
    const resourceType = options.resourceType || "image";
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
    return result;
  } catch (error) {
    console.error(`❌ Cloudinary deletion failed for ${publicId}:`, error.message);
    throw error;
  }
};

/**
 * Deletes multiple assets from Cloudinary in a single API call
 * @param {string[]} publicIds - Array of publicIds to destroy
 * @param {object} options - Options containing resourceType
 */
const deleteMultipleFromCloudinary = async (publicIds, options = {}) => {
  try {
    const resourceType = options.resourceType || "image";
    const result = await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType,
      invalidate: true,
    });
    return result;
  } catch (error) {
    console.error("❌ Cloudinary bulk deletion failed:", error.message);
    throw error;
  }
};

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
  uploadToCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
  generateSignedUrl,
  getAuthenticatedUrl,
};