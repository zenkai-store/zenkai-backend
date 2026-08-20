# 15 — Admin Portal API

This document covers admin-only routes not covered in product, order, shipment, or featured docs.

---

## Admin Auth

See [05-api-auth.md](./05-api-auth.md) for login/logout details.

---

## Customer Management

Base path: `/api/admin/customers`  
Auth: `adminAuth`

### List Customers

```
GET /api/admin/customers
Query: page=1&limit=20&search=<name|email|phone>&sort=newest|totalSpent|orderCount
```

Uses a MongoDB aggregation pipeline that joins `users` with `orders` to compute per-customer stats:

| Field | Description |
|---|---|
| `orderCount` | Total number of paid orders |
| `totalSpent` | Sum of `totalAmount` across paid orders |
| `lastOrderDate` | Most recent order `createdAt` |

**Response:**

```json
{
  "success": true,
  "customers": [
    {
      "_id": "...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "phone": "9876543210",
      "createdAt": "...",
      "orderCount": 5,
      "totalSpent": 6500,
      "lastOrderDate": "2024-01-15T00:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

---

### Get Customer Profile

```
GET /api/admin/customers/:userId
Auth: adminAuth
```

Returns the full user document with aggregated order stats appended.

---

### Get Customer Addresses

```
GET /api/admin/customers/:userId/addresses
Auth: adminAuth
```

Returns all addresses for the user.

---

### Get Customer Orders

```
GET /api/admin/customers/:userId/orders
Auth: adminAuth
Query: page=1&limit=10
```

Returns paginated order history for the user.

---

### Get Customer Reviews

```
GET /api/admin/customers/:userId/reviews
Auth: adminAuth
```

Returns all reviews (active and inactive) written by the user.

---

### Get Customer Wishlist

```
GET /api/admin/customers/:userId/wishlist
Auth: adminAuth
```

Returns the user's wishlist with populated product data.

---

### Get Customer Statistics

```
GET /api/admin/customers/:userId/stats
Auth: adminAuth
```

Runs **parallel** queries to return a comprehensive profile:

```json
{
  "orderStats": {
    "totalOrders": 5,
    "totalSpent": 6500,
    "averageOrderValue": 1300,
    "ordersByStatus": { ... }
  },
  "cartStats": {
    "itemCount": 2,
    "cartTotal": 2598
  },
  "wishlistCount": 8,
  "reviewCount": 3,
  "addressCount": 2
}
```

---

## Admin Activity Log

```
GET /api/admin/activities
Auth: adminAuth
Query: page=1&limit=20&action=<string>&startDate=<ISO>&endDate=<ISO>
```

Returns paginated audit log of admin actions, newest first.

`action` filter does a partial string match (case-insensitive).

**Response item:**

```json
{
  "_id": "...",
  "adminId": "...",
  "adminEmail": "admin@example.com",
  "action": "Product created: Toyota AE86",
  "ipAddress": "203.0.113.5",
  "userAgent": "Mozilla/5.0 ...",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

---

## Expense Management

Base path: `/api/admin/expenses`  
Auth: `adminAuth`

### Create Expense

```
POST /api/admin/expenses
Auth: adminAuth
Body: {
  title,
  category,       // travel | stock | equipment | maintenance | other
  description?,
  amount,
  paymentMethod,  // cash | bank | upi | card
  expenseDate?
}
```

`createdBy` is automatically set from `req.admin.id`.

---

### List Expenses

```
GET /api/admin/expenses
Auth: adminAuth
Query: page=1&limit=20&category=<enum>&startDate=<ISO>&endDate=<ISO>&sort=newest|amount
```

Returns paginated expenses with total amount sum.

**Response:**

```json
{
  "success": true,
  "expenses": [...],
  "totalAmount": 45000,
  "pagination": { ... }
}
```

---

## Notes

- All admin routes log an `AdminActivity` record on mutating operations.
- Customer aggregation queries use `$lookup` + `$group` pipeline stages — they are read-heavy and may be slow on large datasets without proper indexes on `orders.userId`.
- The parallel stats endpoint uses `Promise.all` to fetch all sub-metrics concurrently.
