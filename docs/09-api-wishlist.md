# 09 — Wishlist API

Base path: `/api/wishlist`  
Auth: `userAuth` required for all routes.

---

## Add to Wishlist

```
POST /api/wishlist/:productId
Auth: userAuth
Body: { variantId? }   (optional — saves product-level or variant-level)
```

Creates a `Wishlist` document. Returns `400` if already wishlisted (unique index on `userId + productId + variantId`).

---

## Remove from Wishlist

```
DELETE /api/wishlist/:productId
Auth: userAuth
Query: variantId=<id>   (optional — must match what was saved)
```

Hard-deletes the wishlist entry.

---

## Get Wishlist

```
GET /api/wishlist
Auth: userAuth
Query: page=1&limit=20
```

Returns a paginated list of wishlisted items, formatted for display.

**Each item includes:**
- Product name, slug, categories
- Variant image (first image from `media[]` of the saved variant, or default variant if no variant saved)
- `currentPrice` and `displayPrice` from variant pricing virtuals
- `stockStatus`: `in_stock | low_stock | out_of_stock` (based on quantity)
- `isAvailable`: whether the product and variant are still active

**Response shape:**

```json
{
  "success": true,
  "wishlist": [
    {
      "wishlistId": "...",
      "productId": "...",
      "variantId": "...",
      "product": {
        "name": "Toyota AE86",
        "slug": "toyota-ae86",
        "categories": [...]
      },
      "variant": {
        "sku": "AE86-1:24-RED",
        "color": { "name": "Red", "code": "#FF0000" },
        "size": "1:24",
        "image": "https://res.cloudinary.com/...",
        "currentPrice": 1299,
        "displayPrice": { "price": 1299, "originalPrice": 1499, "isOnSale": true },
        "stockStatus": "in_stock"
      }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5, "pages": 1 }
}
```

---

## Notes

- Wishlist entries can be product-level (no `variantId`) or variant-level. The frontend should pass `variantId` when the user wishlists from a variant detail view.
- The `inWishlist` flag injected on product listing responses is derived from a batch query against `Wishlist` — no extra round-trips per product.
- Moving a wishlist item to cart (`POST /api/cart/from-wishlist/:productId`) uses the product's **default variant**, not the wishlisted variant.
