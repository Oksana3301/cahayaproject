const db = require("./lib/db");
const roster = require("./agents/roster");

async function utama() {
  for (const a of roster.ROSTER) {
    await db.query(
      `INSERT INTO agents (kode, nama, jabatan, emoji, persona, atasan_kode, skill_diizinkan, jatah_token_harian, aktif)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (kode) DO UPDATE SET
         nama = EXCLUDED.nama,
         jabatan = EXCLUDED.jabatan,
         emoji = EXCLUDED.emoji,
         persona = EXCLUDED.persona,
         atasan_kode = EXCLUDED.atasan_kode,
         skill_diizinkan = EXCLUDED.skill_diizinkan,
         jatah_token_harian = EXCLUDED.jatah_token_harian,
         aktif = EXCLUDED.aktif`,
      [
        a.kode, a.nama, a.jabatan, a.emoji, a.persona,
        a.atasan_kode, a.skill_diizinkan, a.jatah_token_harian,
      ]
    );
    console.log(`[seed] ${a.kode} (${a.nama}) - ${a.jabatan} - skill: [${a.skill_diizinkan.join(", ") || "-"}]`);
  }
  const r = await db.query("SELECT count(*)::int AS n FROM agents");
  console.log(`[seed] selesai, total ${r.rows[0].n} agent di tabel`);
  await db.pool.end();
}

utama().catch((e) => {
  console.error("[seed] GAGAL:", e.message);
  process.exit(1);
});
