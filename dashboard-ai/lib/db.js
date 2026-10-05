require("./env");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let MENUTUP = false;

pool.on("error", (err) => {
  // Saat shutdown, error pool (mis. "Cannot use a pool after calling end") bukan kegagalan nyata.
  if (MENUTUP) return;
  console.error("[db] pool error tak terduga:", err.message);
});

function tandaiMenutup() {
  MENUTUP = true;
}

function sedangMenutup() {
  return MENUTUP;
}

// Jalankan query; saat shutdown, jangan lempar error yang berisik — kembalikan nilai aman.
async function query(text, params) {
  if (MENUTUP) return { rows: [] };
  try {
    return await pool.query(text, params);
  } catch (e) {
    if (MENUTUP || /after calling end|pool after/i.test(e.message || "")) {
      return { rows: [] };
    }
    throw e;
  }
}

async function ambilSatu(text, params) {
  const r = await query(text, params);
  return r.rows[0] || null;
}

async function ambilBanyak(text, params) {
  const r = await query(text, params);
  return r.rows;
}

async function withClient(fn) {
  if (MENUTUP) throw new Error("db sedang menutup");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

let SUDAH_END = false;
async function tutup() {
  if (SUDAH_END) return;
  SUDAH_END = true;
  tandaiMenutup();
  try {
    await pool.end();
  } catch (_) {
    /* abaikan error saat menutup pool */
  }
}

module.exports = { pool, query, ambilSatu, ambilBanyak, withClient, tandaiMenutup, sedangMenutup, tutup };
