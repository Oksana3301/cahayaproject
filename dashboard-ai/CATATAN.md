# CATATAN — Dashboard AI Cahaya Project

Diperbarui: 2026-10-03

## INFRASTRUKTUR

- Server: Ubuntu 24.04.4 LTS, 7.6GB RAM, Node v22.23.3, npm 10.9.9
- IP publik: 43.173.8.136 (NAT internal 10.11.22.59)
- Port aplikasi: **4300** (dipilih karena rentang 4000-4999 sepenuhnya kosong)
- Port yang dipakai lain: 80, 443, 22, 3000 (waha), 3002 (placeholder python), 5678 (n8n), 8080 (searxng), 22022
- PostgreSQL 16.15 terpasang di host, listening 127.0.0.1:5432
- Database: `dashboard_ai`, user `dash` (password 24 karakter acak di .env)
- nginx 1.24.0, server block `agentsocmed.dirini.space` sudah ada + sertifikat Let's Encrypt
- Sertifikat: `/etc/letsencrypt/live/agentsocmed.dirini.space/`
- Server block nginx saat ini memproksi `/` ke 127.0.0.1:3002 (placeholder python "agentsocmed.dirini.space aktif")
- pm2 TIDAK ADA -> pakai systemd untuk auto-start (Fase 10)
- certbot: belum dicek keberadaannya, akan dicek di Fase 10

## AKUN

- Doea: user id 24 (Atika Dewi Suryani), account_quota 2, accounts_owned 1
- Akun publish: Instagram @atikadewi, accountId `6abfbca762caae1e045b0392`
- Apify: token valid, username oksana3301

## KEPUTUSAN TEKNIS

- **Timeout Atria: 300 detik** (awalnya 120, terlalu pendek untuk prompt riset/draft yang panjang; model butuh 40-90 detik per panggilan kompleks)
- **max_tokens default 4096, di-clamp ke 65536**
- **Skill `susunDraft` memakai skill `riset`** (bukan publish) karena roster Fase 5 menetapkan agent `tulis` hanya boleh `riset`. `setujui`/terbit yang memakai `publish`.
- **Apify actor Instagram**: `apify~instagram-post-scraper` (bukan `apify~instagram-scraper`).
  Input: `{ username: ["akun"], resultsLimit: N }`. Actor `instagram-scraper` hanya bisa hashtag search.
- **Apify actor TikTok**: `clockworks~tiktok-scraper` gagal untuk username referensi (HTTP 400 run-failed).
  Sebagai fallback, sumber Apify hanya Instagram. Dikategorikan kegagalan sebagian, tidak mematikan.
- **Threads via Doea `/research/threads`**: HTTP 400 "Invalid OAuth access token - Cannot parse access token".
  Ini masalah di sisi Doea (token Instagram yang terhubung), bukan kredensial Doea. Sumber lain tetap jalan.

## BUG YANG PERNAH TERJADI

1. **`doea: false` di /health** — kode membaca `DOE_ACCESS_KEY` (tanpa "A") sedangkan .env berisi `DOEA_ACCESS_KEY`.
   Root cause: typo nama variabel env. .env, dotenv, PostgreSQL tidak bermasalah.
2. **Tanggal RSS gagal di PostgreSQL** — format "02 Okt 2026 14:25:35 +0000" tidak cocok timestamptz.
   Ditambah `normalkanTanggal()` yang konversi via `new Date()`.
3. **Doea POST /schedules** — response bentuknya `{ok: true, result: {scheduleId: "..."}}`, bukan flat.
   Dipatch untuk membaca `res.result.scheduleId`.
4. **`Assignment to constant variable`** — `const url` lalu `url += ...` di lib/doea.js. Diganti `let url`.
5. **Atria timeout 120s** — prompt riset/susunDraft butuh >120s. Timeout dinaikkan ke 300s.
6. **detak.js salah deteksi jenis tugas** — tugas "Susun draft dari riset terakhir" terdeteksi sebagai riset
   karena judul mengandung kata "riset". Diperbaiki: cek draft dulu, baru riset.
7. **Tugas macet 15 menit** — pembersih berjalan tiap 2 menit, mengembalikan tugas `dikerjakan` >15 menit ke `menunggu`.

## JATAH TOKEN

- Plafon harian total: 250.000 token (hard ceiling)
- Target normal: 100.000-150.000 token/hari
- Per agent: ceo 200rb, cto 150rb, cmo 200rb, riset 300rb, tulis 300rb, jadwal 100rb
- Peringatan di 80%, berhenti di 100%
- Rem tangan: total >= plafon -> heartbeat berhenti, /api/status mengembalikan rem_tangan:true

## STATUS HEARTBEAT

- Interval: 2 menit
- Jeda acak 0-20 detik antar agent
- CEO (kode ceo) tidak punya skill, dilewati
- Agent jatah habis dilewati, bukan error

## CATATAN KEAMANAN

- .env permission 600, ada di .gitignore
- Password pernah terlihat di layar saat sesi awal -> SUDAH disarankan ganti
- sudo tanpa password dikonfigurasi untuk user opencode (via /etc/sudoers.d/opencode)
- Tidak ada kunci yang ditulis ke kode atau log

## TODO

- Fase 8: dashboard HTML
- Fase 9: kantor 3D (tema Hermes3)
- Fase 10: terbitkan ke domain
- Fase 11: uji ujung ke ujung

## FASE 9-11 CATATAN TAMBAHAN

- Hermes3D dipasang sebagai subfolder kantor3d (MIT, kredit asli dipakai apa adanya), basePath /kantor.
- Screenshot: /opt/dashboard-ai/hermes3d-standalone.png dan hermes3d-connected.png (berbeda md5, connected lebih besar 142KB vs 93KB).
- UI Hermes3D: dipilih Custom backend -> Upstream URL http://127.0.0.1:4300/api/runtime -> Connect, menampilkan "CUSTOM CONNECTED" dan daftar 6 agent dari bridge (/api/runtime/state, /registry, /health).
- Akses kantor HANYA setelah login dashboard: tanpa cookie -> 302 /masuk; dengan cookie -> 200. Nginx pakai auth_request ke /api/auth/check.
- Runtime bridge (/api/runtime/*) hanya bisa dipanggil dari loopback, tidak dari internet.
- Chat completions bridge memakai LLM Atria dengan jatah token yang sama; dijaga agar tidak dipakai publik tanpa sesi (nginx auth_request) dan hanya loopback.
- Skrip tes Playwright: /opt/dashboard-ai/hermes-tools/ (memakai node_modules Playwright dari kantor3d, chromium headless di ~/.cache/ms-playwright).
- Hermes3D service systemd aktif+enabled (Port 4310, produksi). Dashboard service systemd aktif+enabled (Port 4300). PostgreSQL dan nginx aktif+enabled.
- Certbot renewal dry-run sukses untuk semua sertifikat termasuk agentsocmed.dirini.space (valid s/d 2026-12-31).

## FASE 11 PERBAIKAN AKURAT

- waktu tayang: slotBerikutnya di skills/publish.js sekarang menghitung 19.30 WIB secara eksplisit (Asia/Jakarta) dan menghindari slot yang sudah dipakai; diuji menghasilkan 2026-10-03T12:30:00Z = Sabtu 03 Oktober 2026 19.30 WIB.
- token nyata: lib/llm.js menolak panggilan bila jatah agent habis atau plafon harian tersentuh; max_tokens dibatasi oleh sisa jatah+sisa plafon; usage OpenAI dijadikan total prompt+completion dan dicatat ke agent_pemakaian yang benar.
- jembatan atria: lib/llm.js mencatat token usage agen nyata; uji agent tulis menghasilkan 101 token dan tercatat di agent_pemakaian.
- Akses kantor 3D: tanpa cookie -> 302 ke /masuk, dengan cookie login -> 200. Terminal jaringan kantor hanya menerima request dari loopback.
- proses auto-start: systemd dashboard-ai.service & hermes3d.service aktif+enabled; PostgreSQL & nginx aktif+enabled. certbot dry-run sukses.
- Skrip uji playwright Playwright & Chromium terpasang di ~/.cache/ms-playwright, skrip di /opt/dashboard-ai/hermes-tools.
- Screenshot tersimpan dengan md5 berbeda: standalone 7fa09bed... connected d6f39796 (142KB vs 93KB); detail kontainer tampilan developer tidak bisa dibuka lewat text.

## PEMERIKSAAN ULANG (SESI AKHIR)

- /kantor/office kini TERBUKA dan tersambung: text DOM "CUSTOM • CONNECTED", 0 working / 6 idle, nol HTTP >=400, nol pageerror. Screenshot: /opt/dashboard-ai/hermes3d-final.png.
- Perbaikan asset 3D: nginx location /office-assets/ -> 127.0.0.1:4310/kantor/office-assets/ (basePath alias), tanpa ubah repo.
- Perbaikan rate limit login: hanya kegagalan dihitung (5 gagal/10 menit -> blok 15 menit), login sukses membersihkan; diuji 5x401 lalu 429, login sukses tetap 200.
- TikTok: field actor clockworks~tiktok-scraper adalah "profiles" (bukan usernames). skills/riset.js diperbarui; scrape jerhemynemoo & earthtopia sukses 1 item tiap.
- Threads (Doea /research/threads, /users, /user-content): semua HTTP 400 "Invalid OAuth access token - Cannot parse access token" dari upstream. Akun tersambung hanya Instagram; kemungkinan perlu reconnect/re-token akun atau tambah akun Threads di hub.doea.net. Bukan bug kode.
- Riset lengkap uji: instagram 5? (gnfi), tiktok (2 akun), rss 25, threads 0 -> kegagalan parsial ditangani, sisanya jalan.
- Rem tangan: plafon 1 -> status rem_tangan:true, panggilan LLM ditolak "rem token harian aktif". Lepas via /api/rem-tangan/lepas -> false; plafon dikembalikan 250000. Semua 11 menu + 10 API data 200.

## AUDIT MENYELURUH TERAKHIR

Tanggal audit: 2026-10-03.

### LULUS

- Services: dashboard-ai, hermes3d, nginx, postgresql active dan enabled.
- `/health`: db=true, atria=true, apify=true, doea=true.
- Nginx `-t`: sukses.
- 11 menu: `/`, `/persetujuan`, `/riset`, `/tren`, `/draft`, `/jadwal`, `/pasukan`, `/kantor`, `/biaya`, `/jejak`, `/pengaturan` semuanya 200 dengan sesi owner; `/kantor` memakai redirect trailing slash.
- API data: status, persetujuan, biaya, kantor, tugas, draft, jejak, jadwal, tren, pengaturan, runtime state/registry semuanya 200 dengan sesi.
- Tanpa sesi: dashboard root dan kantor 302 ke `/masuk`; `/health` publik 200.
- Hermes3D: Custom Runtime Connected, 6 agent terdaftar, office-assets alias Nginx aktif, tidak ada 404 aset atau pageerror pada uji browser terakhir.
- Owner planner guardrail terbaru: riset -> `riset`, draft -> `tulis`, publish/jadwal -> `jadwal`; fallback deterministic tersedia jika Atria planner timeout.
- Approval: semua draft `menunggu` terlihat di `/api/persetujuan`; publish hanya melalui `setujui()`.
- Rem tangan: plafon kecil menghasilkan `rem_tangan:true` dan LLM ditolak; release mengembalikan false; plafon dipulihkan 250000.
- Login limiter: hanya 5 kegagalan yang memicu blok 15 menit; login sukses mereset hitungan.
- Shutdown: SIGTERM menghentikan interval heartbeat sebelum pool PostgreSQL ditutup; restart terakhir tidak menghasilkan `pool after end`.
- Riset partial: Apify Instagram + TikTok + RSS tetap menghasilkan data walau Threads gagal.
- Migration idempotent: semua 6 migration skip saat dijalankan ulang.

### PERBAIKAN YANG DITERAPKAN

- Async jobs `/api/perintah`, `/api/riset`, `/api/draft` mengembalikan job ID agar proxy tidak 504.
- `owner.js` guardrail kategori berdasarkan judul, fallback deterministik, tanpa retry rekursif duplikatif.
- TikTok actor menggunakan input `profiles`, bukan `usernames`.
- URL Instagram diperbaiki agar tidak salah precedence operator.
- Approval query menampilkan draft `menunggu` tanpa harus terhubung tugas tertentu.
- Draft multi-sudut mencegah sudut aktif yang sama dipakai ulang.
- Budget/jatah membaca usage nyata dari `runs` dan ledger agent; total konservatif dipakai untuk rem.
- Parser JSON menerima objek maupun array JSON dengan aman.

### BLOCKER EKSTERNAL SAJA

- Threads Doea tetap HTTP 400 dari upstream: `Invalid OAuth access token - Cannot parse access token`.
  `/research/threads`, `/research/threads/users`, dan `/research/threads/user-content` semuanya terkena.
  Akun Doea yang tersambung hanya Instagram `@atikadewi`; perlu reconnect OAuth/menyambungkan akun Threads di hub.doea.net. Sumber Apify TikTok/Instagram dan RSS tidak terganggu.

### KEADAAN DATA

- Ada task/draft historis dari sebelum guardrail terbaru; task lama yang salah rute sudah ditandai gagal, bukan dihapus diam-diam.
- Schedules Doea tetap kosong sampai Owner menyetujui draft.
- Plafon aktif saat ini: 250000.
