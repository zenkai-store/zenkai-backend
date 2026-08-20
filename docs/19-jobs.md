# 19 — Background Jobs

**File:** `src/jobs/cleanupPendingOrders.js`

Jobs are registered in `src/app.js` using `node-cron`.

---

## Pending Order Cleanup

### Schedule

```
0 2 * * *   →   Daily at 2:00 AM (server local time)
```

### What it does

Deletes `Order` documents where **both** conditions are true:
- `paymentStatus: 'pending'`
- `createdAt < now - 24 hours`

These are orders where the user initiated checkout but never completed payment (e.g. closed the Razorpay modal and never retried).

```js
await Order.deleteMany({
  paymentStatus: 'pending',
  createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
});
```

### Why this matters

- Prevents stale pending orders from polluting admin dashboards.
- Removes the Razorpay order reference that can no longer be paid (Razorpay orders expire after a configurable period).
- Keeps the `orders` collection lean.

### Notes

- This is a **hard delete** — the order is permanently removed.
- Only `paymentStatus: 'pending'` orders are affected. Orders with `paid | failed | refunded` are never touched.
- No stock was ever deducted for pending orders (stock deduction happens only after payment verification), so no stock restore is needed.
- The job logs a success message and the count of deleted documents to `console.log`.

---

## Adding New Jobs

To add a cron job:

1. Create a file in `src/jobs/`.
2. Export a function that calls `cron.schedule(expression, handler)`.
3. Import and call it in `src/app.js` alongside the existing `cleanupPendingOrders()` call.

```js
// src/jobs/myNewJob.js
const cron = require('node-cron');

module.exports = function startMyNewJob() {
  cron.schedule('0 3 * * *', async () => {
    try {
      // job logic
    } catch (err) {
      console.error('myNewJob failed:', err);
    }
  });
};
```

```js
// src/app.js
const startMyNewJob = require('./jobs/myNewJob');
startMyNewJob();
```

---

## Cron Expression Reference

| Expression | Meaning |
|---|---|
| `0 2 * * *` | Every day at 2:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First day of every month at midnight |
| `0 9-18 * * 1-5` | Hourly, 9 AM–6 PM, Monday–Friday |
