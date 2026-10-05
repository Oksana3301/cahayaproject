#!/usr/bin/env bash
# sync-repo.sh — menyegarkan repo dokumentasi dari sistem live.
#
# Menyalin berkas yang berubah dari /opt/dashboard-ai (live) ke repo ini:
#   - sumber dashboard-ai (server, lib, agents, skills, migrations, public)
#   - sumber kantor (kecuali node_modules/.next/.git/.env)
#   - data runtime (.hermes3d): rapat, notulen, taskboard, cron, identitas agent
#   - ringkasan percakapan rapat (via tools/gen-percakapan.js)
#
# Pemakaian:
#   BACKEND=/opt/dashboard-ai REPO=/opt/cahayaproject bash tools/sync-repo.sh
#
set -euo pipefail

BACKEND="${BACKEND:-/opt/dashboard-ai}"
REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"

echo "== sync-repo =="
echo "  backend: $BACKEND"
echo "  repo   : $REPO"

[ -d "$BACKEND" ] || { echo "ERROR: backend tidak ditemukan: $BACKEND"; exit 1; }
[ -d "$REPO" ]    || { echo "ERROR: repo tidak ditemukan: $REPO"; exit 1; }

# 1) Sumber dashboard-ai (tanpa .env & node_modules)
mkdir -p "$REPO/dashboard-ai"
for item in server.js migrate.js seed-agents.js BRIEF.md CATATAN.md \
            lib agents skills migrations public hermes-tools \
            package.json package-lock.json .env.example; do
  [ -e "$BACKEND/$item" ] || continue
  if [ -d "$BACKEND/$item" ]; then
    mkdir -p "$REPO/dashboard-ai/$item"
    rsync -a --delete "$BACKEND/$item/" "$REPO/dashboard-ai/$item/"
  else
    cp "$BACKEND/$item" "$REPO/dashboard-ai/$item"
  fi
done

# 2) Sumber kantor (kecuali berat/rahasia)
if [ -d "$BACKEND/kantor3d" ]; then
  rsync -a \
    --exclude node_modules --exclude .next --exclude .git \
    --exclude .env --exclude '*.log' \
    "$BACKEND/kantor3d/" "$REPO/kantor/"
fi

# 3) Data runtime terdokumentasi
H3="$BACKEND/.hermes3d"
mkdir -p "$REPO/data/rapat" "$REPO/data/notulen-harian" "$REPO/data/taskboard" "$REPO/data/agents"
for f in cron-jobs.json rapat-terakhir.json gateway-config.json jadwal-harian-state.json; do
  [ -f "$H3/$f" ] && cp "$H3/$f" "$REPO/data/$f" || true
done
[ -d "$H3/rapat" ]            && rsync -a --delete "$H3/rapat/"            "$REPO/data/rapat/"            || true
[ -d "$H3/notulen-harian" ]   && rsync -a         "$H3/notulen-harian/"   "$REPO/data/notulen-harian/"   || true
[ -d "$H3/taskboard" ]        && rsync -a         "$H3/taskboard/"        "$REPO/data/taskboard/"        || true
[ -d "$H3/agents" ]           && rsync -a         "$H3/agents/"           "$REPO/data/agents/"           || true

# 4) Ringkasan percakapan rapat
if [ -f "$REPO/tools/gen-percakapan.js" ] && [ -d "$H3/rapat" ]; then
  node "$REPO/tools/gen-percakapan.js" "$H3/rapat" "$REPO/percakapan/rapat" || true
fi

echo "== selesai. Cek: git -C \"$REPO\" status --short =="
