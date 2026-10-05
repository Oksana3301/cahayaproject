const db = require("./db");

async function ambilAtomik(kode) {
  const r = await db.query(
    `UPDATE tugas
     SET status = 'dikerjakan', agent_pemilik = $1, diambil_pada = now()
     WHERE id = (
       SELECT id FROM tugas
       WHERE status = 'menunggu' AND $1 = ANY(agent_yang_boleh)
       ORDER BY dibuat_pada
       FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING *`,
    [kode]
  );
  return r.rows[0] || null;
}

async function simpanHasil(id, hasil) {
  await db.query(
    `UPDATE tugas SET status = 'selesai', hasil = $1, selesai_pada = now(), error = NULL WHERE id = $2`,
    [JSON.stringify(hasil || {}), id]
  );
}

async function simpanHasilPerluPersetujuan(id, hasil) {
  await db.query(
    `UPDATE tugas SET status = 'perlu_persetujuan', hasil = $1, selesai_pada = now(), error = NULL WHERE id = $2`,
    [JSON.stringify(hasil || {}), id]
  );
}

async function simpanGagal(id, error) {
  await db.query(
    `UPDATE tugas SET status = 'gagal', error = $1, selesai_pada = now() WHERE id = $2`,
    [String(error || "kesalahan tak dikenal").slice(0, 500), id]
  );
}

async function bersihkanMacet() {
  const r = await db.query(
    `UPDATE tugas
     SET status = 'menunggu', error = 'diambil ulang, agent sebelumnya tidak menyelesaikan', agent_pemilik = NULL, diambil_pada = NULL
     WHERE status = 'dikerjakan' AND diambil_pada < now() - interval '15 minutes'
     RETURNING id`
  );
  return r.rows.length;
}

async function buatTugas({ judul, isi, agentYangBoleh, dibuatOleh }) {
  const r = await db.query(
    `INSERT INTO tugas (judul, isi, status, agent_yang_boleh, dibuat_oleh, dibuat_pada)
     VALUES ($1, $2, 'menunggu', $3, $4, now()) RETURNING *`,
    [judul, isi, agentYangBoleh, dibuatOleh || "owner"]
  );
  return r.rows[0];
}

async function daftarByStatus(status) {
  return db.ambilBanyak("SELECT * FROM tugas WHERE status = $1 ORDER BY dibuat_pada DESC", [status]);
}

module.exports = {
  ambilAtomik,
  simpanHasil,
  simpanHasilPerluPersetujuan,
  simpanGagal,
  bersihkanMacet,
  buatTugas,
  daftarByStatus,
};
