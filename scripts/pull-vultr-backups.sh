#!/usr/bin/env bash
set -euo pipefail

SERVER="${PLAIN_STORE_BACKUP_SERVER:-linuxuser@149.28.243.41}"
REMOTE_DIR="${PLAIN_STORE_BACKUP_REMOTE_DIR:-/opt/plain-store/backups}"
LOCAL_DIR="${PLAIN_STORE_BACKUP_LOCAL_DIR:-backups/vultr}"
SSH_CONFIG="${PLAIN_STORE_BACKUP_SSH_CONFIG:-/dev/null}"
KNOWN_HOSTS="${PLAIN_STORE_BACKUP_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"

mkdir -p "$LOCAL_DIR"

mapfile -t remote_backups < <(
  ssh -F "$SSH_CONFIG" -o UserKnownHostsFile="$KNOWN_HOSTS" "$SERVER" \
    "find '$REMOTE_DIR' -maxdepth 1 -type f -name 'store-*.db' -printf '%f\n' | sort"
)

if [[ "${#remote_backups[@]}" -eq 0 ]]; then
  echo "No remote backups found in $SERVER:$REMOTE_DIR" >&2
  exit 1
fi

for backup in "${remote_backups[@]}"; do
  if [[ ! -f "$LOCAL_DIR/$backup" ]]; then
    scp -F "$SSH_CONFIG" -o UserKnownHostsFile="$KNOWN_HOSTS" \
      "$SERVER:$REMOTE_DIR/$backup" \
      "$LOCAL_DIR/"
  fi
done

latest=""
while IFS= read -r backup; do
  if sqlite3 "$backup" "SELECT COUNT(*) FROM categories;" >/dev/null 2>&1; then
    latest="$backup"
    break
  fi
done < <(find "$LOCAL_DIR" -maxdepth 1 -type f -name 'store-*.db' -printf '%f %p\n' | sort -r | cut -d' ' -f2-)

if [[ -z "$latest" ]]; then
  echo "No valid backups found in $LOCAL_DIR" >&2
  exit 1
fi

sqlite3 "$latest" \
  "SELECT 'categories=' || (SELECT COUNT(*) FROM categories), 'products=' || (SELECT COUNT(*) FROM products), 'orders=' || (SELECT COUNT(*) FROM orders);"
echo "Latest backup verified: $latest"
