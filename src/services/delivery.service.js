// services/delivery.service.js
const mongoose = require("mongoose");
const axios = require("axios");
const crypto = require("crypto");
const Order = require("../models/order.model");
const Shipment = require("../models/shipment.model");
const ProductVariant = require("../models/productVariant.model");
const { syncShipmentToSheet } = require("../services/erpSync.service");

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

// ======================= FIXED DIMENSIONS & WEIGHT =======================
// Box size: 15 inches x 11 inches x 9 inches  →  convert to cm for Shiprocket
const LENGTH_CM = 38.1;  // 15 in
const BREADTH_CM = 27.94; // 11 in
const HEIGHT_CM = 22.86;  // 9 in
const WEIGHT_KG = 0.75;   // default weight per shipment (kg)
// =========================================================================

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
 * Fetch available couriers for a shipment and pick the best one by a
 * composite score:  50% Shiprocket rating (reliability) + 50% cost savings.
 * Returns the courier_id of the winner, or null to fall back to Shiprocket's
 * default recommendation.
 *
 * Weight tuning (must sum to 1.0):
 *   RATING_WEIGHT – how much delivery reliability matters
 *   COST_WEIGHT   – how much lower price matters
 */
async function selectBestCourier(shipmentId, pickupPincode, deliveryPincode, weightKg) {
  const RATING_WEIGHT = 0.5;
  const COST_WEIGHT = 0.5;

  try {
    const params = new URLSearchParams({
      pickup_postcode: pickupPincode,
      delivery_postcode: deliveryPincode,
      cod: 0,
      weight: weightKg,
    });

    const data = await shiprocketRequest(
      "GET",
      `/courier/serviceability/?${params.toString()}`,
    );

    const couriers = data?.data?.available_courier_companies;
    if (!couriers || couriers.length === 0) {
      console.warn("No couriers returned by serviceability API, using Shiprocket default");
      return null;
    }

    const rates = couriers.map((c) => c.rate);
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const rateRange = maxRate - minRate || 1; // avoid divide-by-zero

    const scored = couriers.map((c) => {
      const normalizedCost = (maxRate - c.rate) / rateRange; // 1 = cheapest, 0 = most expensive
      const normalizedRating = (c.rating || 0) / 5;
      const score = RATING_WEIGHT * normalizedRating + COST_WEIGHT * normalizedCost;
      return { courier_id: c.courier_company_id, courier_name: c.courier_name, rate: c.rate, rating: c.rating, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    console.log(
      `✅ Selected courier "${best.courier_name}" (id: ${best.courier_id}) — ₹${best.rate}, rating: ${best.rating}, score: ${best.score.toFixed(3)}`,
    );
    console.log(
      "All couriers scored:",
      scored.map((c) => `${c.courier_name}: ₹${c.rate} rating=${c.rating} score=${c.score.toFixed(3)}`).join(" | "),
    );

    return best.courier_id;
  } catch (err) {
    console.error("Courier selection failed, falling back to Shiprocket default:", err.message);
    return null;
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
    length: LENGTH_CM,
    breadth: BREADTH_CM,
    height: HEIGHT_CM,
    weight: WEIGHT_KG,
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

    // Step 1.5: Pick the best courier by rating + cost instead of auto-recommended
    const pickupPin = PICKUP_ADDRESS?.pin_code || PICKUP_ADDRESS?.pincode || "";
    const deliveryPin = addressSnapshot.pincode;
    const selectedCourierId = await selectBestCourier(
      shiprocketShipmentId,
      pickupPin,
      deliveryPin,
      WEIGHT_KG,
    );

    // Step 2: Assign AWB — pass courier_id if we found one, else let Shiprocket choose
    const awbPayload = { shipment_id: shiprocketShipmentId };
    if (selectedCourierId) {
      awbPayload.courier_id = selectedCourierId;
    }
    const assignAwbRes = await shiprocketRequest(
      "POST",
      "/courier/assign/awb",
      awbPayload,
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

    setImmediate(async () => {
      try {
        // Insert or update Delivery Sheet
        await syncShipmentToSheet(shipment, order);
        // Save shipment if new row number added
        if (shipment.sheetRowNumber) {
          await shipment.save(); // but we need to fetch fresh? Better to save inside sync function.
        }
        // Optionally update order with Shiprocket Order ID in Order Sheet
        // We can call updateOrderRows after updating order.shiprocketOrderId
        // But we already have the order object, we can update and save.
      } catch (err) {
        console.error(`Error syncing shipment ${shipment._id} to sheets:`, err);
      }
    });

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

      const shipment = await Shipment.findOne({ awbCode });
      if (shipment) {
        const order = await Order.findById(shipment.orderId);
        await syncShipmentToSheet(shipment, order);
        await shipment.save(); // if sheetRowNumber updated
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
