// skills/sena.js
// Skill "bedah carousel Instagram kompetitor" milik agent Sena.
//
// Menggabungkan lib/sena.js (pipeline Apify->OCR) + lib/sena-excel.js (xlsx).
// Mendukung banyak akun sekaligus -> satu file .xlsx gabungan (urut like
// menurun GLOBAL), satu baris per post.
//
// Dipanggil dari cron job 3-hari-sekali (agentTurn payload.skill = "riset").
// Bisa juga dipanggil manual.

const path = require("path");
const { bolehPakaiSkill, cekJatah, catatPemakaian } = require("../agents/wewenang");
const sena = require("../lib/sena");
const { tulisExcel } = require("../lib/sena-excel");

// Target default (bisa dioverride lewat env SENA_TARGET_AKUN = url1,url2).
const TARGET_DEFAULT = [
  "https://www.instagram.com/uzi.philosophy/",
  "https://www.instagram.com/climatecardinals/",
];

function targetAkun(dariEnv) {
  if (dariEnv && String(dariEnv).trim()) {
    return String(dariEnv).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return TARGET_DEFAULT;
}

// Jalankan bedah carousel untuk daftar akun, lalu susun xlsx gabungan.
async function bedahCarousel({
  akun = null,
  resultsLimit = 15,
  agentKode = "sena",
  ocr = true,
  lanjutOtomatis = true,
} = {}) {
  await bolehPakaiSkill(agentKode, "riset");
  await cekJatah(agentKode);

  const daftar = akun && akun.length ? akun : targetAkun(process.env.SENA_TARGET_AKUN);
  const semuaPost = [];

  for (const a of daftar) {
    const r = await sena.bedah({
      akun: a,
      resultsLimit,
      ocr,
      lanjutOtomatis, // cron non-interaktif
    });
    if (r.dibatalkan) continue;
    // Tandai asal akun tiap post agar cover bisa di-cache dengan benar.
    for (const p of r.posts) p.akun = a;
    semuaPost.push(...r.posts);
  }

  // Urut global: like menurun.
  semuaPost.sort((a, b) => b.likesCount - a.likesCount);

  // Susun xlsx gabungan.
  const stempel = new Date().toISOString().slice(0, 10);
  const namaFile = `bedah-carousel-${stempel}.xlsx`;
  const filePath = path.join(sena.DIR_OUT, namaFile);
  await tulisExcel({ filePath, listPost: semuaPost });

  console.log(`[sena] selesai: ${semuaPost.length} post -> ${filePath}`);
  return {
    ok: true,
    file: filePath,
    jumlahPost: semuaPost.length,
    akun: daftar,
    slideGagal: semuaPost.reduce((n, p) => n + (p.slideTeks || []).filter((t) => t === "[OCR GAGAL]").length, 0),
  };
}

module.exports = { bedahCarousel, targetAkun, TARGET_DEFAULT };
