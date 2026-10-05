CREATE TABLE IF NOT EXISTS draft_konten (
  id serial PRIMARY KEY,
  ringkasan_id int REFERENCES riset_ringkasan(id) ON DELETE SET NULL,
  sudut int,
  akun_id text,
  judul text NOT NULL,
  caption text NOT NULL,
  media jsonb,
  tagar text[],
  status text NOT NULL DEFAULT 'menunggu',
  alasan_tolak text,
  disetujui_oleh text,
  disetujui_pada timestamptz,
  schedule_id text,
  jadwal_pada timestamptz,
  error text,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS draft_status_idx ON draft_konten (status, dibuat_pada DESC);
CREATE INDEX IF NOT EXISTS draft_jadwal_idx ON draft_konten (jadwal_pada);
