# 07 — Categories API

Base path: `/api/categories`  
Admin base path: `/api/admin/categories`

---

## Public Routes

### List Active Categories

```
GET /api/categories
```

Returns all categories where `isActive: true`. No auth required.

**Response:**

```json
{
  "success": true,
  "categories": [
    {
      "_id": "...",
      "name": "1:24 Scale",
      "slug": "1-24-scale",
      "description": "Standard die-cast models",
      "image": "https://res.cloudinary.com/...",
      "isActive": true
    }
  ]
}
```

---

## Admin Routes

All require `adminAuth`.

### Create Category

```
POST /api/admin/categories
Auth: adminAuth
Body: { name, slug, description?, image? }
```

- `name` and `slug` must be unique.
- Writes `AdminActivity` record.

**Response:**

```json
{
  "success": true,
  "category": { ... }
}
```

---

### Update Category

```
PUT /api/admin/categories/:id
Auth: adminAuth
Body: { name?, slug?, description?, image?, isActive? }
```

Partial update — only provided fields are changed.

---

### Delete Category

```
DELETE /api/admin/categories/:id
Auth: adminAuth
```

**Hard deletes** the category document.  
**Blocks** if any product references this category (checks `Product.categories` array). Returns `400` with a message listing the blocking product count.

This prevents orphaned category references in product documents.

---

## Notes

- Categories are referenced as an array in `Product.categories`, allowing a product to belong to multiple categories.
- The `slug` field is used for URL generation on the frontend.
- Category images are stored as plain URL strings — no Cloudinary integration at the category level.
