// skills/cari/instagram.js — sumber Instagram (hashtag + profile scraper)
const { jalankanActor } = require("../../lib/apify");

module.exports = {
  nama: "instagram",
  kategori: "cari",
  deskripsi: "Cari akun IG bisnis lewat hashtag, lalu ambil profil (bio, email, link).",

  async cari({ kataKunci, maks }) {
    // 1) hashtag -> usernames
    const hashtags = [].concat(kataKunci || []).filter(Boolean);
    const hasilTag = await jalankanActor("apify~instagram-hashtag-scraper", {
      hashtags,
      resultsLimit: maks || 10,
    }, maks || 10);

    const usernames = [];
    for (const h of hasilTag || []) {
      const u = h.ownerUsername || h.username || h.owner?.username;
      if (u) usernames.push(u);
    }

    // 2) profile -> detail
    const profil = usernames.length
      ? await jalankanActor("apify~instagram-profile-scraper", { usernames }, maks || 10)
      : [];

    return (profil || []).map((p) => ({
      nama: p.fullName || p.name || p.username || null,
      kategori: p.isBusinessAccount ? "business" : null,
      deskripsi: p.biography || p.bio || null,
      emails: p.email ? [p.email] : [],
      telepon: p.phone ? [p.phone] : [],
      website: p.externalUrl || p.website || null,
      domain: p.externalUrl ? (() => { try { return new URL(p.externalUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return null; } })() : null,
      alamat: null,
      kota: null,
      instagram: p.username ? "https://instagram.com/" + p.username : null,
      facebook: null,
      linkedin: null,
      tiktok: null,
      followers: p.followersCount || p.followers || null,
      sumber: "instagram",
      sumber_url: p.username ? "https://instagram.com/" + p.username : null,
    }));
  },
};
