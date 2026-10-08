#!/usr/bin/env node
// sena-cli.js
// CLI manual untuk menjalankan bedah carousel (agent Sena) dari terminal.
//
// Penggunaan:
//   node sena-cli.js                     # default: 2 akun target, 15 post
//   node sena-cli.js 5                   # 5 post per akun
//   node sena-cli.js 15 <url1> <url2>    # akun custom
//   node sena-cli.js --no-ocr            # ambil data saja (tanpa OCR)
//
// Variabel hasil: file .xlsx di .hermes3d/sena/output/

require("dotenv").config();

function parseArgs(argv) {
  const args = argv.slice(2);
  let resultsLimit = 15;
  let ocr = true;
  const akun = [];
  for (const a of args) {
    if (a === "--no-ocr") {
      ocr = false;
    } else if (/^\d+$/.test(a)) {
      resultsLimit = parseInt(a, 10);
    } else if (a.startsWith("http")) {
      akun.push(a);
    }
  }
  return { resultsLimit, ocr, akun };
}

(async () => {
  const { resultsLimit, ocr, akun } = parseArgs(process.argv);
  const { bedahCarousel } = require("./skills/sena");
  console.log(`[sena-cli] menjalankan bedah carousel: limit=${resultsLimit}, ocr=${ocr}, akun=${akun.length ? akun.join(",") : "default"}`);
  const r = await bedahCarousel({ akun: akun.length ? akun : null, resultsLimit, ocr, lanjutOtomatis: true });
  console.log("\n===== HASIL =====");
  console.log("File xlsx :", r.file);
  console.log("Jumlah post :", r.jumlahPost);
  console.log("Akun       :", r.akun.join(", "));
  console.log("Slide gagal:", r.slideGagal);
  process.exit(0);
})().catch((e) => {
  console.error("[sena-cli] GAGAL:", e.message);
  process.exit(1);
});
