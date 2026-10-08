// skills/cari/linkedin.js — sumber LinkedIn perusahaan (BUKAN profil orang).
const { jalankanActor } = require("../../lib/apify");

module.exports = {
  nama: "linkedin",
  kategori: "cari",
  deskripsi: "Cari perusahaan di LinkedIn (company search + detail). Bukan profil orang.",

  async cari({ kataKunci, lokasi, maks }) {
    // 1) cari perusahaan
    const daftar = await jalankanActor("harvestapi~linkedin-company-search", {
      searchQuery: [].concat(kataKunci || []).join(" ") || "sustainability",
      locations: [].concat(lokasi || []).filter(Boolean).length
        ? [].concat(lokasi || []).filter(Boolean)
        : ["Indonesia"],
      maxItems: maks || 10,
    }, maks || 10);

    // 2) detail tiap perusahaan (website, industri, ukuran)
    const idList = (daftar || []).map((c) => c.id || c.companyId || c.linkedinId).filter(Boolean);
    const detail = idList.length
      ? await jalankanActor("harvestapi~linkedin-company", { companies: idList }, maks || 10)
      : [];

    const byId = {};
    for (const d of detail || []) {
      const k = d.id || d.companyId || d.linkedinId || d.url;
      if (k) byId[k] = d;
    }

    return (daftar || []).map((c) => {
      const d = byId[c.id || c.companyId || c.linkedinId] || {};
      return {
        nama: c.name || c.title || d.name || null,
        kategori: d.industry || c.industry || null,
        deskripsi: d.description || c.description || null,
        emails: [],
        telepon: d.phone ? [d.phone] : [],
        website: d.website || c.website || null,
        domain: d.website ? (() => { try { return new URL(d.website).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return null; } })() : null,
        alamat: d.address || c.address || null,
        kota: d.city || c.city || c.location || null,
        instagram: null,
        facebook: null,
        linkedin: c.url || c.linkedinUrl || d.url || null,
        tiktok: null,
        followers: c.followers || d.followers || null,
        sumber: "linkedin",
        sumber_url: c.url || c.linkedinUrl || null,
      };
    });
  },
};
