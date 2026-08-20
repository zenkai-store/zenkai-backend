# 22 — Database Migrations

**Tool:** `migrate-mongo`  
**Config:** `migrate-mongo-config.js`

---

## Setup

`migrate-mongo` is already installed as a dev dependency. The config file points to `MONGO_URI` from environment.

---

## Commands

```bash
# Check status of all migrations
npm run migrate:status
# or
npx migrate-mongo status

# Apply all pending migrations (up)
npm run migrate
# or
npx migrate-mongo up

# Roll back the most recently applied migration
npm run migrate:down
# or
npx migrate-mongo down

# Create a new migration file
npx migrate-mongo create <migration-name>
```

---

## Migration File Structure

Generated files live in `migrations/`. Each exports `up` and `down` functions receiving the `db` client and `client` (MongoClient).

```js
// migrations/20240115123456-example-migration.js
module.exports = {
  async up(db, client) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await db.collection('products').updateMany(
          { slug: { $exists: false } },
          [{ $set: { slug: { $toLower: '$name' } } }],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }
  },

  async down(db, client) {
    await db.collection('products').updateMany(
      {},
      { $unset: { slug: '' } }
    );
  }
};
```

---

## Applied Migrations

Migration history is stored in the `changelog` collection in MongoDB. Each document records the migration filename, applied date, and status.

To see what has run:

```bash
npx migrate-mongo status
```

---

## Writing Safe Migrations

- Always wrap multi-document changes in a session + transaction.
- Provide a working `down` function for every `up`.
- Test migrations on a staging database before production.
- Never rename or delete a migration file that has already been applied — `migrate-mongo` tracks files by name.
- For large collections (> 100k documents), prefer `bulkWrite` over `updateMany` with `{ ordered: false }` to avoid holding locks.

---

## Adding a New Index

Indexes should be added via migrations rather than directly in Mongoose schema `index()` calls once the app is in production, to control exactly when the index build runs and avoid surprise blocking operations on large collections.

```js
module.exports = {
  async up(db) {
    await db.collection('orders').createIndex(
      { userId: 1, paymentStatus: 1 },
      { background: true, name: 'orders_userId_paymentStatus' }
    );
  },

  async down(db) {
    await db.collection('orders').dropIndex('orders_userId_paymentStatus');
  }
};
```
