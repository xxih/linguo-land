#!/usr/bin/env bash
# Activate a release: link .env, run migrations, swap symlink, reload pm2, cleanup old releases.
# Runs on the server. Invoked by GitHub Actions after uploading the release dir.
#
# Usage: activate.sh <RELEASE_ID>

set -euo pipefail

RELEASE_ID="${1:?RELEASE_ID required}"
BASE=/var/www/linguo-land-server
REL="$BASE/releases/$RELEASE_ID"
SHARED="$BASE/shared"
KEEP=5
PM2_APP=linguo-land-server

[ -d "$REL" ] || { echo "[activate] release dir missing: $REL"; exit 1; }
[ -f "$SHARED/.env" ] || { echo "[activate] missing $SHARED/.env"; exit 1; }

echo "[activate] linking shared .env into release"
ln -sfn "$SHARED/.env" "$REL/.env"

echo "[activate] running prisma migrate deploy"
cd "$REL"
set -a; . "$REL/.env"; set +a
./node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma

echo "[activate] atomic symlink swap"
ln -sfn "$REL" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"

echo "[activate] reloading pm2 app $PM2_APP"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 reload "$PM2_APP" --update-env
else
  pm2 start "$BASE/current/dist/main.js" --name "$PM2_APP" --cwd "$BASE/current"
fi
pm2 save >/dev/null

echo "[activate] cleaning up old releases (keeping last $KEEP)"
cd "$BASE/releases"
ls -1dt */ 2>/dev/null | tail -n "+$((KEEP+1))" | xargs -r rm -rf

echo "[activate] done: $RELEASE_ID"
