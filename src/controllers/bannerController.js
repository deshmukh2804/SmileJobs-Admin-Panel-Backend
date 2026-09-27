const Banner = require("../models/Banner");

/* ─────────────────────────────────────────────────────────
   🛡️ CRASH-PROOF CLOUDINARY INITIALIZATION
   ───────────────────────────────────────────────────────── */
let cloudinaryInstance = null;

try {
  const cloudConfig = require("../utils/cloudinary");
  cloudinaryInstance = cloudConfig.cloudinary || cloudConfig;
} catch (e1) {
  try {
    cloudinaryInstance = require("../config/cloudinary");
  } catch (e2) {
    try {
      const cloudinaryLib = require("cloudinary");
      if (cloudinaryLib && cloudinaryLib.v2) {
        cloudinaryInstance = cloudinaryLib.v2;
        if (process.env.CLOUDINARY_CLOUD_NAME) {
          cloudinaryInstance.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
          });
        }
      }
    } catch (e3) {
      console.warn("⚠️ Warning: Cloudinary module not loaded. Image uploads may fail.");
    }
  }
}

/* ─────────────────────────────────────────────────────────
   INTERNAL UTILITY FUNCTIONS
   ───────────────────────────────────────────────────────── */
const uploadToCloudinary = (fileBuffer, folder = "banners") => {
  return new Promise((resolve, reject) => {
    if (!cloudinaryInstance) {
      return reject(new Error("Cloudinary helper is not initialized."));
    }
    const stream = cloudinaryInstance.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(fileBuffer);
  });
};

const deleteFromCloudinary = async (publicId) => {
  if (!publicId || !cloudinaryInstance) return;
  try {
    await cloudinaryInstance.uploader.destroy(publicId);
  } catch (e) {
    console.warn("Cloudinary delete failed for ID:", publicId, e.message);
  }
};

const MAX_SLOTS = 5;

async function shiftBannersDown(placement, targetSlot, excludeId = null) {
  const filter = { placement, slot: { $gte: targetSlot } };
  if (excludeId) filter._id = { $ne: excludeId };

  const affected = await Banner.find(filter).sort({ slot: 1 });
  if (affected.length === 0) return { shifted: [] };

  const shifted = [];
  for (let i = affected.length - 1; i >= 0; i--) {
    const b = affected[i];
    const newSlot = b.slot + 1;

    if (newSlot > MAX_SLOTS) {
      b.status = "archived";
      b.isActive = false;
      await b.save();
      shifted.push({ id: b._id, from: b.slot, to: "archived (overflow)" });
    } else {
      b.slot = newSlot;
      await b.save();
      shifted.push({ id: b._id, from: newSlot - 1, to: newSlot });
    }
  }
  return { shifted };
}

async function compactSlots(placement, deletedSlot) {
  await Banner.updateMany(
    { placement, slot: { $gt: deletedSlot } },
    { $inc: { slot: -1 } }
  );
}

/* ─────────────────────────────────────────────────────────
   CONTROLLERS
   ───────────────────────────────────────────────────────── */
const getBanners = async (req, res) => {
  try {
    const { status, placement, category, search } = req.query;
    const filter = {};

    if (status && status !== "all") filter.status = status;
    if (placement && placement !== "all") filter.placement = placement;
    if (category && category !== "all") filter.category = category;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { subtitle: { $regex: search, $options: "i" } },
        { tags: { $regex: search, $options: "i" } },
      ];
    }

    const banners = await Banner.find(filter).sort({ placement: 1, slot: 1, priority: -1 });

    const totalImpressions = banners.reduce((sum, b) => sum + (b.impressions || 0), 0);
    const totalClicks = banners.reduce((sum, b) => sum + (b.clicks || 0), 0);
    const liveCount = banners.filter((b) => b.status === "live").length;

    res.json({
      success: true,
      data: {
        banners,
        stats: {
          totalBanners: banners.length,
          liveCount,
          totalImpressions,
          totalClicks,
        },
      },
    });
  } catch (err) {
    console.error("getBanners Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBannerById = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });
    res.json({ success: true, data: banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createBanner = async (req, res) => {
  try {
    const files = req.files || {};
    const primaryFile = files.image?.[0];
    const additionalFiles = files.images || [];
    const mobileFile = files.mobileImage?.[0];

    if (!primaryFile) {
      return res.status(400).json({ success: false, message: "Primary cover image is required" });
    }

    const payload = { ...req.body };

    // Parse JSON strings from FormData
    ["tags", "platform"].forEach((k) => {
      if (typeof payload[k] === "string") {
        try { payload[k] = JSON.parse(payload[k]); } catch (e) {}
      }
    });
    ["openInNewTab", "isActive"].forEach((k) => {
      if (typeof payload[k] === "string") payload[k] = payload[k] === "true";
    });
    ["priority", "slot", "overlayOpacity"].forEach((k) => {
      if (payload[k] !== undefined && payload[k] !== "") payload[k] = Number(payload[k]);
    });

    const placement = payload.placement || "home_hero";
    const existingCount = await Banner.countDocuments({ placement });

    if (existingCount >= MAX_SLOTS) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_SLOTS} active banners allowed per placement. Archive or delete one first.`,
      });
    }

    let requestedSlot = Math.max(1, Math.min(MAX_SLOTS, Number(payload.slot) || existingCount + 1));
    if (requestedSlot > existingCount + 1) requestedSlot = existingCount + 1;

    const shiftResult = await shiftBannersDown(placement, requestedSlot);

    // ✅ Upload PRIMARY image
    console.log(`📤 Uploading primary image...`);
    const primaryUpload = await uploadToCloudinary(primaryFile.buffer, "banners");
    console.log(`✅ Primary uploaded: ${primaryUpload.url}`);

    // ✅ Upload ADDITIONAL images (up to 4)
    const additionalUploads = [];
    const additionalToProcess = additionalFiles.slice(0, 4);
    console.log(`📤 Uploading ${additionalToProcess.length} additional images...`);

    for (let i = 0; i < additionalToProcess.length; i++) {
      const up = await uploadToCloudinary(additionalToProcess[i].buffer, "banners");
      additionalUploads.push({ ...up, order: i });
      console.log(`✅ Additional [${i}] uploaded: ${up.url}`);
    }

    // ✅ Upload MOBILE image (optional)
    let mobileUpload = { url: "", publicId: "" };
    if (mobileFile) {
      console.log(`📤 Uploading mobile image...`);
      mobileUpload = await uploadToCloudinary(mobileFile.buffer, "banners/mobile");
      console.log(`✅ Mobile uploaded: ${mobileUpload.url}`);
    }

    // Remove any leftover keys that shouldn't be saved directly
    delete payload.keptPrimaryImage;
    delete payload.keptAdditionalImages;
    delete payload.imagesCount;

    const banner = await Banner.create({
      ...payload,
      slot: requestedSlot,
      image: primaryUpload,
      images: additionalUploads,
      mobileImage: mobileUpload,
    });

    console.log(`✅ Banner created with ${1 + additionalUploads.length} images (+ ${mobileFile ? 1 : 0} mobile)`);

    res.status(201).json({
      success: true,
      message: `Banner created at slot position ${requestedSlot} with ${1 + additionalUploads.length} image(s)`,
      data: banner,
      shifted: shiftResult.shifted,
    });
  } catch (err) {
    console.error("❌ createBanner Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

    const files = req.files || {};
    const primaryFile = files.image?.[0];
    const additionalFiles = files.images || [];
    const mobileFile = files.mobileImage?.[0];

    const payload = { ...req.body };
    ["tags", "platform", "keptPrimaryImage", "keptAdditionalImages"].forEach((k) => {
      if (typeof payload[k] === "string") {
        try { payload[k] = JSON.parse(payload[k]); } catch (e) {}
      }
    });
    ["openInNewTab", "isActive"].forEach((k) => {
      if (typeof payload[k] === "string") payload[k] = payload[k] === "true";
    });
    ["priority", "slot", "overlayOpacity"].forEach((k) => {
      if (payload[k] !== undefined && payload[k] !== "") payload[k] = Number(payload[k]);
    });

    const oldSlot = banner.slot;
    const oldPlacement = banner.placement;
    const newPlacement = payload.placement || oldPlacement;
    let newSlot = payload.slot !== undefined ? Math.max(1, Math.min(MAX_SLOTS, payload.slot)) : oldSlot;

    const placementChanged = newPlacement !== oldPlacement;
    const slotChanged = newSlot !== oldSlot;

    if (placementChanged) {
      const cntInNew = await Banner.countDocuments({ placement: newPlacement, _id: { $ne: banner._id } });
      if (cntInNew >= MAX_SLOTS) {
        return res.status(400).json({
          success: false,
          message: `Target placement zone is full (${MAX_SLOTS}/${MAX_SLOTS}).`,
        });
      }
      if (newSlot > cntInNew + 1) newSlot = cntInNew + 1;

      await shiftBannersDown(newPlacement, newSlot, banner._id);
      await compactSlots(oldPlacement, oldSlot);
    } else if (slotChanged) {
      if (newSlot < oldSlot) {
        await Banner.updateMany(
          {
            placement: oldPlacement,
            _id: { $ne: banner._id },
            slot: { $gte: newSlot, $lt: oldSlot },
          },
          { $inc: { slot: 1 } }
        );
      } else if (newSlot > oldSlot) {
        await Banner.updateMany(
          {
            placement: oldPlacement,
            _id: { $ne: banner._id },
            slot: { $gt: oldSlot, $lte: newSlot },
          },
          { $inc: { slot: -1 } }
        );
      }
    }

    payload.slot = newSlot;
    payload.placement = newPlacement;

    const keptAdditional = Array.isArray(payload.keptAdditionalImages) ? payload.keptAdditionalImages : [];
    const keptPrimary = payload.keptPrimaryImage;

    // ✅ PRIMARY image handling
    if (primaryFile) {
      console.log(`📤 Replacing primary image...`);
      if (banner.image?.publicId) await deleteFromCloudinary(banner.image.publicId);
      banner.image = await uploadToCloudinary(primaryFile.buffer, "banners");
      console.log(`✅ Primary replaced: ${banner.image.url}`);
    } else if (keptPrimary && keptPrimary.url) {
      banner.image = { url: keptPrimary.url, publicId: keptPrimary.publicId || banner.image.publicId };
    }

    // ✅ MOBILE image handling
    if (mobileFile) {
      console.log(`📤 Replacing mobile image...`);
      if (banner.mobileImage?.publicId) await deleteFromCloudinary(banner.mobileImage.publicId);
      banner.mobileImage = await uploadToCloudinary(mobileFile.buffer, "banners/mobile");
      console.log(`✅ Mobile replaced: ${banner.mobileImage.url}`);
    }

    // ✅ ADDITIONAL images handling
    const keptIds = new Set(keptAdditional.map((k) => k.publicId).filter(Boolean));
    const toDelete = (banner.images || []).filter((img) => !keptIds.has(img.publicId));

    for (const img of toDelete) {
      await deleteFromCloudinary(img.publicId);
    }

    const newImages = [];
    let orderCounter = 0;

    for (const kept of keptAdditional) {
      if (kept.publicId) {
        newImages.push({ url: kept.url, publicId: kept.publicId, order: orderCounter++ });
      }
    }

    const slotsRemaining = Math.max(0, 4 - newImages.length);
    const filesToUpload = additionalFiles.slice(0, slotsRemaining);
    console.log(`📤 Uploading ${filesToUpload.length} new additional images...`);

    for (const f of filesToUpload) {
      const uploadResult = await uploadToCloudinary(f.buffer, "banners");
      newImages.push({ ...uploadResult, order: orderCounter++ });
      console.log(`✅ Additional uploaded: ${uploadResult.url}`);
    }
    banner.images = newImages;

    delete payload.keptPrimaryImage;
    delete payload.keptAdditionalImages;
    delete payload.imagesCount;
    delete payload.image;
    delete payload.images;
    delete payload.mobileImage;

    Object.assign(banner, payload);
    await banner.save();

    console.log(`✅ Banner updated. Total images: ${1 + banner.images.length}`);

    res.json({
      success: true,
      message: `Banner updated successfully at slot: ${newSlot} with ${1 + banner.images.length} image(s)`,
      data: banner,
    });
  } catch (err) {
    console.error("❌ updateBanner Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

    if (banner.image?.publicId) await deleteFromCloudinary(banner.image.publicId);
    if (banner.mobileImage?.publicId) await deleteFromCloudinary(banner.mobileImage.publicId);
    for (const img of banner.images || []) {
      if (img.publicId) await deleteFromCloudinary(img.publicId);
    }

    const { placement, slot } = banner;
    await banner.deleteOne();
    await compactSlots(placement, slot);

    res.json({ success: true, message: "Banner deleted and slots compacted successfully." });
  } catch (err) {
    console.error("deleteBanner Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleStatus = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

    banner.status = banner.status === "live" ? "paused" : "live";
    banner.isActive = banner.status === "live";
    await banner.save();

    res.json({ success: true, message: `Banner is now ${banner.status}`, data: banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const reorderBanners = async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, message: "orders array is required" });
    }

    const operations = orders.map((o) => ({
      updateOne: {
        filter: { _id: o.id },
        update: { $set: { slot: o.slot, priority: o.priority } },
      },
    }));
    await Banner.bulkWrite(operations);

    res.json({ success: true, message: `Successfully reordered ${orders.length} banner(s)` });
  } catch (err) {
    console.error("reorderBanners Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const bulkAction = async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids array is required" });
    }

    switch (action) {
      case "activate":
        await Banner.updateMany({ _id: { $in: ids } }, { status: "live", isActive: true });
        break;
      case "pause":
        await Banner.updateMany({ _id: { $in: ids } }, { status: "paused", isActive: false });
        break;
      case "archive":
        await Banner.updateMany({ _id: { $in: ids } }, { status: "archived", isActive: false });
        break;
      case "delete":
        const banners = await Banner.find({ _id: { $in: ids } });
        for (const b of banners) {
          if (b.image?.publicId) await deleteFromCloudinary(b.image.publicId);
          if (b.mobileImage?.publicId) await deleteFromCloudinary(b.mobileImage.publicId);
          for (const img of b.images || []) await deleteFromCloudinary(img.publicId);
          await compactSlots(b.placement, b.slot);
        }
        await Banner.deleteMany({ _id: { $in: ids } });
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid batch action specified" });
    }

    res.json({ success: true, message: `Bulk action '${action}' completed on ${ids.length} item(s)` });
  } catch (err) {
    console.error("bulkAction Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getBanners,
  getBannerById,
  createBanner,
  updateBanner,
  deleteBanner,
  toggleStatus,
  reorderBanners,
  bulkAction,
};