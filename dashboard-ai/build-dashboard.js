#!/usr/bin/env node
// build-dashboard.js
// Baca semua file hasil script Sena (bedah, clone, publish, WA, email),
// lalu tulis SATU file dashboard.html yang datanya sudah nempel di dalamnya.
//
// Tanpa framework, tanpa build step, tanpa API key. Aman di-share/upload.
//
// Jalankan: node build-dashboard.js
// Output  : ./dashboard.html

const fs = require("fs");
const path = require("path");

// ============================ KONFIG ============================
const NAMA_BRAND = process.env.NAMA_BRAND || "Cahaya Project";
const DIR = path.join(__dirname, ".hermes3d");
const DIR_OUTPUT = path.join(DIR, "sena", "output");
const DIR_CLONE = path.join(DIR, "sena", "clone", "output");
const DIR_PUBLISH = path.join(DIR, "sena", "publish");
const JADWAL_PATH = path.join(DIR_PUBLISH, "jadwal.json");
const TERJADWAL_PATH = path.join(DIR_PUBLISH, "terjadwal.json");
const WA_LOG = path.join(DIR, "wa", "kirim-log.json");
const EMAIL_LOG = path.join(DIR, "email", "kirim-log.json");
const EMAIL_TERKIRIM = path.join(DIR, "email", "terkirim.json");
const OUT_HTML = path.join(__dirname, "dashboard.html");

function bacaJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

// Escape HTML agar aman di-render (anti injeksi / data sensitif rusak).
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Format ISO UTC -> WIB (YYYY-MM-DD HH:mm).
function wib(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

// ============================ 1. CAROUSEL DIBEDAH ============================
// Baca semua ringkasan-*.json, dedup shortcode, kumpulkan top like.
function dataBedah() {
  const perAkun = new Map();
  const seen = new Set();
  const posts = [];
  if (!fs.existsSync(DIR_OUTPUT)) return { total: 0, top: [], akun: [] };

  for (const f of fs.readdirSync(DIR_OUTPUT)) {
    if (!f.startsWith("ringkasan-") || !f.endsWith(".json")) continue;
    const d = bacaJSON(path.join(DIR_OUTPUT, f), null);
    if (!d) continue;
    const nama = (d.akun || f).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const list = Array.isArray(d.posts) ? d.posts : [];
    if (!perAkun.has(nama)) perAkun.set(nama, new Set());
    for (const p of list) {
      const sc = p?.shortcode || p?.url || null;
      if (!sc || seen.has(sc)) continue;
      seen.add(sc);
      perAkun.get(nama).add(sc);
      posts.push({
        shortcode: sc,
        url: p.url || "",
        likes: p.likesCount || 0,
        judulSlide1: (p.slideTeks && p.slideTeks[0] ? String(p.slideTeks[0]).split("\n")[0] : "") || p.caption || "",
      });
    }
  }
  posts.sort((a, b) => b.likes - a.likes);
  const akun = [...perAkun.entries()].map(([nama, s]) => ({ nama, jumlah: s.size }));
  return { total: posts.length, top: posts.slice(0, 10), akun };
}

// ============================ 2. KONTEN DIBIKIN ============================
function dataClone() {
  if (!fs.existsSync(DIR_CLONE)) return { total: 0, list: [] };
  const files = fs.readdirSync(DIR_CLONE).filter((f) => f.endsWith(".json"));
  return { total: files.length, list: files.map((f) => f.replace(/\.json$/, "")) };
}

// ============================ 3. ANTRE TAYANG ============================
function dataJadwal() {
  const j = bacaJSON(JADWAL_PATH, { diperbarui: null, docs: [] });
  const docs = Array.isArray(j.docs) ? j.docs : [];
  const antre = docs
    .filter((d) => !d.status || d.status === "pending")
    .map((d) => ({ title: d.title || "", scheduleAt: d.scheduleAt || "", status: d.status || "pending" }))
    .sort((a, b) => new Date(a.scheduleAt) - new Date(b.scheduleAt));
  const riwayat = docs.map((d) => ({ title: d.title || "", scheduleAt: d.scheduleAt || "", status: d.status || "" }));
  return { diperbarui: j.diperbarui, antre, riwayat, total: docs.length };
}

// ============================ 4. GAGAL ============================
function dataGagal() {
  let total = 0;
  const detail = [];

  // WA
  const wa = bacaJSON(WA_LOG, []);
  for (const x of wa) {
    if (x.status === "gagal") { total++; detail.push({ saluran: "WA", waktu: x.waktu, error: x.error }); }
  }

  // Email
  const em = bacaJSON(EMAIL_LOG, []);
  for (const x of em) {
    if (x.status === "gagal") { total++; detail.push({ saluran: "Email", waktu: x.waktu, error: x.error }); }
  }

  // Jadwal error
  const j = bacaJSON(JADWAL_PATH, { docs: [] });
  for (const d of (j.docs || [])) {
    if (d.status === "error") { total++; detail.push({ saluran: "Jadwal", waktu: d.scheduleAt, error: d.title }); }
  }

  return { total, detail };
}

// Statistik kirim WA & email (sukses).
function dataKirim() {
  const wa = bacaJSON(WA_LOG, []);
  const em = bacaJSON(EMAIL_LOG, []);
  const emailTerkirim = bacaJSON(EMAIL_TERKIRIM, []);
  return {
    waSukses: wa.filter((x) => x.status === "sukses").length,
    waGagal: wa.filter((x) => x.status === "gagal").length,
    emailSukses: em.filter((x) => x.status === "sukses").length || (Array.isArray(emailTerkirim) ? emailTerkirim.length : 0),
    emailGagal: em.filter((x) => x.status === "gagal").length,
  };
}

// ============================ RENDER ============================
function build() {
  const bedah = dataBedah();
  const clone = dataClone();
  const jadwal = dataJadwal();
  const gagal = dataGagal();
  const kirim = dataKirim();
  const dibangun = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ") + " WIB";

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(NAMA_BRAND)} — Dashboard</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--txt:#e6edf3;--mut:#8b949e;--hijau:#3fb950;--merah:#f85149;--biru:#58a6ff;--abu:#484f58;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
.wrap{max-width:900px;margin:0 auto;padding:16px}
h1{font-size:1.4rem;margin:0 0 4px}
.sub{color:var(--mut);font-size:.85rem;margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:24px}
@media(min-width:640px){.cards{grid-template-columns:repeat(4,1fr)}}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px}
.card .n{font-size:2rem;font-weight:700;line-height:1}
.card .l{color:var(--mut);font-size:.8rem;margin-top:6px}
.card.gagal .n{color:var(--merah)}
.card.gagal.nol .n{color:var(--abu)}
section{margin-bottom:24px}
h2{font-size:1rem;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:520px;font-size:.85rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
th{color:var(--mut);font-weight:600;white-space:nowrap;background:var(--panel)}
tr:last-child td{border-bottom:none}
a{color:var(--biru);text-decoration:none;word-break:break-all}
a:hover{text-decoration:underline}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:600}
.badge.pending{background:#1f2a37;color:var(--mut)}
.badge.success{background:#12261a;color:var(--hijau)}
.badge.error{background:#2d1517;color:var(--merah)}
.empty{color:var(--mut);font-style:italic;padding:10px 0}
.footer{margin-top:32px;color:var(--mut);font-size:.75rem;text-align:right}
</style>
</head>
<body>
<div class="wrap">
<h1>${esc(NAMA_BRAND)}</h1>
<p class="sub">Dashboard pemantauan pipeline Sena — bedah, clone, publish, kirim.</p>

<div class="cards">
  <div class="card"><div class="n">${bedah.total}</div><div class="l">Carousel dibedah</div></div>
  <div class="card"><div class="n">${clone.total}</div><div class="l">Konten dibikin</div></div>
  <div class="card"><div class="n">${jadwal.antre.length}</div><div class="l">Antre tayang</div></div>
  <div class="card gagal ${gagal.total === 0 ? "nol" : ""}"><div class="n">${gagal.total}</div><div class="l">Gagal</div></div>
</div>

<section>
<h2>Antre Tayang</h2>
${
  jadwal.antre.length
    ? `<div class="table-wrap"><table>
<tr><th>Judul</th><th>Kapan Tayang (WIB)</th><th>Status</th></tr>
${jadwal.antre.map((a) => `<tr><td>${esc(a.title)}</td><td>${wib(a.scheduleAt)}</td><td><span class="badge ${esc(a.status)}">${esc(a.status)}</span></td></tr>`).join("")}
</table></div>`
    : `<div class="empty">belum ada data</div>`
}
</section>

<section>
<h2>Carousel Kompetitor Paling Perform</h2>
${
  bedah.top.length
    ? `<div class="table-wrap"><table>
<tr><th>Judul Slide 1</th><th>Like</th><th>Link</th></tr>
${bedah.top.map((p) => `<tr><td>${esc(p.judulSlide1)}</td><td>${p.likes}</td><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : "-"}</td></tr>`).join("")}
</table></div>`
    : `<div class="empty">belum ada data</div>`
}
</section>

<section>
<h2>Kirim WA &amp; Email</h2>
<div class="cards">
  <div class="card"><div class="n">${kirim.waSukses}</div><div class="l">WA sukses</div></div>
  <div class="card"><div class="n">${kirim.emailSukses}</div><div class="l">Email sukses</div></div>
</div>
</section>

<div class="footer">terakhir di-build ${dibangun}</div>
</div>
</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, "utf8");
  return {
    bedahTotal: bedah.total,
    cloneTotal: clone.total,
    antre: jadwal.antre.length,
    gagal: gagal.total,
    waSukses: kirim.waSukses,
    emailSukses: kirim.emailSukses,
  };
}

// ============================ MAIN ============================
const r = build();
console.log("=== DASHBOARD DI-BUILD ===");
console.log(`File        : ${OUT_HTML}`);
console.log(`Carousel dibedah : ${r.bedahTotal}`);
console.log(`Konten dibikin   : ${r.cloneTotal}`);
console.log(`Antre tayang     : ${r.antre}`);
console.log(`Gagal            : ${r.gagal}`);
console.log(`WA sukses        : ${r.waSukses}`);
console.log(`Email sukses     : ${r.emailSukses}`);
