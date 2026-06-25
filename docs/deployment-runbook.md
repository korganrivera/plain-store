# Plain Store Deployment Runbook

Target: small Linux VPS running Node, SQLite, systemd, and Caddy.

## 1. Server

- Product: Vultr Cloud Compute, Shared CPU.
- Size: the smallest 1 GB RAM instance is enough to start for this app.
- Location: Dallas for the current production server.
- OS: Ubuntu 24.04 LTS.
- Firewall: allow `22`, `80`, and `443`. Do not expose `3001` publicly.

## 2. Packages

Install system packages. Use Node 22 or newer; Ubuntu's default Node package is
too old for the built-in SQLite API used by this app.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates gnupg sqlite3 ufw caddy
```

The current production server uses NodeSource's Node 22 apt package.

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
- `PUBLIC_STORE_URL=https://plainstore.net`
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

Check status:

```bash
systemctl status plain-store --no-pager
journalctl -u plain-store -f
```

## 6. Caddy

Use Caddy as the public HTTPS reverse proxy. Current production config:

```caddyfile
www.plainstore.net {
  redir https://plainstore.net{uri} permanent
}

plainstore.net {
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

- Add an `A` record for `plainstore.net` pointing to the server IPv4.
- Add an `A` record for `www.plainstore.net` pointing to the server IPv4.
- Wait for DNS propagation, then visit `https://plainstore.net`.

## 8. Smoke Test

After deploy:

```bash
curl -fsS http://127.0.0.1:3001/healthz
curl -I https://plainstore.net
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
- Current production also has `plain-store-backup.timer`, a daily systemd timer
  scheduled for 03:15 UTC.
- Local off-server pulls use `npm run backup:pull-vultr`.

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
