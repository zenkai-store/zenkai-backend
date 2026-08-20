# 21 — ERP: Google Sheets Integration

## Overview

Every order, payment, and shipment event is synced to a shared Google Spreadsheet. This gives the business team real-time visibility without needing database access.

The integration uses the **Google Sheets API v4** with a service account — no OAuth user flow required.

---

## Setup

### Google Cloud

1. Create a project in Google Cloud Console.
2. Enable the **Google Sheets API**.
3. Create a **Service Account** and download the JSON key.
4. Share the target spreadsheet with the service account email (Editor permission).

### Environment Variables

```
GOOGLE_SHEETS_SPREADSHEET_ID=<from spreadsheet URL>
GOOGLE_SHEETS_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

In `.env` files, replace literal newlines in the private key with `\n`.

### Spreadsheet Structure

The spreadsheet must contain exactly three sheets with these names:

| Sheet Name | Purpose |
|---|---|
| `Order Sheet` | One row per order item |
| `Transaction Sheet` | One row per payment |
| `Delivery Sheet` | One row per shipment |

---

## Order Sheet — Column Schema (A–V)

| Col | Field | Notes |
|---|---|---|
| A | Order Number | `ORD-YYYYMM-NNNNNN` |
| B | Order Date | ISO timestamp |
| C | Customer Name | |
| D | Customer Email | |
| E | Customer Phone | |
| F | Product Name | |
| G | Variant SKU | |
| H | Variant Colour | `name (hex)` |
| I | Size | `1:24` etc. |
| J | Quantity | |
| K | Unit Price | ₹ |
| L | Total Price | Unit × Qty |
| M | Subtotal | Order-level |
| N | Tax | Currently 0 |
| O | Shipping Cost | Currently 0 |
| P | Discount | |
| Q | Total Amount | |
| R | Payment Method | `razorpay / cod` |
| S | Payment Status | |
| T | Order Status | |
| U | Shipping Address | Single-line formatted |
| V | Pincode | |

Multi-item orders write **one row per item**. Order-level fields (M–V) are written on the first item row only; subsequent rows for the same order leave those cells blank.

Each item row's number is stored as `order.items[n].sheetRowNumber` so future status-update calls can target the exact row.

---

## Transaction Sheet — Column Schema (A–R)

| Col | Field |
|---|---|
| A | Order Number |
| B | Payment Date |
| C | Customer Email |
| D | Razorpay Payment ID |
| E | Razorpay Order ID |
| F | Amount (₹) |
| G | Currency |
| H | Payment Method |
| I | Status |
| J | Refund Amount |
| K | Refund ID |
| L | Failure Reason |
| M–R | (reserved / metadata) |

---

## Delivery Sheet — Column Schema (A–V)

| Col | Field |
|---|---|
| A | Order Number |
| B | Shipment Date |
| C | AWB Code |
| D | Courier Name |
| E | Courier ID |
| F | Tracking URL |
| G | Label URL |
| H | Manifest URL |
| I | Invoice URL |
| J | Pickup Scheduled |
| K | Status |
| L | Shiprocket Order ID |
| M | Shiprocket Channel Order ID |
| N | Shiprocket Shipment ID |
| O–V | (reserved) |

---

## Sync Triggers

| Event | Sheet | Method |
|---|---|---|
| Order created (any payment method) | Order Sheet | `syncOrderToSheet` |
| Payment verified | Transaction Sheet | `syncTransactionToSheet` |
| Shipment created (auto or manual) | Delivery Sheet | `syncShipmentToSheet` |
| Order status updated | Order Sheet | `updateOrderRows` |

All syncs are called via `setImmediate` so they never delay the HTTP response. If a sync fails, the error is logged to `console.error` and silently dropped — the order/payment record in MongoDB is the source of truth.

---

## GoogleSheetsService Internals

**Singleton pattern:** The service is instantiated once at module load.

**Lazy init:** `_init()` is called on first use to authenticate and build the Sheets client. Subsequent calls reuse the existing client.

**Row number tracking:** `appendRow` returns the numeric row index from the Sheets API response. This number is persisted on the MongoDB document (`sheetRowNumber`) so `updateRow` can target it precisely.

**Error resilience:** `appendRow` and `updateRow` are wrapped in try/catch inside the ERP service. A Sheets API outage does not break order processing.
