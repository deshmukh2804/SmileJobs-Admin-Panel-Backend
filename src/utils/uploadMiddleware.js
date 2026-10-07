// FILE: backend/src/utils/uploadMiddleware.js
const multer = require("multer");

const storage = multer.memoryStorage();

const imageFileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Only JPEG, PNG, GIF, WebP, and SVG are allowed.`
      ),
      false
    );
  }
};

// Generic multer instance with generous defaults
const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
});

// Specific pre-configured helper middlewares (for backward compatibility)
const uploadLogo = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("logo");

const uploadImages = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).array("images", 10);

const uploadCompanyFiles = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: "logo", maxCount: 1 },
  { name: "images", maxCount: 10 },
]);

const uploadProfileImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("profileImage");

// Attach helpers directly as properties of the main 'upload' function
upload.uploadLogo = uploadLogo;
upload.uploadImages = uploadImages;
upload.uploadCompanyFiles = uploadCompanyFiles;
upload.uploadProfileImage = uploadProfileImage;

// Exporting the function object allows BOTH:
// 1. const upload = require('./uploadMiddleware') -> upload.fields(...) works!
// 2. const { uploadLogo } = require('./uploadMiddleware') -> Destructuring still works!
module.exports = upload;