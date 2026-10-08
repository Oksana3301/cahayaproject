#!/usr/bin/env node
// sena-clone-cli.js
// CLI manual: clone carousel kompetitor -> versi brand kita.
//
// Penggunaan:
//   node sena-clone-cli.js                      # default: 1 teratas (like tertinggi)
//   node sena-clone-cli.js --top 3              # 3 teratas
//   node sena-clone-cli.js --row 5              # baris No. 5
//   node sena-clone-cli.js --file <xlsx>        # file xlsx custom
//   node sena-clone-cli.js --ulang              # paksa proses ulang (abaikan cache)
//
// Output: .hermes3d/sena/clone/output/<shortcode>.json dan .txt

require("dotenv").config();

function parseArgs(argv) {
  const a = argv.slice(2);
  const o = { jenis: "top", nilai: 1, ulang: false, fileXlsx: null };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--top") { o.jenis = "top"; o.nilai = Number(a[++i]) || 1; }
    else if (x === "--row") { o.jenis = "row"; o.nilai = Number(a[++i]); }
    else if (x === "--ulang") o.ulang = true;
    else if (x === "--file") o.fileXlsx = a[++i];
  }
  return o;
}

(async () => {
  const o = parseArgs(process.argv);
  const { cloneCarousel } = require("./lib/sena-clone");

  // default file xlsx = hasil bedah terbaru
  if (!o.fileXlsx) {
    const path = require("path");
    const fs = require("fs");
    const outDir = path.join(__dirname, ".hermes3d", "sena", "output");
    const files = fs.existsSync(outDir)
      ? fs.readdirSync(outDir).filter((f) => f.endsWith(".xlsx")).sort().reverse()
      : [];
    if (!files.length) {
      console.error("[clone-cli] tidak ada file xlsx hasil bedah. Jalankan sena-cli.js dulu.");
      process.exit(1);
    }
    o.fileXlsx = path.join(outDir, files[0]);
  }

  console.log(`[clone-cli] file: ${o.fileXlsx}`);
  console.log(`[clone-cli] mode: ${o.jenis} ${o.nilai}${o.ulang ? " (--ulang)" : ""}`);

  const r = await cloneCarousel({ fileXlsx: o.fileXlsx, jenis: o.jenis, nilai: o.nilai, ulang: o.ulang });

  console.log("\n===== HASIL CLONE =====");
  for (const h of r.hasil) {
    const n = h.hasil.slides.length;
    console.log(`  ${h.post.shortcode} (${h.post.likesCount} like) -> ${n} slide`);
    console.log(`    json: ${h.jsonPath}`);
    console.log(`    txt : ${h.txtPath}`);
  }
  console.log(`\nFolder output: ${r.dirOut}`);
  process.exit(0);
})().catch((e) => {
  console.error("[clone-cli] GAGAL:", e.message);
  process.exit(1);
});
