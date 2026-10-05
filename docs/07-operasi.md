# 07 — Operasi

## Lokasi Deployment

- Kode berjalan: `/opt/dashboard-ai` (bukan git repo; patch langsung + verifikasi).
- Host: `agentsocmed.dirini.space`.
- User layanan: `opencode`.

> Catatan: `/opt/dashboard-ai` **bukan** repo git. Repository dokumentasi ini
> (`cahayaproject/`) adalah salinan terorganisir untuk dokumentasi & kolaborasi.

## Layanan (systemd)

| Unit | Perintah | Port | Env |
|---|---|---|---|
| `dashboard-ai.service` | Express | `127.0.0.1:4300` | `.env` |
| `hermes3d.service` | `npm run start` (Next.js) | `127.0.0.1:4310` | `NODE_ENV=production`, `HERMES3D_GATEWAY_URL=http://127.0.0.1:4300/api/runtime` |

```bash
sudo systemctl status dashboard-ai.service
sudo systemctl restart dashboard-ai.service
sudo systemctl status hermes3d.service
sudo systemctl restart hermes3d.service
sudo nginx -t && sudo systemctl reload nginx
```

## Docker

- Container `waha` (network `waha_default`, gateway `172.18.0.1`; `127.0.0.1:3000`).
- Lihat: `docker ps`, `docker logs waha --tail 100`.

## nginx (`/etc/nginx/sites-enabled/agentsocmed.dirini.space`)

Routing penting:

| Lokasi | Tujuan |
|---|---|
| `/kantor/` | `127.0.0.1:4310/kantor/...` (Next.js, basePath `/kantor`) |
| `/kantor/` (root) | `127.0.0.1:4310/kantor/office` |
| `/media/` | `127.0.0.1:4300` (banner, **tanpa auth**) |
| `/api/wa/inbound` | `127.0.0.1:4300/api/wa/inbound` (token, tanpa auth sesi) |
| `/api/office/`, `/api/files/`, `/api/gateway/`, `/api/runtime/custom` | `127.0.0.1:4310/kantor/...` |
| `/` lainnya | `127.0.0.1:4300` (dengan cek sesi Owner) |

## Login Dashboard

- Env: `DASHBOARD_USER`, `DASHBOARD_PASS`.
- Endpoint: `POST /api/masuk` dengan `{ "pengguna": "...", "sandi": "..." }`.

## Verifikasi Kesehatan (rutin)

```bash
systemctl is-active dashboard-ai hermes3d
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/            # dashboard
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4310/kantor/office
curl -s -H "X-Api-Key: $WAHA_API_KEY" http://127.0.0.1:3000/api/sessions   # WAHA
journalctl -u dashboard-ai.service -n 50 --no-pager | grep -iE "error|gagal"
```

## Database

- Postgres via `DATABASE_URL`. Migrasi di `dashboard-ai/migrations/` (`*.sql`).
- Tabel utama: `agents`, `riset_hasil`, `riset_ringkasan`, `draft_konten`, `tugas`, `jejak`, `runs`, `agent_pemakaian`.

## Playwright (panel admin / `/kantor`)

```bash
set -a; source /opt/dashboard-ai/.env; set +a
cd /opt/dashboard-ai/kantor3d && node /tmp/skrip.mjs
```
Import: `import pkg from "/opt/dashboard-ai/kantor3d/node_modules/playwright/index.js";`
Tab sidebar: `#hq-tab-kanban`, `#hq-tab-playbooks`, `#hq-tab-percakapan`.

## Section Percakapan (`/kantor`)

- **UI**: tab **Percakapan** di HQ sidebar (`#hq-tab-percakapan`), komponen
  `kantor/src/features/office/components/panels/PercakapanPanel.tsx`. Menampilkan riwayat
  Owner ↔ agent (masuk/keluar), filter per-tanggal & per-agent, pencarian, auto-refresh 20 dtk.
- **API** (dashboard-ai, auth sesi):
  - `GET /api/percakapan/tanggal` → `{ ok, tanggal: ["YYYY-MM-DD", ...] }`
  - `GET /api/percakapan?tanggal=YYYY-MM-DD&batas=300` → `{ ok, pesan: [...] }`
- **Penyimpanan**: `<PERCAKAPAN_DIR>/owner-agent/<YYYY-MM-DD>.jsonl` (lihat `percakapan/README.md`).
  `PERCAKAPAN_DIR` default ke `<repo>/percakapan` (fallback `.hermes3d/percakapan`).

```bash
# Uji cepat (login dulu)
set -a; . /opt/dashboard-ai/.env; set +a
CJ=$(mktemp)
curl -s -c "$CJ" -X POST http://127.0.0.1:4300/api/masuk \
  -H 'Content-Type: application/json' \
  -d "{\"pengguna\":\"$DASHBOARD_USER\",\"sandi\":\"$DASHBOARD_PASS\"}" >/dev/null
curl -s -b "$CJ" http://127.0.0.1:4300/api/percakapan/tanggal
```

## Troubleshooting Umum

| Gejala | Sebab | Tindakan |
|---|---|---|
| Notifikasi WA gagal (HTTP 422, `SCAN_QR_CODE`) | Sesi WAHA turun | Scan QR ulang (`/api/<session>/auth/qr?format=image`) |
| Rapat/agent tidak jalan | Plafon token harian (`PLAFON_TOKEN_HARIAN`) tercapai | Tunggu reset harian / naikkan plafon / lepas rem tangan |
| `Cannot use a pool after calling end` | Shutdown pool tak aman | Sudah diperbaiki di `lib/db.js` (+ guard di `server.js`, `cron-runner.js`) |
| Schedule Doea `unsupported type schedule` | `type:"text"` tanpa `medias` | Pakai `type:"image"` + `medias` |
| Job cron jalan berulang | Job berdurasi panjang terpicu ulang | Sudah diperbaiki (kunci `runningAtMs` + `putaranCronAman`) |

## Backup

- `.env` (rahasia) — simpan aman di luar repo.
- `data/` — arsip rapat, notulen harian, taskboard.
- DB — `pg_dump` berkala.
