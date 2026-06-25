# Plain Store

Minimalist, self-hosted local pickup store MVP built as a small Node.js monolith.

![Plain Store homepage](docs/plain-store-screenshot.png)

## Stack

- Node.js
- Express
- SQLite via the built-in `node:sqlite` module
- Server-rendered HTML from plain template functions
- Static CSS and local optimized product images
- Sharp for upload image resizing/compression

## Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Review `.env` and adjust it for your machine.

   Local development now reads configuration from [`.env`](/home/korgan/store/.env) automatically.

3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:3001`

The first run creates `data/store.db` and seeds the current starter catalog automatically.

## Routes

- `/` catalog homepage
- `/search?q=...` simple search
- `/c/:slug` category pages
- `/p/:slug` product detail pages
- `/contact` contact form
- `/cart` basket
- `/checkout` pickup details
- `/order/status/:token` private pickup order status links
- `/order-lookup` pickup order lookup
- `/admin` admin dashboard

## Admin

The admin is intentionally plain. It supports:

- product create/edit
- inventory and pricing updates
- low-stock and out-of-stock warnings
- product image upload/delete with automatic web optimization
- category creation
- order status updates

Default local password fallback is `change-me`. Set `ADMIN_PASSWORD_HASH` in real use.

## Operations

- Data lives in `data/store.db`
- Email uses SMTP when `SMTP_HOST` and `MAIL_FROM` are set
- Without SMTP settings, email messages are written to `data/email_outbox/`
- New back-in-stock notification emails are confirmed before they enter the queue;
  previously verified order contacts can join directly
- Static assets live in `public/`
- Simple file backups: `npm run backup`
- Health check: `/healthz`
- Put Caddy or Nginx in front for TLS and compression
- A minimal [Caddyfile](/home/korgan/store/Caddyfile) is included for self-hosting

## Product Images

Admin uploads accept common image formats and save only an optimized web JPEG.
Images are rotated from EXIF metadata, resized to fit within `900 x 900`, and
compressed so product pages do not serve oversized originals.

## Tests

Run the critical-path test suite:

```bash
npm test
```

The tests use temporary SQLite databases. The HTTP route tests start a temporary
local server and do not touch production or local development data.

## systemd

A ready-to-install unit file is included at [systemd/plain-store.service](/home/korgan/store/systemd/plain-store.service).

Install and enable it with:

```bash
sudo cp /home/korgan/store/systemd/plain-store.service /etc/systemd/system/plain-store.service
sudo systemctl daemon-reload
sudo systemctl enable --now plain-store
```

Useful commands:

```bash
sudo systemctl status plain-store
sudo journalctl -u plain-store -f
sudo systemctl restart plain-store
```

## Environment

- `PORT` defaults to `3001`
- `ADMIN_PASSWORD_HASH` should be set for public deployment; generate with `npm run admin:hash -- "your-long-admin-password"`
- `ADMIN_PASSWORD` remains a development fallback when `ADMIN_PASSWORD_HASH` is not set
- `COOKIE_SECRET` should always be set in real use
- `COOKIE_SECURE=true` is recommended behind HTTPS; use `false` for plain local HTTP development
- `TRUST_PROXY` defaults to `loopback`, which matches a same-host Caddy/Nginx reverse proxy and prevents direct clients from spoofing forwarded IP headers
- `PUBLIC_STORE_URL` is used in order-status email links
- `PICKUP_LOCATION` and `PICKUP_INSTRUCTIONS` are included in pickup-order emails
- `MAIL_FROM`, `STORE_OWNER_EMAIL`, and `SMTP_*` enable real email delivery
- `ORDER_CONFIRMATION_MINUTES` controls first-time email confirmation expiry; default `30`
- `CONTACT_VERIFICATION_DAYS` controls how long a confirmed contact can reorder without another confirmation; default `90`
- `.env` values are loaded automatically by the npm scripts

## Deployment

A Hetzner Cloud deployment runbook is available at [docs/deployment-runbook.md](/home/korgan/store/docs/deployment-runbook.md).
Backup and restore notes are available at [docs/backup-restore.md](/home/korgan/store/docs/backup-restore.md).

## Notes

- Local pickup only
- Pay at pickup; no online payment flow
- Pickup lifecycle decision flow: [docs/pay-at-pickup-flow.md](/home/korgan/store/docs/pay-at-pickup-flow.md)
- First-time email addresses must confirm by email before inventory is reserved
- Out-of-stock product pages support back-in-stock email notifications
- No shipping
- No customer accounts by default
- No third-party tracking
- No SPA or frontend build pipeline
- No external services required for the MVP
