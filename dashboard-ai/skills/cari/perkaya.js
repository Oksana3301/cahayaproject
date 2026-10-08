// skills/cari/perkaya.js — perkaya kontak dari website (vdrmota~contact-info-scraper)
const { jalankanActor } = require("../../lib/apify");

module.exports = {
  nama: "perkaya",
  kategori: "cari",
  deskripsi: "Perkaya kontak (email/telepon/sosmed) dari daftar website prospek.",

  // domains: array domain unik (tanpa www). Satu panggilan untuk semua.
  async perkaya(domains) {
    const list = [...new Set([].concat(domains || []).filter(Boolean))];
    if (!list.length) return {};

    const startUrls = list.map((d) => ({ url: d.startsWith("http") ? d : "https://" + d }));

    const hasil = await jalankanActor("vdrmota~contact-info-scraper", {
      startUrls,
      maxDepth: 1,
      sameDomain: true,
      mergeContacts: true,
      maxRequestsPerStartUrl: 5,
      proxyConfig: { useApifyProxy: true },
    }, list.length);

    const map = {};
    for (const h of hasil || []) {
      let domain = null;
      try { domain = new URL(h.url || h.startUrl || "").hostname.replace(/^www\./, "").toLowerCase(); } catch (e) {}
      if (!domain) continue;
      map[domain] = {
        emails: [].concat(h.emails || []).filter(Boolean),
        telepon: [].concat(h.phones || []).filter(Boolean),
        instagram: (h.instagrams && h.instagrams[0]) || null,
        facebook: (h.facebooks && h.facebooks[0]) || null,
        linkedin: (h.linkedIns && h.linkedIns[0]) || null,
      };
    }
    return map;
  },
};
