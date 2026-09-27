const Company = require("../models/Company");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
} = require("../utils/cloudinary");

const createCompany = async (req, res) => {
  try {
    const recruiterId = req.authUser.id || req.authUser.adminId;

    const companyData = {
      ...req.body,
      recruiterId,
    };

    if (req.files && req.files.logo && req.files.logo[0]) {
      const logoResult = await uploadToCloudinary(
        req.files.logo[0].buffer,
        "jobs/company/logos"
      );
      companyData.logo = {
        url: logoResult.url,
        publicId: logoResult.publicId,
      };
    }

    if (req.files && req.files.images && req.files.images.length > 0) {
      const imagePromises = req.files.images.map((file) =>
        uploadToCloudinary(file.buffer, "jobs/company/gallery")
      );
      const imageResults = await Promise.all(imagePromises);
      companyData.images = imageResults.map((result) => ({
        url: result.url,
        publicId: result.publicId,
      }));
    }

    if (typeof companyData.benefits === "string") {
      try {
        companyData.benefits = JSON.parse(companyData.benefits);
      } catch (e) {
        companyData.benefits = companyData.benefits
          .split(",")
          .map((b) => b.trim());
      }
    }

    if (typeof companyData.address === "string") {
      try {
        companyData.address = JSON.parse(companyData.address);
      } catch (e) {}
    }

    const company = await Company.create(companyData);

    res.status(201).json({
      success: true,
      message: "Company created successfully",
      data: company,
    });
  } catch (error) {
    console.error("Create Company Error:", error.message);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error while creating company",
    });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    console.error("Get Company Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while fetching company",
    });
  }
};

const updateCompany = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const userId = req.authUser.id || req.authUser.adminId;
    const isAdmin = ["admin", "super_admin"].includes(req.authUser.role);

    if (!isAdmin && company.recruiterId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this company",
      });
    }

    if (req.files && req.files.logo && req.files.logo[0]) {
      if (company.logo && company.logo.publicId) {
        await deleteFromCloudinary(company.logo.publicId);
      }
      const logoResult = await uploadToCloudinary(
        req.files.logo[0].buffer,
        "jobs/company/logos"
      );
      req.body.logo = {
        url: logoResult.url,
        publicId: logoResult.publicId,
      };
    }

    if (req.files && req.files.images && req.files.images.length > 0) {
      const imagePromises = req.files.images.map((file) =>
        uploadToCloudinary(file.buffer, "jobs/company/gallery")
      );
      const imageResults = await Promise.all(imagePromises);
      const newImages = imageResults.map((result) => ({
        url: result.url,
        publicId: result.publicId,
      }));

      if (req.body.replaceImages === "true") {
        if (company.images && company.images.length > 0) {
          const oldPublicIds = company.images.map((img) => img.publicId);
          await deleteMultipleFromCloudinary(oldPublicIds);
        }
        req.body.images = newImages;
      } else {
        const totalImages = (company.images || []).length + newImages.length;
        if (totalImages > 10) {
          return res.status(400).json({
            success: false,
            message: "Maximum 10 company images allowed",
          });
        }
        req.body.images = [...(company.images || []), ...newImages];
      }
    }

    if (typeof req.body.benefits === "string") {
      try {
        req.body.benefits = JSON.parse(req.body.benefits);
      } catch (e) {
        req.body.benefits = req.body.benefits
          .split(",")
          .map((b) => b.trim());
      }
    }

    if (typeof req.body.address === "string") {
      try {
        req.body.address = JSON.parse(req.body.address);
      } catch (e) {}
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Company updated successfully",
      data: updatedCompany,
    });
  } catch (error) {
    console.error("Update Company Error:", error.message);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error while updating company",
    });
  }
};

module.exports = {
  createCompany,
  getCompanyById,
  updateCompany,
};