CREATE TABLE IF NOT EXISTS tugas (
  id serial PRIMARY KEY,
  judul text NOT NULL,
  isi text NOT NULL,
  status text NOT NULL DEFAULT 'menunggu',
  agent_yang_boleh text[] NOT NULL DEFAULT '{}',
  agent_pemilik text,
  dibuat_oleh text,
  hasil jsonb,
  error text,
  diambil_pada timestamptz,
  selesai_pada timestamptz,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tugas_status_dibuat_idx ON tugas (status, dibuat_pada);
CREATE INDEX IF NOT EXISTS tugas_pemilik_idx ON tugas (agent_pemilik);
