# 12 — Addresses API

Base path: `/api/addresses`  
Auth: `userAuth` required for all routes.

---

## List Addresses

```
GET /api/addresses
Auth: userAuth
```

Returns all addresses for the authenticated user, default address first.

**Response:**

```json
{
  "success": true,
  "addresses": [
    {
      "_id": "...",
      "fullName": "Jane Doe",
      "phone": "9876543210",
      "addressLine1": "42 Main Street",
      "addressLine2": "Apt 3B",
      "landmark": "Near City Mall",
      "city": "Bengaluru",
      "district": "Bengaluru Urban",
      "state": "Karnataka",
      "country": "India",
      "pincode": "560001",
      "addressType": "home",
      "isDefault": true
    }
  ]
}
```

---

## Add Address

```
POST /api/addresses
Auth: userAuth
Body: {
  fullName, phone,
  addressLine1, addressLine2?,
  landmark?, city, district,
  state, country?,
  pincode, addressType,
  isDefault?,
  latitude?, longitude?
}
```

If `isDefault: true` and the user already has a default address, the old default is unset atomically before the new one is set.

---

## Get Address

```
GET /api/addresses/:id
Auth: userAuth
```

Returns a single address. Verifies ownership.

---

## Update Address

```
PUT /api/addresses/:id
Auth: userAuth
Body: (any subset of address fields)
```

Partial update. If `isDefault: true` is passed, performs the atomic default-swap described above.

---

## Delete Address

```
DELETE /api/addresses/:id
Auth: userAuth
```

Hard-deletes the address document. Returns `400` if the address is used by an existing order (checked via `Order.addressId`).

---

## Set Default Address

```
PATCH /api/addresses/:id/default
Auth: userAuth
```

Atomically:
1. Sets `isDefault: false` on all other addresses for this user.
2. Sets `isDefault: true` on the specified address.

Uses a MongoDB session to keep both operations atomic.

---

## Address Snapshot

When an order is placed, a full snapshot of the address is copied into `Order.addressSnapshot`. This snapshot is immutable and is preserved even if the user later edits or deletes the address.

Snapshot fields: `fullName, phone, addressLine1, addressLine2, landmark, city, district, state, country, pincode, addressType`.
