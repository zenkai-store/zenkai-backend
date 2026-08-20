# 11 — Payments API

Base path: `/api/payments`  
Auth: `userAuth` required for all routes.

---

## Payment Flow Overview

```
1. POST /api/payments/create-order
       │  Creates Order + Razorpay order (or COD)
       ▼
2. Frontend: open Razorpay checkout with razorpayOrderId
       │  User pays
       ▼
3. POST /api/payments/verify
       │  HMAC signature verified
       │  Stock deducted, cart cleared
       │  Shipment creation triggered (background)
       ▼
4. GET /api/payments/status/:orderId
       │  Confirm payment status
```

---

## Create Order

```
POST /api/payments/create-order
Auth: userAuth
Body: { addressId, paymentMethod }
```

`paymentMethod`: `razorpay | cod`

**What happens:**
1. Calls `OrderService.createOrderFromCart(userId, addressId, paymentMethod)`.
2. Validates cart is not empty and all items are in stock (uses session lock).
3. Creates `Order` document with `paymentStatus: 'pending'`, `orderStatus: 'pending'`.
4. If `paymentMethod === 'razorpay'`: creates a Razorpay order with `amount` in paise, `currency: 'INR'`, `receipt: orderNumber`.
5. If `paymentMethod === 'cod'`: marks `paymentStatus: 'paid'` immediately and triggers background shipment.
6. Fires `setImmediate` → `ErpSyncService.syncOrderToSheet()`.

**Response (Razorpay):**

```json
{
  "success": true,
  "orderId": "<mongoOrderId>",
  "razorpayOrderId": "order_xxxxxxxxxxxx",
  "amount": 259800,
  "currency": "INR",
  "keyId": "rzp_test_xxxxxxxx"
}
```

**Response (COD):**

```json
{
  "success": true,
  "orderId": "<mongoOrderId>",
  "paymentMethod": "cod",
  "message": "Order placed successfully"
}
```

---

## Verify Payment

```
POST /api/payments/verify
Auth: userAuth
Body: {
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  orderId
}
```

**Signature verification:**

```js
const expectedSignature = crypto
  .createHmac('sha256', RAZORPAY_KEY_SECRET)
  .update(razorpayOrderId + '|' + razorpayPaymentId)
  .digest('hex');

if (expectedSignature !== razorpaySignature) {
  // 400 Payment verification failed
}
```

**On success:**
1. Calls `OrderService.processSuccessfulPayment(orderId, paymentData)`.
2. Creates `Payment` document with `status: 'success'`.
3. Sets `Order.paymentStatus = 'paid'`, `Order.orderStatus = 'confirmed'`.
4. Deducts stock: `ProductVariant.$inc({ quantity: -itemQuantity })` per item.
5. Clears user's cart.
6. `setImmediate` → `ErpSyncService.syncTransactionToSheet()`.
7. `setImmediate` → `DeliveryService.createShipmentForOrder()`.

**Response:**

```json
{
  "success": true,
  "message": "Payment verified successfully",
  "orderId": "...",
  "orderNumber": "ORD-202401-000042"
}
```

---

## Get Payment Status

```
GET /api/payments/status/:orderId
Auth: userAuth
```

Returns the current `paymentStatus` and `orderStatus` for the order. Used by frontend to poll after Razorpay modal closes.

**Response:**

```json
{
  "success": true,
  "paymentStatus": "paid",
  "orderStatus": "confirmed",
  "orderNumber": "ORD-202401-000042"
}
```

---

## Retry Payment

```
POST /api/payments/retry/:orderId
Auth: userAuth
```

For orders stuck in `paymentStatus: 'pending'` (user closed modal without paying).

**What happens:**
1. Validates order belongs to user and `paymentStatus === 'pending'`.
2. Creates a **new Razorpay order** for the same amount.
3. Updates `Order.razorpayOrderId` with the new value.
4. Returns new Razorpay order details for the frontend to re-open the checkout.

---

## Refund Flow

Refunds are triggered automatically on order cancellation (see [10-api-orders.md](./10-api-orders.md)) or manually via admin tools.

```js
// payment.model.js instance method
payment.processRefund(amount, reason)
```

1. Calls `razorpay.payments.refund(paymentId, { amount, notes: { reason } })`.
2. Stores `refundId` from Razorpay response.
3. Sets `payment.status = 'refunded'` (or `'partially_refunded'` for partial).
4. Sets `order.paymentStatus = 'refunded'`.

---

## Error Scenarios

| Scenario | HTTP | Message |
|---|---|---|
| Cart empty | 400 | Cart is empty |
| Insufficient stock | 400 | `<variantSku>` has only `<n>` items in stock |
| Invalid signature | 400 | Payment verification failed |
| Order already paid | 400 | Order already completed |
| Order not found | 404 | Order not found |
| Razorpay API error | 500 | Payment service unavailable |
