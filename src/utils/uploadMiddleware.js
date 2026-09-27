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

module.exports = {
  uploadLogo,
  uploadImages,
  uploadCompanyFiles,
  uploadProfileImage,
};