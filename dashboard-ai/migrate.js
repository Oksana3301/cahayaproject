const fs = require("fs");
const path = require("path");
const db = require("./lib/db");

const DIR = path.join(__dirname, "migrations");

async function pastikanTabelMigrasi() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrasi (
      nama text PRIMARY KEY,
      dijalankan_pada timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function sudahDijalankan(nama) {
  const r = await db.query("SELECT 1 FROM _migrasi WHERE nama = $1", [nama]);
  return r.rows.length > 0;
}

async function tandai(nama) {
  await db.query("INSERT INTO _migrasi (nama) VALUES ($1) ON CONFLICT DO NOTHING", [nama]);
}

async function utama() {
  await pastikanTabelMigrasi();
  const berkas = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  console.log(`[migrate] ditemukan ${berkas.length} berkas migration`);
  let jml = 0;
  for (const f of berkas) {
    if (await sudahDijalankan(f)) {
      console.log(`[migrate] skip  ${f} (sudah)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    console.log(`[migrate] jalankan ${f} ...`);
    await db.query(sql);
    await tandai(f);
    jml++;
    console.log(`[migrate] OK     ${f}`);
  }
  console.log(`[migrate] selesai, ${jml} migration baru dijalankan`);
  await db.pool.end();
}

utama().catch((e) => {
  console.error("[migrate] GAGAL:", e.message);
  process.exit(1);
});
