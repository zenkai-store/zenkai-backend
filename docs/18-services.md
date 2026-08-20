# 18 — Services

Business logic lives in `src/services/`. Services are instantiated once (singletons) or exported as classes that callers instantiate per-request.

---

## OrderService

**File:** `src/services/order.service.js`

### `createOrderFromCart(userId, addressId, paymentMethod)`

1. Opens a Mongoose session.
2. Fetches user's cart and validates it is non-empty.
3. For each cart item: fetches variant, checks `isActive`, checks `quantity >= requestedQty` — throws `400` on failure.
4. Fetches and snapshots the address.
5. Computes totals: `subtotal = Σ(unitPrice × qty)`, `tax = 0`, `shippingCost = 0`, `totalAmount = subtotal`.
6. Auto-increments `Counter` (key `orderNumber`) via `findOneAndUpdate($inc)`.
7. Formats `orderNumber` as `ORD-YYYYMM-NNNNNN`.
8. Creates `Order` document.
9. If `paymentMethod === 'razorpay'`: calls Razorpay `orders.create({ amount: totalAmount * 100, currency: 'INR', receipt: orderNumber })`.
10. Commits transaction.
11. `setImmediate` → `ErpSyncService.syncOrderToSheet(order)`.
12. Returns `{ order, razorpayOrder }`.

### `processSuccessfulPayment(orderId, { razorpayPaymentId, razorpayOrderId, razorpaySignature })`

1. Opens session.
2. Finds order, asserts `paymentStatus === 'pending'`.
3. Creates `Payment` document with `status: 'success'`.
4. Sets `order.paymentStatus = 'paid'`, `order.orderStatus = 'confirmed'`, `order.paymentId`.
5. Deducts stock: `ProductVariant.updateOne({ _id: variantId }, { $inc: { quantity: -qty } })` per item.
6. Deletes user's cart.
7. Commits.
8. `setImmediate` → `ErpSyncService.syncTransactionToSheet(order, payment)`.
9. `setImmediate` → `DeliveryService.createShipmentForOrder(orderId)`.

### `cancelOrder(orderId, userId, reason)`

1. Fetches order, verifies ownership and `canBeCancelled()`.
2. Sets `orderStatus = 'cancelled'`, `cancelledAt`, `cancellationReason`.
3. If `paymentStatus === 'paid'`: calls `payment.processRefund(order.totalAmount, reason)`.
4. Restores stock: `$inc quantity +qty` per variant.
5. Appends `statusHistory` entry.

### `getOrderStatistics(period)`

Runs an aggregation pipeline over `orders` where `paymentStatus: 'paid'` and `createdAt >= now - period`:
- `$group` by date (truncated to day) for `dailySales`.
- `$group` overall for totals.
- `$facet` for `ordersByStatus` breakdown.

### `getAdminOrders(filters)`

Paginated query with optional filters: `status`, `paymentStatus`, `search` (orderNumber / userEmail regex), `startDate`, `endDate`, `sort`.

---

## CartService

**File:** `src/services/cart.service.js`

All methods use `mongoose.startSession()` + `withTransaction`.

### `addToCart(userId, variantId, quantity)`

1. Fetches variant; throws if not found or `isActive: false`.
2. Checks `variant.quantity >= quantity`.
3. Finds or creates cart for user.
4. If variant already in cart: increments `item.quantity` (validates new total vs stock).
5. Else: pushes new item with `unitPrice = variant.currentPrice` (virtual).
6. Saves cart inside transaction.

### `updateCartItem(userId, variantId, quantity)`

- `quantity === 0` → removes item (same as `removeFromCart`).
- Validates new quantity vs stock before setting.

### `removeFromCart(userId, variantId)`

Pulls the item matching `variantId` from `cart.items`.

### `clearCart(userId)`

Sets `cart.items = []`.

### `getCartSummary(userId)`

- Fetches cart with populated variants.
- For each item: compares `item.quantity` against current `variant.quantity`.
- Returns `{ totalAmount, totalItems, isEligibleForCheckout, stockIssues[] }`.

### `bulkAddToCart(userId, items[])`

Iterates `[{ variantId, quantity }]` in a single transaction, calling the add logic for each.

---

## DeliveryService

**File:** `src/services/delivery.service.js`

### Constants

| Constant | Value |
|---|---|
| `DELIVERY_CHARGE_THRESHOLD` | `250` (₹) |
| Package dimensions | 20.3 × 15.3 × 10.2 cm |
| Package weight | 0.75 kg |

### Token Management

Shiprocket requires a Bearer token obtained via `POST /auth/local`. The token is cached in-memory with a 10-day TTL. `_getToken()` returns the cached value or re-authenticates if expired.

### `createShipmentForOrder(orderId)`

Full auto-routing pipeline:

```
1. Fetch order + address snapshot
2. Get available couriers from Shiprocket
3. Score each courier:
     score = 0.5 × normalizedRating + 0.5 × normalizedCost
     (normalizedRating = rating / maxRating)
     (normalizedCost = 1 - (charge - minCharge) / (maxCharge - minCharge))
4. Select highest-scoring courier
5. If courier.charge > DELIVERY_CHARGE_THRESHOLD:
     → createDeliveryRequest(orderId, 'charge_exceeds_threshold')
     → return
6. Check Shiprocket wallet balance:
   If balance < courier.charge:
     → createDeliveryRequest(orderId, 'insufficient_wallet')
     → return
7. Create Shiprocket order
8. Assign AWB code
9. Generate shipping label
10. Generate manifest
11. Schedule pickup
12. Create Shipment document
13. Update Order: awbCode, courierName, deliveryStatus = 'assigned', shipmentId
14. ErpSyncService.syncShipmentToSheet(shipment)
```

### `retryShipment(shipmentId)`

1. Fetches `Shipment` by ID.
2. Asserts status is not `delivered` or `cancelled`.
3. Deletes the `Shipment` document.
4. Clears `order.shipmentId`, `order.awbCode`, `order.deliveryStatus = 'pending'`.
5. Calls `createShipmentForOrder(orderId)` fresh.

### `fulfillDeliveryRequest(requestId, { awbCode, courierName }, adminId)`

Called from the admin delivery requests route:
1. Updates `DeliveryRequest` → `status: 'fulfilled'`.
2. Creates `Shipment` with provided AWB and courier, `status: 'assigned'`.
3. Updates `Order` fields.
4. Fires ERP sync.

### `rejectDeliveryRequest(requestId, reason)`

Sets `DeliveryRequest.status = 'rejected'`, stores `rejectionReason`.

### `updateTrackingStatus(shipmentId)`

Calls Shiprocket track-by-AWB endpoint. Parses the verbose status string and maps it to internal enum (see [16-api-shipments.md](./16-api-shipments.md) for mapping table). Saves result to `shipment.trackingDetails`.

---

## RecommendationService

**File:** `src/services/recommendation.service.js`

### `getRecommendations(productId, userId?)`

Returns up to 8 recommended products.

**Pipeline stages (MongoDB aggregation):**

| Stage | Score weight | Logic |
|---|---|---|
| `sameCategory` | 40 | Product shares ≥ 1 category with the target |
| `topRated` | 20 | Average review rating ≥ 4.0 |
| `newArrival` | 15 | `createdAt` within last 30 days |
| `highStock` | 10 | `variantSummary.totalQuantity` ≥ 10 |
| `metaSimilarity` | 10 | Shared keys/values in `product.meta` object |
| `similarPrice` | 5 | `variantSummary.minPrice` within ±30% of target's minPrice |

The pipeline:
1. Filters out the target product itself and inactive products.
2. Computes a `score` field using `$add` of conditional `$cond` expressions.
3. Sorts descending by `score`.
4. Limits to 8.
5. If fewer than 8 results, fills remaining slots with newest active products.

**Post-pipeline enrichment (no N+1):**
- Batch wishlist lookup: one query `Wishlist.find({ userId, productId: { $in: resultIds } })`.
- Batch variant image lookup: one query `ProductVariant.find({ productId: { $in: resultIds }, isDefault: true })`.
- Merges results in-memory.

---

## GoogleSheetsService

**File:** `src/services/googleSheet.service.js`

Singleton. Uses `googleapis` with a service account JWT.

### Initialisation (`_init()`)

Called lazily on first use:
1. Creates `google.auth.JWT` with `client_email`, `private_key`, scopes `spreadsheets`.
2. Calls `auth.authorize()`.
3. Creates `google.sheets({ version: 'v4', auth })`.

### `appendRow(sheetName, values[])`

Calls `sheets.spreadsheets.values.append` with `valueInputOption: 'USER_ENTERED'`, `insertDataOption: 'INSERT_ROWS'`. Returns the row number from the response's `updatedRange`.

### `updateRow(sheetName, rowNumber, values[])`

Calls `sheets.spreadsheets.values.update` on the exact range `SheetName!A{rowNumber}`.

---

## ErpSyncService

**File:** `src/services/erpSync.service.js`

Wraps `GoogleSheetsService` with domain-specific column schemas.

### Sheet Schemas

**Order Sheet** (22 columns, A–V)

| Col | Field |
|---|---|
| A | Order Number |
| B | Order Date |
| C | Customer Name |
| D | Customer Email |
| E | Customer Phone |
| F | Product Name |
| G | Variant SKU |
| H | Variant Color |
| I | Size |
| J | Quantity |
| K | Unit Price |
| L | Total Price |
| M | Subtotal |
| N | Tax |
| O | Shipping Cost |
| P | Discount |
| Q | Total Amount |
| R | Payment Method |
| S | Payment Status |
| T | Order Status |
| U | Shipping Address |
| V | Pincode |

One **row per order item**. The first item row also contains order-level fields; subsequent item rows for the same order have order-level cells left blank.

**Transaction Sheet** (18 columns, A–R)

Columns include: Order Number, Payment ID, Razorpay Order ID, Amount, Currency, Payment Method, Status, Refund Amount, Refund ID, etc.

**Delivery Sheet** (22 columns, A–V)

Columns include: Order Number, AWB Code, Courier Name, Courier ID, Tracking URL, Label URL, Pickup Scheduled, Status, Shiprocket Order ID, etc.

### `syncOrderToSheet(order)`

Appends one row per order item. Stores `sheetRowNumber` back on each `order.items[n].sheetRowNumber` for future updates.

### `updateOrderRows(order)`

Updates existing rows (using stored `sheetRowNumber`) when order status changes.

### `syncTransactionToSheet(order, payment)`

Appends a single transaction row.

### `syncShipmentToSheet(shipment)`

Appends a delivery row. Stores `sheetRowNumber` on the `Shipment` document.

All sync methods are called via `setImmediate` so they never block the HTTP response. Errors are caught and logged but do not propagate.
