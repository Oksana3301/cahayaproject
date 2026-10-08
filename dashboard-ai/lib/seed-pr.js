// lib/seed-pr.js — Seeder pengaturan_pr default (Fase 1.4).
// Idempoten (ON CONFLICT DO UPDATE). Dipanggil sekali saat boot / manual.
const outreach = require("./outreach");

const DEFAULT = {
  tujuan: "client+partner",
  niche: "industri sustainability/green transition (media, komunitas, bisnis hijau, NGO, riset kebijakan, konsultan ESG, brand peduli lingkungan)",
  lokasi: "Indonesia",
  ukuran: "UMKM/kecil + menengah (bukan korporat besar)",
  sumber: ["maps", "web", "linkedin", "instagram", "facebook", "tiktok"],
  kata_kunci: {
    maps: ["sustainable cafe", "zero waste store", "toko ramah lingkungan", "ecoprint", "daur ulang", "bank sampah", "komunitas lingkungan", "refill station", "produk organik", "eco-friendly store"],
    web: ["bisnis ramah lingkungan Indonesia", "startup sustainability Indonesia", "brand eco friendly Indonesia", "konsultan ESG Indonesia", "produk daur ulang Indonesia", "komunitas green transition", "UMKM sustainable Indonesia", "supplier bahan ramah lingkungan"],
    linkedin: ["sustainability", "ESG", "renewable energy", "circular economy", "green business", "climate tech", "environmental consulting", "sustainable finance"],
    instagram: ["sustainableliving", "zerowaste", "gogreen", "ecofriendly", "sustainability", "greenlifestyle", "climateaction", "produkramahlingkungan", "umkmhijau", "bisnisberkelanjutan"],
    facebook: ["ramah lingkungan", "zero waste", "daur ulang", "komunitas lingkungan"],
    tiktok: ["sustainableliving", "zerowaste", "gogreen", "ecofriendly", "greenlifestyle", "climateaction", "sustainability"],
  },
  kuota_per_sumber: { maps: 6, web: 12, linkedin: 3, instagram: 10, facebook: 4, tiktok: 5 },
  prospek_per_minggu: Number(process.env.PROSPEK_PER_MINGGU) || 40,
  ghosting_hari: 5,
  susulan_maks: 2,
  persetujuan_balasan: "semua",
  tawaran_client: "semua produk/layanan Cahaya Project KECUALI riset & insight",
  tawaran_partner: "kolaborasi + co-host webinar",
  nilai_inti: "konten & komunitas yang bikin isu sustainability mudah dipahami dan relevan buat audiens kalangan mana pun, termasuk penerapan dan prosesnya yang bisa dimengerti non-praktisi energi, dengan bahasa yang mudah dipahami",
  nada: "santai tapi profesional",
  kata_terlarang: ["save the planet", "kamu harus", "100% sustainable", "100% ramah lingkungan"],
};

async function seedPR() {
  for (const [kunci, nilai] of Object.entries(DEFAULT)) {
    await outreach.simpanPengaturan(kunci, nilai);
  }
  // rem_reputasi awal (non-aktif) kalau belum ada
  const rem = await outreach.ambilPengaturan("rem_reputasi");
  if (!rem) await outreach.simpanPengaturan("rem_reputasi", { aktif: false });
  console.log("[seed-pr] pengaturan_pr default siap");
}

if (require.main === module) {
  seedPR().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { seedPR, DEFAULT };
