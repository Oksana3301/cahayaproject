CREATE TABLE IF NOT EXISTS jejak (
  id serial PRIMARY KEY,
  jenis text NOT NULL,
  objek_id bigint,
  keputusan text NOT NULL,
  oleh text,
  alasan text,
  isi_saat_itu jsonb,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jejak_dibuat_idx ON jejak (dibuat_pada DESC);
CREATE INDEX IF NOT EXISTS jejak_objek_idx ON jejak (jenis, objek_id);
