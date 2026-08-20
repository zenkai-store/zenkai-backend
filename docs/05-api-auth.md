# 05 — Authentication & Authorisation

## Overview

There are two separate auth systems:

| System | Collection | Cookie | Expiry |
|---|---|---|---|
| User (customer) | `users` | `token` | 180 days |
| Admin | `admins` | `adminToken` | 24 hours |

Both use the same `JWT_SECRET` but the payload carries a `role` field that separates them.

---

## User Authentication

### Google OAuth 2.0 (popup flow)

The frontend opens a popup window to `/api/auth/google`. After OAuth completes the popup sends the JWT to the opener via `postMessage` and closes itself.

```
Frontend: window.open('/api/auth/google', 'googleLogin', ...)
              │
              ▼
GET /api/auth/google
  → passport.authenticate('google', { scope: ['profile', 'email'] })
              │
              ▼  (Google redirects back)
GET /api/auth/google/callback
  → passport.authenticate('google', { session: false })
  → Find or create User by googleId / email
  → Sign JWT  { id, name, email, role }
  → Set cookie  token=<jwt>; HttpOnly; maxAge=180d
  → Redirect to /api/auth/success
              │
              ▼
GET /api/auth/success
  → Returns HTML page:
      window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', user: {...} }, origin)
      window.close()
```

On OAuth failure the user is redirected to `/api/auth/failure` which sends `GOOGLE_AUTH_FAILURE` via postMessage.

### Email / Password

**Sign up**

```
POST /api/auth/signup
Body: { name, email, password }
```

- Checks email uniqueness.
- Hashes password with bcrypt (12 rounds).
- Creates `User` document.
- Signs JWT and sets `token` cookie.
- Returns `{ message, user: { id, name, email, role } }`.

**Login**

```
POST /api/auth/login
Body: { email, password }
```

- Finds user by email (explicit `+password` select).
- Compares bcrypt hash.
- Signs JWT and sets `token` cookie.
- Returns `{ message, user }`.

### Logout

```
POST /api/auth/logout
```

Clears the `token` cookie.

### Get Current User

```
GET /api/auth/me
Auth: userAuth (required)
```

Returns the decoded JWT payload from `req.user`.

---

## JWT Payload (User)

```json
{
  "id": "<userId>",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "role": "user",
  "iat": 1700000000,
  "exp": 1715000000
}
```

---

## Admin Authentication

```
POST /api/admin/login
Body: { email, password }
```

- Finds admin in `admins` collection.
- Compares bcrypt.
- Signs JWT `{ id, name, email, role: 'admin' }`.
- Sets `adminToken` cookie (HttpOnly, 24h).
- Writes `AdminActivity` record: action `"Admin logged in"`.

```
POST /api/admin/logout
```

Clears `adminToken` cookie.

---

## JWT Payload (Admin)

```json
{
  "id": "<adminId>",
  "name": "Admin Name",
  "email": "admin@example.com",
  "role": "admin",
  "iat": 1700000000,
  "exp": 1700086400
}
```

---

## Middleware

### userAuth (`src/middleware/userAuth.middleware.js`)

```
1. Read token from req.cookies.token
2. Fallback: Authorization: Bearer <token> header
3. jwt.verify(token, JWT_SECRET)
4. req.user = decoded payload
5. next()
```

Returns `401` if no token or invalid. Returns `403` if `role !== 'user'` (not currently enforced — role check happens at route level via `adminAuth`).

### adminAuth (`src/middleware/adminAuth.middleware.js`)

```
1. Read token from req.cookies.adminToken
2. Fallback: Authorization: Bearer <token> header
3. jwt.verify(token, JWT_SECRET)
4. Check decoded.role === 'admin'  → 403 if not
5. req.admin = decoded payload
6. next()
```

Returns `401` if no token or invalid. Returns `403` if role is not admin.

### optionalAuth

Used on product listing and search routes. Runs the same JWT check but calls `next()` even if no token is present. Enables wishlist status injection without gating public routes.

---

## Admin Activity Log

Every mutating admin action appends a record to `adminActivities`:

```js
await AdminActivity.create({
  adminId: req.admin.id,
  adminEmail: req.admin.email,
  action: "Description of what was done",
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
```

Query the audit log:

```
GET /api/admin/activities?page=1&limit=20&action=login&startDate=2024-01-01&endDate=2024-12-31
Auth: adminAuth
```

---

## Security Notes

- Cookies are `HttpOnly` and `SameSite=Lax` (set by Express default when `httpOnly: true`).
- In production, `Secure: true` should be added (requires HTTPS — set `NODE_ENV=production`).
- JWT secret must be a strong random string ≥ 32 characters in production.
- Admin token expiry is intentionally short (24h) to limit blast radius of a compromised token.
- Passwords are hashed with bcrypt at cost factor 12. Never stored or logged in plaintext.
