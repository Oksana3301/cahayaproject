// skills/cari/web.js — sumber Website via Google Search (apify~google-search-scraper)
const { jalankanActor } = require("../../lib/apify");

// Domain yang dibuang: marketplace, direktori, media, sosmed.
const BUANG = [
  "tokopedia.com", "shopee.co.id", "bukalapak.com", "lazada", "blibli",
  "facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "twitter.com", "x.com",
  "youtube.com", "wikipedia.org", "kompas.com", "detik.com", "cnnindonesia.com",
  "tempo.co", "tribunnews.com", "liputan6.com", "antaranews.com", "idntimes.com",
  "merdeka.com", "suara.com", "katadata", "kontan", "bisnis.com", "cnbcindonesia.com",
  "brilio.net", "kumparan.com", "beritagar.id",
];

module.exports = {
  nama: "web",
  kategori: "cari",
  deskripsi: "Cari website calon client/partner lewat Google Search (buang marketplace/media/sosmed).",

  async cari({ kataKunci, maks }) {
    const queries = [].concat(kataKunci || []).filter(Boolean);
    const hasil = await jalankanActor("apify~google-search-scraper", {
      queries: queries.join("\n"),
      countryCode: "id",
      languageCode: "id",
      maxPagesPerQuery: 1,
    }, maks || 10);

    const out = [];
    for (const page of hasil || []) {
      for (const r of page.organicResults || []) {
        let url = r.url || "";
        try { url = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { continue; }
        if (BUANG.some((b) => url === b || url.endsWith("." + b))) continue;
        out.push({
          nama: r.title || null,
          kategori: null,
          deskripsi: r.description || null,
          emails: [],
          telepon: [],
          website: r.url || null,
          domain: url,
          alamat: null,
          kota: null,
          instagram: null,
          facebook: null,
          linkedin: null,
          tiktok: null,
          followers: null,
          sumber: "web",
          sumber_url: r.url || null,
        });
      }
    }
    return out.slice(0, maks || 10);
  },
};
