const cloudinary = require("cloudinary").v2;
const { Readable } = require("stream");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadToCloudinary = (fileBuffer, folder, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
      max_bytes: 5 * 1024 * 1024,
      ...options,
    };

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            resourceType: result.resource_type,
          });
        }
      }
    );

    const readableStream = new Readable();
    readableStream.push(fileBuffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
};

const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error("Cloudinary delete error:", error.message);
    throw error;
  }
};

const deleteMultipleFromCloudinary = async (publicIds) => {
  try {
    if (!publicIds || publicIds.length === 0) return null;
    const result = await cloudinary.api.delete_resources(publicIds);
    return result;
  } catch (error) {
    console.error("Cloudinary bulk delete error:", error.message);
    throw error;
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
};