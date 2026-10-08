// lib/outreach.js
// Helper Misi 2: rem kuota harian (atomik), pengaturan PR, cek email (MX),
// rem reputasi, dan util umum untuk pipeline client/partner + outreach email.
const db = require("./db");
const dns = require("dns").promises;

// ============================================================================
// REM KUOTA HARIAN (Fase 1.3) — ATOMIK via INSERT ... ON CONFLICT ... WHERE.
// ============================================================================

// Batas kirim hari ini: min(EMAIL_PER_HARI, 10) selama 7 hari pertama sejak
// email pertama sepanjang masa terkirim; sesudahnya EMAIL_PER_HARI.
async function batasHarian() {
  const perHari = Number(process.env.EMAIL_PER_HARI) || 20;
  const tglPertama = await ambilPengaturan("tanggal_email_pertama");
  const pertama = tglPertama ? new Date(String(tglPertama)) : null;
  if (pertama && !isNaN(pertama.getTime())) {
    const hari = Math.floor((Date.now() - pertama.getTime()) / 86400000);
    if (hari < 7) return Math.min(perHari, 10);
  }
  return perHari;
}

// Klaim satu jatah SEBELUM kirim. Return true bila dapat, false bila penuh.
async function klaimJatah() {
  const batas = await batasHarian();
  const r = await db.query(
    `INSERT INTO email_kuota (tanggal, terpakai)
     VALUES (current_date, 1)
     ON CONFLICT (tanggal)
     DO UPDATE SET terpakai = email_kuota.terpakai + 1
     WHERE email_kuota.terpakai < $1
     RETURNING terpakai`,
    [batas]
  );
  return r.rows.length > 0;
}

// Kembalikan satu jatah saat kirim gagal.
async function kembalikanJatah() {
  await db.query(
    `UPDATE email_kuota SET terpakai = GREATEST(0, terpakai - 1) WHERE tanggal = current_date`
  );
}

async function terpakaiHariIni() {
  const r = await db.query(`SELECT terpakai FROM email_kuota WHERE tanggal = current_date`);
  return Number(r.rows[0]?.terpakai || 0);
}

// ============================================================================
// PENGATURAN PR (Fase 1.4)
// ============================================================================
async function ambilPengaturan(kunci) {
  const r = await db.ambilSatu(`SELECT nilai FROM pengaturan_pr WHERE kunci = $1`, [kunci]);
  return r ? r.nilai : null;
}

async function simpanPengaturan(kunci, nilai) {
  await db.query(
    `INSERT INTO pengaturan_pr (kunci, nilai) VALUES ($1, $2)
     ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai`,
    [kunci, JSON.stringify(nilai)]
  );
}

async function semuaPengaturan() {
  const rows = await db.ambilBanyak(`SELECT kunci, nilai FROM pengaturan_pr`);
  const out = {};
  for (const r of rows) out[r.kunci] = r.nilai;
  return out;
}

// ============================================================================
// CEK EMAIL (Fase 6.1) — format valid + domain punya MX record.
// ============================================================================
function formatEmailValid(alamat) {
  return typeof alamat === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alamat.trim());
}

async function cekEmail(alamat) {
  if (!formatEmailValid(alamat)) return { valid: false, alasan: "format email tidak valid" };
  const domain = alamat.trim().split("@")[1].toLowerCase();
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || !mx.length) return { valid: false, alasan: `domain ${domain} tidak punya MX record` };
    return { valid: true, mx: mx.map((m) => m.exchange) };
  } catch (e) {
    return { valid: false, alasan: `gagal cek MX ${domain}: ${e.message}` };
  }
}

// ============================================================================
// REM REPUTASI (Fase 6.3)
// ============================================================================
async function hitungReputasi7Hari() {
  const r = await db.ambilSatu(
    `SELECT
       COUNT(*) FILTER (WHERE status_kirim = 'bounced')::int AS bounce,
       COUNT(*) FILTER (WHERE status_kirim = 'complained')::int AS complain,
       COUNT(*)::int AS terkirim
     FROM pesan
     WHERE arah = 'keluar' AND dibuat_pada > now() - interval '7 days'`
  );
  const terkirim = Number(r?.terkirim || 0);
  const bounce = Number(r?.bounce || 0);
  const complain = Number(r?.complain || 0);
  const bouncePct = terkirim > 0 ? (bounce / terkirim) * 100 : 0;
  const complainPct = terkirim > 0 ? (complain / terkirim) * 100 : 0;
  return { terkirim, bounce, complain, bouncePct, complainPct };
}

async function cekRemReputasi() {
  const s = await ambilPengaturan("rem_reputasi");
  if (s && s.aktif) return s;
  return { aktif: false };
}

async function jalankanCekReputasi() {
  const stat = await hitungReputasi7Hari();
  const aktif =
    stat.terkirim >= 20 && (stat.bouncePct > 3 || stat.complainPct > 0.05);
  if (aktif) {
    const nilai = {
      aktif: true,
      alasan: `bounce ${stat.bouncePct.toFixed(2)}% / complaint ${stat.complainPct.toFixed(2)}% (7 hari, ${stat.terkirim} terkirim)`,
      angka: stat,
      sejak: new Date().toISOString(),
    };
    await simpanPengaturan("rem_reputasi", nilai);
    return nilai;
  }
  return { aktif: false, angka: stat };
}

async function lepasRemReputasi(oleh) {
  await simpanPengaturan("rem_reputasi", { aktif: false, dilepas_oleh: oleh, dilepas_pada: new Date().toISOString() });
  await db.query(
    `INSERT INTO jejak (jenis, objek_id, keputusan, oleh, alasan)
     VALUES ('pr', NULL, 'lepas_rem_reputasi', $1, 'rem reputasi dilepas manual')`,
    [oleh || "owner"]
  );
}

module.exports = {
  batasHarian,
  klaimJatah,
  kembalikanJatah,
  terpakaiHariIni,
  ambilPengaturan,
  simpanPengaturan,
  semuaPengaturan,
  formatEmailValid,
  cekEmail,
  hitungReputasi7Hari,
  cekRemReputasi,
  jalankanCekReputasi,
  lepasRemReputasi,
};
