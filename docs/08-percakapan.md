# 08 — Percakapan dengan Agent

Semua percakapan antara **Owner** dan **agent** tercatat otomatis dan dapat dilihat di UI
`/kantor` pada tab **Percakapan**. Tujuannya: seluruh komunikasi terdokumentasi & rapih.

## 1. Dari mana percakapan datang

| Sumber | Masuk sebagai | Ditangani oleh |
|---|---|---|
| WhatsApp (WAHA → `POST /api/wa/inbound`) | pesan Owner | router perintah (`server.js`) |
| Web UI (`/kantor`) | pesan Owner | chat agent/gateway |

Perintah WhatsApp yang dikenali (prefix wajib):

| Perintah | Arti |
|---|---|
| `/bantuan` | daftar perintah |
| `/status` | ringkasan status sistem |
| `/tanya <q>` | tanya bebas ke Kirana (orchestrator) |
| `@<agent> <q>` | tanya langsung ke agent tertentu |
| `/rapat <agenda>` | jalankan rapat ad-hoc |

Pesan tanpa prefix, pesan `fromMe:true`, dan pesan grup (`@g.us`) **diabaikan**.

## 2. Alur pencatatan

```
WhatsApp / UI ──▶ server.js
                    │  (masuk)
                    ├─▶ lib/percakapan.catat({ arah:"masuk",  ... })
                    │
                    ├─▶ proses (kirana / @agent / /rapat)
                    │
                    └─▶ lib/percakapan.catat({ arah:"keluar", ... })
```

`lib/percakapan.js` menulis JSON Lines (satu baris = satu pesan) ke:

```
<PERCAKAPAN_DIR>/owner-agent/<YYYY-MM-DD>.jsonl
```

- `PERCAKAPAN_DIR` default: `<repo>/percakapan`, fallback `.hermes3d/percakapan`.
- Tanggal memakai zona **WIB** (`tanggalWIB()`), bukan zona server.

## 3. Skema baris

```json
{"waktu":"2026-10-05T02:10:00.000Z","arah":"masuk","nomor":"62895610524580","agent":"kirana","perintah":"/tanya","pesan":"progress hari ini?","balasan":null,"meta":{"nama":"Owner"}}
{"waktu":"2026-10-05T02:10:05.000Z","arah":"keluar","nomor":"62895610524580","agent":"kirana","perintah":"/tanya","pesan":null,"balasan":"Progress hari ini ..."}
```

| Field | Keterangan |
|---|---|
| `waktu` | ISO-8601 UTC |
| `arah` | `masuk` (Owner → agent) / `keluar` (agent → Owner) |
| `nomor` | nomor WhatsApp lawan bicara |
| `agent` | kode agent yang menangani (`kirana`, `tara`, …) |
| `perintah` | `/bantuan`, `/status`, `/tanya`, `/rapat`, `@agent`, atau `-` |
| `pesan` / `balasan` | isi pesan masuk / balasan agent |
| `meta` | opsional (`nama`, `jenis` rapat, `error`) |

## 4. Menampilkan di UI (`/kantor`)

- Komponen: `kantor/src/features/office/components/panels/PercakapanPanel.tsx`
- Tab: `#hq-tab-percakapan` di `HQSidebar.tsx`, dipasang di `OfficeScreen.tsx`
- Fitur: filter per-tanggal, filter per-agent, pencarian, auto-refresh 20 dtk.

API (dashboard-ai, perlu sesi login):

| Method | Path | Hasil |
|---|---|---|
| `GET` | `/api/percakapan/tanggal` | `{ ok, tanggal: ["YYYY-MM-DD", …] }` |
| `GET` | `/api/percakapan?tanggal=YYYY-MM-DD&batas=300` | `{ ok, pesan: [ … ] }` |

## 5. Uji cepat

```bash
set -a; . /opt/dashboard-ai/.env; set +a
CJ=$(mktemp)
curl -s -c "$CJ" -X POST http://127.0.0.1:4300/api/masuk \
  -H 'Content-Type: application/json' \
  -d "{\"pengguna\":\"$DASHBOARD_USER\",\"sandi\":\"$DASHBOARD_PASS\"}" >/dev/null
curl -s -b "$CJ" http://127.0.0.1:4300/api/percakapan/tanggal
```

## 6. Rapat juga masuk ke sini

Ringkasan tiap rapat (pagi/siang/sore) ditulis ke [`percakapan/rapat/`](../percakapan/rapat/)
dan notulen mentahnya di `data/rapat/` + `data/notulen-harian/`.
Lihat [`04-rapat-harian.md`](04-rapat-harian.md).
