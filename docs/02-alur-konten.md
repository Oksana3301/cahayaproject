# 02 — Alur Konten (End-to-End)

```
riset ─▶ verifikasi ─▶ analisis ─▶ draft ─▶ review ─▶ GATE 4 PRINSIP
   ─▶ persetujuan Owner ─▶ banner ─▶ publish terjadwal (IG 12:00 WIB)
```

## Tahap

1. **Riset** (`lib/riset` / `skills/riset.js`) — Aruna mengumpulkan sinyal terbaru; 3 sudut pandang layak tindak.
2. **Verifikasi** — Jati memverifikasi klaim material; kategori FACT/ANALYSIS/INFERENCE/OPINION/UNKNOWN.
3. **Analisis** — Nala membaca pola, peluang, implikasi strategis.
4. **Draft** (`lib/alur-publish.js`) — Laras menyusun draft (timely, educational, engagement); caption 500–1000 karakter; 3–5 hashtag.
5. **Review** — Bima (risiko/red team), Raya (kreatif/hook), Tara (growth/CTA), Kirana (editorial).
6. **Gate 4 Prinsip** (`lib/pre-publish-gate.js`) — 2 lapis: deterministik + LLM. Skor = `(lulus/4)*100`. Gagal → blokir (HTTP 422, `kode:"GATE_GAGAL"`).
7. **Persetujuan Owner** — via endpoint `/api/alur/setujui`, `/api/persetujuan/:id/ya`, atau balasan WA.
8. **Banner** (`lib/banner.js`) — dibuat 1080×1080, disimpan di `.hermes3d/media/`, disajikan via `/media/:nama`.
9. **Publish** (`lib/publish.js` → Doea hub) — schedule `type:"image"` dengan `medias`; jam tayang utama **12:00 WIB**.
10. **Status** — draft berubah `terjadwal` → `terbit` setelah tayang.

## Status Draft

`menunggu` → `terjadwal` → `terbit` (atau `ditolak`).

## Endpoint Terkait (dashboard-ai)

- `POST /api/alur/gate` — uji gate pra-publish.
- `POST /api/alur/setujui` — setujui & jadwalkan.
- `POST /api/persetujuan/:id/ya` — persetujuan cepat.

## Catatan Doea (penting)

- `POST /schedules` → `{ok, result:{scheduleId}}`.
- `PUT /schedules/{id}` wajib `title, description, scheduleAt`.
- Schedule `type:"text"` **tanpa** `medias` **selalu gagal** → gunakan `type:"image"` + `medias`.
- Schedule **errored tidak bisa diperbaiki** via PUT → `DELETE` lalu buat baru.

Lihat juga [`06-gate-4-prinsip.md`](06-gate-4-prinsip.md).
