// skills/cari/tiktok.js — sumber TikTok (hashtag -> profile; email dari regex bio)
const { jalankanActor } = require("../../lib/apify");

function ambilEmail(teks) {
  if (!teks) return [];
  const m = String(teks).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return m ? [...new Set(m)] : [];
}

module.exports = {
  nama: "tiktok",
  kategori: "cari",
  deskripsi: "Cari akun TikTok bisnis lewat hashtag, ambil profil (bio, bioLink).",

  async cari({ kataKunci, maks }) {
    const hashtags = [].concat(kataKunci || []).filter(Boolean);
    const hasilTag = await jalankanActor("clockworks~tiktok-scraper", {
      hashtags,
      resultsPerPage: maks || 10,
    }, maks || 10);

    const profiles = [];
    for (const h of hasilTag || []) {
      const n = h.authorMeta?.name || h.author?.name || h.uniqueId;
      if (n) profiles.push(n);
    }
    if (!profiles.length) return [];

    const profil = await jalankanActor("clockworks~tiktok-profile-scraper", {
      profiles: [...new Set(profiles)].slice(0, maks || 10),
    }, maks || 10);

    return (profil || []).map((p) => {
      const bio = p.signature || p.bio || p.description || "";
      const emails = ambilEmail(bio);
      const bioLink = p.bioLink || p.bio_link || null;
      return {
        nama: p.nickname || p.name || p.uniqueId || null,
        kategori: null,
        deskripsi: bio || null,
        emails,
        telepon: [],
        website: bioLink,
        domain: bioLink ? (() => { try { return new URL(bioLink).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return null; } })() : null,
        alamat: null,
        kota: null,
        instagram: null,
        facebook: null,
        linkedin: null,
        tiktok: p.uniqueId ? "https://tiktok.com/@" + p.uniqueId : null,
        followers: p.followerCount || p.followers || null,
        sumber: "tiktok",
        sumber_url: p.uniqueId ? "https://tiktok.com/@" + p.uniqueId : null,
      };
    });
  },
};
