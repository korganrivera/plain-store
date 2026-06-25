# Backup and Restore

Plain Store stores operational data in `data/store.db`. Backups use SQLite's
online backup command so WAL-mode databases are copied safely into `backups/`.

## Create Backup

From the app directory:

```bash
npm run backup
```

The command writes a timestamped file such as:

```text
backups/store-2026-05-22T19-44-50.601Z.db
```

## Verify Backup

Check that the backup opens and key tables can be read:

```bash
node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log({ categories: db.prepare('SELECT COUNT(*) AS count FROM categories').get().count, products: db.prepare('SELECT COUNT(*) AS count FROM products').get().count, orders: db.prepare('SELECT COUNT(*) AS count FROM orders').get().count }); db.close();" backups/store-example.db
```

Replace `backups/store-example.db` with the real backup filename.

## Restore Backup

Stop the app first:

```bash
sudo systemctl stop plain-store
```

Preserve the current database before replacing it:

```bash
cp data/store.db "data/store.db.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"
```

Copy the backup into place:

```bash
cp backups/store-example.db data/store.db
```

Start the app:

```bash
sudo systemctl start plain-store
```

Smoke test:

```bash
curl -fsS http://127.0.0.1:3001/healthz
```

Then check the homepage, admin login, catalog, and order board.

## Production Habit

- Run `npm run backup` before deploys.
- Copy important backups off-server.
- Periodically verify a backup using the read-only check above.
- Do not restore while the app is running.

## Pull Vultr Backups

From the local repo, pull production backups from the Vultr server:

```bash
npm run backup:pull-vultr
```

The script copies missing `store-*.db` files from `/opt/plain-store/backups/`
to `backups/vultr/`, then verifies the newest valid backup can read the core
tables. The backup files remain ignored by git.

The laptop also has a user systemd timer installed from
`systemd/user/plain-store-backup-pull.timer`. It runs the same pull command on
startup and daily around 19:30 local time, with `Persistent=true` so missed runs
catch up when the user session starts.

Useful local commands:

```bash
systemctl --user status plain-store-backup-pull.timer
systemctl --user list-timers plain-store-backup-pull.timer
journalctl --user -u plain-store-backup-pull.service -n 80 --no-pager
```
