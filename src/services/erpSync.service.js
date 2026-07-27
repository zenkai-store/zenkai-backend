// services/erpSync.service.js
const googleSheets = require("./googleSheet.service");

// Column order for Order Sheet (based on the provided sheet)
const ORDER_SHEET_COLUMNS = [
  "Order ID*", // A
  "Order Date*", // B
  "Customer Name*", // C
  "variant_id", // D
  "Product Name", // E
  "Quantity*", // F
  "Unit Price", // G
  "Discount", // H
  "GST Amount", // I
  "Shipping Charge", // J
  "Order Total", // K
  "Customer Email", // L
  "Customer Phone", // M
  "Shipping Address", // N
  "City", // O
  "State", // P
  "Order Status*", // Q
  "Payment Status", // R
  "Razorpay Order ID", // S
  "Shiprocket Order ID", // T
  "Sales Channel", // U
  "Notes", // V
];

// Column order for Transaction Sheet
const TRANSACTION_SHEET_COLUMNS = [
  "Transaction ID*", // A
  "Order ID*", // B
  "Transaction Date*", // C
  "Razorpay Order ID", // D
  "Razorpay Payment ID", // E
  "Razorpay Signature", // F
  "Payment Method", // G
  "Gross Amount", // H
  "Razorpay Fee", // I
  "GST on Fee", // J
  "Net Settlement", // K
  "Payment Status*", // L
  "Settlement ID", // M
  "Settlement Date", // N
  "Refund ID", // O
  "Refund Amount", // P
  "Refund Date", // Q
  "Remarks", // R
];

// Column order for Delivery Sheet
const DELIVERY_SHEET_COLUMNS = [
  "Shipment ID*", // A
  "Order ID*", // B
  "Shiprocket Order ID", // C
  "Shiprocket Shipment ID", // D
  "AWB Number", // E
  "Courier Company", // F
  "Pickup Location", // G
  "Package Weight (kg)", // H
  "Length (cm)", // I
  "Breadth (cm)", // J
  "Height (cm)", // K
  "Shipping Cost", // L
  "Pickup Date", // M
  "Shipped Date", // N
  "Expected Delivery", // O
  "Delivered Date", // P
  "Delivery Status*", // Q
  "Tracking URL", // R
  "RTO Status", // S
  "RTO Charge", // T
  "Last Updated", // U
  "Delivery Remarks", // V
];

/**
 * Format a date for Google Sheets (ISO string or date object)
 */
function formatDate(date) {
  if (!date) return "";
  if (date instanceof Date) return date.toISOString();
  return new Date(date).toISOString();
}

/**
 * Map an order item to an array of values for the Order Sheet.
 */
function mapOrderItemToRow(
  orderItem,
  order,
  addressSnapshot,
  userEmail,
  userPhone,
) {
  const row = [];
  // A: Order ID*
  row.push(order.orderNumber || order._id.toString());
  // B: Order Date*
  row.push(formatDate(order.createdAt));
  // C: Customer Name*
  row.push(addressSnapshot.fullName || "");
  // D: variant_id*
  row.push(orderItem.variantId.toString()); // or variantSku? They said variant_id
  // E: Product Name
  row.push(orderItem.productName || ""); // we might need to fetch product name, but we have variant name
  // Use variant name or product name
  const productName = orderItem.variantColor?.name
    ? `${orderItem.variantColor.name}`
    : "";
  row.push(productName);
  // F: Quantity*
  row.push(orderItem.quantity);
  // G: Unit Price
  row.push(orderItem.unitPrice);
  // H: Discount
  row.push(order.discount || 0);
  // I: GST Amount
  row.push(order.tax || 0);
  // J: Shipping Charge
  row.push(order.shippingCost || 0);
  // K: Order Total
  row.push(order.totalAmount);
  // L: Customer Email
  row.push(userEmail || "");
  // M: Customer Phone
  row.push(userPhone || "");
  // N: Shipping Address
  row.push(
    addressSnapshot.addressLine1 +
      (addressSnapshot.addressLine2 ? ", " + addressSnapshot.addressLine2 : ""),
  );
  // O: City
  row.push(addressSnapshot.city || "");
  // P: State
  row.push(addressSnapshot.state || "");
  // Q: Order Status*
  row.push(order.orderStatus || "pending");
  // R: Payment Status
  row.push(order.paymentStatus || "pending");
  // S: Razorpay Order ID
  row.push(order.razorpayOrderId || "");
  // T: Shiprocket Order ID
  row.push(order.shiprocketOrderId || ""); // we'll store this in order later
  // U: Sales Channel
  row.push("Website");
  // V: Notes
  row.push(order.notes || "");
  return row;
}

/**
 * Map a payment to Transaction Sheet row.
 */
function mapPaymentToTransactionRow(payment, order) {
  const row = [];
  // A: Transaction ID*
  row.push(payment._id.toString());
  // B: Order ID*
  row.push(order.orderNumber || order._id.toString());
  // C: Transaction Date*
  row.push(formatDate(payment.createdAt));
  // D: Razorpay Order ID
  row.push(payment.razorpayOrderId || "");
  // E: Razorpay Payment ID
  row.push(payment.razorpayPaymentId || "");
  // F: Razorpay Signature
  row.push(payment.razorpaySignature || "");
  // G: Payment Method
  row.push(payment.paymentMethod || "razorpay");
  // H: Gross Amount
  row.push(payment.amount || 0);
  // I: Razorpay Fee
  row.push(payment.razorpayFee || 0); // if not stored, leave 0
  // J: GST on Fee
  row.push(payment.gstOnFee || 0);
  // K: Net Settlement
  row.push(
    payment.netSettlement ||
      (payment.amount || 0) -
        (payment.razorpayFee || 0) -
        (payment.gstOnFee || 0),
  );
  // L: Payment Status*
  row.push(payment.status || "success");
  // M: Settlement ID
  row.push(payment.settlementId || "");
  // N: Settlement Date
  row.push(payment.settlementDate ? formatDate(payment.settlementDate) : "");
  // O: Refund ID
  row.push(payment.refundId || "");
  // P: Refund Amount
  row.push(payment.refundAmount || 0);
  // Q: Refund Date
  row.push(payment.refundDate ? formatDate(payment.refundDate) : "");
  // R: Remarks
  row.push(payment.remarks || "");
  return row;
}

/**
 * Map a shipment to Delivery Sheet row.
 */
function mapShipmentToDeliveryRow(shipment, order) {
  const row = [];
  // A: Shipment ID*
  row.push(shipment._id.toString());
  // B: Order ID*
  row.push(order.orderNumber || order._id.toString());
  // C: Shiprocket Order ID
  row.push(shipment.shiprocketOrderId || "");
  // D: Shiprocket Shipment ID
  row.push(shipment.shiprocketShipmentId || "");
  // E: AWB Number
  row.push(shipment.awbCode || "");
  // F: Courier Company
  row.push(shipment.courierName || "");
  // G: Pickup Location
  row.push(shipment.pickupLocation || "");
  // H: Package Weight (kg)
  row.push(shipment.packageWeight || 0);
  // I: Length (cm)
  row.push(shipment.length || 0);
  // J: Breadth (cm)
  row.push(shipment.breadth || 0);
  // K: Height (cm)
  row.push(shipment.height || 0);
  // L: Shipping Cost
  row.push(shipment.shippingCost || 0);
  // M: Pickup Date
  row.push(shipment.pickupDate ? formatDate(shipment.pickupDate) : "");
  // N: Shipped Date
  row.push(shipment.shippedDate ? formatDate(shipment.shippedDate) : "");
  // O: Expected Delivery
  row.push(
    shipment.expectedDelivery ? formatDate(shipment.expectedDelivery) : "",
  );
  // P: Delivered Date
  row.push(shipment.deliveredDate ? formatDate(shipment.deliveredDate) : "");
  // Q: Delivery Status*
  row.push(shipment.status || "pending");
  // R: Tracking URL
  row.push(shipment.trackingUrl || "");
  // S: RTO Status
  row.push(shipment.rtoStatus || "");
  // T: RTO Charge
  row.push(shipment.rtoCharge || 0);
  // U: Last Updated
  row.push(formatDate(shipment.updatedAt || new Date()));
  // V: Delivery Remarks
  row.push(shipment.deliveryRemarks || "");
  return row;
}

/**
 * Synchronize an order's items to the Order Sheet.
 * For each item, insert a new row and store the row number in item.sheetRowNumber.
 * This is called after order creation.
 */
async function syncOrderToSheet(order, addressSnapshot, userEmail, userPhone) {
  if (!order || !order.items || order.items.length === 0) {
    console.warn("syncOrderToSheet: Order has no items, skipping.");
    return;
  }

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    // Skip if already synced (has row number)
    if (item.sheetRowNumber) {
      console.info(
        `Order item ${item._id} already synced to sheet row ${item.sheetRowNumber}, skipping append.`,
      );
      continue;
    }

    try {
      const rowValues = mapOrderItemToRow(
        item,
        order,
        addressSnapshot,
        userEmail,
        userPhone,
      );
      const rowNumber = await googleSheets.appendRow("Order Sheet", rowValues);
      // Store the row number back into the item
      item.sheetRowNumber = rowNumber;
      // Save the order after loop? We'll handle saving outside.
    } catch (error) {
      console.error(
        `Failed to sync order item ${item._id} to Google Sheets:`,
        error,
      );
      // Continue with other items; the order will still be created.
    }
  }
  // If any item got a new row number, mark the order as modified and save.
  // We'll let the caller handle the save by returning a flag or we can save here.
  // But we need to save the order with updated item sheetRowNumber.
  // Since we are in a service that may be called within a transaction, we need to be careful.
  // We'll return a boolean indicating if any changes were made.
  const anyUpdated = order.items.some((item) => item.sheetRowNumber);
  if (anyUpdated) {
    // We'll save outside, but we can also set a flag.
    // We'll return the order with updated items.
  }
  return order;
}

/**
 * Update an order's rows in the Order Sheet (e.g., after payment or status change).
 * Uses stored sheetRowNumber per item.
 */
async function updateOrderRows(order) {
  if (!order || !order.items) return;
  for (const item of order.items) {
    if (!item.sheetRowNumber) {
      console.warn(
        `Order item ${item._id} has no sheet row number, skipping update.`,
      );
      continue;
    }
    try {
      // We need the full order data and address snapshot; we can reconstruct from order.
      const rowValues = mapOrderItemToRow(
        item,
        order,
        order.addressSnapshot,
        order.userEmail,
        order.userPhone,
      );
      await googleSheets.updateRow(
        "Order Sheet",
        item.sheetRowNumber,
        rowValues,
      );
    } catch (error) {
      console.error(
        `Failed to update order item ${item._id} row ${item.sheetRowNumber}:`,
        error,
      );
    }
  }
}

/**
 * Sync a payment to the Transaction Sheet (insert a new row).
 */
async function syncTransactionToSheet(payment, order) {
  if (!payment) return;
  try {
    const rowValues = mapPaymentToTransactionRow(payment, order);
    const rowNumber = await googleSheets.appendRow(
      "Transaction Sheet",
      rowValues,
    );
    // Store row number in payment if needed for future updates (e.g., refund)
    payment.sheetRowNumber = rowNumber;
    // Save payment later
  } catch (error) {
    console.error(
      `Failed to sync payment ${payment._id} to Google Sheets:`,
      error,
    );
  }
}

/**
 * Sync a shipment to the Delivery Sheet (insert or update).
 * If shipment already has a sheetRowNumber, update; else insert.
 */
async function syncShipmentToSheet(shipment, order) {
  if (!shipment) return;
  try {
    const rowValues = mapShipmentToDeliveryRow(shipment, order);
    if (shipment.sheetRowNumber) {
      // Update existing row
      await googleSheets.updateRow(
        "Delivery Sheet",
        shipment.sheetRowNumber,
        rowValues,
      );
    } else {
      // Insert new row
      const rowNumber = await googleSheets.appendRow(
        "Delivery Sheet",
        rowValues,
      );
      shipment.sheetRowNumber = rowNumber;
      // Save shipment later
    }
  } catch (error) {
    console.error(
      `Failed to sync shipment ${shipment._id} to Google Sheets:`,
      error,
    );
  }
}

module.exports = {
  syncOrderToSheet,
  updateOrderRows,
  syncTransactionToSheet,
  syncShipmentToSheet,
};
