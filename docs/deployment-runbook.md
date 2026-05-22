# Plain Store Deployment Runbook

Target: small Hetzner Cloud VPS running Node, SQLite, systemd, and Caddy.

## 1. Server

- Product: Hetzner Cloud, Shared Resources, Regular Performance.
- Size: smallest US regular-performance instance is enough for this app.
- Location: Ashburn, Virginia.
- OS: Ubuntu 24.04 LTS or Debian 12.
- Firewall: allow `22`, `80`, and `443`. Do not expose `3001` publicly.

## 2. Packages

Install system packages:

```bash
sudo apt update
sudo apt install -y git nodejs npm caddy sqlite3
```

Use Node 22 or newer. If the distro package is older, install a current Node
LTS from your preferred trusted source before starting the service.

## 3. Deploy Code

```bash
sudo mkdir -p /opt/plain-store
sudo chown "$USER":"$USER" /opt/plain-store
git clone git@github.com:korganrivera/plain-store.git /opt/plain-store
cd /opt/plain-store
npm ci --omit=dev
```

## 4. Environment

Create `/opt/plain-store/.env` from `.env.example`.

Required production values:

- `HOST=127.0.0.1`
- `PORT=3001`
- `ADMIN_PASSWORD_HASH`
- `COOKIE_SECRET`
- `COOKIE_SECURE=true`
- `PUBLIC_STORE_URL=https://your-domain.example`
- `PICKUP_LOCATION`
- `PICKUP_INSTRUCTIONS`
- `MAIL_FROM`
- `STORE_OWNER_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`

Generate the admin password hash:

```bash
npm run admin:hash -- "your-long-admin-password"
```

Put the output into `.env` as `ADMIN_PASSWORD_HASH=...`.

Generate a cookie secret:

```bash
openssl rand -base64 48
```

Put the output into `.env` as `COOKIE_SECRET=...`.

## 5. systemd

Install the service:

```bash
sudo cp /opt/plain-store/systemd/plain-store.service /etc/systemd/system/plain-store.service
sudo systemctl daemon-reload
sudo systemctl enable --now plain-store
```

If the service file still points at `/home/korgan/store`, edit it for the VPS
path before copying:

```ini
WorkingDirectory=/opt/plain-store
ExecStart=/usr/bin/npm start
```

Check status:

```bash
systemctl status plain-store --no-pager
journalctl -u plain-store -f
```

## 6. Caddy

Use Caddy as the public HTTPS reverse proxy. Example:

```caddyfile
your-domain.example {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3001
}
```

Install and reload:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 7. DNS

- Add an `A` record for the domain pointing to the server IPv4.
- Add an `AAAA` record if using IPv6.
- Wait for DNS propagation, then visit `https://your-domain.example`.

## 8. Smoke Test

After deploy:

```bash
curl -fsS http://127.0.0.1:3001/healthz
curl -I https://your-domain.example
```

Manual checks:

- Homepage loads over HTTPS.
- Admin login works.
- Admin session cookie is marked secure behind HTTPS.
- Product page loads images.
- Checkout with a new email sends confirmation email.
- Confirmation link creates a requested order.
- Admin can mark order ready and send ready email.
- Admin can mark picked up/paid and archive the order.
- `npm run backup` writes a database backup.

## 9. Backups

Run a backup before each deploy:

```bash
cd /opt/plain-store
npm run backup
```

Detailed backup and restore notes are in [backup-restore.md](/home/korgan/store/docs/backup-restore.md).

Minimum production habit:

- Keep local backups under `/opt/plain-store/backups`.
- Periodically copy backups off-server.
- Do a restore drill before relying on the store operationally.

## 10. Update / Rollback

Update:

```bash
cd /opt/plain-store
npm run backup
git pull --ff-only
npm ci --omit=dev
sudo systemctl restart plain-store
```

Rollback to the previous commit if needed:

```bash
cd /opt/plain-store
git log --oneline -5
git checkout <known-good-commit>
npm ci --omit=dev
sudo systemctl restart plain-store
```

Return to the branch after fixing:

```bash
git checkout main
```
