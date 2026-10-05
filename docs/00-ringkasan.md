# 00 — Ringkasan Proyek

**Cahaya Project** adalah sistem otomasi konten berbasis AI yang dikelola seperti sebuah
"kantor" berisi 8 agent. Sistem menangani siklus penuh produksi konten — riset, verifikasi,
analisis, penyusunan draft, review, kepatuhan (gate 4 prinsip), persetujuan Owner, pembuatan
banner, dan publikasi terjadwal ke Instagram — serta berkomunikasi dua arah dengan Owner
melalui WhatsApp.

## Nilai Inti

Seluruh keluaran konten wajib memakai **4 prinsip wajib**: Strategic Storytelling, Digital
Literacy, Storytelling & Content Creation, dan Responsible Communication.
Lihat [`06-gate-4-prinsip.md`](06-gate-4-prinsip.md).

## Komponen Utama

1. **dashboard-ai** — server Express: orkestrasi agent, skill, gate, publish, jembatan WhatsApp, cron.
2. **kantor** — web dashboard (Next.js): kanban, playbook, dan section **Percakapan**.
3. **WAHA** — gateway WhatsApp (session `tophillshape`).
4. **Doea hub** — penjadwalan publikasi ke Instagram (jam terbit utama 12:00 WIB).

Arsitektur lengkap: [`01-arsitektur.md`](01-arsitektur.md).

## Alur Harian (waktu WIB)

| Waktu | Aktivitas |
|---|---|
| 07:00 | Riset sinyal pagi (Aruna) |
| 07:30 | Verifikasi klaim (Jati) |
| 08:00 | **Rapat Pagi** — daily standup |
| 09:00 | Analisis strategi (Nala) |
| 12:00 | **Publikasi Instagram** (slot terbit) & penyusunan draft (Laras) |
| 13:00 | **Rapat Siang** — progress update |
| 15:00 | Red team (Bima) |
| 16:00 | Review kreatif (Raya) |
| 17:00 | Growth & jadwal (Tara) |
| 18:00 | Review editorial harian (Kirana) |
| 19:00 | **Rapat Sore** — rekap harian + rencana malam & besok |
| 19:30 | Finalisasi & permintaan persetujuan publish (Tara) |

## Prinsip Rekayasa

- **Keselamatan dulu**: rahasia tidak di-commit; gate menahan publikasi berisiko.
- **Idempotensi & kunci**: tugas/rapat tidak dijalankan ganda (lock).
- **Dokumentasi melekat**: setiap perubahan besar diperbarui di `docs/`.
