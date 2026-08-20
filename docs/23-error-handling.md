# 23 — Error Handling

## Convention

All route handlers return JSON with a consistent shape:

**Success:**
```json
{ "success": true, "data": ... }
```
or field-specific:
```json
{ "success": true, "order": { ... } }
```

**Error:**
```json
{ "success": false, "message": "Human-readable description" }
```

There is no global error-handler middleware — each route handler has its own try/catch and sends the appropriate status code directly.

---

## HTTP Status Codes Used

| Code | Meaning | Common causes |
|---|---|---|
| `200` | OK | Successful read or update |
| `201` | Created | New resource created |
| `400` | Bad Request | Validation failure, business rule violation |
| `401` | Unauthorised | Missing or expired JWT |
| `403` | Forbidden | Wrong role (e.g. user accessing admin route) |
| `404` | Not Found | Document not found by ID |
| `409` | Conflict | Duplicate (e.g. duplicate review, slug already taken) |
| `500` | Internal Server Error | Unhandled exception, DB error, third-party API failure |

---

## Common Error Messages

### Auth

| Message | Code | Cause |
|---|---|---|
| `Admin not authenticated` | 401 | No `adminToken` cookie or Bearer header |
| `Invalid or expired token` | 401 | JWT verification failed |
| `Access denied` | 403 | JWT role is not `admin` |
| `Not authenticated` | 401 | No `token` cookie for user routes |

### Cart

| Message | Code | Cause |
|---|---|---|
| `Cart is empty` | 400 | `createOrderFromCart` called with empty cart |
| `<SKU> has only <n> items in stock` | 400 | Cart qty exceeds current stock |
| `Variant not found or inactive` | 400 | Variant deleted between add-to-cart and checkout |

### Payments

| Message | Code | Cause |
|---|---|---|
| `Payment verification failed` | 400 | HMAC signature mismatch |
| `Order already completed` | 400 | Duplicate payment verify attempt |
| `Order not found` | 404 | Invalid `orderId` in request |

### Products

| Message | Code | Cause |
|---|---|---|
| `Product not found` | 404 | |
| `Slug already exists` | 409 | Duplicate slug on create/update |
| `Cannot delete the last active variant` | 400 | Attempt to remove only remaining variant |

### Orders

| Message | Code | Cause |
|---|---|---|
| `Order cannot be cancelled` | 400 | Status is `shipped` / `delivered` / `cancelled` |
| `Order cannot be returned` | 400 | Outside 7-day return window or wrong status |
| `Unauthorised` | 403 | User trying to access another user's order |

### Categories

| Message | Code | Cause |
|---|---|---|
| `Cannot delete category with active products` | 400 | Products still reference this category |

---

## Transaction Errors

All handlers that open a Mongoose session follow this pattern:

```js
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // ... mutations
  });
  res.json({ success: true, ... });
} catch (err) {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
} finally {
  await session.endSession();
}
```

If the transaction is aborted by a write conflict or network error, `withTransaction` retries automatically (Mongoose default behaviour). If retries are exhausted, the catch block returns `500`.

---

## Third-Party API Errors

| Service | Failure behaviour |
|---|---|
| Razorpay order create | `500` returned to client, order not created |
| Razorpay verify | `400` if signature invalid; `500` on API error |
| Shiprocket | Error logged; `DeliveryRequest` created for manual handling |
| Google Sheets | Error logged and swallowed; HTTP response already sent via `setImmediate` |
| Cloudinary | Upload middleware returns `500` on upload failure |

---

## Logging

- `morgan('dev')` logs all incoming requests (method, path, status, response time) to stdout.
- `console.error` is used for unexpected exceptions within try/catch blocks.
- There is no structured logging library (Winston, Pino) at present. For production, consider adding one and shipping logs to a log aggregation service.
