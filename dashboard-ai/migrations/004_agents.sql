CREATE TABLE IF NOT EXISTS agents (
  id serial PRIMARY KEY,
  kode text UNIQUE NOT NULL,
  nama text NOT NULL,
  jabatan text NOT NULL,
  emoji text NOT NULL DEFAULT '🤖',
  persona text NOT NULL,
  atasan_kode text,
  skill_diizinkan text[] NOT NULL DEFAULT '{}',
  jatah_token_harian int NOT NULL DEFAULT 100000,
  aktif boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS agent_pemakaian (
  agent_kode text NOT NULL,
  tanggal date NOT NULL DEFAULT current_date,
  token_terpakai bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_kode, tanggal)
);
CREATE INDEX IF NOT EXISTS agent_pemakaian_tanggal_idx ON agent_pemakaian (tanggal);
