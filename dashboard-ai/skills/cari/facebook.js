// skills/cari/facebook.js — sumber Facebook Page (cari URL via Google, lalu pages-scraper)
const { jalankanActor } = require("../../lib/apify");
const web = require("./web");

module.exports = {
  nama: "facebook",
  kategori: "cari",
  deskripsi: "Cari Facebook Page bisnis (via Google Search -> facebook-pages-scraper).",

  async cari({ kataKunci, lokasi, maks }) {
    // 1) cari URL page lewat google
    const queries = [].concat(kataKunci || []).map((k) => `site:facebook.com "${k}" ${lokasi || ""}`.trim());
    const hasilGoogle = await jalankanActor("apify~google-search-scraper", {
      queries: queries.join("\n"),
      countryCode: "id",
      languageCode: "id",
      maxPagesPerQuery: 1,
    }, maks || 10);

    const startUrls = [];
    for (const page of hasilGoogle || []) {
      for (const r of page.organicResults || []) {
        if (r.url && /facebook\.com\//.test(r.url)) startUrls.push({ url: r.url });
      }
    }
    if (!startUrls.length) return [];

    // 2) ambil detail page
    const halaman = await jalankanActor("apify~facebook-pages-scraper", {
      startUrls: startUrls.slice(0, maks || 10),
    }, maks || 10);

    return (halaman || []).map((p) => ({
      nama: p.title || p.name || null,
      kategori: p.category || null,
      deskripsi: p.description || null,
      emails: p.email ? [p.email] : (p.emails ? [].concat(p.emails) : []),
      telepon: p.phone ? [p.phone] : [],
      website: p.website || null,
      domain: p.website ? (() => { try { return new URL(p.website).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return null; } })() : null,
      alamat: p.address || null,
      kota: p.city || null,
      instagram: null,
      facebook: p.url || p.pageUrl || null,
      linkedin: null,
      tiktok: null,
      followers: p.followers || p.likes || null,
      sumber: "facebook",
      sumber_url: p.url || p.pageUrl || null,
    }));
  },
};
