# 06 — Products API

Base path: `/api/products`  
Admin base path: `/api/admin/products`

---

## Public Routes

### List Products

```
GET /api/products
Auth: optionalAuth
```

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `page` | Number | default 1 |
| `limit` | Number | default 12 |
| `category` | String | category ObjectId filter |
| `minPrice` | Number | filter by variantSummary.minPrice |
| `maxPrice` | Number | |
| `size` | String | `1:16 \| 1:24 \| 1:32 \| 1:64` |
| `sort` | String | `price_asc \| price_desc \| newest \| rating` |
| `search` | String | name / description text match |

**Response includes per product:**
- All product fields + populated `categories`
- `variantSummary` (min/max price, totalQuantity, availableColors, availableSizes)
- `inWishlist: boolean` (if user is authenticated)
- Review stats aggregation (averageRating, reviewCount)

---

### Get Product by ID

```
GET /api/products/:id
Auth: optionalAuth
```

Returns full product document with all active variants populated (including media arrays), category info, review stats, and `inWishlist`.

---

### Get Product by Slug

```
GET /api/products/slug/:slug
Auth: optionalAuth
```

Same as above but resolves via `slug` field. Used for SEO-friendly product URLs.

---

### Get Products by Category

```
GET /api/categories/:categoryId/products
Auth: optionalAuth
```

Returns paginated products filtered by `categoryId`. Each product includes:
- `stockStatus`: `in_stock | low_stock | out_of_stock`
- `variantCount`: number of active variants
- `availableSizes`: array from variantSummary

---

### Search Products

```
GET /api/products/search?q=<query>
Auth: optionalAuth
```

Performs a **case-insensitive regex** match across:
- `Product.name`
- `Product.description[].content`
- `ProductVariant.sku`
- `ProductVariant.name`

Returns grouped results with variant matches highlighted.

---

### Get Recommendations

```
GET /api/products/recommend/:productId
Auth: optionalAuth
```

Returns up to 8 recommended products. See [18-services.md](./18-services.md) for the weighted scoring algorithm.

---

## Public Variant Routes

### Get All Variants for a Product

```
GET /api/products/:id/variants
```

Returns all active `ProductVariant` documents for the product, sorted by `displayOrder`.

---

### Get Single Variant

```
GET /api/products/:id/variants/:variantId
```

---

## Admin Product Routes

All require `adminAuth`.

### List All Products (Admin)

```
GET /api/admin/products
Auth: adminAuth
```

Like public list but includes inactive products, and shows `isActive` flag.

**Query parameters:** `page`, `limit`, `search`, `category`, `isActive`.

---

### Create Product

```
POST /api/admin/products
Auth: adminAuth
Content-Type: multipart/form-data
```

Creates a product and its first (default) variant in a **single transaction**.

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Product name |
| `slug` | Yes | URL slug (must be unique) |
| `categories` | No | JSON array of category IDs |
| `description` | No | JSON array `[{ type, content }]` |
| `productDetails` | No | JSON array `[{ topic, detail }]` |
| `meta` | No | JSON object for recommendation similarity |
| `variantName` | Yes | Name of the default variant |
| `color` | No | JSON `{ name, code }` |
| `size` | No | `1:16 \| 1:24 \| 1:32 \| 1:64` |
| `quantity` | Yes | Initial stock |
| `sellingPrice` | Yes | Selling price |
| `costPrice` | No | Cost price |
| `onSalePrice` | No | Sale price |
| `isOnSale` | No | Boolean |
| `files` | No | Media files (images / video / 3D) |

**Transaction steps:**
1. Create `Product` document.
2. Create default `ProductVariant` with `isDefault: true`.
3. Upload media to Cloudinary.
4. Recompute `variantSummary` on product.
5. Log admin activity.

---

### Update Product

```
PUT /api/admin/products/:id
Auth: adminAuth
Content-Type: application/json
```

Updates product-level fields (name, slug, categories, description, productDetails, meta, isActive).  
Does **not** touch variants. Recomputes `variantSummary` if needed.

---

### Soft Delete Product

```
DELETE /api/admin/products/:id
Auth: adminAuth
```

Sets `isActive: false` on the product and all its variants in a single transaction.

---

### Add Variant

```
POST /api/admin/products/:id/variants
Auth: adminAuth
Content-Type: multipart/form-data
```

Same fields as the variant part of product creation. Creates a new `ProductVariant` referencing the product. Recomputes `variantSummary`.

---

### Update Variant

```
PUT /api/admin/products/:id/variants/:variantId
Auth: adminAuth
Content-Type: multipart/form-data
```

Merges new media with existing (does not replace unless explicitly deleted first). Accepts the same fields as create. Recomputes `variantSummary`.

---

### Soft Delete Variant

```
DELETE /api/admin/products/:id/variants/:variantId
Auth: adminAuth
```

Sets variant `isActive: false`. **Blocks** if this is the last active variant for the product — a product must always have at least one active variant.

---

### Add Media to Variant

```
POST /api/admin/products/:id/variants/:variantId/media
Auth: adminAuth
Content-Type: multipart/form-data
Fields: files[]
```

Uploads additional files to Cloudinary and appends to `variant.media[]`.

---

### Delete Media from Variant

```
DELETE /api/admin/products/:id/variants/:variantId/media/:publicId
Auth: adminAuth
```

Calls `cloudinary.uploader.destroy(publicId)` and removes the media entry from the variant.

---

### Bulk Variant Update

```
POST /api/admin/products/bulk-variant-update
Auth: adminAuth
Body: { type: 'price' | 'stock', updates: [{ variantId, ...fields }] }
```

Batch updates pricing or stock across multiple variants in a single session.

- `type: 'price'`: updates `pricing.sellingPrice`, `pricing.onSalePrice`, `isOnSale`.
- `type: 'stock'`: updates `quantity`.

---

## Media Upload Constraints

| Constraint | Value |
|---|---|
| Max file size | 50 MB |
| Accepted formats | jpeg, png, webp, mp4, quicktime, gltf-binary, gltf+json, octet-stream |
| Cloudinary folder | `zenkai/products` |
| `resource_type` | `auto` (Cloudinary infers) |

---

## variantSummary Recomputation

Whenever variants are created, updated, or deleted the route handler calls a helper that:
1. Fetches all active variants for the product.
2. Calculates `min/max` of `currentPrice`.
3. Sums `quantity`.
4. Deduplicates `color` and `size` values.
5. Saves the result to `product.variantSummary`.

This keeps listing-page queries O(1) per product.
