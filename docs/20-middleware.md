# 20 — Middleware Reference

All middleware lives in `src/middleware/`.

---

## adminAuth

**File:** `src/middleware/adminAuth.middleware.js`  
**Used on:** All `/api/admin/*` routes

```
Token source priority:
  1. req.cookies.adminToken
  2. Authorization: Bearer <token> header

Verification:
  jwt.verify(token, JWT_SECRET)
  decoded.role must === 'admin'

Sets: req.admin = decoded JWT payload

Errors:
  401  Admin not authenticated  (no token)
  401  Invalid or expired token (bad JWT)
  403  Access denied            (role !== 'admin')
```

---

## userAuth

**File:** `src/middleware/userAuth.middleware.js`  
**Used on:** All user-facing write routes (cart, orders, payments, wishlist, addresses, reviews)

```
Token source priority:
  1. req.cookies.token
  2. Authorization: Bearer <token> header

Verification:
  jwt.verify(token, JWT_SECRET)

Sets: req.user = decoded JWT payload

Errors:
  401  Not authenticated  (no token)
  401  Invalid or expired token (bad JWT)
```

---

## optionalAuth

**File:** `src/middleware/auth.middleware.js` (exported as `optionalAuth`)  
**Used on:** `GET /api/products`, `GET /api/products/:id`, `GET /api/products/search`, `GET /api/products/recommend/:productId`

Runs the same JWT extraction and verification logic as `userAuth`, but calls `next()` regardless of outcome. If a valid token is present, `req.user` is set; if absent or invalid, `req.user` remains `undefined`.

This enables wishlist status and personalised data to be injected into public responses without gating access.

---

## upload

**File:** `src/middleware/upload.middleware.js`  
**Used on:** Product media upload routes, review media upload routes

Wraps `multer` with `multer-storage-cloudinary`.

### Configuration

| Setting | Value |
|---|---|
| Storage | Cloudinary |
| Folder | `zenkai/products` |
| `resource_type` | `auto` (Cloudinary infers image/video/raw) |
| Max file size | 50 MB |

### Accepted MIME types

| MIME type | Format |
|---|---|
| `image/jpeg` | JPEG |
| `image/png` | PNG |
| `image/webp` | WebP |
| `video/mp4` | MP4 |
| `video/quicktime` | MOV |
| `model/gltf-binary` | GLB (3D model) |
| `model/gltf+json` | GLTF (3D model) |
| `application/octet-stream` | Binary (fallback for GLB) |

Files that do not match the allowed types are rejected with a `400 File type not allowed` error before they reach Cloudinary.

### Usage

```js
const upload = require('../middleware/upload.middleware');

// Single field, multiple files
router.post('/', upload.array('files', 10), handler);

// Multiple named fields
router.post('/', upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'model', maxCount: 1 }
]), handler);
```

After upload, `req.files` contains an array of objects with:

```js
{
  fieldname: 'files',
  originalname: 'photo.jpg',
  path: 'https://res.cloudinary.com/...',  // delivery URL
  filename: 'zenkai/products/abc123',       // public_id
  format: 'jpg',
  bytes: 204800
}
```

---

## Middleware Execution Order in app.js

```
helmet()
cors(corsOptions)
morgan('dev')
express.json()
express.urlencoded({ extended: true })
cookieParser()
passport.initialize()
```

Route-level middleware (auth, upload) is applied per-router, not globally.
