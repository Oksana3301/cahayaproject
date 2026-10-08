# CATATAN-PR — Misi 2 Challenge Part 3 (Pipeline Client/Partner + Outreach Email)

Progress implementasi pipeline cari client/partner + outreach email (Resend).

## Fase 0 — SELESAI
- Wawancara 1 pertanyaan/pesan. Jawaban tersimpan di BRIEF.md bagian "OUTREACH".
- Keputusan Owner:
  - Tujuan: client + partner (dua-duanya).
  - Niche: industri sustainability/green transition.
  - Lokasi: online se-Indonesia. Ukuran: UMKM + menengah.
  - Sumber: SEMUA (1-7), total 40 prospek/minggu.
  - Kata kunci per sumber: disetujui.
  - Penawaran client: semua produk kecuali riset & insight. Partner: kolaborasi + co-host webinar.
  - Nada: santai profesional; contoh = tone Cahaya Project.
  - Kata terlarang: dari BRIEF (save the planet, "kamu harus...", 100% sustainable, dll).
  - Ghosting 5 hari, susulan maks 2, SEMUA balasan wajib disetujui (opsi A).
- Config Resend: pakai `dirini.id` dulu (verified). FROM_NAME "Cahaya Project", FROM_EMAIL halo@dirini.id (disetujui).
  EMAIL_PER_HARI=20, PROSPEK_PER_MINGGU=40 (bawaan, Owner bilang "nanti").
- Cek mandiri: dirini.id verified; MX inbound BELUM terpasang (Owner: "nanti"); health loopback-only.

## Fase 1 — SELESAI
- .env: tambah EMAIL_DOMAIN, FROM_NAME, FROM_EMAIL, INBOUND_SUBDOMAIN, EMAIL_PER_HARI, PROSPEK_PER_MINGGU, RESEND_WEBHOOK_SECRET (kosong). `npm i svix` OK.
- lib/resend.js ditulis ulang: kirimEmail({to,subject,html,text,replyTo,headers,idempotencyKey}) — to wajib string, idempotencyKey kosong lempar, replyTo->reply_to, text wajib; ambilMasuk(emailId); cekDomain(); 401 tanpa retry, 429/5xx backoff. Fungsi lama kirimBanyak/CONFIG dipertahankan (cron-runner laporan).
- lib/outreach.js: rem kuota atomik (klaimJatah/kembalikanJatah/batasHarian), pengaturan_pr, cekEmail (MX), cekReputasi/rem_reputasi.
- /health tambah `resend`. BUKTI: `{"ok":true,"db":true,"atria":true,"apify":true,"doea":true,"resend":true}`.

## Fase 2 — SELESAI
- migrations/007_pr.sql: tabel prospek, pesan, cari_log, email_kuota, pengaturan_pr, jadwal_pr.
- Migrasi dijalankan (1 migration baru). Semua 6 tabel ada.

## Fase 3 — SELESAI
- skills/cari/: maps, web, linkedin, instagram, facebook, tiktok, perkaya (bentuk output seragam).
- lib/cari.js: cariClient() orkestrator — bersihkan (email kecil/buang example/noreply, 08xx->628xx, pilih 1 email utama), dedupe lintas sumber (kunci_dedupe = domain>email>telepon>nama|kota), saringAI (batch 30, skor>=3, robust format hasil|results|skor|nilai), perkaya, simpan tahap belum_contact, satu baris cari_log per sumber.
- lib/apify.js: detailActor + ambilKredit; input-schema fallback exampleRunInput (endpoint input-schema 404 di API v2 ini).
- agents/roster.js + seed-agents.js: tambah agent 'humas' (Manajer Kemitraan, skill pr, atasan cmo). TOTAL 10 agent.
- BUKTI: cariClient maps (maks 4) → 4 mentah, 2 lolos saring tersimpan (Dhong Djati Ecoprint skor 4, darihulu bulkstore skor 3, keduanya punya telepon). Dedupe: putaran ke-2 hanya +1 baru (3 di-skip).
- Catatan: Maps actor kadang TIMED-OUT (400) → cariClient catat error & lanjut (sesuai kontrak). Kata kunci web menghasilkan artikel media, perlu penyempurnaan (bukan blocker).

## Fase 4-10 — BELUM
## Uji ujung ke ujung — BELUM
