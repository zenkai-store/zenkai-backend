# 02 — Getting Started

## Prerequisites

- Node.js ≥ 18
- MongoDB ≥ 6 (local or Atlas)
- A Cloudinary account
- A Razorpay test/live account
- A Google Cloud service account with Sheets API enabled
- A Shiprocket account

---

## Installation

```bash
git clone <repo-url>
cd zenkai-backend
npm install
```

---

## Environment Variables

Create a `.env` file in the project root. All variables below are **required** unless marked optional.

### Server

| Variable | Example | Description |
|---|---|---|
| `PORT` | `5000` | HTTP port (default 5000) |
| `NODE_ENV` | `development` | `development` or `production` |

### Database

| Variable | Example | Description |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017/zenkai` | MongoDB connection string |

### JWT

| Variable | Example | Description |
|---|---|---|
| `JWT_SECRET` | `super-secret-key` | Signing secret for all JWTs |

### Google OAuth

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `FRONTEND_URL` | Frontend origin for postMessage redirect (e.g. `http://localhost:5173`) |

### Cloudinary

| Variable | Description |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloud name from Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | API key |
| `CLOUDINARY_API_SECRET` | API secret |

### Razorpay

| Variable | Description |
|---|---|
| `RAZORPAY_KEY_ID` | Key ID (starts with `rzp_test_` or `rzp_live_`) |
| `RAZORPAY_KEY_SECRET` | Key secret |

### Shiprocket

| Variable | Example | Description |
|---|---|---|
| `SHIPROCKET_EMAIL` | `ops@example.com` | Shiprocket account email |
| `SHIPROCKET_PASSWORD` | `••••` | Shiprocket account password |
| `SHIPROCKET_BASE_URL` | `https://apiv2.shiprocket.in/v1/external` | API base (default set in code) |
| `SHIPROCKET_PICKUP_ADDRESS` | See below | JSON string of pickup location details |

`SHIPROCKET_PICKUP_ADDRESS` must be a valid JSON string:

```json
{
  "pickup_location": "main",
  "pin_code": "110001",
  "address": "123 Warehouse Street",
  "city": "New Delhi",
  "state": "Delhi",
  "country": "India"
}
```

### Google Sheets (ERP)

| Variable | Description |
|---|---|
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID from the Google Sheet URL |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Service account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Private key (use `\n` for newlines in `.env`) |

The spreadsheet must have three sheets named exactly:
- `Order Sheet`
- `Transaction Sheet`
- `Delivery Sheet`

---

## Running the Server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server logs `🚀 Server running on port 5000` and `✅ MongoDB Connected` on successful startup.

---

## Database Migrations

```bash
# Apply all pending migrations
npm run migrate

# Roll back the last migration
npm run migrate:down

# Check migration status
npm run migrate:status
```

---

## Seeding an Admin

```bash
node scripts/seed-admin.js
```

Edit the script first to set the desired admin email and password.

---

## Index Cleanup (one-time maintenance)

If you encounter duplicate-index warnings from MongoDB:

```bash
node scripts/cleanup-indexes.js
```

---

## Running with Docker (optional)

No `Dockerfile` is included in this repo. To containerise:

1. Use `node:18-alpine` as base image.
2. Copy `package.json` and run `npm ci --omit=dev`.
3. Copy source.
4. Set `CMD ["node", "server.js"]`.
5. Pass all environment variables via Docker secrets or a `.env` file mounted at runtime.
