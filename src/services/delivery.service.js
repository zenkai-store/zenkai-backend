// services/delivery.service.js
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
const Order = require("../models/order.model");
const Shipment = require("../models/shipment.model");
const ProductVariant = require("../models/productVariant.model");

// ================================
// SHIPROCKET CONFIGURATION
// ================================
const SHIPROCKET_BASE_URL =
  process.env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in/v1/external";
const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;

// Pickup address from environment (must be valid JSON string)
let PICKUP_ADDRESS = null;
try {
  PICKUP_ADDRESS = JSON.parse(process.env.SHIPROCKET_PICKUP_ADDRESS || "{}");
} catch (e) {
  console.error("Invalid SHIPROCKET_PICKUP_ADDRESS JSON");
}

// Token cache with expiry (240 hours = 10 days)
let cachedToken = null;
let tokenExpiry = null;

/**
 * Get Shiprocket auth token (cached)
 */
async function getShiprocketToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    console.log("🔄 Requesting Shiprocket token...");
    const response = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, {
      email: SHIPROCKET_EMAIL,
      password: SHIPROCKET_PASSWORD,
    });

    console.log("✅ Shiprocket login response:", response.data);

    if (response.data && response.data.token) {
      cachedToken = response.data.token;
      tokenExpiry = Date.now() + 240 * 60 * 60 * 1000; // 10 days
      return cachedToken;
    }
    throw new Error("No token received from Shiprocket");
  } catch (error) {
    console.error("❌ Shiprocket auth failed:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error(error.message);
    }
    throw new Error("Failed to authenticate with Shiprocket");
  }
}

/**
 * Generic request helper with token refresh retry
 */
async function shiprocketRequest(method, endpoint, data = null) {
  let token = await getShiprocketToken();
  const url = `${SHIPROCKET_BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await axios({ method, url, data, headers });
    return response.data;
  } catch (error) {
    // Log full error details
    console.error(`❌ Shiprocket API error (${method} ${endpoint}):`);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }

    // If token expired, retry once
    if (error.response?.status === 401) {
      cachedToken = null;
      token = await getShiprocketToken();
      headers.Authorization = `Bearer ${token}`;
      const retryResponse = await axios({ method, url, data, headers });
      return retryResponse.data;
    }
    throw error;
  }
}

/**
 * Build Shiprocket order payload from our order + address + items
 */
// In delivery.service.js
async function buildShiprocketPayload(
  order,
  addressSnapshot,
  itemsWithVariants,
) {
  const orderItems = itemsWithVariants.map((item) => ({
    name: item.variant.name || "Product",
    sku: item.variant.sku || "SKU",
    units: item.quantity,
    selling_price: item.unitPrice,
    discount: 0,
    tax: 0,
    hsn: "999999",
  }));

  // Calculate total weight – use default if missing
  let totalWeight = 0;
  let maxLength = 10,
    maxWidth = 10,
    maxHeight = 10;
  for (const item of itemsWithVariants) {
    const dims = item.variant.dimensions || {
      weight: 0.5,
      length: 10,
      width: 10,
      height: 10,
    };
    totalWeight += dims.weight * item.quantity;
    maxLength = Math.max(maxLength, dims.length);
    maxWidth = Math.max(maxWidth, dims.width);
    maxHeight = Math.max(maxHeight, dims.height);
  }

  return {
    order_id: order.orderNumber,
    order_date: order.createdAt.toISOString(),
    pickup_location: PICKUP_ADDRESS?.pickup_location || "main",
    //channel_id: 1, // <-- Comment out or remove
    comment: `Order ${order.orderNumber}`,
    billing_customer_name: addressSnapshot.fullName,
    billing_last_name: "",
    billing_address: addressSnapshot.addressLine1,
    billing_address_2: addressSnapshot.addressLine2 || "",
    billing_city: addressSnapshot.city,
    billing_pincode: addressSnapshot.pincode,
    billing_state: addressSnapshot.state,
    billing_country: "India",
    billing_email: order.userEmail || "customer@example.com",
    billing_phone: addressSnapshot.phone,
    shipping_is_billing: true,
    order_items: orderItems,
    payment_method: "prepaid", // lowercase
    sub_total: order.subtotal,
    total_discount: order.discount || 0,
    total_tax: order.tax || 0,
    shipping_charges: order.shippingCost || 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total: order.totalAmount,
    roundoff: 0,
    length: maxLength,
    breadth: maxWidth,
    height: maxHeight,
    weight: totalWeight || 1,
  };
}

/**
 * Main function to create a shipment for a paid order
 */
async function createShipmentForOrder(orderId, userId = null) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Fetch order with address snapshot and items
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error("Order not found");

    // Check if shipment already exists
    const existingShipment = await Shipment.findOne({ orderId }).session(
      session,
    );
    if (existingShipment) {
      return existingShipment; // already processed
    }

    // Get full address snapshot (order already has addressSnapshot)
    const addressSnapshot = order.addressSnapshot;
    if (!addressSnapshot || !addressSnapshot.pincode) {
      throw new Error("Order missing address snapshot");
    }

    // Fetch product variants for each item
    const itemsWithVariants = [];
    for (const item of order.items) {
      const variant = await ProductVariant.findById(item.variantId).session(
        session,
      );
      if (!variant) throw new Error(`Variant ${item.variantId} not found`);
      itemsWithVariants.push({ ...item.toObject(), variant });
    }

    // Build payload and call Shiprocket APIs
    const payload = await buildShiprocketPayload(
      order,
      addressSnapshot,
      itemsWithVariants,
    );

    // Step 1: Create order in Shiprocket
    const createOrderRes = await shiprocketRequest(
      "POST",
      "/orders/create/adhoc",
      payload,
    );
    if (!createOrderRes || !createOrderRes.order_id) {
      throw new Error(
        "Shiprocket order creation failed: " + JSON.stringify(createOrderRes),
      );
    }
    const shiprocketOrderId = createOrderRes.order_id;
    const shiprocketShipmentId = createOrderRes.shipment_id;

    // Step 2: Assign AWB
    const assignAwbRes = await shiprocketRequest(
      "POST",
      "/courier/assign/awb",
      {
        shipment_id: shiprocketShipmentId,
      },
    );
    if (!assignAwbRes || !assignAwbRes.awb_code) {
      throw new Error("AWB assignment failed: " + JSON.stringify(assignAwbRes));
    }
    const awbCode = assignAwbRes.awb_code;
    const courierName = assignAwbRes.courier_name;

    // Step 3: Generate label
    const labelRes = await shiprocketRequest(
      "POST",
      "/courier/generate/label",
      {
        shipment_id: shiprocketShipmentId,
      },
    );
    const labelUrl = labelRes.label_url || null;

    // Step 4: Generate manifest
    const manifestRes = await shiprocketRequest("POST", "/manifests/generate", {
      shipment_id: shiprocketShipmentId,
    });
    const manifestUrl = manifestRes.manifest_url || null;

    // Step 5: Generate pickup request
    const pickupRes = await shiprocketRequest(
      "POST",
      "/courier/generate/pickup",
      {
        shipment_id: shiprocketShipmentId,
      },
    );
    const pickupScheduled = pickupRes.status === "success";

    // Create shipment record
    const shipment = await Shipment.create(
      [
        {
          orderId: order._id,
          awbCode,
          courierName,
          courierId: assignAwbRes.courier_id || null,
          trackingUrl: `https://shiprocket.co/tracking/${awbCode}`,
          labelUrl,
          manifestUrl,
          invoiceUrl: null, // optional, can be generated separately
          pickupScheduled,
          status: "assigned",
          shiprocketOrderId,
          shiprocketChannelOrderId: createOrderRes.channel_order_id || null,
          shiprocketShipmentId,
          metadata: {
            createOrderResponse: createOrderRes,
            assignAwbResponse: assignAwbRes,
          },
        },
      ],
      { session },
    );

    // Update order with quick access fields
    order.shipmentId = shipment[0]._id;
    order.deliveryStatus = "assigned";
    order.trackingNumber = awbCode;
    order.courierName = courierName;
    order.awbCode = awbCode;
    order.shippedAt = new Date(); // once AWB assigned, consider shipped
    // Estimate delivery: +5 days (customizable)
    order.estimatedDeliveryDate = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    );
    await order.save({ session });

    await session.commitTransaction();
    return shipment[0];
  } catch (error) {
    await session.abortTransaction();
    console.error("Shipment creation failed for order", orderId, error.message);
    // Mark order delivery status as failed
    await Order.findByIdAndUpdate(orderId, { deliveryStatus: "failed" });
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Retry a failed shipment
 */
async function retryShipment(shipmentId) {
  const shipment = await Shipment.findById(shipmentId);
  if (!shipment) throw new Error("Shipment not found");
  const order = await Order.findById(shipment.orderId);
  if (!order) throw new Error("Order not found");

  // Delete old shipment record and recreate
  await Shipment.deleteOne({ _id: shipmentId });
  return createShipmentForOrder(order._id);
}

/**
 * Update tracking status from Shiprocket (for admin sync)
 */
async function updateTrackingStatus(awbCode) {
  try {
    const trackingData = await shiprocketRequest(
      "GET",
      `/courier/track/awb/${awbCode}`,
    );
    if (trackingData && trackingData.current_status) {
      const statusMap = {
        "Pickup Requested": "picked_up",
        "Picked Up": "picked_up",
        "In Transit": "in_transit",
        "Out for Delivery": "in_transit",
        Delivered: "delivered",
        Cancelled: "failed",
      };
      const mappedStatus =
        statusMap[trackingData.current_status] || "in_transit";
      await Shipment.findOneAndUpdate(
        { awbCode },
        { $set: { status: mappedStatus, trackingDetails: trackingData } },
      );
      if (mappedStatus === "delivered") {
        await Order.findOneAndUpdate(
          { awbCode },
          { deliveryStatus: "delivered" },
        );
      }
      return trackingData;
    }
  } catch (error) {
    console.error("Tracking update failed for AWB", awbCode, error.message);
    return null;
  }
}

module.exports = {
  createShipmentForOrder,
  retryShipment,
  updateTrackingStatus,
  shiprocketRequest, // for admin endpoints
};
