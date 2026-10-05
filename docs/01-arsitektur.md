# 01 — Arsitektur

## Ringkasan Komponen

| Komponen | Teknologi | Peran | Port/Basis |
|---|---|---|---|
| **dashboard-ai** | Node.js + Express | Otak sistem: agent, skill, gate, publish, jembatan WhatsApp, cron, DB | `127.0.0.1:4300` |
| **kantor** | Next.js ("Hermes3D") | Web dashboard: kanban, playbook, section **Percakapan** | `127.0.0.1:4310`, basePath `/kantor` |
| **WAHA** | Docker (`waha`) | Gateway WhatsApp HTTP API | `127.0.0.1:3000` (session `tophillshape`) |
| **Postgres** | — | Penyimpanan: agent, riset, draft, tugas, jejak, runs | `DATABASE_URL` |
| **nginx** | — | Reverse proxy + akses publik + `/media/` | `agentsocmed.dirini.space` |
| **Doea hub** | REST | Penjadwalan publikasi ke Instagram | `DOEA_BASE_URL` |

## Peta Aliran

```
Owner ──WhatsApp──▶ [WAHA tophillshape]
                        │ webhook (events: message)
                        ├─▶ n8n front desk Top Hills  (TIDAK diubah)
                        └─▶ POST /api/wa/inbound?token=…  (dashboard-ai)
                                  │ guard: token, fromMe, grup, prefix
                                  ▼
                        perintah /bantuan /status /tanya /rapat @agent
                                  │
                                  ▼
                        agent (8) ── skill ──▶ LLM (ATRIA)
                                  │
                                  ▼
                        balas via lib/whatsapp.kirimTeks ──▶ Owner
```

## Peta Alur Konten (otomatis)

```
[cron pagi]  Aruna riset ──▶ Jati verifikasi ──▶ Nala analisis
        │
        ▼
[cron siang] Laras susun 3 draft (menunggu)
        │
        ▼
[cron sore]  Bima red-team ──▶ Raya review kreatif ──▶ Tara growth/jadwal
        │
        ▼
[Owner]  /api/alur/gate (2 lapis) ──▶ persetujuan ──▶ banner 1080x1080
        │
        ▼
[Doea hub]  schedule image ──▶ Instagram @ 12:00 WIB
        │
        ▼
DB: draft.status = "terbit"
```

## Batas Kepercayaan & Keamanan

- **Inbound WA** wajib token (`WA_INBOUND_TOKEN`); tanpa token → 401.
- **Grup**, pesan `fromMe:true`, dan pesan tanpa prefix **diabaikan** dashboard (ditangani bot front desk).
- **Media publik** (`/media/:nama`) hanya `.png`/`.jpg`; melindungi dari path traversal.
- **Rahasia** di `.env` (dikecualikan dari repo). Lihat `.env.example`.
- Gate pre-publish **2 lapis**: deterministik (regex/pola) + LLM (Kirana). Publikasi diblokir bila gagal (HTTP 422).

## Berkas Kunci

- `dashboard-ai/server.js` — router & orkestrasi.
- `dashboard-ai/lib/` — `rapat.js`, `whatsapp.js`, `cron-runner.js`, `db.js`, `llm.js`, `pre-publish-gate.js`, `publish.js`, `doea.js`, `banner.js`, `detak.js`, `jadwal-harian.js`.
- `dashboard-ai/agents/` — `roster.js` (8 agent), `wewenang.js`.
- `dashboard-ai/skills/` — `riset.js`, `publish.js`.
- `dashboard-ai/migrations/` — skema DB.
- `kantor/` — web dashboard (Next.js).

## Layanan (systemd)

- `dashboard-ai.service` — Express (Node, user `opencode`).
- `hermes3d.service` — Next.js `npm run start`, `NODE_ENV=production`.
- nginx — situs `agentsocmed.dirini.space`.

Detail operasi: [`07-operasi.md`](07-operasi.md).
