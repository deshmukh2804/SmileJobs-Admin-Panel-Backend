const ProfilePricing = require("../models/ProfilePricing");

// 1. Get current pricing config
exports.getPricingSettings = async (req, res) => {
  try {
    let config = await ProfilePricing.findOne();
    if (!config) {
      config = await ProfilePricing.create({
        enabled: true,
        price: 100,
        priceInPaise: 10000,
        currency: "INR"
      });
    }
    return res.status(200).json({ success: true, data: config });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// 2. Update profile price directly in MongoDB
exports.updatePricingSettings = async (req, res) => {
  try {
    const { enabled, price, currency } = req.body;
    const priceNum = Number(price) >= 0 ? Number(price) : 100;
    const priceInPaise = Math.round(priceNum * 100);

    let config = await ProfilePricing.findOne();
    if (!config) {
      config = new ProfilePricing();
    }

    config.enabled = enabled !== undefined ? enabled : config.enabled;
    config.price = priceNum;
    config.priceInPaise = priceInPaise;
    config.currency = currency || "INR";

    await config.save();

    return res.status(200).json({
      success: true,
      message: "Profile price updated successfully in database!",
      data: config
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// 3. Public API for Recruiter Website (No auth required)
exports.getPublicPricing = async (req, res) => {
  try {
    let config = await ProfilePricing.findOne();
    if (!config) {
      config = { enabled: true, price: 100, priceInPaise: 10000, currency: "INR" };
    }
    return res.status(200).json({
      success: true,
      data: {
        enabled: config.enabled,
        price: config.price,
        priceInPaise: config.priceInPaise || config.price * 100,
        currency: config.currency || "INR"
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};