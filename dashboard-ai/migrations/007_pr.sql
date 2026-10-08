-- ============================================================================
-- Misi 2 — Pipeline cari client/partner + outreach email (Fase 2).
-- Tabel: prospek, pesan, cari_log, email_kuota, pengaturan_pr, jadwal_pr.
-- ============================================================================

-- Prospek (calon client/partner)
CREATE TABLE IF NOT EXISTS prospek (
  id serial PRIMARY KEY,
  tujuan text,                        -- 'client' | 'partner' | 'dua-duanya'
  nama text,
  kategori text,
  deskripsi text,
  email text,
  email_lain jsonb NOT NULL DEFAULT '[]'::jsonb,
  email_valid boolean,
  telepon text,
  website text,
  domain text,
  alamat text,
  kota text,
  instagram text,
  facebook text,
  linkedin text,
  tiktok text,
  followers int,
  sumber text,
  sumber_url text,
  kunci_dedupe text UNIQUE,
  skor_cocok int,
  alasan_cocok text,
  tahap text NOT NULL DEFAULT 'belum_contact',
  pitch text,
  subject_awal text,
  alasan_tolak_draft text,
  message_id_terakhir text,
  referensi_thread text,
  resend_id_terakhir text,
  terakhir_dihubungi timestamptz,
  jumlah_susulan int NOT NULL DEFAULT 0,
  catatan text,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prospek_email_uniq_idx
  ON prospek (email) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS prospek_tahap_hubungi_idx ON prospek (tahap, terakhir_dihubungi);
CREATE INDEX IF NOT EXISTS prospek_sumber_idx ON prospek (sumber);
CREATE INDEX IF NOT EXISTS prospek_tujuan_idx ON prospek (tujuan);
CREATE INDEX IF NOT EXISTS prospek_domain_idx ON prospek (domain);

-- Pesan (utas email per prospek)
CREATE TABLE IF NOT EXISTS pesan (
  id serial PRIMARY KEY,
  prospek_id int REFERENCES prospek(id) ON DELETE CASCADE,
  arah text NOT NULL DEFAULT 'keluar', -- 'keluar' | 'masuk'
  dari_email text,
  subject text,
  isi text,
  message_id text,
  resend_id text,
  in_reply_to text,
  sudah_dibalas boolean NOT NULL DEFAULT false,
  status_kirim text,                  -- 'terkirim' | 'delivered' | 'bounced' | 'complained'
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesan_prospek_idx ON pesan (prospek_id, dibuat_pada);
CREATE INDEX IF NOT EXISTS pesan_resend_idx ON pesan (resend_id);
CREATE INDEX IF NOT EXISTS pesan_status_idx ON pesan (status_kirim, dibuat_pada);

-- Log pencarian per sumber (Fase 3.7)
CREATE TABLE IF NOT EXISTS cari_log (
  id serial PRIMARY KEY,
  sumber text,
  actor text,
  kata_kunci text,
  jumlah_mentah int NOT NULL DEFAULT 0,
  jumlah_baru int NOT NULL DEFAULT 0,
  jumlah_email int NOT NULL DEFAULT 0,
  jumlah_telepon int NOT NULL DEFAULT 0,
  kredit_sebelum numeric,
  kredit_sesudah numeric,
  error text,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cari_log_sumber_idx ON cari_log (sumber);
CREATE INDEX IF NOT EXISTS cari_log_dibuat_idx ON cari_log (dibuat_pada DESC);

-- Rem kuota harian (atomik). tanggal = PK, terpakai = jumlah email terkirim hari itu.
CREATE TABLE IF NOT EXISTS email_kuota (
  tanggal date PRIMARY KEY,
  terpakai int NOT NULL DEFAULT 0
);

-- Pengaturan PR (sumber terpilih + kata kunci + pembagian kuota + tanggal email pertama + rem reputasi)
CREATE TABLE IF NOT EXISTS pengaturan_pr (
  kunci text PRIMARY KEY,
  nilai jsonb NOT NULL
);

-- Jadwal PR (catat terakhir_jalan per nama jadwal; mencegah dobel)
CREATE TABLE IF NOT EXISTS jadwal_pr (
  nama text PRIMARY KEY,
  terakhir_jalan timestamptz
);
