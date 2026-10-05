# 04 — Rapat Harian

Tiga rapat per hari (WIB). Masing-masing menghasilkan **satu** pesan WhatsApp (tidak spam).

| Jam | Jenis | Agenda | Peserta |
|---|---|---|---|
| 08:00 | `pagi` | Daily standup: update malam + rencana & 3 prioritas hari ini | nala, laras, tara, jati |
| 13:00 | `siang` | Progress: selesai/tertunda + blocker | nala, tara, bima |
| 19:00 | `sore` | Rekap komprehensif: **semua notulen hari ini + NEXT ACTION malam & besok (jam)** | nala, tara, laras |

## Mekanisme

1. Setiap peserta menyampaikan pendapat singkat (hemat token: batas per jenis).
2. **Kirana** menyusun notulen. Untuk **sore**, Kirana menggabungkan notulen pagi+siang+sore hari itu menjadi **REKAP HARIAN** dengan bagian:
   `RINGKASAN HARI INI`, `YANG SELESAI`, `BLOCKER`, `YANG BELUM SELESAI`, `NEXT ACTION MALAM INI`, `NEXT ACTION BESOK`, `CATATAN TERHADAP 4 PRINSIP` — tiap aksi disertai jam.
3. Hasil disimpan ke:
   - `data/rapat/rapat-<ISO>.json` (arsip mentah per rapat),
   - `data/rapat-terakhir.json` (untuk UI),
   - `data/notulen-harian/<YYYY-MM-DD>.json` (akumulasi hari itu),
   - diringkas ke `percakapan/rapat/` (Markdown).
4. Ringkasan dikirim ke WhatsApp Owner (`WA_NOTIF_NOMOR`).

## Kode

- `dashboard-ai/lib/rapat.js` — `jalankanRapat({ jenis, agenda, konteks, undangan, kirimWa, waNomor })`, `PRESET`, `bacaNotulenHarian`, `tanggalWIB`.
- `dashboard-ai/lib/whatsapp.js` — `ringkasRapatUntukWa(hasil)`.
- `dashboard-ai/lib/cron-runner.js` — cabang `jenis:"rapat"` (baca `payload.rapatJenis`).
- `data/cron-jobs.json` — `pb-rapat-pagi`, `pb-rapat-siang`, `pb-rapat-sore`.

## Anti-Rapat-Berulang (guard)

Latar belakang: pernah terjadi **22 rapat identik** dalam ~11 menit karena `putaranCron`
(tiap 60s) mengeksekusi ulang job berdurasi panjang yang `nextRunAtMs`-nya masih lewat.
Perbaikan (3 lapis):

1. **Kunci per-job** `state.runningAtMs` (persist), batas anggap berjalan 2 jam.
2. **Kunci dalam-proses** `putaranCronAman()` (mencegah tumpang-tindih dalam satu proses).
3. **Majukan `nextRunAtMs` SEBELUM eksekusi** — aman bila proses mati di tengah.
4. **RUN NOW** menolak job yang masih `running`.

## Uji

- Uji pipeline (mock LLM): 3 rapat → tepat **3** pesan WA; akumulasi harian tanpa duplikat; sore berisi NEXT ACTION berjam.
- Uji guard: 3 putaran tumpang-tindih → hanya **1** rapat dieksekusi.
