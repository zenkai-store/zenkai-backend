# 16 — Shipments API

Base path: `/api/admin/shipments`  
Auth: `adminAuth` required for all routes.

For the Shiprocket integration details and courier scoring see [18-services.md](./18-services.md).

---

## List Shipments

```
GET /api/admin/shipments
Auth: adminAuth
Query: page=1&limit=20&status=<enum>&search=<awbCode|orderNumber>
```

`status` enum: `pending | created | assigned | picked_up | in_transit | delivered | failed | cancelled`

**Response:**

```json
{
  "success": true,
  "shipments": [
    {
      "_id": "...",
      "orderId": { "orderNumber": "ORD-202401-000042", "totalAmount": 2598 },
      "awbCode": "1234567890",
      "courierName": "Delhivery",
      "status": "in_transit",
      "pickupScheduled": true,
      "createdAt": "..."
    }
  ],
  "pagination": { ... }
}
```

---

## Get Shipment Detail

```
GET /api/admin/shipments/:id
Auth: adminAuth
```

Returns the full shipment document including `metadata` (raw Shiprocket response) and `trackingDetails` (latest tracking fetch).

---

## Retry Shipment

```
POST /api/admin/shipments/:id/retry
Auth: adminAuth
```

Deletes the existing shipment record and re-runs the full auto-routing flow from scratch:

1. Calls `DeliveryService.retryShipment(shipmentId)`.
2. Fetches fresh courier availability.
3. Scores and selects best courier.
4. Creates new Shiprocket order, assigns AWB, generates label, manifests, schedules pickup.
5. Creates a new `Shipment` document; old document is deleted.

Returns `400` if shipment is in a terminal state (`delivered | cancelled`).

---

## Refresh Tracking

```
POST /api/admin/shipments/:id/refresh-tracking
Auth: adminAuth
```

Calls Shiprocket's tracking API for the `awbCode` and updates `shipment.trackingDetails` with the latest response.

Also maps the Shiprocket status string to the internal `status` enum via `DeliveryService.updateTrackingStatus()`.

---

## Get Shipping Label

```
GET /api/admin/shipments/:id/label
Auth: adminAuth
```

Redirects (`302`) to `shipment.labelUrl` (the Cloudinary/Shiprocket PDF URL). Returns `404` if label not yet generated.

---

## Shipment Status Enum

| Internal Status | Meaning |
|---|---|
| `pending` | Order paid, shipment not yet created |
| `created` | Shiprocket order created |
| `assigned` | AWB code assigned |
| `picked_up` | Package collected from warehouse |
| `in_transit` | In courier network |
| `delivered` | Delivered to customer |
| `failed` | Delivery failed / returned |
| `cancelled` | Cancelled before pickup |

---

## Shiprocket Status Mapping

`DeliveryService.updateTrackingStatus()` maps Shiprocket's verbose status strings to internal enum values:

| Shiprocket status (contains) | Internal status |
|---|---|
| `Picked Up` | `picked_up` |
| `In Transit` / `Out for Delivery` | `in_transit` |
| `Delivered` | `delivered` |
| `RTO` / `Return` | `failed` |
| `Cancelled` | `cancelled` |
| (default) | `created` |
