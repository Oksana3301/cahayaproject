// skills/cari/maps.js — sumber Google Maps (compass~crawler-google-places)
const { jalankanActor } = require("../../lib/apify");

module.exports = {
  nama: "maps",
  kategori: "cari",
  deskripsi: "Cari calon client/partner dari Google Maps (tempat usaha lokal).",

  async cari({ kataKunci, lokasi, maks }) {
    const hasil = await jalankanActor("compass~crawler-google-places", {
      searchStringsArray: [].concat(kataKunci || []),
      locationQuery: lokasi || "Indonesia",
      maxCrawledPlacesPerSearch: Math.min(maks || 10, 10),
      language: "id",
      skipClosedPlaces: true,
      scrapeContacts: true,
    }, maks || 10);

    return (hasil || []).map((r) => ({
      nama: r.title || null,
      kategori: r.categoryName || null,
      deskripsi: r.description || null,
      emails: [].concat(r.emails || []).filter(Boolean),
      telepon: r.phone ? [r.phone] : (r.phones ? [].concat(r.phones) : []),
      website: r.website || null,
      domain: null,
      alamat: r.address || null,
      kota: r.city || null,
      instagram: (r.instagrams && r.instagrams[0]) || null,
      facebook: (r.facebooks && r.facebooks[0]) || null,
      linkedin: (r.linkedIns && r.linkedIns[0]) || null,
      tiktok: null,
      followers: null,
      sumber: "maps",
      sumber_url: r.url || null,
    }));
  },
};
