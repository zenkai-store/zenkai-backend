// services/delivery.service.js
const mongoose = require("mongoose");
const axios = require("axios");
const Order = require("../models/order.model");
const Shipment = require("../models/shipment.model");
const DeliveryRequest = require("../models/deliveryRequest.model");
const OrderStatusHistory = require("../models/orderStatusHistory.model");
const ProductVariant = require("../models/productVariant.model");
const { syncShipmentToSheet } = require("../services/erpSync.service");

// ================================
// SHIPROCKET CONFIGURATION
// ================================
const SHIPROCKET_BASE_URL =
  process.env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in/v1/external";
const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;

// Delivery charge threshold above which admin must place shipment manually
const DELIVERY_CHARGE_THRESHOLD = 250;

// Pickup address from environment (must be valid JSON string)
let PICKUP_ADDRESS = null;
try {
  PICKUP_ADDRESS = JSON.parse(process.env.SHIPROCKET_PICKUP_ADDRESS || "{}");
} catch (e) {
  console.error("Invalid SHIPROCKET_PICKUP_ADDRESS JSON");
}

// ======================= FIXED DIMENSIONS & WEIGHT =======================
// Box size: 15 inches x 11 inches x 9 inches  →  convert to cm for Shiprocket
const LENGTH_CM = 20.3;  // 8 in
const BREADTH_CM = 15.3; // 6 in
const HEIGHT_CM = 10.2;  // 4 in
const WEIGHT_KG = 0.75;   // default weight per shipment (kg)
// =========================================================================

// Token cache with expiry (240 hours = 10 days)
let cachedToken = null;
let tokenExpiry = null;

// ================================
// AUTH
// ================================

/**
 * Get Shiprocket auth token (cached, 10-day TTL)
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

// ================================
// HTTP HELPER
// ================================

/**
 * Generic Shiprocket request helper with 401 token-refresh retry
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
    console.error(`❌ Shiprocket API error (${method} ${endpoint}):`);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }

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

// ================================
// COURIER SELECTION
// ================================

/**
 * Fetch available couriers and select the best one using a composite score:
 *   50% Shiprocket reliability rating + 50% cost savings
 *
 * Returns:
 *   { courierId, courierName, rate } — where rate is the estimated charge in ₹
 *   { courierId: null, courierName: null, rate: null } — if API fails (fallback)
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
      return { courierId: null, courierName: null, rate: null };
    }

    const rates = couriers.map((c) => c.rate);
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const rateRange = maxRate - minRate || 1;

    const scored = couriers.map((c) => {
      const normalizedCost = (maxRate - c.rate) / rateRange;
      const normalizedRating = (c.rating || 0) / 5;
      const score = RATING_WEIGHT * normalizedRating + COST_WEIGHT * normalizedCost;
      return {
        courierId: c.courier_company_id,
        courierName: c.courier_name,
        rate: c.rate,
        rating: c.rating,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    console.log(
      `✅ Best courier: "${best.courierName}" (id: ${best.courierId}) ` +
      `— ₹${best.rate}, rating: ${best.rating}, score: ${best.score.toFixed(3)}`,
    );
    console.log(
      "All couriers scored:",
      scored
        .map((c) => `${c.courierName}: ₹${c.rate} rating=${c.rating} score=${c.score.toFixed(3)}`)
        .join(" | "),
    );

    return { courierId: best.courierId, courierName: best.courierName, rate: best.rate };
  } catch (err) {
    console.error("Courier selection failed, will fall back to Shiprocket default:", err.message);
    return { courierId: null, courierName: null, rate: null };
  }
}

// ================================
// WALLET BALANCE CHECK
// ================================

/**
 * Fetch the Shiprocket wallet balance for the authenticated account.
 * Returns the numeric balance in ₹, or null if the endpoint is unavailable.
 */
async function getWalletBalance() {
  try {
    const data = await shiprocketRequest("GET", "/account/details/wallet-balance");
    // Shiprocket returns { data: { wallet_balance: "1234.56" } } or similar
    const raw = data?.data?.wallet_balance ?? data?.wallet_balance ?? null;
    if (raw === null || raw === undefined) return null;
    const balance = parseFloat(raw);
    return isNaN(balance) ? null : balance;
  } catch (err) {
    console.error("Could not fetch Shiprocket wallet balance:", err.message);
    return null;
  }
}

// ================================
// PAYLOAD BUILDER
// ================================

/**
 * Build the Shiprocket order creation payload from our order document
 */
async function buildShiprocketPayload(order, addressSnapshot, itemsWithVariants) {
  const orderItems = itemsWithVariants.map((item) => ({
    name: item.variant.name || "Product",
    sku: item.variant.sku || "SKU",
    units: item.quantity,
    selling_price: item.unitPrice,
    discount: 0,
    tax: 0,
    hsn: "999999",
  }));

  let totalWeight = 0;
  let maxLength = 10, maxWidth = 10, maxHeight = 10;
  for (const item of itemsWithVariants) {
    const dims = item.variant.dimensions || { weight: 0.5, length: 10, width: 10, height: 10 };
    totalWeight += dims.weight * item.quantity;
    maxLength = Math.max(maxLength, dims.length);
    maxWidth = Math.max(maxWidth, dims.width);
    maxHeight = Math.max(maxHeight, dims.height);
  }

  return {
    order_id: order.orderNumber,
    order_date: order.createdAt.toISOString(),
    pickup_location: PICKUP_ADDRESS?.pickup_location || "main",
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
    payment_method: "prepaid",
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

// ================================
// MAIN SHIPMENT CREATION
// ================================

/**
 * Attempt to create a shipment automatically for a paid order.
 *
 * Decision logic (in order):
 *   1. If estimated delivery charge > DELIVERY_CHARGE_THRESHOLD (₹250) → escalate to admin
 *   2. If Shiprocket wallet balance < estimated charge → escalate to admin
 *   3. Otherwise → proceed with full automatic placement via Shiprocket
 *
 * Return shape:
 *   { routed: "auto",  shipment }                  — placed automatically
 *   { routed: "admin", deliveryRequest, reason }   — needs admin action
 *
 * This function never throws to the caller for routing-related outcomes; it
 * only throws on unrecoverable infrastructure errors (DB session failure, etc.).
 */
async function createShipmentForOrder(orderId, userId = null) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ── Fetch order ──────────────────────────────────────────────────────────
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error("Order not found");

    // Idempotency: already has a shipment
    const existingShipment = await Shipment.findOne({ orderId }).session(session);
    if (existingShipment) {
      await session.commitTransaction();
      return { routed: "auto", shipment: existingShipment };
    }

    // Idempotency: already has a pending delivery request
    const existingRequest = await DeliveryRequest.findOne({
      orderId,
      status: "pending",
    }).session(session);
    if (existingRequest) {
      await session.commitTransaction();
      return { routed: "admin", deliveryRequest: existingRequest, reason: existingRequest.reason };
    }

    const addressSnapshot = order.addressSnapshot;
    if (!addressSnapshot || !addressSnapshot.pincode) {
      throw new Error("Order missing address snapshot");
    }

    // ── Fetch product variants ───────────────────────────────────────────────
    const itemsWithVariants = [];
    for (const item of order.items) {
      const variant = await ProductVariant.findById(item.variantId).session(session);
      if (!variant) throw new Error(`Variant ${item.variantId} not found`);
      itemsWithVariants.push({ ...item.toObject(), variant });
    }

    // ── Courier selection (charge check) ────────────────────────────────────
    const pickupPin = PICKUP_ADDRESS?.pin_code || PICKUP_ADDRESS?.pincode || "";
    const deliveryPin = addressSnapshot.pincode;

    const { courierId: selectedCourierId, courierName: selectedCourierName, rate: estimatedCharge } =
      await selectBestCourier(null, pickupPin, deliveryPin, WEIGHT_KG);

    // Validation 1 — charge threshold
    if (estimatedCharge !== null && estimatedCharge > DELIVERY_CHARGE_THRESHOLD) {
      console.warn(
        `Delivery charge ₹${estimatedCharge} exceeds threshold ₹${DELIVERY_CHARGE_THRESHOLD} ` +
        `for order ${order.orderNumber}. Routing to admin.`,
      );

      const deliveryRequest = await _createDeliveryRequest(
        order,
        "charge_exceeds_threshold",
        estimatedCharge,
        null,
        session,
      );

      await session.commitTransaction();
      return { routed: "admin", deliveryRequest, reason: "charge_exceeds_threshold" };
    }

    // Validation 2 — wallet balance (only checked when charge is known and within threshold)
    if (estimatedCharge !== null) {
      const walletBalance = await getWalletBalance();

      if (walletBalance !== null && walletBalance < estimatedCharge) {
        console.warn(
          `Shiprocket wallet balance ₹${walletBalance} is less than estimated charge ₹${estimatedCharge} ` +
          `for order ${order.orderNumber}. Routing to admin.`,
        );

        const deliveryRequest = await _createDeliveryRequest(
          order,
          "insufficient_balance",
          estimatedCharge,
          walletBalance,
          session,
        );

        await session.commitTransaction();
        return { routed: "admin", deliveryRequest, reason: "insufficient_balance" };
      }
    }

    // ── All checks passed — auto-place via Shiprocket ────────────────────────
    const payload = await buildShiprocketPayload(order, addressSnapshot, itemsWithVariants);

    // Step 1: Create order in Shiprocket
    const createOrderRes = await shiprocketRequest("POST", "/orders/create/adhoc", payload);
    if (!createOrderRes || !createOrderRes.order_id) {
      throw new Error("Shiprocket order creation failed: " + JSON.stringify(createOrderRes));
    }
    const shiprocketOrderId = createOrderRes.order_id;
    const shiprocketShipmentId = createOrderRes.shipment_id;

    // Step 2: Assign AWB
    const awbPayload = { shipment_id: shiprocketShipmentId };
    if (selectedCourierId) {
      awbPayload.courier_id = selectedCourierId;
    }
    const assignAwbRes = await shiprocketRequest("POST", "/courier/assign/awb", awbPayload);
    if (!assignAwbRes || !assignAwbRes.awb_code) {
      throw new Error("AWB assignment failed: " + JSON.stringify(assignAwbRes));
    }
    const awbCode = assignAwbRes.awb_code;
    const courierName = assignAwbRes.courier_name;

    // Step 3: Generate label
    const labelRes = await shiprocketRequest("POST", "/courier/generate/label", {
      shipment_id: shiprocketShipmentId,
    });
    const labelUrl = labelRes.label_url || null;

    // Step 4: Generate manifest
    const manifestRes = await shiprocketRequest("POST", "/manifests/generate", {
      shipment_id: shiprocketShipmentId,
    });
    const manifestUrl = manifestRes.manifest_url || null;

    // Step 5: Schedule pickup
    const pickupRes = await shiprocketRequest("POST", "/courier/generate/pickup", {
      shipment_id: shiprocketShipmentId,
    });
    const pickupScheduled = pickupRes.status === "success";

    // ── Persist shipment record ──────────────────────────────────────────────
    const [shipment] = await Shipment.create(
      [
        {
          orderId: order._id,
          awbCode,
          courierName,
          courierId: assignAwbRes.courier_id || null,
          trackingUrl: `https://shiprocket.co/tracking/${awbCode}`,
          labelUrl,
          manifestUrl,
          invoiceUrl: null,
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

    // ── Update order with delivery details ───────────────────────────────────
    order.shipmentId = shipment._id;
    order.deliveryStatus = "assigned";
    order.orderStatus = "shipped";
    order.trackingNumber = awbCode;
    order.courierName = courierName;
    order.awbCode = awbCode;
    order.shiprocketOrderId = String(shiprocketOrderId);
    order.shippedAt = new Date();
    order.estimatedDeliveryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await order.save({ session });

    // ── Status history ───────────────────────────────────────────────────────
    await OrderStatusHistory.create(
      [
        {
          orderId: order._id,
          previousStatus: "confirmed",
          newStatus: "shipped",
          changedBy: null,
          changedByRole: "system",
          notes: `Shipment auto-placed. AWB: ${awbCode}, Courier: ${courierName}`,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    // ── Fire-and-forget: sync to Google Sheets ───────────────────────────────
    setImmediate(async () => {
      try {
        await syncShipmentToSheet(shipment, order);
        if (shipment.sheetRowNumber) {
          await shipment.save();
        }
      } catch (err) {
        console.error(`Error syncing shipment ${shipment._id} to sheets:`, err);
      }
    });

    return { routed: "auto", shipment };
  } catch (error) {
    await session.abortTransaction();
    console.error("Shipment creation failed for order", orderId, ":", error.message);

    // Mark delivery as failed so admin can investigate
    try {
      await Order.findByIdAndUpdate(orderId, { deliveryStatus: "failed" });
    } catch (updateErr) {
      console.error("Could not mark order delivery as failed:", updateErr.message);
    }

    throw error;
  } finally {
    session.endSession();
  }
}

// ================================
// INTERNAL: CREATE DELIVERY REQUEST
// ================================

/**
 * Persist a DeliveryRequest record and update the order's deliveryStatus to
 * "pending" (unchanged from its current state — the order stays "confirmed").
 * Called inside an existing Mongoose session/transaction.
 */
async function _createDeliveryRequest(order, reason, estimatedCharge, walletBalance, session) {
  const [deliveryRequest] = await DeliveryRequest.create(
    [
      {
        orderId: order._id,
        reason,
        estimatedCharge,
        walletBalance,
        thresholdAmount: DELIVERY_CHARGE_THRESHOLD,
        status: "pending",
      },
    ],
    { session },
  );

  // Keep deliveryStatus as "pending" — it hasn't been placed yet
  order.deliveryStatus = "pending";
  await order.save({ session });

  return deliveryRequest;
}

// ================================
// ADMIN: FULFILL DELIVERY REQUEST
// ================================

/**
 * Called when admin manually places the shipment in Shiprocket portal and
 * fills in the resulting details. Updates the order and creates a Shipment
 * record, then syncs to Google Sheets.
 *
 * @param {string} deliveryRequestId
 * @param {object} fulfillmentData  — AWB, courier, Shiprocket IDs, dates, etc.
 * @param {string} adminId
 */
async function fulfillDeliveryRequest(deliveryRequestId, fulfillmentData, adminId) {
  const {
    awbCode,
    courierName,
    courierId,
    shiprocketOrderId,
    shiprocketShipmentId,
    trackingUrl,
    labelUrl,
    manifestUrl,
    estimatedDeliveryDate,
    adminNotes,
  } = fulfillmentData;

  if (!awbCode || typeof awbCode !== "string" || !awbCode.trim()) {
    throw new Error("awbCode is required to fulfill a delivery request");
  }
  if (!courierName || typeof courierName !== "string" || !courierName.trim()) {
    throw new Error("courierName is required to fulfill a delivery request");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const deliveryRequest = await DeliveryRequest.findById(deliveryRequestId).session(session);
    if (!deliveryRequest) throw new Error("Delivery request not found");
    if (deliveryRequest.status !== "pending") {
      throw new Error(`Delivery request is already ${deliveryRequest.status}`);
    }

    const order = await Order.findById(deliveryRequest.orderId).session(session);
    if (!order) throw new Error("Order not found");
    if (order.paymentStatus !== "paid") {
      throw new Error("Cannot fulfill shipment for an unpaid order");
    }

    // Prevent duplicate AWB assignments
    const existingShipment = await Shipment.findOne({ awbCode: awbCode.trim() }).session(session);
    if (existingShipment) {
      throw new Error(`AWB ${awbCode} is already assigned to another shipment`);
    }

    // Create the Shipment record (mirrors auto-placement shape)
    const [shipment] = await Shipment.create(
      [
        {
          orderId: order._id,
          awbCode: awbCode.trim(),
          courierName: courierName.trim(),
          courierId: courierId || null,
          trackingUrl: trackingUrl || `https://shiprocket.co/tracking/${awbCode.trim()}`,
          labelUrl: labelUrl || null,
          manifestUrl: manifestUrl || null,
          invoiceUrl: null,
          pickupScheduled: true, // admin placed it manually — pickup is inherently scheduled
          status: "assigned",
          shiprocketOrderId: shiprocketOrderId ? String(shiprocketOrderId) : null,
          shiprocketShipmentId: shiprocketShipmentId ? String(shiprocketShipmentId) : null,
          metadata: { fulfilledByAdmin: true, adminId, deliveryRequestId },
        },
      ],
      { session },
    );

    // Update order
    order.shipmentId = shipment._id;
    order.deliveryStatus = "assigned";
    order.orderStatus = "shipped";
    order.trackingNumber = awbCode.trim();
    order.courierName = courierName.trim();
    order.awbCode = awbCode.trim();
    if (shiprocketOrderId) order.shiprocketOrderId = String(shiprocketOrderId);
    order.shippedAt = new Date();
    order.estimatedDeliveryDate = estimatedDeliveryDate
      ? new Date(estimatedDeliveryDate)
      : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await order.save({ session });

    // Status history
    await OrderStatusHistory.create(
      [
        {
          orderId: order._id,
          previousStatus: "confirmed",
          newStatus: "shipped",
          changedBy: adminId,
          changedByRole: "admin",
          notes: `Shipment manually fulfilled by admin. AWB: ${awbCode.trim()}, Courier: ${courierName.trim()}${adminNotes ? `. Notes: ${adminNotes}` : ""}`,
        },
      ],
      { session },
    );

    // Mark delivery request as fulfilled
    deliveryRequest.status = "fulfilled";
    deliveryRequest.fulfilledBy = adminId;
    deliveryRequest.fulfilledAt = new Date();
    deliveryRequest.awbCode = awbCode.trim();
    deliveryRequest.courierName = courierName.trim();
    deliveryRequest.courierId = courierId || null;
    deliveryRequest.shiprocketOrderId = shiprocketOrderId ? String(shiprocketOrderId) : null;
    deliveryRequest.shiprocketShipmentId = shiprocketShipmentId ? String(shiprocketShipmentId) : null;
    deliveryRequest.trackingUrl = trackingUrl || `https://shiprocket.co/tracking/${awbCode.trim()}`;
    deliveryRequest.labelUrl = labelUrl || null;
    deliveryRequest.manifestUrl = manifestUrl || null;
    deliveryRequest.estimatedDeliveryDate = order.estimatedDeliveryDate;
    deliveryRequest.adminNotes = adminNotes || null;
    await deliveryRequest.save({ session });

    await session.commitTransaction();

    // Fire-and-forget: sync to Google Sheets
    setImmediate(async () => {
      try {
        await syncShipmentToSheet(shipment, order);
        if (shipment.sheetRowNumber) {
          await shipment.save();
        }
      } catch (err) {
        console.error(`Error syncing admin-fulfilled shipment ${shipment._id} to sheets:`, err);
      }
    });

    return { shipment, order, deliveryRequest };
  } catch (error) {
    await session.abortTransaction();
    console.error("fulfillDeliveryRequest failed:", error.message);
    throw error;
  } finally {
    session.endSession();
  }
}

// ================================
// ADMIN: REJECT DELIVERY REQUEST
// ================================

/**
 * Admin rejects a delivery request (e.g. order will be cancelled, or courier
 * is arranged outside Shiprocket). Updates order deliveryStatus to "failed".
 */
async function rejectDeliveryRequest(deliveryRequestId, adminId, rejectionReason) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const deliveryRequest = await DeliveryRequest.findById(deliveryRequestId).session(session);
    if (!deliveryRequest) throw new Error("Delivery request not found");
    if (deliveryRequest.status !== "pending") {
      throw new Error(`Delivery request is already ${deliveryRequest.status}`);
    }

    deliveryRequest.status = "rejected";
    deliveryRequest.rejectedBy = adminId;
    deliveryRequest.rejectedAt = new Date();
    deliveryRequest.rejectionReason = rejectionReason || null;
    await deliveryRequest.save({ session });

    // Mark order delivery as failed so it surfaces in admin dashboards
    const order = await Order.findById(deliveryRequest.orderId).session(session);
    if (order) {
      order.deliveryStatus = "failed";
      await order.save({ session });

      await OrderStatusHistory.create(
        [
          {
            orderId: order._id,
            previousStatus: order.orderStatus,
            newStatus: order.orderStatus, // order status unchanged; only delivery status changes
            changedBy: adminId,
            changedByRole: "admin",
            notes: `Delivery request rejected by admin. Reason: ${rejectionReason || "none"}`,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();
    return deliveryRequest;
  } catch (error) {
    await session.abortTransaction();
    console.error("rejectDeliveryRequest failed:", error.message);
    throw error;
  } finally {
    session.endSession();
  }
}

// ================================
// RETRY SHIPMENT
// ================================

/**
 * Retry a failed shipment — deletes the old Shipment record and re-triggers
 * the full createShipmentForOrder flow.
 */
async function retryShipment(shipmentId) {
  const shipment = await Shipment.findById(shipmentId);
  if (!shipment) throw new Error("Shipment not found");
  const order = await Order.findById(shipment.orderId);
  if (!order) throw new Error("Order not found");

  await Shipment.deleteOne({ _id: shipmentId });
  return createShipmentForOrder(order._id);
}

// ================================
// TRACKING UPDATE
// ================================

/**
 * Pull the latest tracking status from Shiprocket and update both Shipment
 * and Order records. Syncs to Google Sheets after update.
 */
async function updateTrackingStatus(awbCode) {
  try {
    const trackingData = await shiprocketRequest("GET", `/courier/track/awb/${awbCode}`);

    if (trackingData && trackingData.current_status) {
      const statusMap = {
        "Pickup Requested": "picked_up",
        "Picked Up": "picked_up",
        "In Transit": "in_transit",
        "Out for Delivery": "in_transit",
        Delivered: "delivered",
        Cancelled: "failed",
      };
      const mappedStatus = statusMap[trackingData.current_status] || "in_transit";

      await Shipment.findOneAndUpdate(
        { awbCode },
        { $set: { status: mappedStatus, trackingDetails: trackingData } },
      );

      if (mappedStatus === "delivered") {
        await Order.findOneAndUpdate(
          { awbCode },
          {
            $set: {
              deliveryStatus: "delivered",
              orderStatus: "delivered",
              deliveredAt: new Date(),
            },
          },
        );
      }

      const shipment = await Shipment.findOne({ awbCode });
      if (shipment) {
        const order = await Order.findById(shipment.orderId);
        if (order) {
          await syncShipmentToSheet(shipment, order);
          await shipment.save();
        }
      }

      return trackingData;
    }

    return null;
  } catch (error) {
    console.error("Tracking update failed for AWB", awbCode, ":", error.message);
    return null;
  }
}

// ================================
// EXPORTS
// ================================

module.exports = {
  createShipmentForOrder,
  fulfillDeliveryRequest,
  rejectDeliveryRequest,
  retryShipment,
  updateTrackingStatus,
  shiprocketRequest, // exposed for admin endpoints
  getWalletBalance,  // exposed for admin dashboard
};
