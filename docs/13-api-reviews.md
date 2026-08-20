# 13 — Reviews API

Base path: `/api/reviews`  
Auth: `userAuth` for write operations.

---

## Create Review

```
POST /api/reviews
Auth: userAuth
Content-Type: multipart/form-data
Fields: { productId, rating, reviewText?, files[]? }
```

- `rating`: integer 1–5 (required).
- `files`: optional media (images only via upload middleware).
- Enforces partial unique index: only one **active** review per `(userId, productId)` pair. Returns `409` if already reviewed.
- Uploads media to Cloudinary and stores `{ url, public_id, type: 'image' }` in `review.media[]`.

---

## Update Review

```
PUT /api/reviews/:reviewId
Auth: userAuth
Content-Type: multipart/form-data
Fields: { rating?, reviewText?, files[]? }
```

- Verifies `review.userId === req.user.id`.
- Appends new media (does not replace existing).
- Partial update — only provided fields are changed.

---

## Delete Review

```
DELETE /api/reviews/:reviewId
Auth: userAuth
```

Soft-deletes: sets `isActive: false`. This releases the partial unique index, allowing the user to submit a new review for the same product later.

---

## Get Product Review Stats

```
GET /api/reviews/product/:productId/stats
```

No auth required.

Returns aggregated rating breakdown for the product.

**Response:**

```json
{
  "success": true,
  "stats": {
    "averageRating": 4.3,
    "totalReviews": 28,
    "breakdown": {
      "5": 14,
      "4": 8,
      "3": 4,
      "2": 1,
      "1": 1
    },
    "percentages": {
      "5": 50,
      "4": 28.6,
      "3": 14.3,
      "2": 3.6,
      "1": 3.6
    }
  }
}
```

The aggregation uses `$group` with a `$cond` per star to count each bucket in a single pass.

---

## Get Product Reviews

```
GET /api/reviews/product/:productId
Query: page=1&limit=10&sort=newest|highest|lowest
```

Returns paginated active reviews with user name and media.

---

## Admin Review Routes

Base path: `/api/admin/reviews`  
Auth: `adminAuth`

### List All Reviews

```
GET /api/admin/reviews
Query: page, limit, productId, isActive, minRating, maxRating
```

Returns all reviews including soft-deleted ones.

---

### Toggle Review Status

```
PATCH /api/admin/reviews/:reviewId/toggle-status
Auth: adminAuth
```

Toggles `isActive`. Used to hide/unhide reviews.

---

### Delete Review (Hard Delete)

```
DELETE /api/admin/reviews/:reviewId
Auth: adminAuth
```

Permanently removes the review document. Also calls `cloudinary.uploader.destroy()` for each media item in `review.media[]`.

---

## Notes

- Review media is stored in Cloudinary but in a separate path from product media.
- The batch review aggregation on product listing (averageRating, reviewCount) is done with a `$lookup` + `$group` pipeline — not denormalised — so it's always current.
- Soft-deleting then re-creating a review is the supported flow for users who want to change a review (the partial index only blocks duplicate **active** reviews).
