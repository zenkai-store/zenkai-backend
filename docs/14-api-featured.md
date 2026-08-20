# 14 — Featured Products API

Base path: `/api/admin/featured`  
Auth: `adminAuth` required for all write routes.  
Public read: `GET /api/featured` (no auth).

---

## Concept

The homepage features up to **4 product slots** (positions 1–4). Each slot holds a reference to an active product. The admin can set, reorder, toggle, and remove slots.

---

## Public Route

### Get Active Featured Products

```
GET /api/featured
```

Returns featured slots where `isActive: true`, ordered by `position`, with populated product and default variant data.

**Response:**

```json
{
  "success": true,
  "featured": [
    {
      "position": 1,
      "productId": {
        "_id": "...",
        "name": "Toyota AE86",
        "slug": "toyota-ae86",
        "variantSummary": { ... }
      }
    }
  ]
}
```

---

## Admin Routes

### List All Featured Slots

```
GET /api/admin/featured
Auth: adminAuth
```

Returns all featured documents including inactive ones.

---

### Set Featured Product

```
POST /api/admin/featured
Auth: adminAuth
Body: { productId, position }
```

- `position` must be 1–4.
- If a slot at that position already exists and is active, it is soft-deactivated first.
- Creates a new featured document at the position.
- Logs `AdminActivity`.

---

### Bulk Reorder Featured

```
PUT /api/admin/featured/bulk
Auth: adminAuth
Body: { updates: [{ featuredId, position }] }
```

Reorders multiple slots in a single batch. Each `featuredId` is set to the given `position`. Useful for drag-and-drop reordering in admin UI.

---

### Toggle Featured Slot

```
PATCH /api/admin/featured/:id/toggle
Auth: adminAuth
```

Toggles `isActive` on the specified featured document. Allows temporarily hiding a slot without deleting it.

---

### Soft Delete Featured Slot

```
DELETE /api/admin/featured/:id
Auth: adminAuth
```

Sets `isActive: false`.

---

### Permanent Delete Featured Slot

```
DELETE /api/admin/featured/:id/permanent
Auth: adminAuth
```

Hard-deletes the featured document.

---

### Clear All Featured Slots

```
DELETE /api/admin/featured/clear/all
Auth: adminAuth
```

Permanently deletes all featured documents. Use with caution — homepage will show no featured products.

---

### Delete by Position

```
DELETE /api/admin/featured/position/:position
Auth: adminAuth
```

Deletes (permanently) the featured slot at a given position number (1–4).

---

### Get Available Products for Featuring

```
GET /api/admin/featured/available-products
Auth: adminAuth
```

Returns active products that are **not** currently featured (excludes products already assigned to an active slot). Used to populate the admin "add featured" product picker.
