# 24 — Deployment

## Prerequisites

- Node.js ≥ 18 on the server
- MongoDB Atlas cluster (or self-hosted replica set — transactions require a replica set)
- All environment variables configured (see [02-getting-started.md](./02-getting-started.md))
- Domain + TLS certificate if serving HTTPS directly (or put behind a reverse proxy)

---

## Environment Checklist

Before deploying, verify:

- [ ] `NODE_ENV=production`
- [ ] `MONGO_URI` points to production Atlas cluster
- [ ] `JWT_SECRET` is a strong random string (≥ 32 chars, not reused from dev)
- [ ] `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are **live** keys (not test)
- [ ] `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` are production credentials
- [ ] `CLOUDINARY_*` vars point to production cloud
- [ ] `GOOGLE_SHEETS_SPREADSHEET_ID` points to the production sheet
- [ ] `GOOGLE_SHEETS_PRIVATE_KEY` newlines are properly escaped (`\n`)
- [ ] `FRONTEND_URL` is set to the production frontend origin
- [ ] CORS origins in `src/app.js` include the production frontend URL

---

## Starting the Server

```bash
npm start
# runs: node server.js
```

For process management use **PM2**:

```bash
npm install -g pm2

# Start
pm2 start server.js --name zenkai-backend

# Save process list (survives reboots)
pm2 save
pm2 startup

# Logs
pm2 logs zenkai-backend

# Restart
pm2 restart zenkai-backend

# Status
pm2 status
```

---

## Database Migrations on Deploy

Always run migrations before starting the new server version:

```bash
npm run migrate
```

In a CI/CD pipeline this step should run after deploying the new code but before routing traffic to the new instance.

---

## Reverse Proxy (Nginx)

Place Node.js behind Nginx to handle TLS termination and serve on port 443.

Minimal Nginx config:

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

When behind a proxy, `req.ip` returns the proxy IP. Set `app.set('trust proxy', 1)` in `src/app.js` so that `req.ip` correctly reflects the client IP for admin activity logging.

---

## Cookie Security in Production

When `NODE_ENV=production`, ensure cookies are set with `Secure: true` and `SameSite=Strict`:

```js
res.cookie('token', jwt, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 180 * 24 * 60 * 60 * 1000,
});
```

Verify that HTTPS is enforced end-to-end before enabling `Secure: true`.

---

## MongoDB Atlas Configuration

- Use an **M10** or larger cluster for production (M0 free tier does not support transactions).
- Create a database user with `readWrite` on the zenkai database only.
- Whitelist only your server's IP in the Atlas network access list.
- Enable Atlas backups (daily snapshots).

---

## Cloudinary Configuration

- Use a dedicated Cloudinary account or at minimum a dedicated folder (`zenkai/products`).
- Set upload presets to restrict allowed formats if needed.
- Configure Cloudinary's auto-backup for the `zenkai` folder.

---

## Shiprocket

- Confirm pickup address is registered in the Shiprocket dashboard before go-live.
- Ensure wallet balance is sufficient for expected order volume (auto-routing fails on insufficient balance).
- Set the `DELIVERY_CHARGE_THRESHOLD` constant in `delivery.service.js` to match business requirements.

---

## Google Sheets

- Lock cells / ranges in the spreadsheet to prevent accidental manual edits that would desync `sheetRowNumber`.
- The service account needs **Editor** access to the spreadsheet.
- Do not rename the three sheet tabs (`Order Sheet`, `Transaction Sheet`, `Delivery Sheet`) — the service references them by exact name.

---

## Health Check

There is no dedicated `/health` endpoint. For uptime monitoring, probe any lightweight endpoint such as:

```
GET /api/categories   (returns 200 with empty array on cold DB)
```

Or add a dedicated endpoint:

```js
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```

---

## CI/CD Pipeline (recommended steps)

```
1. Run tests (if test suite exists)
2. npm ci  (clean install)
3. npx migrate-mongo up  (apply pending migrations)
4. pm2 reload zenkai-backend  (zero-downtime reload)
5. Smoke test: curl https://api.yourdomain.com/health
```

---

## Scaling Considerations

- The app is stateless (JWT auth, no server-side sessions) — horizontal scaling with a load balancer is straightforward.
- The Shiprocket token is cached in-process memory. With multiple instances, each will independently re-authenticate when the cached token expires. This is safe but causes extra Shiprocket auth calls. Move the token to Redis if this becomes an issue.
- MongoDB Atlas auto-scales read replicas. Ensure read-heavy queries (product listing, recommendations) use `readPreference: 'secondaryPreferred'` if read throughput becomes a bottleneck.
