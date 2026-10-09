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

## Fase 4 — SELESAI
- lib/pitch.js: draftPitch(prospekId) (chatJSON subject+email, max 120 kata, sebut hal spesifik, penutup STOP), cekKataTerlarang, mintaPersetujuanPitch (simpan subject_awal+pitch ke prospek, buat tugas perlu_persetujuan jenis pitch, ulangi sekali jika kata terlarang muncul, tandai merah jika masih ada).
- server.js: GET /api/persetujuan tambah `pr[]` (tugas jenis pitch/balasan); POST /ya & /tidak dispatch jenis pitch (kirimPitch) / balasan (kirimBalasan), tolak -> alasan_tolak_draft + jejak.
- public/persetujuan.html: render tugas PR + tombol "Setujui & Kirim" / "Tolak" + pita merah kata terlarang.
- BUKTI: tugas#47 "Pitch untuk Dhong Djati Ecoprint" (jenis=pitch, prospek=2) tampil di /api/persetujuan; draft pitch personal (sebut "ecoprint pewarna alami khas Palangka Raya"), penutup STOP, 0 kata terlarang. Belum ada email keluar.

## Fase 5 — SELESAI
- lib/webhook-resend.js: verifikasi Svix (raw Buffer sebelum JSON.parse), handler email.sent/delivered/bounced/complained/received.
- server.js: route POST /webhook/resend (express.raw) SEBELUM express.json & middleware login (J1+J2).
- Webhook terdaftar di Resend: id cc9f9d2b-b7cb-493d-a4f1-72ceb9524a75, endpoint https://agentsocmed.dirini.space/webhook/resend, event 5 jenis. RESEND_WEBHOOK_SECRET = signing_secret Resend (whsec_...).
- BUKTI: curl POST tanpa cookie -> 400 Svix (bukan 302/401); endpoint publik 400 "Missing required headers"; kirim email test -> log "[webhook/resend] email.sent noop" + "email.delivered noop" (verifikasi LOLOS).

## Fase 6 — SELESAI
- kirimPitch end-to-end diverifikasi: cekRemReputasi + cekEmail MX -> jeda 20-90dt -> klaimJatah -> kirimEmail (List-Unsubscribe + replyTo p<id>@) -> simpan resend_id + baris 'keluar'.
- BUKTI: email.sent updated + email.delivered ok di log; message_id_terakhir & referensi_thread terisi dari webhook (J3); prospek#2 tahap sudah_contact.
- Fix: idempotency key unik per kirim (buatIdempotensi) — sebelumnya "pitch:2" dedupe Resend; fix payload webhook pakai data.data (bukan objek luar).

## Fase 7-10 — DI-SKIP (perintah Owner 2026-10-08)
- Detail "gerbang balasan" & "rem 1/6 jam" (Fase 7) + Fase 8-10 (sweepGhosting, detak tugas pr, scheduler) tidak ditemukan definisinya di file mana pun; Owner bilang "skip dulu, nggak paham maksudnya".
- Yang SUDAH tertulis tapi BELUM teruji: kirimBalasan (threaded), handler email.received (STOP->tolak, simpan pesan masuk, buat tugas tangani balasan).
- Keterbatasan: MX inbound dirini.id belum terpasang (Owner "nanti") -> email.received belum bisa diuji dengan data nyata.

## UJI UJUNG KE UJUNG (Fase 0-6) — SELESAI
- Pipeline penuh yang diimplementasi terverifikasi: cariClient (Apify) -> bersihkan/dedupe/saringAI -> draftPitch -> persetujuan (/api/persetujuan pr[]) -> kirimPitch -> webhook email.sent/delivered -> message_id_terakhir + referensi_thread terisi.
- State akhir DB: 3 prospek (#2 sudah_contact), 1 tugas PR (pitch perlu_persetujuan), email_kuota 5 terpakai (dari uji kirim berulang ke inbox owner, satu-per-satu, reputasi aman).
- health: semua true. service active, tanpa error di journalctl.
