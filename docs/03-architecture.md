# 03 — Architecture

## Layers

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (Browser / App)            │
└───────────────────────┬─────────────────────────────┘
                        │ HTTPS
┌───────────────────────▼─────────────────────────────┐
│              EXPRESS 5 APPLICATION                   │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Helmet   │  │   CORS     │  │  Morgan (logs)   │  │
│  └──────────┘  └────────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────────────┐│
│  │               Route Layer (18 routers)           ││
│  │  /api/auth   /api/products   /api/cart           ││
│  │  /api/orders /api/payments   /api/admin/*        ││
│  └──────────────────────┬───────────────────────────┘│
│                         │                            │
│  ┌──────────────────────▼───────────────────────────┐│
│  │           Middleware: Auth / Upload               ││
│  │  adminAuth  userAuth  optionalAuth  upload        ││
│  └──────────────────────┬───────────────────────────┘│
│                         │                            │
│  ┌──────────────────────▼───────────────────────────┐│
│  │              Controller / Handler Layer           ││
│  │  Route handler functions (inline in route files) ││
│  └──────┬───────────────┬──────────────┬────────────┘│
│         │               │              │             │
│  ┌──────▼──────┐ ┌──────▼──────┐ ┌────▼──────────┐  │
│  │  OrderSvc   │ │  CartSvc    │ │ DeliverySvc   │  │
│  │  RecommSvc  │ │ GoogleSheet │ │  ErpSyncSvc   │  │
│  └──────┬──────┘ └──────┬──────┘ └────┬──────────┘  │
│         │               │              │             │
│  ┌──────▼───────────────▼──────────────▼────────────┐│
│  │              Mongoose Models (ODM)                ││
│  └──────────────────────┬───────────────────────────┘│
└─────────────────────────┼───────────────────────────┘
                          │
         ┌────────────────▼────────────────┐
         │           MongoDB Atlas          │
         └─────────────────────────────────┘
```

---

## Request Lifecycle

1. **Incoming request** hits Express via Node.js `http`.
2. **Global middleware** runs in order:
   - `helmet()` sets security headers.
   - `cors(corsOptions)` checks `Origin` header against whitelist.
   - `morgan('dev')` logs method + path + status.
   - `cookieParser()` parses `Cookie` header into `req.cookies`.
   - `express.json()` parses JSON body.
   - `express.urlencoded()` parses form bodies.
   - Passport initialise (no sessions — stateless).
3. **Router match** — Express finds the matching router and handler.
4. **Auth middleware** (route-specific):
   - Public routes: no middleware.
   - User routes: `userAuth` reads `token` cookie or `Authorization` header, verifies JWT, sets `req.user`.
   - Admin routes: `adminAuth` reads `adminToken` cookie or `Authorization` header, verifies JWT, checks `role === 'admin'`, sets `req.admin`.
   - Optional auth routes: `optionalAuth` sets `req.user` if token present, otherwise continues without error.
5. **Upload middleware** (media routes only): Multer streams to Cloudinary, adds `req.files`.
6. **Handler** executes, usually:
   - Validates request params / body.
   - Opens a Mongoose session if write is multi-document.
   - Calls service method(s) or queries models directly.
   - Commits or aborts transaction.
   - Sends JSON response.
7. **Background work** (`setImmediate` / cron):
   - Google Sheets sync fires after the HTTP response is sent.
   - Shiprocket order creation fires after payment confirmation.

---

## Route Mounting (src/app.js)

| Prefix | Router file |
|---|---|
| `/api/auth` | `auth.routes.js` |
| `/api/admin` | `admin.routes.js` |
| `/api/admin/products` | `admin.products.routes.js` |
| `/api/admin/categories` | `admin.category.routes.js` |
| `/api/admin/orders` | `admin.order.routes.js` |
| `/api/admin/customers` | `admin.customer.routes.js` |
| `/api/admin/shipments` | `admin.shipment.routes.js` |
| `/api/admin/delivery-requests` | `admin.deliveryRequest.routes.js` |
| `/api/admin/featured` | `admin.featured.routes.js` |
| `/api/admin/expenses` | `admin.expense.routes.js` |
| `/api/admin/reviews` | `admin.review.routes.js` |
| `/api/products` | `product.routes.js` |
| `/api/categories` | `category.routes.js` |
| `/api/cart` | `cart.routes.js` |
| `/api/wishlist` | `wishlist.routes.js` |
| `/api/orders` | `order.routes.js` |
| `/api/payments` | `payment.routes.js` |
| `/api/addresses` | `address.routes.js` |
| `/api/reviews` | `review.routes.js` |

---

## Data Flow: Order Placement

```
POST /api/payments/create-order
        │
        ▼
OrderService.createOrderFromCart()
  ├─ Validate cart items / stock (Mongoose session)
  ├─ Create Order document (orderNumber via Counter)
  ├─ Create Razorpay order (or mark COD)
  └─ Return { orderId, razorpayOrderId, amount }

POST /api/payments/verify
        │
        ▼
HMAC signature check (razorpayOrderId + razorpayPaymentId)
        │
        ▼
OrderService.processSuccessfulPayment()
  ├─ Create Payment record
  ├─ Deduct stock ($inc -quantity per variant)
  ├─ Clear cart
  ├─ setImmediate → ErpSyncService.syncOrderToSheet()
  └─ setImmediate → DeliveryService.createShipmentForOrder()
```

---

## Data Flow: Shipment Auto-routing

```
DeliveryService.createShipmentForOrder()
  ├─ Fetch available couriers from Shiprocket
  ├─ Score each courier (50% reliability + 50% cost)
  ├─ Select best scoring courier
  ├─ Estimated delivery charge ≤ ₹250?
  │     YES → Check Shiprocket wallet balance
  │             SUFFICIENT → Create order → Assign AWB → Generate label
  │                          → Generate manifest → Schedule pickup
  │             INSUFFICIENT → Create DeliveryRequest (manual)
  │     NO  → Create DeliveryRequest (manual)
  └─ Update Order.deliveryStatus
```

---

## Concurrency & Consistency

- All writes that span multiple collections open a **Mongoose session** and use `startTransaction` / `commitTransaction`.
- If any step throws, `abortTransaction` rolls back every change in that session.
- Cron job and background `setImmediate` callbacks run outside request sessions; they catch their own errors and log rather than crashing.
