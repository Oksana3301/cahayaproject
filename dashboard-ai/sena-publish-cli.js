#!/usr/bin/env node
// sena-publish-cli.js
// CLI: kirim hasil clone carousel ke SocialHub (Doea) untuk tayang otomatis.
//
// Penggunaan:
//   node sena-publish-cli.js --dry-run                 # lihat yang bakal dikirim (tanpa kirim)
//   node sena-publish-cli.js --jam 19:00               # jam tayang WIB (default 19:00)
//   node sena-publish-cli.js --mulai 2026-10-10        # tanggal mulai WIB (default hari ini)
//   node sena-publish-cli.js --jumlah 1                # batasi jumlah konten
//   node sena-publish-cli.js --account <id>            # pilih akun (skip tanya)
//   node sena-publish-cli.js --list-akun               # tampilkan daftar akun saja
//   node sena-publish-cli.js --list-jadwal             # tampilkan jadwal terdaftar (dalam WIB)
//   node sena-publish-cli.js --ulang                   # abaikan anti-dobel (kirim ulang)

require("dotenv").config();

function parseArgs(argv) {
  const a = argv.slice(2);
  const o = { dryRun: false, jam: null, mulai: null, jumlah: null, account: null, ulang: false, listAkun: false, listJadwal: false };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--dry-run") o.dryRun = true;
    else if (x === "--jam") o.jam = a[++i];
    else if (x === "--mulai") o.mulai = a[++i];
    else if (x === "--jumlah") o.jumlah = Number(a[++i]);
    else if (x === "--account") o.account = a[++i];
    else if (x === "--ulang") o.ulang = true;
    else if (x === "--list-akun") o.listAkun = true;
    else if (x === "--list-jadwal") o.listJadwal = true;
  }
  return o;
}

(async () => {
  const o = parseArgs(process.argv);
  const pub = require("./lib/sena-publish");

  if (o.listAkun) {
    const akun = await pub.daftarAkun();
    console.log("=== AKUN TERSAMBUNG ===");
    akun.forEach((a, i) => console.log(`[${i + 1}] ${a.name} (@${a.username}) — ${a.type} — id ${a.id}`));
    if (!akun.length) console.log("(tidak ada akun tersambung)");
    process.exit(0);
  }

  if (o.listJadwal) {
    const jadwal = await pub.daftarJadwal({});
    console.log("=== JADWAL TERDAFTAR (WIB) ===");
    jadwal.forEach((j) => console.log(`  ${j.id} | ${pub.utcKeWib(j.scheduleAt)} | ${j.status} | ${j.title.slice(0, 50)}`));
    if (!jadwal.length) console.log("(belum ada jadwal)");
    process.exit(0);
  }

  const r = await pub.publishClone({
    accountId: o.account || null,
    jamTayang: o.jam || undefined,
    tanggalMulai: o.mulai || null,
    dryRun: o.dryRun,
    jumlah: o.jumlah || null,
    ulang: o.ulang,
  });

  console.log("\n===== RINGKASAN =====");
  if (o.dryRun) {
    console.log("MODE DRY-RUN — TIDAK ADA yang dikirim.");
    console.log("Hasil konversi jam (WIB -> UTC):");
    for (const h of r.hasil) {
      console.log(`  ${h.shortcode}: ${h.scheduleAtWib}  ->  ${h.scheduleAt}`);
    }
  } else {
    console.log(`Terkirim: ${r.hasil.length} | Gagal: ${r.gagal.length}`);
    if (r.hasil.length) {
      console.log("Jadwal (WIB):");
      for (const h of r.hasil) console.log(`  ${h.shortcode}: ${h.scheduleAtWib}`);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error("[publish-cli] GAGAL:", e.message);
  process.exit(1);
});
