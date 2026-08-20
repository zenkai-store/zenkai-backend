# 17 — Delivery Requests API

Base path: `/api/admin/delivery-requests`  
Auth: `adminAuth` required for all routes.

---

## What is a Delivery Request?

When automatic Shiprocket routing fails, a `DeliveryRequest` is created for admin to handle manually. There are two trigger conditions:

| Reason | Description |
|---|---|
| `charge_exceeds_threshold` | Estimated courier charge > ₹250 |
| `insufficient_wallet` | Shiprocket wallet balance too low to place the order |

The admin then either **fulfils** the request (provides AWB + courier) or **rejects** it (with a reason).

---

## List Delivery Requests

```
GET /api/admin/delivery-requests
Auth: adminAuth
Query: page=1&limit=20&status=pending|fulfilled|rejected&reason=charge_exceeds_threshold|insufficient_wallet
```

**Response:**

```json
{
  "success": true,
  "requests": [
    {
      "_id": "...",
      "orderId": {
        "orderNumber": "ORD-202401-000042",
        "totalAmount": 2598,
        "userEmail": "jane@example.com"
      },
      "reason": "charge_exceeds_threshold",
      "status": "pending",
      "createdAt": "..."
    }
  ],
  "pagination": { ... }
}
```

---

## Get Delivery Request Detail

```
GET /api/admin/delivery-requests/:id
Auth: adminAuth
```

Returns the full document with populated order and address details.

---

## Fulfil Delivery Request

```
POST /api/admin/delivery-requests/:id/fulfill
Auth: adminAuth
Body: { awbCode, courierName }
```

**What happens:**
1. Validates request is `pending`.
2. Calls `DeliveryService.fulfillDeliveryRequest(requestId, { awbCode, courierName }, adminId)`.
3. Creates a `Shipment` document with `status: 'assigned'`.
4. Updates `Order.awbCode`, `Order.courierName`, `Order.deliveryStatus = 'assigned'`.
5. Sets `DeliveryRequest.status = 'fulfilled'`, `fulfilledBy`, `fulfilledAt`.
6. Logs `AdminActivity`.
7. Fires `setImmediate` → `ErpSyncService.syncShipmentToSheet()`.

---

## Reject Delivery Request

```
POST /api/admin/delivery-requests/:id/reject
Auth: adminAuth
Body: { reason }
```

Sets `DeliveryRequest.status = 'rejected'` and stores the `rejectionReason`.  
The order's `deliveryStatus` remains `pending` — the admin may retry shipment separately via the Shipments API.

---

## Delivery Request Summary

```
GET /api/admin/delivery-requests/stats/summary
Auth: adminAuth
```

Returns counts by status:

```json
{
  "success": true,
  "summary": {
    "pending": 3,
    "fulfilled": 45,
    "rejected": 2,
    "total": 50,
    "byReason": {
      "charge_exceeds_threshold": 30,
      "insufficient_wallet": 20
    }
  }
}
```

---

## Lifecycle Diagram

```
Payment confirmed
        │
        ▼
DeliveryService.createShipmentForOrder()
        │
   ┌────┴────────────────────────────────┐
   │                                     │
Charge ≤ ₹250 &&                   Charge > ₹250 OR
wallet sufficient                  wallet insufficient
   │                                     │
Auto-route:                        Create DeliveryRequest
  • Shiprocket order                (status: pending)
  • AWB assign                           │
  • Label generate               Admin reviews request
  • Pickup schedule                      │
  • status: assigned             ┌───────┴───────┐
                                 │               │
                              Fulfil           Reject
                            (awb + courier)  (reason)
                                 │
                          Shipment created
                          status: assigned
```
