#!/usr/bin/env bash
# Roll back to a previous release. Run on the server.
#
# Usage:
#   rollback.sh                  # roll back to the release immediately before current
#   rollback.sh <RELEASE_ID>     # roll back to a specific release
#   rollback.sh --list           # list available releases

set -euo pipefail

BASE=/var/www/linguo-land-server
PM2_APP=linguo-land-server

cd "$BASE/releases"

if [ "${1:-}" = "--list" ]; then
  current=$(readlink -f "$BASE/current" 2>/dev/null | xargs -I{} basename {} || echo "")
  ls -1dt */ | sed 's:/$::' | while read r; do
    mark=" "
    [ "$r" = "$current" ] && mark="*"
    echo "$mark $r"
  done
  exit 0
fi

target="${1:-}"
if [ -z "$target" ]; then
  current=$(readlink -f "$BASE/current" | xargs basename)
  target=$(ls -1dt */ | sed 's:/$::' | grep -v "^$current$" | head -1)
  [ -n "$target" ] || { echo "no previous release available"; exit 1; }
fi

[ -d "$BASE/releases/$target" ] || { echo "release not found: $target"; exit 1; }

echo "[rollback] switching current → $target"
ln -sfn "$BASE/releases/$target" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"

echo "[rollback] reloading pm2"
pm2 reload "$PM2_APP" --update-env
pm2 save >/dev/null

echo "[rollback] done. current = $target"
