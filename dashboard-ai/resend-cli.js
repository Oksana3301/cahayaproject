#!/usr/bin/env node
// resend-cli.js
// CLI: kirim email via Resend.
//
// Penggunaan:
//   node resend-cli.js --cek-domain                 # cek status domain (lapor bahasa manusia)
//   node resend-cli.js --dry-run                    # tampilkan pengirim/tujuan/subject/isi (tanpa kirim)
//   node resend-cli.js --kirim                      # kirim email tes ke EMAIL_TES
//   node resend-cli.js --to a@x.com,b@y.com --subject "..." --html "..." --text "..."

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR_SENT = path.join(__dirname, ".hermes3d", "email", "terkirim.json");
const EMAIL_LOG = path.join(__dirname, ".hermes3d", "email", "kirim-log.json");

function parseArgs(argv) {
  const a = argv.slice(2);
  const o = { cekDomain: false, dryRun: false, kirim: false, to: null, subject: null, html: null, text: null };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--cek-domain") o.cekDomain = true;
    else if (x === "--dry-run") o.dryRun = true;
    else if (x === "--kirim") o.kirim = true;
    else if (x === "--to") o.to = a[++i];
    else if (x === "--subject") o.subject = a[++i];
    else if (x === "--html") o.html = a[++i];
    else if (x === "--text") o.text = a[++i];
  }
  return o;
}

function bacaTerkirim() {
  try {
    if (!fs.existsSync(DIR_SENT)) return [];
    return JSON.parse(fs.readFileSync(DIR_SENT, "utf8"));
  } catch { return []; }
}
function simpanTerkirim(list) {
  fs.mkdirSync(path.dirname(DIR_SENT), { recursive: true });
  fs.writeFileSync(DIR_SENT, JSON.stringify(list, null, 2), "utf8");
}

// Catat log kirim email (sukses/gagal) untuk dashboard.
function catatKirimEmail({ tujuan, status, error = "" }) {
  let list = [];
  try {
    if (fs.existsSync(EMAIL_LOG)) list = JSON.parse(fs.readFileSync(EMAIL_LOG, "utf8"));
  } catch {}
  list.push({ waktu: new Date().toISOString(), tujuan: [].concat(tujuan), status, error });
  fs.mkdirSync(path.dirname(EMAIL_LOG), { recursive: true });
  fs.writeFileSync(EMAIL_LOG, JSON.stringify(list, null, 2), "utf8");
}

// Contoh isi email (HTML sederhana + teks polos).
function isiEmailDefault() {
  const subject = "Halo dari Cahaya Project 👋";
  const html = `
<h2>Cahaya Project — Uji Kirim Email</h2>
<p>Ini email uji coba dari <strong>Resend</strong>.</p>
<p>Kalau kamu membaca pesan ini, artinya alur kirim email sudah jalan.</p>
<p>Terima kasih sudah jadi bagian dari perjalanan sustainability kami.</p>
<a href="https://cahayaproject.id" style="display:inline-block;padding:10px 18px;background:#1a7a4a;color:#fff;text-decoration:none;border-radius:4px;">Kunjungi Cahaya Project</a>
<p style="color:#666;font-size:12px;">Email ini dikirim otomatis oleh Sena.</p>
`.trim();
  const text = [
    "Cahaya Project — Uji Kirim Email",
    "",
    "Ini email uji coba dari Resend. Kalau kamu membaca pesan ini, alur kirim email sudah jalan.",
    "",
    "Terima kasih sudah jadi bagian dari perjalanan sustainability kami.",
    "Kunjungi: https://cahayaproject.id",
    "",
    "Email ini dikirim otomatis oleh Sena.",
  ].join("\n");
  return { subject, html, text };
}

(async () => {
  const o = parseArgs(process.argv);
  const R = require("./lib/resend");

  // 1. CEK DOMAIN
  if (o.cekDomain) {
    const hasil = await R.cekDomain();
    console.log("=== CEK DOMAIN ===");
    console.log(`Domain : ${R.CONFIG.DOMAIN === "-" ? "(mode onboarding)" : R.CONFIG.DOMAIN}`);
    console.log(`Status : ${hasil.pesan}`);
    if (hasil.records && hasil.records.length) {
      console.log("\nRecord DNS yang harus dipasang (dari endpoint detail domain):");
      console.log(R.tabelRecords(hasil.records));
      console.log("\nPasang record ini di panel DNS domain kamu, lalu tunggu verifikasi Resend.");
      console.log("Selama belum verified, kirim otomatis pakai onboarding@resend.dev (tujuan hanya EMAIL_TES).");
    }
    process.exit(0);
  }

  // 2. Susun tujuan/subject/isi
  const tujuan = o.to ? o.to.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const def = isiEmailDefault();
  const subject = o.subject || def.subject;
  const html = o.html || def.html;
  const text = o.text || def.text;

  if (!tujuan.length && R.CONFIG.EMAIL_TES) tujuan.push(R.CONFIG.EMAIL_TES);
  if (!tujuan.length) {
    console.error("Tidak ada tujuan. Isi EMAIL_TES di blok CONFIG, atau pakai --to a@x.com.");
    process.exit(1);
  }

  // 3. DRY-RUN
  if (o.dryRun) {
    console.log("\n=== DRY-RUN (tidak dikirim) ===");
    console.log(`Dari    : ${R.susunFrom()}`);
    console.log(`Tujuan  : ${tujuan.join(", ")}`);
    console.log(`Reply-to: ${R.CONFIG.REPLY_TO || "(sama dgn pengirim)"}`);
    console.log(`Subject : ${subject}`);
    console.log("----- ISI (text) -----");
    console.log(text);
    console.log("----- ISI (html) -----");
    console.log(html);
    process.exit(0);
  }

  // 4. KIRIM
  if (!o.kirim) {
    console.log("Pakai --cek-domain / --dry-run / --kirim");
    process.exit(0);
  }

  // Anti dobel: catat yang sudah dikirim (kunci = hash tujuan+subject+isi).
  const sudah = bacaTerkirim();
  const kunci = crypto.createHash("sha256").update(JSON.stringify({ tujuan, subject, html })).digest("hex");
  if (sudah.includes(kunci)) {
    console.log("Email ini sudah pernah dikirim (anti-dobel). Skip.");
    console.log("(Idempotency-Key Resend juga sudah kedaluwarsa 24 jam, aman.)");
    process.exit(0);
  }

  console.log(`Mengirim ke ${tujuan.length} alamat...`);
  try {
    const hasil = await R.kirimBanyak({ tujuan, subject, html, text });
    console.log("TERKIRIM:");
    for (const h of hasil) {
      console.log(`  batch ${h.batch}: ${h.jumlah} alamat — id ${h.resp?.id || h.resp?.data?.id || "-"}`);
    }
    catatKirimEmail({ tujuan, status: "sukses" });

    sudah.push(kunci);
    simpanTerkirim(sudah);
    console.log("\nSudah dicatat anti-dobel. Selesai.");
  } catch (e) {
    catatKirimEmail({ tujuan, status: "gagal", error: e.message });
    throw e;
  }
})().catch((e) => {
  console.error("[resend] GAGAL:", e.message);
  process.exit(1);
});
