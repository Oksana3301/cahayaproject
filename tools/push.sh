#!/usr/bin/env bash
# push.sh — commit & push repo dokumentasi ke GitHub dengan aman.
#
# Pemakaian:
#   bash tools/push.sh "pesan commit"
#   REPO=/opt/cahayaproject bash tools/push.sh "docs: rapikan indeks"
#
# Aman: menolak commit bila ada .env / node_modules / .next yang ter-stage.
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
MSG="${1:-chore: sinkronisasi repo dokumentasi}"
BRANCH="${BRANCH:-main}"

cd "$REPO"

echo "== push repo: $REPO (branch $BRANCH) =="

# 1) Refresh dari live (opsional, lewati dengan SKIP_SYNC=1)
if [ "${SKIP_SYNC:-0}" != "1" ] && [ -f tools/sync-repo.sh ]; then
  echo "-- sync dari sistem live --"
  bash tools/sync-repo.sh
fi

# 2) Stage
git add -A

# 3) Pagar keamanan: pastikan tidak ada rahasia/berat yang ikut
DENY='(^|/)\.env$|(^|/)\.env\.|node_modules/|(^|/)\.next/|(^|/)\.git/'
BAD="$(git diff --cached --name-only | grep -E "$DENY" | grep -v '\.env\.example' || true)"
if [ -n "$BAD" ]; then
  echo "ERROR: berkas terlarang ter-stage:"; echo "$BAD"; exit 1
fi

# 4) Commit (lewati bila tak ada perubahan)
if git diff --cached --quiet; then
  echo "-- tidak ada perubahan untuk di-commit --"
else
  git commit -m "$MSG"
fi

# 5) Push
echo "-- push ke origin/$BRANCH --"
git push -u origin "$BRANCH"
echo "== selesai =="
