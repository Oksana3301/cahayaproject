# Cahaya Project — Repository Dokumentasi & Kode

Repositori ini adalah **sumber dokumentasi & kode lengkap** untuk sistem otomasi konten
**Cahaya Project**: dari riset, verifikasi, analisis, penyusunan draft, review, gate 4 prinsip,
persetujuan Owner, pembuatan banner, hingga publikasi terjadwal ke Instagram — ditambah
**dashboard kantor** (web), **jembatan WhatsApp** ke agent, dan **rapat harian** multi-agent.

> Tujuan repo ini: **semuanya terdokumentasi & rapih** — kode, data runtime, aturan/aturan main
> agent, dan percakapan dengan agent (satu section tersendiri).

---

## Peta Repositori

| Folder | Isi |
|---|---|
| [`docs/`](docs/) | 📚 Dokumentasi lengkap (arsitektur, alur, agent, rapat, WhatsApp, gate, operasi, riwayat percakapan). **Mulai dari sini.** |
| [`dashboard-ai/`](dashboard-ai/) | 🧠 Server Express (`server.js`), `lib/`, `agents/`, `skills/`, migrasi DB, UI admin `public/`. |
| [`kantor/`](kantor/) | 🏢 Dashboard kantor (Next.js / "Hermes3D") — kanban, playbook, dan **section Percakapan**. |
| [`data/`](data/) | 🗂 State runtime terdokumentasi: `cron-jobs.json`, akumulasi notulen harian, arsip rapat, taskboard, identitas agent. |
| [`percakapan/`](percakapan/) | 💬 **Section percakapan dengan agent**: log Owner↔agent & ringkasan tiap rapat (pagi/siang/sore). |

---

## Arsitektur Singkat

```
                        ┌──────────────────────────────┐
   Owner / WhatsApp ───▶│  WAHA (session tophillshape)  │
                        └───────────────┬──────────────┘
                          webhook       │
        ┌───────────────────────────────┼────────────────────────────┐
        ▼                               ▼                            ▼
  n8n front desk              POST /api/wa/inbound            (webhook lain)
  (Top Hills, tak diubah)     (token WA_INBOUND_TOKEN)
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │  dashboard-ai (Express :4300)  │
                        │  agent · skill · gate · publish│
                        └───────┬───────────────┬────────┘
                                │               │
                 Postgres ◀─────┘               └────▶ Doea hub (Instagram schedule)
                                │
                                ▼
                        ┌───────────────────────────────┐
                        │  kantor (Next.js :4310) /kantor │
                        │  kanban · playbooks · percakapan│
                        └───────────────────────────────┘
```

Detail: [`docs/01-arsitektur.md`](docs/01-arsitektur.md).

---

## Alur Konten (end-to-end)

`riset → verifikasi → analisis → draft → review → GATE 4 PRINSIP → persetujuan Owner → banner → publish terjadwal (IG 12:00 WIB)`

Detail: [`docs/02-alur-konten.md`](docs/02-alur-konten.md) · Gate: [`docs/06-gate-4-prinsip.md`](docs/06-gate-4-prinsip.md).

---

## Rapat Harian (3× sehari)

| Jam WIB | Rapat | Isi | Peserta |
|---|---|---|---|
| 08:00 | Pagi — Daily Standup | update malam + rencana & 3 prioritas | nala, laras, tara, jati |
| 13:00 | Siang — Progress Update | selesai/tertunda + blocker | nala, tara, bima |
| 19:00 | Sore — Rekap Harian | **semua notulen hari ini + NEXT ACTION malam & besok (berjam)** | nala, tara, laras |

- **Satu pesan WhatsApp per rapat** (tidak spam).
- Notulen disimpan: [`data/rapat/`](data/rapat/), [`data/notulen-harian/`](data/notulen-harian/), dan diringkas ke [`percakapan/rapat/`](percakapan/rapat/).
- Anti-rapat-berulang: kunci `runningAtMs` + kunci dalam-proses + majukan jadwal sebelum eksekusi.

Detail: [`docs/04-rapat-harian.md`](docs/04-rapat-harian.md).

---

## Menjalankan

Lihat [`docs/07-operasi.md`](docs/07-operasi.md). Ringkas:

```bash
# dashboard-ai (Express)
cd dashboard-ai && npm ci && cp .env.example .env   # isi nilai rahasia
npm start

# kantor (Next.js)
cd kantor && npm ci && cp .env.example .env
npm run build && npm start
```

> ⚠️ **Rahasia tidak pernah di-commit.** Semua `.env` dikecualikan; gunakan `.env.example`.

---

## Konvensi Commit

- `docs:` dokumentasi
- `feat:` fitur baru (mis. section percakapan)
- `fix:` perbaikan bug
- `chore:` rutin/struktur

---

_Dibuat & dipelihara untuk Cahaya Project._
