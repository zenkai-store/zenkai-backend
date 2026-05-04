const express = require("express");
const slugify = require("slugify");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");

const Product = require("../models/product.model");
const ProductVariant = require("../models/productVariant.model");
const Category = require("../models/category.model");
const Admin = require("../models/admin.model");
const AdminActivity = require("../models/adminActivity.model");

const adminAuth = require("../middleware/adminAuth.middleware");
const upload = require("../middleware/upload.middleware");

const router = express.Router();

/**
 * Helper: Update product variant summary cache
 */
const updateProductVariantSummary = async (productId, session = null) => {
  const variants = await ProductVariant.find(
    { productId, isActive: true },
    null,
    { session },
  ).lean();

  if (variants.length === 0) {
    return;
  }

  const prices = variants.map((v) =>
    v.isOnSale && v.pricing.onSalePrice
      ? v.pricing.onSalePrice
      : v.pricing.sellingPrice,
  );

  const totalQuantity = variants.reduce((sum, v) => sum + v.quantity, 0);
  const availableColors = variants.map((v) => ({
    name: v.color.name,
    code: v.color.code,
    isActive: v.isActive && v.quantity > 0,
  }));

  const updateData = {
    variantSummary: {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      totalQuantity,
      availableColors,
    },
    hasVariants: true,
  };

  await Product.findByIdAndUpdate(productId, { $set: updateData }, { session });
};

/**
 * Helper: Validate variant data
 */
const validateVariantData = (variantData) => {
  const errors = [];

  if (
    !variantData.color ||
    !variantData.color.name ||
    !variantData.color.code
  ) {
    errors.push("Color name and code are required for variant");
  }

  if (!variantData.pricing || !variantData.pricing.sellingPrice) {
    errors.push("Selling price is required for variant");
  }

  if (!variantData.pricing || !variantData.pricing.marketPrice) {
    errors.push("Market price is required for variant");
  }

  if (variantData.pricing && variantData.pricing.sellingPrice < 0) {
    errors.push("Selling price cannot be negative");
  }

  if (variantData.pricing && variantData.pricing.marketPrice < 0) {
    errors.push("Market price cannot be negative");
  }

  if (
    variantData.pricing &&
    variantData.pricing.onSalePrice !== undefined &&
    variantData.pricing.onSalePrice !== null &&
    variantData.pricing.onSalePrice < 0
  ) {
    errors.push("On-sale price cannot be negative");
  }

  if (variantData.quantity !== undefined && variantData.quantity < 0) {
    errors.push("Quantity cannot be negative");
  }

  return errors;
};

/**
 * Helper: Format product for listing with variant info
 */
const formatProductForListing = async (product) => {
  // Get cheapest variant for listing display
  const cheapestVariant = await ProductVariant.findOne({
    productId: product._id,
    quantity: { $gt: 0 },
  })
    .sort({ "pricing.sellingPrice": 1 })
    .lean();

  let variantImage = null;
  if (
    cheapestVariant &&
    cheapestVariant.media &&
    cheapestVariant.media.length
  ) {
    const imageItem = cheapestVariant.media.find((m) => m.type === "image");
    if (imageItem) {
      variantImage = {
        url: imageItem.url,
        type: "image",
      };
    }
  }

  return {
    _id: product._id,
    productId: product.productId,
    name: product.name,
    slug: product.slug,
    media: variantImage,
    hasVariants: product.hasVariants,
    variantSummary: product.variantSummary,
    pricing: product.variantSummary
      ? {
          sellingPrice: product.variantSummary.minPrice,
          maxPrice: product.variantSummary.maxPrice,
        }
      : null,
  };
};

/**
 * GET: /api/admin/products
 * PAGINATED LIST OF ALL ACTIVE/INACTIVE PRODUCTS
 */
router.get("/", async (req, res) => {
  try {
    const { page, limit } = req.query;
    const { page: pageNum, limit: limitNum, skip } = getPagination(page, limit);

    const query = {};

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("categories", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    // Format products with variant information
    const formattedProducts = await Promise.all(
      products.map((product) => formatProductForListing(product)),
    );

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: formattedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    console.error("Error in product listing: ", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * CREATE PRODUCT WITH DEFAULT VARIANT
 * POST /api/admin/products
 */
router.post("/", adminAuth, upload.array("media", 10), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      productId,
      name,
      description,
      productDetails,
      categories,
      defaultVariant,
    } = req.body;

    // Validate admin
    const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
    if (!admin) {
      await session.abortTransaction();
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Validate required fields
    if (!productId || !name) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Product ID and name are required",
      });
    }

    // Check for existing product
    const existing = await Product.findOne({ productId }).session(session);
    if (existing) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Product with this ID already exists",
      });
    }

    // Parse and validate default variant
    let variantData;
    try {
      variantData = defaultVariant ? JSON.parse(defaultVariant) : null;
    } catch (e) {
      variantData = defaultVariant;
    }

    if (!variantData) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Default variant is required",
      });
    }

    // Validate variant
    const variantErrors = validateVariantData(variantData);
    if (variantErrors.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid variant data",
        errors: variantErrors,
      });
    }

    // Validate categories
    let categoryIds = [];
    if (categories) {
      let parsedCategories;
      try {
        parsedCategories = JSON.parse(categories);
      } catch (e) {
        parsedCategories = categories;
      }

      if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
        const foundCategories = await Category.find({
          _id: { $in: parsedCategories },
          isActive: true,
        }).session(session);

        if (foundCategories.length !== parsedCategories.length) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Invalid categories provided",
          });
        }
        categoryIds = parsedCategories;
      }
    }

    // Process media files
    const mediaFiles = req.files.map((file) => {
      let type = "image";
      if (file.mimetype.startsWith("video/")) type = "video";
      if (
        !file.mimetype.startsWith("image/") &&
        !file.mimetype.startsWith("video/")
      )
        type = "model";

      return {
        type,
        url: file.path,
        public_id: file.filename,
        format: file.format,
        bytes: file.size,
      };
    });

    // Create product
    const product = await Product.create(
      [
        {
          productId,
          name,
          slug: slugify(name, { lower: true, strict: true }),
          categories: categoryIds,
          description: description
            ? typeof description === "string"
              ? JSON.parse(description)
              : description
            : [],
          productDetails: productDetails
            ? typeof productDetails === "string"
              ? JSON.parse(productDetails)
              : productDetails
            : [],
          hasVariants: true,
          createdBy: req.admin.id,
          updatedBy: req.admin.id,
        },
      ],
      { session },
    );

    const createdProduct = product[0];

    // Generate SKU if not provided
    const sku =
      variantData.sku ||
      `${productId}-${variantData.color.name.toUpperCase().replace(/\s/g, "")}`;

    // Check SKU uniqueness
    const existingSku = await ProductVariant.findOne({ sku }).session(session);
    if (existingSku) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "SKU already exists",
      });
    }

    // Create default variant
    const variant = await ProductVariant.create(
      [
        {
          productId: createdProduct._id,
          sku: sku,
          name: `${name} - ${variantData.color.name}`,
          color: variantData.color,
          media: variantData.media || mediaFiles,
          quantity: variantData.quantity || 0,
          pricing: variantData.pricing,
          isOnSale: variantData.isOnSale || false,
          isDefault: true,
          displayOrder: 0,
          createdBy: req.admin.id,
          updatedBy: req.admin.id,
        },
      ],
      { session },
    );

    // Update product summary
    await updateProductVariantSummary(createdProduct._id, session);

    // Log activity
    await AdminActivity.create(
      [
        {
          adminId: req.admin.id,
          adminEmail: admin.email,
          action: `CREATE_PRODUCT_WITH_VARIANT (${createdProduct.name} - ${variantData.color.name})`,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      ],
      { session },
    );

    await session.commitTransaction();

    const populatedProduct = await Product.findById(createdProduct._id)
      .populate("categories", "name slug")
      .lean();

    return res.status(201).json({
      success: true,
      data: {
        product: populatedProduct,
        defaultVariant: variant[0],
      },
      message: "Product created successfully with default variant",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error in creating product: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

/**
 * ADD VARIANT TO EXISTING PRODUCT
 * POST /api/admin/products/:id/variants
 */
router.post(
  "/:id/variants",
  adminAuth,
  upload.array("media", 10),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(req.params.id).session(session);

      if (!product) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
      if (!admin) {
        await session.abortTransaction();
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      let variantData;
      try {
        variantData =
          typeof req.body.variant === "string"
            ? JSON.parse(req.body.variant)
            : req.body.variant;
      } catch (e) {
        variantData = req.body;
      }

      // Validate variant
      const variantErrors = validateVariantData(variantData);
      if (variantErrors.length > 0) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Invalid variant data",
          errors: variantErrors,
        });
      }

      // Process media files
      const mediaFiles = req.files.map((file) => {
        let type = "image";
        if (file.mimetype.startsWith("video/")) type = "video";
        if (
          !file.mimetype.startsWith("image/") &&
          !file.mimetype.startsWith("video/")
        )
          type = "model";

        return {
          type,
          url: file.path,
          public_id: file.filename,
          format: file.format,
          bytes: file.size,
        };
      });

      const variantMedia = variantData.media || mediaFiles;

      // Generate SKU if not provided
      const sku =
        variantData.sku ||
        `${product.productId}-${variantData.color.name.toUpperCase().replace(/\s/g, "")}`;

      // Check SKU uniqueness
      const existingSku = await ProductVariant.findOne({ sku }).session(
        session,
      );
      if (existingSku) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "SKU already exists",
        });
      }

      // Check if variant with same color already exists
      const existingColor = await ProductVariant.findOne({
        productId: product._id,
        "color.name": variantData.color.name,
        isActive: true,
      }).session(session);

      if (existingColor) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Variant with color "${variantData.color.name}" already exists`,
        });
      }

      // Create variant
      const variant = await ProductVariant.create(
        [
          {
            productId: product._id,
            sku: sku,
            name: `${product.name} - ${variantData.color.name}`,
            color: variantData.color,
            media: variantMedia,
            quantity: variantData.quantity || 0,
            pricing: variantData.pricing,
            isOnSale: variantData.isOnSale || false,
            isDefault: false,
            displayOrder:
              variantData.displayOrder ||
              (await ProductVariant.countDocuments({ productId: product._id })),
            createdBy: req.admin.id,
            updatedBy: req.admin.id,
          },
        ],
        { session },
      );

      // Update product summary
      await updateProductVariantSummary(product._id, session);

      // Log activity
      await AdminActivity.create(
        [
          {
            adminId: req.admin.id,
            adminEmail: admin.email,
            action: `ADD_VARIANT (${product.name} - ${variantData.color.name})`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          },
        ],
        { session },
      );

      await session.commitTransaction();

      res.status(201).json({
        success: true,
        data: variant[0],
        message: "Variant added successfully",
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error adding variant: ", err);
      res.status(500).json({
        success: false,
        message: err.message,
      });
    } finally {
      session.endSession();
    }
  },
);

/**
 * GET ALL VARIANTS OF A PRODUCT
 * GET /api/admin/products/:id/variants
 */
router.get("/:id/variants", adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const variants = await ProductVariant.find({
      productId: product._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, isDefault: -1 })
      .lean();

    res.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  } catch (err) {
    console.error("Error fetching variants: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET SINGLE VARIANT
 * GET /api/admin/products/:id/variants/:variantId
 */
router.get("/:id/variants/:variantId", adminAuth, async (req, res) => {
  try {
    const variant = await ProductVariant.findOne({
      _id: req.params.variantId,
      productId: req.params.id,
    })
      .populate("productId", "name slug productId categories")
      .lean();

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    res.json({
      success: true,
      data: variant,
    });
  } catch (err) {
    console.error("Error fetching variant: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * UPDATE VARIANT
 * PUT /api/admin/products/:id/variants/:variantId
 */
router.put(
  "/:id/variants/:variantId",
  adminAuth,
  upload.array("media", 10),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const variant = await ProductVariant.findOne({
        _id: req.params.variantId,
        productId: req.params.id,
      }).session(session);

      if (!variant) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Variant not found",
        });
      }

      const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
      if (!admin) {
        await session.abortTransaction();
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      let updateData;
      try {
        updateData =
          typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } catch (e) {
        updateData = req.body;
      }

      // Process new media if uploaded
      if (req.files && req.files.length > 0) {
        const mediaFiles = req.files.map((file) => {
          let type = "image";
          if (file.mimetype.startsWith("video/")) type = "video";
          if (
            !file.mimetype.startsWith("image/") &&
            !file.mimetype.startsWith("video/")
          )
            type = "model";

          return {
            type,
            url: file.path,
            public_id: file.filename,
            format: file.format,
            bytes: file.size,
          };
        });

        updateData.media = [...(variant.media || []), ...mediaFiles];
      }

      // Update variant fields
      if (updateData.color) variant.color = updateData.color;
      if (updateData.pricing) {
        // Merge pricing data to preserve existing fields not included in update
        variant.pricing = {
          costPrice:
            updateData.pricing.costPrice ?? variant.pricing.costPrice ?? 0,
          marginalPrice:
            updateData.pricing.marginalPrice ??
            variant.pricing.marginalPrice ??
            0,
          marketPrice:
            updateData.pricing.marketPrice ??
            variant.pricing.marketPrice ??
            variant.pricing.sellingPrice ??
            0,
          sellingPrice:
            updateData.pricing.sellingPrice ??
            variant.pricing.sellingPrice ??
            0,
          onSalePrice:
            updateData.pricing.onSalePrice !== undefined
              ? updateData.pricing.onSalePrice
              : (variant.pricing.onSalePrice ?? null),
        };

        // Mark the pricing path as modified explicitly
        variant.markModified("pricing");
      }
      if (updateData.quantity !== undefined)
        variant.quantity = updateData.quantity;
      if (updateData.media) variant.media = updateData.media;
      if (updateData.isActive !== undefined)
        variant.isActive = updateData.isActive;
      if (updateData.isDefault !== undefined) {
        // If setting as default, unset other defaults
        if (updateData.isDefault) {
          await ProductVariant.updateMany(
            { productId: variant.productId, _id: { $ne: variant._id } },
            { $set: { isDefault: false } },
            { session },
          );
        }
        variant.isDefault = updateData.isDefault;
      }
      if (updateData.isOnSale !== undefined)
        variant.isOnSale = updateData.isOnSale;
      if (updateData.displayOrder !== undefined)
        variant.displayOrder = updateData.displayOrder;

      variant.updatedBy = req.admin.id;
      variant.updatedAt = new Date();

      await variant.save({ session });

      // Update product summary
      await updateProductVariantSummary(variant.productId, session);

      // Log activity
      await AdminActivity.create(
        [
          {
            adminId: req.admin.id,
            adminEmail: admin.email,
            action: `UPDATE_VARIANT (${variant.name})`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          },
        ],
        { session },
      );

      await session.commitTransaction();

      res.json({
        success: true,
        data: variant,
        message: "Variant updated successfully",
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error updating variant: ", err);
      res.status(500).json({
        success: false,
        message: err.message,
      });
    } finally {
      session.endSession();
    }
  },
);

/**
 * DELETE VARIANT (SOFT DELETE)
 * DELETE /api/admin/products/:id/variants/:variantId
 */
router.delete("/:id/variants/:variantId", adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const variant = await ProductVariant.findOne({
      _id: req.params.variantId,
      productId: req.params.id,
    }).session(session);

    if (!variant) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
    if (!admin) {
      await session.abortTransaction();
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Check if this is the only variant
    const variantCount = await ProductVariant.countDocuments({
      productId: variant.productId,
      isActive: true,
    }).session(session);

    if (variantCount === 1) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete the only variant. Add another variant first or delete the product.",
      });
    }

    // Soft delete variant
    variant.isActive = false;
    variant.updatedBy = req.admin.id;
    await variant.save({ session });

    // If this was default variant, set another as default
    if (variant.isDefault) {
      const anotherVariant = await ProductVariant.findOne({
        productId: variant.productId,
        isActive: true,
        _id: { $ne: variant._id },
      }).session(session);

      if (anotherVariant) {
        anotherVariant.isDefault = true;
        await anotherVariant.save({ session });
      }
    }

    // Update product summary
    await updateProductVariantSummary(variant.productId, session);

    // Log activity
    await AdminActivity.create(
      [
        {
          adminId: req.admin.id,
          adminEmail: admin.email,
          action: `DELETE_VARIANT (${variant.name})`,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.json({
      success: true,
      message: "Variant deleted successfully",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error deleting variant: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

/**
 * ADD MEDIA TO VARIANT
 * POST /api/admin/products/:id/variants/:variantId/media
 */
router.post(
  "/:id/variants/:variantId/media",
  adminAuth,
  upload.array("media", 10),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const variant = await ProductVariant.findOne({
        _id: req.params.variantId,
        productId: req.params.id,
      }).session(session);

      if (!variant) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Variant not found",
        });
      }

      const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
      if (!admin) {
        await session.abortTransaction();
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      if (!req.files || req.files.length === 0) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "No media files uploaded",
        });
      }

      const mediaFiles = req.files.map((file) => {
        let type = "image";
        if (file.mimetype.startsWith("video/")) type = "video";
        if (
          !file.mimetype.startsWith("image/") &&
          !file.mimetype.startsWith("video/")
        )
          type = "model";

        return {
          type,
          url: file.path,
          public_id: file.filename,
          format: file.format,
          bytes: file.size,
        };
      });

      variant.media.push(...mediaFiles);
      await variant.save({ session });

      // Update product summary (media doesn't affect pricing, but keep consistency)
      await updateProductVariantSummary(variant.productId, session);

      await AdminActivity.create(
        [
          {
            adminId: req.admin.id,
            adminEmail: admin.email,
            action: `ADD_MEDIA_TO_VARIANT (${variant.name})`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          },
        ],
        { session },
      );

      await session.commitTransaction();

      res.json({
        success: true,
        data: variant.media,
        message: "Media added to variant successfully",
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error adding media to variant: ", err);
      res.status(500).json({
        success: false,
        message: err.message,
      });
    } finally {
      session.endSession();
    }
  },
);

/**
 * DELETE VARIANT MEDIA
 * DELETE /api/admin/products/:id/variants/:variantId/media/:publicId
 */
router.delete(
  "/:id/variants/:variantId/media/:publicId",
  adminAuth,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const variant = await ProductVariant.findOne({
        _id: req.params.variantId,
        productId: req.params.id,
      }).session(session);

      if (!variant) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Variant not found",
        });
      }

      const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
      if (!admin) {
        await session.abortTransaction();
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      const mediaItem = variant.media.find(
        (m) => m.public_id === req.params.publicId,
      );

      if (!mediaItem) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Media not found",
        });
      }

      // Delete from Cloudinary
      await cloudinary.uploader.destroy(mediaItem.public_id, {
        resource_type:
          mediaItem.type === "video"
            ? "video"
            : mediaItem.type === "model"
              ? "raw"
              : "image",
      });

      variant.media = variant.media.filter(
        (m) => m.public_id !== req.params.publicId,
      );
      await variant.save({ session });

      await AdminActivity.create(
        [
          {
            adminId: req.admin.id,
            adminEmail: admin.email,
            action: `DELETE_MEDIA_FROM_VARIANT (${variant.name})`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          },
        ],
        { session },
      );

      await session.commitTransaction();

      res.json({
        success: true,
        message: "Media deleted from variant successfully",
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error deleting variant media: ", err);
      res.status(500).json({
        success: false,
        message: err.message,
      });
    } finally {
      session.endSession();
    }
  },
);

/**
 * UPDATE PRODUCT DETAILS (NOT VARIANTS)
 * PUT /api/admin/products/:id
 */
router.put("/:id", adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await Product.findById(req.params.id).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
    if (!admin) {
      await session.abortTransaction();
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const { name, slug, categories, description, productDetails, isActive } =
      req.body;

    // Check slug uniqueness if changed
    if (slug && slug !== product.slug) {
      const existingProduct = await Product.findOne({
        slug,
        _id: { $ne: product._id },
      }).session(session);

      if (existingProduct) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Slug already exists",
        });
      }
      product.slug = slugify(slug, { lower: true, strict: true });
    }

    // Update fields
    if (name) {
      product.name = name;
      // Update variant names to match
      await ProductVariant.updateMany(
        { productId: product._id },
        {
          $set: {
            name: `${name} - ${product.variantSummary?.availableColors?.[0]?.name || ""}`.replace(
              " - ",
              " - ",
            ),
          },
        },
        { session },
      );
    }
    if (categories) {
      let parsedCategories;
      try {
        parsedCategories = JSON.parse(categories);
      } catch (e) {
        parsedCategories = categories;
      }

      if (Array.isArray(parsedCategories)) {
        const foundCategories = await Category.find({
          _id: { $in: parsedCategories },
          isActive: true,
        }).session(session);

        if (foundCategories.length === parsedCategories.length) {
          product.categories = parsedCategories;
        }
      }
    }
    if (description) {
      product.description =
        typeof description === "string" ? JSON.parse(description) : description;
    }
    if (productDetails) {
      product.productDetails =
        typeof productDetails === "string"
          ? JSON.parse(productDetails)
          : productDetails;
    }
    if (isActive !== undefined) product.isActive = isActive;

    product.updatedBy = req.admin.id;
    await product.save({ session });

    // Log activity
    await AdminActivity.create(
      [
        {
          adminId: req.admin.id,
          adminEmail: admin.email,
          action: `UPDATE_PRODUCT (${product.name})`,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      ],
      { session },
    );

    await session.commitTransaction();

    const updatedProduct = await Product.findById(product._id)
      .populate("categories", "name slug")
      .lean();

    res.json({
      success: true,
      data: updatedProduct,
      message: "Product updated successfully",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error updating product: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

/**
 * SOFT DELETE PRODUCT (AND ALL VARIANTS)
 * DELETE /api/admin/products/:id
 */
router.delete("/:id", adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await Product.findById(req.params.id).session(session);

    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
    if (!admin) {
      await session.abortTransaction();
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Soft delete product
    product.isActive = false;
    product.updatedBy = req.admin.id;
    await product.save({ session });

    // Soft delete all variants
    await ProductVariant.updateMany(
      { productId: product._id },
      {
        $set: {
          isActive: false,
          updatedBy: req.admin.id,
          updatedAt: new Date(),
        },
      },
      { session },
    );

    // Log activity
    await AdminActivity.create(
      [
        {
          adminId: req.admin.id,
          adminEmail: admin.email,
          action: `SOFT_DELETE_PRODUCT (${product.name})`,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.json({
      success: true,
      message: "Product and all its variants have been deleted",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error deleting product: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

/**
 * BULK UPDATE VARIANTS (Prices, Stock)
 * POST /api/admin/products/bulk-variant-update
 */
router.post("/bulk-variant-update", adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const admin = await Admin.findOne({ _id: req.admin.id }).session(session);
    if (!admin) {
      await session.abortTransaction();
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const { updates, updateType } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Updates array is required",
      });
    }

    let bulkOps = [];
    const productIds = new Set();

    switch (updateType) {
      case "price":
        for (const update of updates) {
          if (
            !update.variantId ||
            !update.sellingPrice ||
            !update.marketPrice
          ) {
            await session.abortTransaction();
            return res.status(400).json({
              success: false,
              message:
                "Each update must have variantId, marketPrice, and sellingPrice",
            });
          }

          bulkOps.push({
            updateOne: {
              filter: { _id: update.variantId },
              update: {
                $set: {
                  "pricing.marketPrice": update.marketPrice,
                  "pricing.sellingPrice": update.sellingPrice,
                  "pricing.onSalePrice": update.onSalePrice || null,
                  isOnSale: !!(update.onSalePrice && update.onSalePrice > 0),
                  updatedBy: req.admin.id,
                  updatedAt: new Date(),
                },
              },
            },
          });

          // Get productId for summary update
          const variant = await ProductVariant.findById(
            update.variantId,
          ).session(session);
          if (variant) productIds.add(variant.productId.toString());
        }
        break;

      case "stock":
        for (const update of updates) {
          if (!update.variantId || update.quantity === undefined) {
            await session.abortTransaction();
            return res.status(400).json({
              success: false,
              message: "Each update must have variantId and quantity",
            });
          }

          if (update.quantity < 0) {
            await session.abortTransaction();
            return res.status(400).json({
              success: false,
              message: "Quantity cannot be negative",
            });
          }

          bulkOps.push({
            updateOne: {
              filter: { _id: update.variantId },
              update: {
                $set: {
                  quantity: update.quantity,
                  updatedBy: req.admin.id,
                  updatedAt: new Date(),
                },
              },
            },
          });

          const variant = await ProductVariant.findById(
            update.variantId,
          ).session(session);
          if (variant) productIds.add(variant.productId.toString());
        }
        break;

      default:
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Invalid updateType. Use 'price' or 'stock'",
        });
    }

    if (bulkOps.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "No valid updates to process",
      });
    }

    const result = await ProductVariant.bulkWrite(bulkOps, { session });

    // Update summaries for affected products
    for (const productId of productIds) {
      await updateProductVariantSummary(productId, session);
    }

    // Log activity
    await AdminActivity.create(
      [
        {
          adminId: req.admin.id,
          adminEmail: admin.email,
          action: `BULK_UPDATE_VARIANTS (${updateType}) - ${updates.length} items`,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.json({
      success: true,
      data: result,
      message: `Bulk ${updateType} update completed successfully`,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error in bulk update: ", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

module.exports = router;
