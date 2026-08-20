# 04 — Data Models

All models live in `src/models/`. Mongoose 9 is used throughout. Every model uses `{ timestamps: true }` unless noted.

---

## Relationship Map

```
Admin ──────────────────────────────────────────────────────┐
  │ createdBy / updatedBy                                    │
  ▼                                                         │
Product ──────────── Category (many-to-many via array)       │
  │                                                         │
  └── ProductVariant (hasVariants=true)                     │
        │ variantId                                         │
        ▼                                                   │
User ──── Cart.items[] ──────────────────────────────────── │
  │                                                         │
  ├── Wishlist                                              │
  ├── Address ◄──── Order.addressId                        │
  ├── Review ──── Product                                   │
  └── Order ──────── Payment                               │
               └── Shipment ◄─────────────────────────────┘
                      │
                  DeliveryRequest (manual escalation)
```

---

## User

**Collection:** `users`  
**File:** `src/models/user.model.js`

| Field | Type | Notes |
|---|---|---|
| `name` | String | |
| `email` | String | unique, sparse (OAuth users may have no email initially) |
| `phone` | String | unique, sparse |
| `googleId` | String | unique, sparse |
| `password` | String | bcrypt hash, `select: false` |
| `role` | String enum | `user` \| `admin` (default `user`) |

---

## Admin

**Collection:** `admins`  
**File:** `src/models/admin.model.js`

Separate from `User`. Admin portal authentication uses this collection exclusively.

| Field | Type | Notes |
|---|---|---|
| `name` | String | required |
| `email` | String | unique, required |
| `password` | String | bcrypt hash, required |
| `role` | String | hardcoded `admin` |

---

## Category

**Collection:** `categories`  
**File:** `src/models/category.model.js`

| Field | Type | Notes |
|---|---|---|
| `name` | String | required, unique |
| `slug` | String | unique |
| `description` | String | |
| `image` | String | URL |
| `isActive` | Boolean | default `true` |

---

## Product

**Collection:** `products`  
**File:** `src/models/product.model.js`

| Field | Type | Notes |
|---|---|---|
| `productId` | String | unique, auto-generated |
| `name` | String | required |
| `slug` | String | unique, URL-safe identifier |
| `hasVariants` | Boolean | always `true` in practice |
| `categories` | ObjectId[] | ref: `Category` |
| `description` | Array | `{ type: 'topic'\|'line'\|'bullet', content: String }` |
| `productDetails` | Array | `{ topic: String, detail: String }` |
| `meta` | Object | flexible key-value for topic similarity |
| `isActive` | Boolean | soft delete flag |
| `createdBy` | ObjectId | ref: `Admin` |
| `updatedBy` | ObjectId | ref: `Admin` |
| `variantSummary` | Object | cached — see below |

### variantSummary (denormalised cache)

| Field | Type | Description |
|---|---|---|
| `minPrice` | Number | Lowest selling price across active variants |
| `maxPrice` | Number | Highest selling price across active variants |
| `totalQuantity` | Number | Sum of all variant quantities |
| `availableColors` | Array | `{ name, code }` |
| `availableSizes` | Array | `['1:24', '1:32', ...]` |

This cache is updated on every variant create/update/delete so listing endpoints never need a join.

---

## ProductVariant

**Collection:** `productvariants`  
**File:** `src/models/productVariant.model.js`

| Field | Type | Notes |
|---|---|---|
| `productId` | ObjectId | ref: `Product`, required |
| `sku` | String | unique |
| `name` | String | display name |
| `color` | Object | `{ name: String, code: String }` (hex) |
| `size` | String enum | `1:16 \| 1:24 \| 1:32 \| 1:64` (default `1:24`) |
| `media` | Array | see Media sub-schema below |
| `quantity` | Number | current stock |
| `pricing` | Object | see Pricing sub-schema below |
| `isOnSale` | Boolean | toggles `onSalePrice` usage |
| `isActive` | Boolean | soft delete flag |
| `isDefault` | Boolean | one default variant per product |
| `displayOrder` | Number | sort position |
| `attributes` | Map | flexible extra attributes |

### Media sub-schema

| Field | Type | Notes |
|---|---|---|
| `type` | String | `image \| video \| model` |
| `url` | String | Cloudinary delivery URL |
| `public_id` | String | Cloudinary public ID (for deletion) |
| `format` | String | e.g. `jpg`, `mp4`, `gltf` |
| `bytes` | Number | file size |

### Pricing sub-schema

| Field | Type | Description |
|---|---|---|
| `costPrice` | Number | Internal cost (not exposed to users) |
| `marginalPrice` | Number | Minimum acceptable margin price |
| `marketPrice` | Number | Competitor / MRP reference |
| `sellingPrice` | Number | Normal retail price |
| `onSalePrice` | Number | Sale/discounted price |

### Virtuals

| Virtual | Description |
|---|---|
| `currentPrice` | `isOnSale ? onSalePrice : sellingPrice` |
| `displayPrice` | `{ price: currentPrice, originalPrice: sellingPrice, isOnSale }` |

### Static methods

| Method | Description |
|---|---|
| `bulkUpdateQuantities(updates, session)` | Accepts `[{ variantId, quantity }]` and issues atomic `$set` per document inside the passed session |

---

## Order

**Collection:** `orders`  
**File:** `src/models/order.model.js`

| Field | Type | Notes |
|---|---|---|
| `orderNumber` | String | auto `ORD-YYYYMM-000001` via `Counter` |
| `userId` | ObjectId | ref: `User` |
| `userEmail` | String | snapshot at order time |
| `userPhone` | String | snapshot at order time |
| `items` | Array | see Order Item below |
| `subtotal` | Number | |
| `tax` | Number | currently 0% GST |
| `shippingCost` | Number | currently 0 |
| `discount` | Number | |
| `totalAmount` | Number | |
| `addressId` | ObjectId | ref: `Address` |
| `addressSnapshot` | Object | full address copy at order time |
| `paymentStatus` | String enum | `pending \| paid \| failed \| refunded \| partially_refunded` |
| `orderStatus` | String enum | `pending \| confirmed \| processing \| shipped \| delivered \| cancelled \| returned` |
| `paymentMethod` | String enum | `razorpay \| cod \| bank_transfer` |
| `razorpayOrderId` | String | |
| `paymentId` | String | Razorpay payment ID |
| `trackingNumber` | String | |
| `trackingUrl` | String | |
| `estimatedDeliveryDate` | Date | |
| `deliveredAt` | Date | |
| `cancelledAt` | Date | |
| `cancellationReason` | String | |
| `shipmentId` | ObjectId | ref: `Shipment` |
| `deliveryStatus` | String enum | `pending \| assigned \| picked_up \| in_transit \| delivered \| failed` |
| `courierName` | String | |
| `awbCode` | String | Air Waybill code |
| `shippedAt` | Date | |
| `shiprocketOrderId` | String | |
| `statusHistory` | Array | `{ status, timestamp, note }` — used to build tracking timeline |

### Order Item sub-schema

| Field | Type | Notes |
|---|---|---|
| `productId` | ObjectId | ref: `Product` |
| `variantId` | ObjectId | ref: `ProductVariant` |
| `variantSku` | String | snapshot |
| `variantColor` | Object | `{ name, code }` snapshot |
| `quantity` | Number | |
| `unitPrice` | Number | price at time of order |
| `totalPrice` | Number | `unitPrice × quantity` |
| `sheetRowNumber` | Number | Google Sheets row for ERP update |

### Instance methods

| Method | Returns | Description |
|---|---|---|
| `canBeCancelled()` | Boolean | `orderStatus` in `[pending, confirmed, processing]` |
| `canBeReturned()` | Boolean | `orderStatus === delivered` and `deliveredAt` within 7 days |

---

## Payment

**Collection:** `payments`  
**File:** `src/models/payment.model.js`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | ref: `User` |
| `orderId` | ObjectId | ref: `Order` |
| `razorpayPaymentId` | String | |
| `razorpayOrderId` | String | |
| `razorpaySignature` | String | stored after verification |
| `amount` | Number | paise |
| `currency` | String | default `INR` |
| `paymentMethod` | String | |
| `status` | String enum | `pending \| success \| failed \| refunded \| partially_refunded` |
| `refundAmount` | Number | |
| `refundId` | String | Razorpay refund ID |
| `failureReason` | String | |
| `paymentDetails` | Map | raw Razorpay webhook data |
| `metadata` | Map | extra context |

### Instance methods

`processRefund(amount, reason)` — calls Razorpay `payments.refund()` API, stores `refundId`, updates `status`.

---

## Cart

**Collection:** `carts`  
**File:** `src/models/cart.model.js`

One cart per user (`userId` is unique).

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | ref: `User`, unique |
| `items` | Array | see Cart Item below |

### Cart Item sub-schema

| Field | Type |
|---|---|
| `productId` | ObjectId |
| `variantId` | ObjectId |
| `variantSku` | String |
| `variantColor` | Object |
| `quantity` | Number |
| `unitPrice` | Number |
| `addedAt` | Date |

### Virtuals

| Virtual | Description |
|---|---|
| `totalAmount` | Sum of `item.unitPrice × item.quantity` |
| `totalItems` | Sum of all item quantities |

### Instance methods

| Method | Description |
|---|---|
| `hasVariant(variantId)` | Returns true if variant is already in cart |
| `getItemByVariant(variantId)` | Returns the cart item for that variant |

---

## Address

**Collection:** `addresses`  
**File:** `src/models/address.model.js`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | ref: `User` |
| `fullName` | String | |
| `phone` | String | |
| `addressLine1` | String | |
| `addressLine2` | String | |
| `landmark` | String | |
| `city` | String | |
| `district` | String | |
| `state` | String | |
| `country` | String | default `India` |
| `latitude` | Number | |
| `longitude` | Number | |
| `pincode` | String | |
| `addressType` | String enum | `home \| work \| other` |
| `isDefault` | Boolean | |

---

## Wishlist

**Collection:** `wishlists`  
**File:** `src/models/wishlist.model.js`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | ref: `User` |
| `productId` | ObjectId | ref: `Product` |
| `variantId` | ObjectId | ref: `ProductVariant`, optional |

**Unique index:** `(userId, productId, variantId)` — prevents duplicate wishlist entries per user + product + variant combination.

---

## Review

**Collection:** `reviews`  
**File:** `src/models/review.model.js`

| Field | Type | Notes |
|---|---|---|
| `productId` | ObjectId | ref: `Product` |
| `userId` | ObjectId | ref: `User` |
| `rating` | Number | 1–5 |
| `reviewText` | String | |
| `media` | Array | `{ url, public_id, type }` |
| `isActive` | Boolean | soft delete |

**Partial unique index:** `{ userId, productId }` where `isActive: true` — allows only one active review per user per product.

---

## Shipment

**Collection:** `shipments`  
**File:** `src/models/shipment.model.js`

| Field | Type | Notes |
|---|---|---|
| `orderId` | ObjectId | ref: `Order`, unique |
| `awbCode` | String | Air Waybill code |
| `courierName` | String | |
| `courierId` | Number | Shiprocket courier ID |
| `trackingUrl` | String | |
| `labelUrl` | String | |
| `manifestUrl` | String | |
| `invoiceUrl` | String | |
| `pickupScheduled` | Boolean | |
| `status` | String enum | `pending \| created \| assigned \| picked_up \| in_transit \| delivered \| failed \| cancelled` |
| `shiprocketOrderId` | String | |
| `shiprocketChannelOrderId` | String | |
| `shiprocketShipmentId` | String | |
| `metadata` | Mixed | raw Shiprocket response |
| `trackingDetails` | Mixed | latest tracking fetch |
| `sheetRowNumber` | Number | ERP row reference |

---

## DeliveryRequest

**Collection:** `deliveryrequests`  
**File:** `src/models/deliveryRequest.model.js`

Created when auto-routing fails (charge > ₹250 or insufficient wallet).

| Field | Type | Notes |
|---|---|---|
| `orderId` | ObjectId | ref: `Order` |
| `reason` | String | `charge_exceeds_threshold \| insufficient_wallet` |
| `status` | String enum | `pending \| fulfilled \| rejected` |
| `awbCode` | String | filled by admin on fulfilment |
| `courierName` | String | filled by admin on fulfilment |
| `rejectionReason` | String | |
| `fulfilledBy` | ObjectId | ref: `Admin` |
| `fulfilledAt` | Date | |

---

## AdminActivity

**Collection:** `adminActivities`  
**File:** `src/models/adminActivity.model.js`

Append-only audit log. Every significant admin action writes one record.

| Field | Type | Notes |
|---|---|---|
| `adminId` | ObjectId | ref: `Admin` |
| `adminEmail` | String | snapshot |
| `action` | String | human-readable description |
| `ipAddress` | String | `req.ip` |
| `userAgent` | String | `req.headers['user-agent']` |

---

## Expense

**Collection:** `expenses`  
**File:** `src/models/expense.model.js`

| Field | Type | Notes |
|---|---|---|
| `title` | String | required |
| `category` | String enum | `travel \| stock \| equipment \| maintenance \| other` |
| `description` | String | |
| `amount` | Number | required |
| `paymentMethod` | String enum | `cash \| bank \| upi \| card` |
| `expenseDate` | Date | |
| `createdBy` | ObjectId | ref: `Admin` |

---

## Counter

**Collection:** `counters`  
**File:** `src/models/counter.model.js`

Monotonic counter used for order number generation.

| Field | Type | Notes |
|---|---|---|
| `_id` | String | counter key, e.g. `orderNumber` |
| `seq` | Number | current value |

`findOneAndUpdate` with `$inc: { seq: 1 }` and `upsert: true` gives a race-safe auto-increment.

---

## Featured

**Collection:** `featuredproducts`  
**File:** `src/models/featured.model.js`

| Field | Type | Notes |
|---|---|---|
| `productId` | ObjectId | ref: `Product` |
| `position` | Number | 1–4 |
| `isActive` | Boolean | soft delete |
| `setBy` | ObjectId | ref: `Admin` |
