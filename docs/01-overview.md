# 01 — Project Overview

## What is Zenkai?

Zenkai is a **die-cast scale-model car** e-commerce platform. This repository is the Node.js / Express REST API backend that powers:

- A storefront (product listing, search, recommendations, cart, checkout)
- An admin portal (inventory, orders, customers, shipments, expenses)
- Payment processing via **Razorpay**
- Shipping via **Shiprocket** with automatic courier selection
- ERP sync to **Google Sheets** (orders, transactions, shipments)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS) |
| Framework | Express 5 |
| Database | MongoDB via Mongoose 9 |
| Auth | JWT (jsonwebtoken) + HttpOnly cookies |
| OAuth | Google OAuth 2.0 via Passport.js |
| Payments | Razorpay SDK |
| File storage | Cloudinary (images, videos, 3D models) |
| File upload | Multer + multer-storage-cloudinary |
| Shipping | Shiprocket REST API v2 |
| ERP | Google Sheets API v4 (service account) |
| Security | Helmet, CORS whitelist |
| Logging | Morgan (dev) |
| Scheduled jobs | node-cron |
| Migrations | migrate-mongo |
| Dev server | nodemon |

---

## Repository Layout

```
zenkai-backend/
├── server.js                  # Entry point — connects DB, starts server
├── src/
│   ├── app.js                 # Express app setup, middleware, route mounting
│   ├── config/
│   │   ├── db.js              # Mongoose connection
│   │   ├── passport.js        # Google OAuth strategy
│   │   ├── cloudinary.js      # Cloudinary v2 client
│   │   └── razorpay.js        # Razorpay client
│   ├── middleware/
│   │   ├── adminAuth.middleware.js   # Verify admin JWT
│   │   ├── userAuth.middleware.js    # Verify user JWT
│   │   ├── auth.middleware.js        # Generic auth (used by admin routes file)
│   │   └── upload.middleware.js      # Multer + Cloudinary storage
│   ├── models/                # Mongoose schemas (see 04-data-models.md)
│   ├── routes/                # Express routers (one file per domain)
│   ├── services/              # Business logic (see 18-services.md)
│   ├── jobs/
│   │   └── cleanupPendingOrders.js  # Cron: delete stale unpaid orders
│   └── generate-test-payment.js     # Dev utility
├── migrations/                # migrate-mongo migration files
├── scripts/
│   ├── seed-admin.js          # One-time admin seeder
│   └── cleanup-indexes.js     # Index maintenance utility
├── migrate-mongo-config.js    # migrate-mongo config
├── package.json
└── docs/                      # ← You are here
```

---

## Scale model sizes supported

Products use a controlled vocabulary for die-cast scale:

| Value | Description |
|---|---|
| `1:16` | Large — ~30 cm |
| `1:24` | Standard — ~18 cm (default) |
| `1:32` | Mid — ~13 cm |
| `1:64` | Small — ~7 cm |

---

## Allowed CORS Origins

```
http://localhost:5173
https://localhost:5173
http://127.0.0.1:5173
https://127.0.0.1:5173
https://zenkai-frontend-nine.vercel.app
```

---

## Key Design Decisions

1. **Variant-centric inventory** — Stock and pricing live on `ProductVariant`, not `Product`. The `Product` document caches a `variantSummary` (min/max price, total quantity, available colours and sizes) to avoid per-request joins for listing pages.

2. **Dual auth system** — Users authenticate via `token` cookie; admins via `adminToken` cookie. Both accept `Authorization: Bearer <token>` as a fallback (useful for mobile / Postman).

3. **Transactional writes** — All multi-document mutations (order creation, payment processing, variant management) use Mongoose sessions and `startTransaction` / `commitTransaction` to guarantee atomicity.

4. **Shiprocket auto-routing** — After payment, shipment creation is attempted automatically. Two escalation gates exist: estimated charge > ₹250 or wallet balance too low. Either gate creates a `DeliveryRequest` for admin to fulfil manually.

5. **Google Sheets as ERP** — Every order item, payment, and shipment is written to a shared Google Sheet for lightweight business reporting without a dedicated BI tool.

6. **Soft deletes everywhere** — Products, variants, reviews, and featured slots are soft-deleted (`isActive: false`) rather than removed from the database.
