#!/usr/bin/env node
// laporan-harian-cli.js
// CLI: kirim laporan harian agent Sena ke WhatsApp via WAHA.
//
// Penggunaan:
//   node laporan-harian-cli.js --dry-run          # tampilkan isi pesan (tanpa kirim)
//   node laporan-harian-cli.js                    # kirim ke NOMOR_TES
//   node laporan-harian-cli.js --nomor 628123456789  # kirim ke nomor lain (minta konfirmasi)
//   node laporan-harian-cli.js --nomor 628123456789 --iya  # konfirmasi eksplisit
//   node laporan-harian-cli.js --tanpa-retry     # jangan retry saat gagal

require("dotenv").config();

function parseArgs(argv) {
  const a = argv.slice(2);
  const o = { dryRun: false, nomor: null, iya: false, retry: true };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--dry-run") o.dryRun = true;
    else if (x === "--nomor") o.nomor = a[++i];
    else if (x === "--iya") o.iya = true;
    else if (x === "--tanpa-retry") o.retry = false;
  }
  return o;
}

(async () => {
  const o = parseArgs(process.argv);
  const { kirimLaporanHarian } = require("./lib/laporan-harian");

  const r = await kirimLaporanHarian({
    dryRun: o.dryRun,
    nomor: o.nomor || null,
    retry: o.retry,
  });

  if (o.dryRun) {
    console.log("\n===== DRY-RUN (tidak dikirim) =====");
    console.log(`Session  : ${r.session.nama} (${r.session.status})`);
    console.log(`Tujuan    : ${r.nomorTujuan}`);
    console.log("----- ISI PESAN -----");
    console.log(r.teks);
    console.log("----------------------");
  } else {
    console.log(`\n===== TERKIRIM ====`);
    console.log(`Tujuan  : ${r.nomorTujuan}`);
    console.log(`ID pesan: ${r.terkirim?.id || "-"}`);
    if (r.retried) console.log("(berhasil setelah retry 1x)");
  }
})().catch((e) => {
  console.error("[laporan-harian] GAGAL:", e.message);
  process.exit(1);
});
