const express = require("express");

const Address = require("../models/address.model");
const User = require("../models/user.model");

const userAuth = require("../middleware/userAuth.middleware");

const router = express.Router();

/**
 * ADD ADDRESS
 */

router.post("/", userAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      fullName,
      phone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      district,
      state,
      pincode,
      addressType,
      isDefault,
    } = req.body;

    if (!fullName || !phone || !addressLine1 || !city || !state || !pincode)
      return res.status(400).json({
        success: false,
        message: "Required address fields missing",
      });

    if (isDefault) {
      await Address.updateMany({ userId }, { isDefault: false });
    }

    const address = await Address.create({
      userId,
      fullName,
      phone,
      addressLine1,
      addressLine2,
      landmark,
      city,
      district,
      state,
      pincode,
      addressType,
      isDefault,
    });

    res.status(201).json({
      success: true,
      data: address,
    });
  } catch (err) {
    console.log("Address create error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET USER ADDRESSES
 */

router.get("/", userAuth, async (req, res) => {
  try {
    const addresses = await Address.find({
      userId: req.user.id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: addresses,
    });
  } catch (err) {
    console.log("Address fetch error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * UPDATE ADDRESS
 */

router.patch("/:id", userAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const address = await Address.findOne({
      _id: id,
      userId: req.user.id,
    });

    if (!address)
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });

    if (req.body.isDefault) {
      await Address.updateMany({ userId: req.user.id }, { isDefault: false });
    }

    Object.assign(address, req.body);

    await address.save();

    res.json({
      success: true,
      data: address,
    });
  } catch (err) {
    console.log("Address update error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * DELETE ADDRESS
 */

router.delete("/:id", userAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const address = await Address.findOneAndDelete({
      _id: id,
      userId: req.user.id,
    });

    if (!address)
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });

    res.json({
      success: true,
      message: "Address deleted",
    });
  } catch (err) {
    console.log("Address delete error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * SET DEFAULT ADDRESS
 */

router.patch("/:id/default", userAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await Address.updateMany({ userId: req.user.id }, { isDefault: false });

    const address = await Address.findOneAndUpdate(
      {
        _id: id,
        userId: req.user.id,
      },
      { isDefault: true },
      { new: true },
    );

    if (!address)
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });

    res.json({
      success: true,
      data: address,
    });
  } catch (err) {
    console.log("Default address error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
