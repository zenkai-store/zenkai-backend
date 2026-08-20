# 08 — Cart API

Base path: `/api/cart`  
Auth: `userAuth` required for all routes.

All cart mutations go through `CartService` and use MongoDB transactions.

---

## Get Cart

```
GET /api/cart
Auth: userAuth
```

Returns the user's cart with populated variant and product data.

**Response:**

```json
{
  "success": true,
  "cart": {
    "items": [
      {
        "productId": { "_id": "...", "name": "Toyota AE86", "slug": "..." },
        "variantId": { "_id": "...", "sku": "AE86-1:24-RED", "color": {...}, "size": "1:24", "media": [...] },
        "variantSku": "AE86-1:24-RED",
        "variantColor": { "name": "Red", "code": "#FF0000" },
        "quantity": 2,
        "unitPrice": 1299,
        "addedAt": "2024-01-01T00:00:00Z"
      }
    ],
    "totalAmount": 2598,
    "totalItems": 2
  }
}
```

---

## Get Cart Summary

```
GET /api/cart/summary
Auth: userAuth
```

Returns cart totals plus checkout eligibility.

**Response:**

```json
{
  "success": true,
  "summary": {
    "totalAmount": 2598,
    "totalItems": 2,
    "isEligibleForCheckout": true,
    "stockIssues": []
  }
}
```

`stockIssues` is an array of objects describing any variant whose available quantity is now less than the cart quantity:

```json
{
  "variantId": "...",
  "sku": "AE86-1:24-RED",
  "requestedQty": 5,
  "availableQty": 3
}
```

---

## Add Item to Cart

```
POST /api/cart/add
Auth: userAuth
Body: { variantId, quantity }
```

- Fetches current variant price (respects `isOnSale`).
- If variant already in cart, increments quantity.
- Validates stock — returns `400` if insufficient.
- Uses transaction for atomicity.

---

## Update Item Quantity

```
PUT /api/cart/update
Auth: userAuth
Body: { variantId, quantity }
```

Sets quantity to the provided value. Use quantity `0` to remove.  
Returns `400` if new quantity exceeds available stock.

---

## Remove Item from Cart

```
DELETE /api/cart/remove/:variantId
Auth: userAuth
```

Removes the variant from the cart entirely.

---

## Clear Cart

```
DELETE /api/cart/clear
Auth: userAuth
```

Removes all items.

---

## Bulk Add to Cart

```
POST /api/cart/bulk
Auth: userAuth
Body: { items: [{ variantId, quantity }] }
```

Adds or updates multiple items in a single transaction. Useful for syncing a guest cart on login.

---

## Move Wishlist Item to Cart

```
POST /api/cart/from-wishlist/:productId
Auth: userAuth
```

- Finds the product's default variant.
- Adds it to the cart with quantity 1.
- Removes the product from the wishlist.
- Runs in a transaction.

---

## Get Available Variants for Product

```
GET /api/cart/product/:productId/variants
Auth: userAuth
```

Returns a list of active variants for the product, annotating each with:
- `inCart: boolean`
- `cartQuantity: number`
- `availableQuantity: number`

Useful for the "Add to Cart" variant selector UI.

---

## CartService Internals

See [18-services.md](./18-services.md) for full CartService documentation. Key points:

- Every write method opens a Mongoose session and uses `withTransaction`.
- `addToCart` reads `currentPrice` virtual at add-time and stores it as `unitPrice`. Price changes after adding do not retroactively update cart items.
- `getCartSummary` does a real-time stock check against the database; it does not rely on cached data.
