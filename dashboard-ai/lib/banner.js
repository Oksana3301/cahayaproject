// lib/banner.js
// Generator banner + carousel 1080x1080 untuk konten Cahaya Project.
// Output PNG disimpan di <STATE_DIR>/media/<nama>.png dan diakses publik via
// endpoint /media/<nama>.png (lihat server.js) sehingga Instagram Graph API
// (via Doea) bisa mengambilnya.
//
// Instagram WAJIB punya media (image/video) — posting teks polos selalu gagal.
// Karena itu setiap publish selalu disertai banner/carousel ini.
//
// ============================================================================
// BRAND (playful editorial collage — deskripsi logo Cahaya Project)
// ============================================================================
// - Konsep: kolase editorial playful = tipografi ekspresif + potongan bentuk
//   geometris + warna kontras + tekstur berlapis, terinspirasi seni kolase.
// - Warna: oranye, biru tua, hijau, merah, kuning, ungu (cerah, energik,
//   inklusif). Elemen bintang + huruf dinamis = eksploratif & optimistis.
// - Kepribadian: Curious, Creative, Optimistic, Inclusive.
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_DIR = path.resolve(__dirname, "..", ".hermes3d");
const MEDIA_DIR = path.join(STATE_DIR, "media");

const W = 1080;
const H = 1080;
const MARGIN = 96;

// ----------------------------------------------------------------------------
// PALET BRAND (dari deskripsi logo). Setiap palet punya latar netral + 6 aksen
// warna brand. Dipilih deterministik dari judul, tapi semua tetap "brand-able".
// ----------------------------------------------------------------------------
const BRAND_COLORS = [
  { nama: "oranye", hex: "#F97316" },
  { nama: "biru",   hex: "#1E3A8A" },
  { nama: "hijau",  hex: "#16A34A" },
  { nama: "merah",  hex: "#DC2626" },
  { nama: "kuning", hex: "#FACC15" },
  { nama: "ungu",   hex: "#7C3AED" },
];

// Latar terang (paper/krem) — hangat, cocok untuk kolase editorial.
const PALET = [
  { nama: "krem",   bg: "#FAF6EF", tinta: "#1A1A1A", tintaLembut: "#4B4B4B" },
  { nama: "putih",  bg: "#FFFFFF", tinta: "#111111", tintaLembut: "#555555" },
  { nama: "birupastel", bg: "#EDF2FA", tinta: "#0F172A", tintaLembut: "#334155" },
];

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Bungkus teks panjang menjadi baris <= maxChars.
function bungkusTeks(teks, maxChars) {
  const kata = String(teks || "").trim().replace(/\s+/g, " ").split(" ");
  const baris = [];
  let kini = "";
  for (const k of kata) {
    const calon = kini ? `${kini} ${k}` : k;
    if (calon.length > maxChars && kini) {
      baris.push(kini);
      kini = k;
    } else {
      kini = calon;
    }
  }
  if (kini) baris.push(kini);
  return baris;
}

// Judul dari caption: baris pertama yang berarti (bukan hashtag).
function judulDari(caption) {
  const bersih = String(caption || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^#/.test(x));
  const kandidat = bersih[0] || "Cahaya Project";
  return kandidat.replace(/^\[[^\]]*\]\s*/, "").slice(0, 160);
}

function hashIndeks(seed, panjang) {
  const h = crypto.createHash("md5").update(String(seed)).digest()[0];
  return h % panjang;
}

// Estimasi lebar teks (kasar) untuk auto-fit.
function estimasiLebar(teks, fontSize) {
  return String(teks).length * fontSize * 0.56;
}

// Pilih ukuran font agar satu baris muat dalam lebar maksimum.
function ukuranPas(teks, lebarMaks, min = 40, maks = 96) {
  let u = maks;
  while (u > min && estimasiLebar(teks, u) > lebarMaks) u -= 2;
  return u;
}

// ----------------------------------------------------------------------------
// PRIMITIF COLLAGE (dipakai ulang oleh tiap slide).
// ----------------------------------------------------------------------------

// Blok geometris acak-deterministik yang "hidup" tapi tidak bertabrakan teks.
function dekorasiCollage(seed, aksenArr) {
  const rnd = (i) => {
    const h = crypto.createHash("md5").update(seed + ":" + i).digest();
    return h.readUInt32BE(0) / 0xffffffff; // 0..1
  };
  const bagian = [];
  const nBentuk = 6 + Math.floor(rnd(1) * 4); // 6-9 bentuk
  for (let i = 0; i < nBentuk; i++) {
    const warna = aksenArr[Math.floor(rnd(i * 2 + 1) * aksenArr.length)];
    const jenis = Math.floor(rnd(i * 3 + 2) * 4); // 0 kotak, 1 lingkaran, 2 bintang, 3 garis
    const x = 40 + rnd(i * 5 + 3) * (W - 80);
    const y = 40 + rnd(i * 7 + 4) * (H - 80);
    const s = 24 + rnd(i * 11 + 5) * 120;
    const op = (0.12 + rnd(i * 13 + 6) * 0.5).toFixed(2);
    const rot = Math.floor(rnd(i * 17 + 7) * 360);

    if (jenis === 0) {
      bagian.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${s.toFixed(0)}" height="${(s * 0.7).toFixed(0)}" rx="8" fill="${warna}" fill-opacity="${op}" transform="rotate(${rot} ${x.toFixed(0)} ${y.toFixed(0)})"/>`);
    } else if (jenis === 1) {
      bagian.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(s * 0.5).toFixed(0)}" fill="${warna}" fill-opacity="${op}"/>`);
    } else if (jenis === 2) {
      bagian.push(bintangSvg(x, y, s * 0.5, warna, op, rot));
    } else {
      bagian.push(`<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + s).toFixed(0)}" y2="${(y - s * 0.6).toFixed(0)}" stroke="${warna}" stroke-opacity="${op}" stroke-width="6" stroke-linecap="round"/>`);
    }
  }
  return bagian.join("\n  ");
}

// Bintang 5 titik sederhana (SVG path) dengan rotasi.
function bintangSvg(cx, cy, r, warna, op, rot) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const rad = (i % 2 === 0) ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    p.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${p.join(" ")}" fill="${warna}" fill-opacity="${op}" transform="rotate(${rot} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`;
}

// Pola titik (dot grid) — tekstur berlapis khas kolase.
function polaTitik(seed, warna) {
  const dots = [];
  const step = 44;
  const rnd = (i) => {
    const h = crypto.createHash("md5").update(seed + ":" + i).digest();
    return h.readUInt32BE(0) / 0xffffffff;
  };
  for (let y = MARGIN; y < H - MARGIN; y += step) {
    for (let x = MARGIN; x < W - MARGIN; x += step) {
      if (rnd(x + y * 999) < 0.25) {
        dots.push(`<circle cx="${x}" cy="${y}" r="3" fill="${warna}" fill-opacity="0.18"/>`);
      }
    }
  }
  return dots.join("\n  ");
}

// ----------------------------------------------------------------------------
// BANGUN SATU SLIDE (SVG -> PNG buffer).
// ----------------------------------------------------------------------------
async function bangunSlide({ mode, judul, sub, badge, edisi, logoPath, paletIdx, aksenIdx, nomor, totalSlide } = {}) {
  const sharp = require("sharp");
  const palet = PALET[paletIdx % PALET.length];
  const aksen = BRAND_COLORS[aksenIdx % BRAND_COLORS.length];
  const aksenArr = BRAND_COLORS.map((c) => c.hex);
  const seed = String(judul || badge || "cahaya") + ":" + mode;

  const lebarIsi = W - MARGIN * 2;

  // Judul besar auto-fit (maks 3 baris).
  const barisJudul = bungkusTeks(judul || "", 22).slice(0, 3);
  let ukuran = 96;
  for (let u = 96; u >= 44; u -= 2) {
    if (barisJudul.every((b) => estimasiLebar(b, u) <= lebarIsi)) { ukuran = u; break; }
  }
  const tinggiBaris = ukuran * 1.16;

  // Sub kalimat (maks 2 baris).
  const barisSub = bungkusTeks(sub || "", 44).slice(0, 2);

  const badgeTeks = escapeXml((badge || "INSIGHT HARIAN").toUpperCase());
  const edisiTeks = escapeXml(edisi || edisiHariIni());

  // ---- penyusunan blok SVG ----
  const parts = [];
  // latar
  parts.push(`<rect width="${W}" height="${H}" fill="${palet.bg}"/>`);
  // tekstur titik halus
  parts.push(polaTitik(seed + "dot", aksen.hex));
  // dekorasi collage
  parts.push(dekorasiCollage(seed + "dec", aksenArr));

  // bingkai tipis
  parts.push(`<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${palet.tinta}" stroke-opacity="0.14" stroke-width="2"/>`);

  // ---- header: logo + wordmark (logo di pojok kiri atas) ----
  if (logoPath) {
    parts.push(`<image href="${logoPath}" x="${MARGIN}" y="64" width="96" height="96" preserveAspectRatio="xMidYMid meet"/>`);
    parts.push(`<text x="${MARGIN + 112}" y="120" font-family="DejaVu Sans" font-weight="bold" font-size="32" fill="${palet.tinta}">CAHAYA PROJECT</text>`);
  } else {
    parts.push(`<rect x="${MARGIN}" y="70" width="12" height="52" rx="6" fill="${aksen.hex}"/>`);
    parts.push(`<text x="${MARGIN + 28}" y="108" font-family="DejaVu Sans" font-weight="bold" font-size="34" letter-spacing="1" fill="${palet.tinta}">CAHAYA PROJECT</text>`);
  }

  // ---- badge kategori ----
  const badgeW = Math.min(lebarIsi, 36 + badgeTeks.length * 21);
  parts.push(`<rect x="${MARGIN}" y="142" rx="22" width="${badgeW}" height="48" fill="${aksen.hex}"/>`);
  parts.push(`<text x="${MARGIN + 22}" y="174" font-family="DejaVu Sans" font-weight="bold" font-size="22" letter-spacing="2" fill="#FFFFFF">${badgeTeks}</text>`);

  // ---- edisi + nomor slide ----
  parts.push(`<text x="${MARGIN}" y="248" font-family="DejaVu Sans" font-size="20" letter-spacing="4" fill="${palet.tintaLembut}">EDISI ${edisiTeks}</text>`);
  if (totalSlide && totalSlide > 1) {
    parts.push(`<text x="${W - MARGIN}" y="248" text-anchor="end" font-family="DejaVu Sans" font-weight="bold" font-size="22" fill="${aksen.hex}">${nomor} / ${totalSlide}</text>`);
  }

  // ---- judul utama (asimetris: mulai sedikit ke bawah) ----
  const judulTop = 330;
  const judulSpan = barisJudul
    .map((b, i) => `<text x="${MARGIN}" y="${judulTop + i * tinggiBaris}" font-family="DejaVu Sans" font-weight="bold" font-size="${ukuran}" fill="${palet.tinta}">${escapeXml(b)}</text>`)
    .join("\n  ");
  parts.push(judulSpan);

  // ---- garis aksen ----
  const subTop = judulTop + barisJudul.length * tinggiBaris + 34;
  parts.push(`<rect x="${MARGIN}" y="${subTop - 12}" width="150" height="8" rx="4" fill="${aksen.hex}"/>`);

  // ---- sub caption ----
  const subSpan = barisSub
    .map((b, i) => `<text x="${MARGIN}" y="${subTop + i * 48}" font-family="DejaVu Sans" font-size="34" fill="${palet.tintaLembut}">${escapeXml(b)}</text>`)
    .join("\n  ");
  parts.push(subSpan);

  // ---- footer ----
  parts.push(`<line x1="${MARGIN}" y1="${H - 130}" x2="${W - MARGIN}" y2="${H - 130}" stroke="${palet.tinta}" stroke-opacity="0.16" stroke-width="2"/>`);
  parts.push(`<text x="${MARGIN}" y="${H - 76}" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="${aksen.hex}">#CahayaProject</text>`);
  parts.push(`<text x="${W - MARGIN}" y="${H - 76}" text-anchor="end" font-family="DejaVu Sans" font-size="22" fill="${palet.tintaLembut}">cahayaproject</text>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  ${parts.join("\n  ")}
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return { buffer, meta: { judul, palet: palet.nama, aksen: aksen.nama, ukuran, baris: barisJudul } };
}

function edisiHariIni() {
  const WIB = 7 * 3600000;
  const d = new Date(Date.now() + WIB);
  const bln = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${bln} ${d.getUTCFullYear()}`;
}

// ----------------------------------------------------------------------------
// FUNGSI PUBLIK
// ----------------------------------------------------------------------------

// Buat SATU banner (kompatibel dengan publish.js). Mengembalikan { nama, path, buffer, meta }.
async function buatBanner({ caption, judul, badge, kategori, edisi, logoPath } = {}) {
  await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  const judulFinal = String(judul || judulDari(caption)).trim();
  const kalimat = String(caption || "")
    .split("\n").map((x) => x.trim()).filter(Boolean).filter((x) => !/^#/.test(x));
  const sub = (kalimat[1] || kalimat[0] || "").replace(/\s+/g, " ").slice(0, 160);

  const paletIdx = hashIndeks(judulFinal, PALET.length);
  const aksenIdx = hashIndeks(judulFinal + ":aksen", BRAND_COLORS.length);

  const { buffer, meta } = await bangunSlide({
    mode: "cover",
    judul: judulFinal,
    sub,
    badge: kategori || badge || "INSIGHT HARIAN",
    edisi,
    logoPath,
    paletIdx,
    aksenIdx,
  });

  const nama = `cahaya-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
  const filePath = path.join(MEDIA_DIR, nama);
  await fs.promises.writeFile(filePath, buffer);
  return { nama, path: filePath, buffer, meta };
}

// Buat CAROUSEL multi-slide. slide = [{ judul, sub, badge? }].
// Mengembalikan { slides: [{ nama, path, buffer, meta }] }.
async function buatCarousel({ caption, judul, badge, kategori, edisi, logoPath, slide } = {}) {
  await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  const list = Array.isArray(slide) && slide.length ? slide : [];
  const hasil = [];

  // Slide cover default dari caption bila tidak ada slide eksplisit.
  if (!list.length) {
    const judulFinal = String(judul || judulDari(caption)).trim();
    const kalimat = String(caption || "")
      .split("\n").map((x) => x.trim()).filter(Boolean).filter((x) => !/^#/.test(x));
    list.push({ judul: judulFinal, sub: (kalimat[1] || kalimat[0] || "").slice(0, 160) });
  }

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const paletIdx = hashIndeks(s.judul + i, PALET.length);
    const aksenIdx = (hashIndeks(s.judul + i + ":aksen", BRAND_COLORS.length) + i) % BRAND_COLORS.length;
    const { buffer, meta } = await bangunSlide({
      mode: "slide-" + (i + 1),
      judul: s.judul || "Cahaya Project",
      sub: s.sub || "",
      badge: s.badge || kategori || badge || "INSIGHT HARIAN",
      edisi,
      logoPath,
      paletIdx,
      aksenIdx,
      nomor: i + 1,
      totalSlide: list.length,
    });
    const nama = `cahaya-${Date.now()}-${i}-${crypto.randomBytes(4).toString("hex")}.png`;
    const filePath = path.join(MEDIA_DIR, nama);
    await fs.promises.writeFile(filePath, buffer);
    hasil.push({ nama, path: filePath, buffer, meta });
  }

  return { slides: hasil };
}

module.exports = { buatBanner, buatCarousel, bangunSlide, MEDIA_DIR, judulDari, PALET, BRAND_COLORS };
