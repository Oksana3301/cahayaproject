// lib/cari.js — Orkestrator pencarian client/partner (Fase 3.7).
const { ambilKredit } = require("./apify");
const { chatJSON } = require("./llm");
const db = require("./db");
const outreach = require("./outreach");

const SKILLS = {
  maps: require("../skills/cari/maps"),
  web: require("../skills/cari/web"),
  linkedin: require("../skills/cari/linkedin"),
  instagram: require("../skills/cari/instagram"),
  facebook: require("../skills/cari/facebook"),
  tiktok: require("../skills/cari/tiktok"),
};
const perkaya = require("../skills/cari/perkaya");

// ============================================================================
// BERSIHKAN (Fase 3.4)
// ============================================================================
const EMAIL_BUANG = /example\.|sentry|wixpress|\.png|\.jpg|\.jpeg|\.gif|\.webp|noreply|no-reply|@2x|@3x/i;

function bersihkanEmail(list) {
  const hasil = [];
  for (let e of [].concat(list || [])) {
    if (typeof e !== "string") continue;
    e = e.trim().toLowerCase();
    if (!e || !/@/.test(e)) continue;
    if (EMAIL_BUANG.test(e)) continue;
    if (hasil.includes(e)) continue;
    hasil.push(e);
  }
  return hasil;
}

function bersihkanTelepon(list) {
  const hasil = [];
  for (let t of [].concat(list || [])) {
    if (typeof t !== "string") continue;
    t = t.replace(/[^\d+]/g, "");
    if (!t) continue;
    // 08xx -> 628xx
    if (/^0\d{8,}/.test(t)) t = "62" + t.slice(1);
    // +62 -> 62
    if (t.startsWith("+")) t = t.slice(1);
    if (!hasil.includes(t)) hasil.push(t);
  }
  return hasil;
}

function domainDariWebsite(website) {
  if (!website) return null;
  try { return new URL(website).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return null; }
}

// Pilih SATU email utama (domain sama website > info/halo/hello/contact/admin/sales > sisanya).
const PRIORITAS = ["info@", "halo@", "hello@", "contact@", "kontak@", "admin@", "sales@"];

function pilihEmailUtama(emails, domain) {
  if (!emails.length) return null;
  if (domain) {
    const sama = emails.filter((e) => e.endsWith("@" + domain));
    if (sama.length) {
      for (const p of PRIORITAS) {
        const hit = sama.find((e) => e.startsWith(p));
        if (hit) return hit;
      }
      return sama[0];
    }
  }
  for (const p of PRIORITAS) {
    const hit = emails.find((e) => e.startsWith(p));
    if (hit) return hit;
  }
  return emails[0];
}

function bersihkanProspek(p) {
  const emails = bersihkanEmail(p.emails);
  const domain = p.domain || domainDariWebsite(p.website);
  const emailUtama = pilihEmailUtama(emails, domain);
  const emailLain = emails.filter((e) => e !== emailUtama);
  const telepon = bersihkanTelepon(p.telepon);
  return {
    tujuan: p.tujuan || null,
    nama: p.nama || null,
    kategori: p.kategori || null,
    deskripsi: p.deskripsi || null,
    email: emailUtama,
    email_lain: emailLain,
    telepon: telepon[0] || null,
    website: p.website || null,
    domain,
    alamat: p.alamat || null,
    kota: p.kota || null,
    instagram: p.instagram || null,
    facebook: p.facebook || null,
    linkedin: p.linkedin || null,
    tiktok: p.tiktok || null,
    followers: p.followers != null ? Number(p.followers) || null : null,
    sumber: p.sumber || null,
    sumber_url: p.sumber_url || null,
  };
}

// kunci_dedupe: domain > email > telepon > nama|kota
function kunciDedupe(p) {
  if (p.domain) return p.domain;
  if (p.email) return p.email;
  if (p.telepon) return p.telepon;
  if (p.nama) return (p.nama.toLowerCase() + "|" + (p.kota || "").toLowerCase());
  return null;
}

// ============================================================================
// DEDUPE lintas sumber (Fase 3.5) — cek email/telepon/domain yang sudah ada.
// ============================================================================
async function sudahAda(p) {
  const kondisi = [];
  const params = [];
  if (p.email) { params.push(p.email); kondisi.push(`email = $${params.length}`); }
  if (p.telepon) { params.push(p.telepon); kondisi.push(`telepon = $${params.length}`); }
  if (p.domain) { params.push(p.domain); kondisi.push(`domain = $${params.length}`); }
  if (!kondisi.length) return false;
  const r = await db.ambilSatu(`SELECT 1 FROM prospek WHERE ${kondisi.join(" OR ")} LIMIT 1`, params);
  return !!r;
}

// ============================================================================
// SARING AI (Fase 3.6) — batch maks 30.
// ============================================================================
async function saringAI(kandidat, pengaturan) {
  const lolos = [];
  const total = kandidat.length;
  for (let i = 0; i < total; i += 30) {
    const batch = kandidat.slice(i, i + 30);
    const data = batch.map((k, idx) => ({
      i: idx,
      nama: k.nama,
      kategori: k.kategori,
      deskripsi: (k.deskripsi || "").slice(0, 300),
      kota: k.kota,
      website: k.website,
      sumber: k.sumber,
    }));
    const pesan = [
      {
        role: "system",
        content: [
          "Kamu humas Cahaya Project. Saring calon client/partner dari data hasil pencarian.",
          `Niche: ${pengaturan.niche || "sustainability/green transition"}`,
          `Tujuan: ${pengaturan.tujuan || "client+partner"}`,
          `Lokasi: ${pengaturan.lokasi || "Indonesia"}`,
          `Ukuran: ${pengaturan.ukuran || "UMKM + menengah"}`,
          "Nilai 1-5 seberapa cocok jadi client/partner Cahaya Project.",
          'Balas JSON PERSIS berformat {"hasil":[{"i":0,"tujuan":"client|partner","skor":1,"alasan":"singkat"}]}.',
          'Kunci field WAJIB: "i" (angka), "tujuan" (string), "skor" (angka 1-5), "alasan" (string). Jangan pakai kunci lain seperti "nilai".',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(data),
      },
    ];
    let hasil;
    try {
      hasil = await chatJSON({ agent: "humas", skill: "pr", messages: pesan, maxTokens: 2000, noReasoning: true });
    } catch (e) {
      hasil = [];
    }
    // LLM bisa mengembalikan array langsung, atau {hasil:[...]}/{results:[...]}.
    let arr = Array.isArray(hasil) ? hasil : (hasil.hasil || hasil.results || hasil.result || []);
    for (const item of arr) {
      const idx = Number(item.i);
      const skor = Number(item.skor ?? item.nilai ?? item.score);
      if (idx >= 0 && idx < batch.length && skor >= 3) {
        const k = batch[idx];
        lolos.push({ ...k, skor_cocok: skor, alasan_cocok: item.alasan || "", tujuan: item.tujuan || item.jenis || null });
      }
    }
  }
  return lolos;
}

// ============================================================================
// CARI CLIENT (orkestrator, Fase 3.7)
// ============================================================================
async function cariClient({ sumberFilter, maksPerSumber, progress } = {}) {
  const pengaturan = await outreach.semuaPengaturan();
  const sumberTerpilih = pengaturan.sumber || ["maps", "web", "linkedin", "instagram", "facebook", "tiktok"];
  const kataKunci = pengaturan.kata_kunci || {};
  const lokasi = pengaturan.lokasi || "Indonesia";

  const daftarSumber = sumberFilter
    ? [].concat(sumberFilter)
    : sumberTerpilih;

  const logPerSumber = [];

  for (const nama of daftarSumber) {
    const skill = SKILLS[nama];
    const kreditSebelum = await ambilKredit().catch(() => null);
    let log = { sumber: nama, actor: null, kata_kunci: JSON.stringify(kataKunci[nama] || []), jumlah_mentah: 0, jumlah_baru: 0, jumlah_email: 0, jumlah_telepon: 0, kredit_sebelum: kreditSebelum, kredit_sesudah: null, error: null };

    try {
      if (!skill) throw new Error(`sumber ${nama} tidak dikenal`);
      const mentah = await skill.cari({
        kataKunci: kataKunci[nama] || [],
        lokasi,
        maks: maksPerSumber || 10,
      });
      log.jumlah_mentah = mentah.length;

      // bersihkan
      let bersih = mentah.map(bersihkanProspek).filter((p) => p.nama || p.email || p.telepon || p.domain);

      // perkaya (hanya prospek ber-website tanpa email)
      const perluPerkaya = bersih.filter((p) => p.domain && !p.email).map((p) => p.domain);
      if (perluPerkaya.length) {
        const map = await perkaya.perkaya(perluPerkaya).catch(() => ({}));
        bersih = bersih.map((p) => {
          if (p.domain && !p.email && map[p.domain]) {
            const m = map[p.domain];
            const emails = bersihkanEmail(m.emails);
            p.email = emails[0] || null;
            p.email_lain = emails.slice(1);
            const tels = bersihkanTelepon(m.telepon);
            if (!p.telepon && tels[0]) p.telepon = tels[0];
            if (!p.instagram && m.instagram) p.instagram = m.instagram;
            if (!p.facebook && m.facebook) p.facebook = m.facebook;
            if (!p.linkedin && m.linkedin) p.linkedin = m.linkedin;
          }
          return p;
        });
      }

      // dedupe lintas sumber
      const baru = [];
      for (const p of bersih) {
        if (await sudahAda(p)) continue;
        baru.push(p);
      }

      // saring AI
      const lolos = await saringAI(baru, pengaturan);
      log.jumlah_baru = lolos.length;
      log.jumlah_email = lolos.filter((p) => p.email).length;
      log.jumlah_telepon = lolos.filter((p) => p.telepon).length;

      // simpan
      for (const p of lolos) {
        const k = kunciDedupe(p);
        if (!k) continue; // tidak ada identitas, lewati
        const tanpaEmail = !p.email;
        const catatan = tanpaEmail ? "tanpa email" : null;
        await db.query(
          `INSERT INTO prospek (tujuan, nama, kategori, deskripsi, email, email_lain, telepon, website, domain, alamat, kota, instagram, facebook, linkedin, tiktok, followers, sumber, sumber_url, kunci_dedupe, skor_cocok, alasan_cocok, tahap, catatan)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'belum_contact',$22)
           ON CONFLICT (kunci_dedupe) DO NOTHING`,
          [
            p.tujuan, p.nama, p.kategori, p.deskripsi, p.email, JSON.stringify(p.email_lain || []),
            p.telepon, p.website, p.domain, p.alamat, p.kota, p.instagram, p.facebook, p.linkedin,
            p.tiktok, p.followers, p.sumber, p.sumber_url, k, p.skor_cocok, p.alasan_cocok, catatan,
          ]
        );
      }
      log.kredit_sesudah = await ambilKredit().catch(() => null);
      if (progress) progress({ sumber: nama, ...log });
    } catch (e) {
      log.error = e.message;
      log.kredit_sesudah = await ambilKredit().catch(() => null);
      if (progress) progress({ sumber: nama, ...log });
    }

    // satu baris cari_log per sumber
    await db.query(
      `INSERT INTO cari_log (sumber, actor, kata_kunci, jumlah_mentah, jumlah_baru, jumlah_email, jumlah_telepon, kredit_sebelum, kredit_sesudah, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [log.sumber, log.actor, log.kata_kunci, log.jumlah_mentah, log.jumlah_baru, log.jumlah_email, log.jumlah_telepon, log.kredit_sebelum, log.kredit_sesudah, log.error]
    );
    logPerSumber.push(log);
  }

  return logPerSumber;
}

module.exports = { cariClient, bersihkanProspek, kunciDedupe, bersihkanEmail, bersihkanTelepon, pilihEmailUtama, saringAI };
