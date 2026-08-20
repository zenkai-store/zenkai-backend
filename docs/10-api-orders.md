# 10 — Orders API

Base path: `/api/orders`  
Auth: `userAuth` required for all routes.

For payment-triggered order creation see [11-api-payments.md](./11-api-payments.md).

---

## List User Orders

```
GET /api/orders
Auth: userAuth
Query: page=1&limit=10
```

Returns only orders where `paymentStatus: 'paid'`. Pending/failed orders are excluded from the customer-facing list.

**Response:**

```json
{
  "success": true,
  "orders": [
    {
      "orderNumber": "ORD-202401-000042",
      "orderStatus": "shipped",
      "paymentStatus": "paid",
      "totalAmount": 2598,
      "items": [...],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": { ... }
}
```

---

## Get Order Detail

```
GET /api/orders/:orderId
Auth: userAuth
```

Returns the full order document. Verifies that `order.userId` matches `req.user.id` — users cannot access other users' orders.

Includes populated:
- `items[].productId` (name, slug)
- `items[].variantId` (sku, color, media)
- `addressId`
- `shipmentId`

---

## Cancel Order

```
POST /api/orders/:orderId/cancel
Auth: userAuth
Body: { reason? }
```

**Eligibility check:** `order.canBeCancelled()` must return `true` — orderStatus must be `pending | confirmed | processing`.

**What happens on cancellation:**
1. `orderStatus` → `cancelled`, `cancelledAt` = now, `cancellationReason` saved.
2. If `paymentStatus === 'paid'`: auto-refund triggered via `payment.processRefund()`.
3. Stock restored: each variant quantity incremented back via `$inc`.
4. `statusHistory` entry appended.

Returns `400` if order is not cancellable (e.g. already shipped).

---

## Track Order

```
GET /api/orders/:orderId/track
Auth: userAuth
```

Returns a **progress timeline** built from `order.statusHistory`.

**Response:**

```json
{
  "success": true,
  "tracking": {
    "orderNumber": "ORD-202401-000042",
    "currentStatus": "in_transit",
    "awbCode": "1234567890",
    "courierName": "Delhivery",
    "trackingUrl": "https://...",
    "estimatedDeliveryDate": "2024-01-20T00:00:00Z",
    "timeline": [
      { "status": "pending", "label": "Order Placed", "timestamp": "...", "completed": true },
      { "status": "confirmed", "label": "Order Confirmed", "timestamp": "...", "completed": true },
      { "status": "processing", "label": "Processing", "timestamp": null, "completed": false },
      { "status": "shipped", "label": "Shipped", "timestamp": null, "completed": false },
      { "status": "delivered", "label": "Delivered", "timestamp": null, "completed": false }
    ]
  }
}
```

---

## Admin Order Routes

Base path: `/api/admin/orders`  
Auth: `adminAuth`

### List All Orders

```
GET /api/admin/orders
Query: page, limit, status, paymentStatus, search, startDate, endDate, sort
```

`search` matches on `orderNumber` or `userEmail`.

---

### Get Order (Admin)

```
GET /api/admin/orders/:orderId
```

Same as user get-order but with no ownership check. Includes full admin-level details.

---

### Update Order Status

```
PUT /api/admin/orders/:orderId/status
Auth: adminAuth
Body: { orderStatus, paymentStatus?, note? }
```

Transitions the order status. Appends to `statusHistory`. Writes `AdminActivity`.

If `orderStatus === 'shipped'`, expects `trackingNumber` and `trackingUrl` in the body.

---

### Bulk Status Update

```
POST /api/admin/orders/bulk/status
Auth: adminAuth
Body: { orderIds: [...], orderStatus, note? }
```

Updates multiple orders in a single operation. Returns a count of updated documents.

---

### Dashboard Statistics

```
GET /api/admin/orders/statistics/dashboard
Auth: adminAuth
Query: period=7d | 30d | 90d | 1y
```

Returns an aggregation result:

```json
{
  "totalOrders": 150,
  "totalRevenue": 195000,
  "averageOrderValue": 1300,
  "ordersByStatus": { "pending": 5, "confirmed": 10, "shipped": 30, ... },
  "dailySales": [
    { "date": "2024-01-15", "orders": 8, "revenue": 10400 }
  ]
}
```

---

## Order Number Format

`ORD-YYYYMM-NNNNNN`

- `YYYYMM`: year and month of creation.
- `NNNNNN`: zero-padded 6-digit sequential counter from the `Counter` model.
- Example: `ORD-202401-000042`

The counter is global (not per-month reset) — this ensures uniqueness across all orders.
