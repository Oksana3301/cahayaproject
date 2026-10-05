CREATE TABLE IF NOT EXISTS riset_hasil (
  id serial PRIMARY KEY,
  keyword text,
  sumber text NOT NULL,
  penulis text,
  teks text,
  url text,
  suka int,
  komentar int,
  tanggal timestamptz,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS riset_hasil_keyword_idx ON riset_hasil (keyword, dibuat_pada);
CREATE INDEX IF NOT EXISTS riset_hasil_sumber_idx ON riset_hasil (sumber);

CREATE TABLE IF NOT EXISTS riset_ringkasan (
  id serial PRIMARY KEY,
  keyword text NOT NULL,
  sudut jsonb NOT NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS riset_ringkasan_dibuat_idx ON riset_ringkasan (dibuat_pada DESC);
