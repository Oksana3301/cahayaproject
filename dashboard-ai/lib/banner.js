// lib/banner.js
// Generator banner 1080x1080 (format feed Instagram) dari judul/caption konten.
// Output PNG disimpan di <STATE_DIR>/media/<nama>.png dan diakses publik via
// endpoint /media/<nama>.png (lihat server.js) sehingga Instagram Graph API
// (via Doea) bisa mengambilnya.
//
// Instagram WAJIB punya media (image/video) — posting teks polos selalu gagal
// dengan "invalid postId: unsupported type schedule". Karena itu setiap publish
// selalu disertai banner ini.
//
// DESAIN (redesign):
//   - Latar gradien diagonal + blob aksen + garis halus (tekstur "energi").
//   - Header: wordmark "CAHAYA PROJECT" + kategori (badge).
//   - Judul besar auto-fit (ukuran menyesuaikan panjang, selalu pas & seimbang).
//   - Garis aksen + sub-caption ringkas.
//   - Footer: tagar resmi.
//   Dijaga deterministik (palet dipilih dari hash judul) agar hasil konsisten.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_DIR = path.resolve(__dirname, "..", ".hermes3d");
const MEDIA_DIR = path.join(STATE_DIR, "media");

const W = 1080;
const H = 1080;
const MARGIN = 96;

// Palet Cahaya Project. Setiap palet: latar (bg1->bg2), aksen utama/sekunder,
// warna judul & subteks. Dipilih deterministik dari judul.
const PALET = [
  { nama: "hijau",   bg1: "#04261c", bg2: "#0a4a35", aksen: "#34d399", aksen2: "#a7f3d0", judul: "#ffffff", sub: "#d1fae5" },
  { nama: "biru",    bg1: "#071c2e", bg2: "#0d3f63", aksen: "#38bdf8", aksen2: "#bae6fd", judul: "#ffffff", sub: "#dbeafe" },
  { nama: "amber",   bg1: "#2a1206", bg2: "#4a2a0d", aksen: "#fbbf24", aksen2: "#fde68a", judul: "#ffffff", sub: "#fef3c7" },
  { nama: "ungu",    bg1: "#1b0f2e", bg2: "#3a1d63", aksen: "#c084fc", aksen2: "#e9d5ff", judul: "#ffffff", sub: "#f3e8ff" },
  { nama: "teal",    bg1: "#04252b", bg2: "#0a4550", aksen: "#2dd4bf", aksen2: "#99f6e4", judul: "#ffffff", sub: "#ccfbf1" },
  { nama: "merah",   bg1: "#2b0a12", bg2: "#4d1224", aksen: "#fb7185", aksen2: "#fecdd3", judul: "#ffffff", sub: "#ffe4e6" },
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

function hashPalet(seed) {
  const h = crypto.createHash("md5").update(String(seed)).digest()[0];
  return PALET[h % PALET.length];
}

// Perkirakan lebar teks (kasar) untuk auto-fit: rata-rata ~0.56 * fontSize/karakter.
function estimasiLebar(teks, fontSize) {
  return String(teks).length * fontSize * 0.56;
}

// Pilih ukuran font agar satu baris muat dalam lebar maksimum.
function ukuranPas(teks, lebarMaks, min = 34, maks = 92) {
  let u = maks;
  while (u > min && estimasiLebar(teks, u) > lebarMaks) u -= 2;
  return u;
}

// Bangun buffer PNG banner. Mengembalikan { buffer, meta }.
async function bangunBuffer({ caption, judul, badge, kategori, edisi } = {}) {
  const sharp = require("sharp");
  const judulFinal = String(judul || judulDari(caption)).trim();
  const p = hashPalet(judulFinal);

  const lebarIsi = W - MARGIN * 2;

  // --- Judul: auto-fit. Bila judul panjang, pecah 2-3 baris dengan ukuran pas. ---
  const barisJudul = bungkusTeks(judulFinal, 26).slice(0, 3);
  // ukuran font untuk tiap baris: yang terpanjang menentukan agar seragam
  let ukuran = 88;
  for (let u = 88; u >= 40; u -= 2) {
    const muat = barisJudul.every((b) => estimasiLebar(b, u) <= lebarIsi);
    if (muat) { ukuran = u; break; }
    ukuran = u;
  }
  const tinggiBaris = ukuran * 1.18;

  // Blok judul diposisikan mulai dari titik tetap, tumbuh ke bawah.
  const judulTop = 430;

  // --- Sub-caption: ambil kalimat bermakna (bukan hashtag), maks 2 baris. ---
  const kalimat = String(caption || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^#/.test(x));
  const subSumber = (kalimat[1] || kalimat[0] || "").replace(/\s+/g, " ").slice(0, 170);
  const barisSub = bungkusTeks(subSumber, 52).slice(0, 2);

  const judulSpan = barisJudul
    .map((b, i) => {
      const y = judulTop + i * tinggiBaris;
      return `<text x="${MARGIN}" y="${y}" font-family="DejaVu Sans" font-weight="bold" font-size="${ukuran}" fill="${p.judul}">${escapeXml(b)}</text>`;
    })
    .join("\n  ");

  const subTop = judulTop + barisJudul.length * tinggiBaris + 30;
  const subSpan = barisSub
    .map((b, i) => `<text x="${MARGIN}" y="${subTop + i * 46}" font-family="DejaVu Sans" font-size="34" fill="${p.sub}">${escapeXml(b)}</text>`)
    .join("\n  ");

  const kategoriTeks = escapeXml((kategori || badge || "INSIGHT HARIAN").toUpperCase());
  const edisiTeks = escapeXml(edisi || edisiHariIni());

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.bg1}"/>
      <stop offset="100%" stop-color="${p.bg2}"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.82" cy="0.16" r="0.55">
      <stop offset="0%" stop-color="${p.aksen}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${p.aksen}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.08" cy="0.94" r="0.6">
      <stop offset="0%" stop-color="${p.aksen2}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${p.aksen2}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="aksenBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${p.aksen}"/>
      <stop offset="100%" stop-color="${p.aksen2}"/>
    </linearGradient>
  </defs>

  <!-- latar -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow1)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>

  <!-- tekstur garis diagonal halus -->
  <g stroke="${p.aksen}" stroke-opacity="0.06" stroke-width="2">
    <line x1="-100" y1="240" x2="1180" y2="-340"/>
    <line x1="-100" y1="360" x2="1180" y2="-220"/>
    <line x1="-100" y1="480" x2="1180" y2="-100"/>
    <line x1="-100" y1="900" x2="1180" y2="320"/>
    <line x1="-100" y1="1020" x2="1180" y2="440"/>
  </g>

  <!-- frame tipis -->
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${p.aksen}" stroke-opacity="0.18" stroke-width="2"/>

  <!-- header brand -->
  <rect x="${MARGIN}" y="118" width="10" height="44" rx="5" fill="${p.aksen}"/>
  <text x="${MARGIN + 26}" y="150" font-family="DejaVu Sans" font-weight="bold" font-size="34" fill="${p.judul}">CAHAYA PROJECT</text>

  <!-- badge kategori -->
  <rect x="${MARGIN}" y="188" rx="18" width="${Math.min(lebarIsi, 30 + kategoriTeks.length * 20)}" height="46" fill="${p.aksen}" fill-opacity="0.16" stroke="${p.aksen}" stroke-opacity="0.55" stroke-width="2"/>
  <text x="${MARGIN + 24}" y="220" font-family="DejaVu Sans" font-weight="bold" font-size="24" letter-spacing="2" fill="${p.aksen2}">${kategoriTeks}</text>

  <!-- judul utama -->
  <text x="${MARGIN}" y="300" font-family="DejaVu Sans" font-size="22" letter-spacing="4" fill="${p.aksen}" fill-opacity="0.85">EDISI ${edisiTeks}</text>
  ${judulSpan}

  <!-- garis aksen -->
  <rect x="${MARGIN}" y="${subTop - 8}" width="140" height="6" rx="3" fill="url(#aksenBar)"/>
  ${subSpan}

  <!-- footer -->
  <line x1="${MARGIN}" y1="${H - 150}" x2="${W - MARGIN}" y2="${H - 150}" stroke="${p.aksen}" stroke-opacity="0.25" stroke-width="2"/>
  <text x="${MARGIN}" y="${H - 96}" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="${p.aksen}">#CahayaProject</text>
  <text x="${W - MARGIN}" y="${H - 96}" text-anchor="end" font-family="DejaVu Sans" font-size="24" fill="${p.sub}" fill-opacity="0.85">Transisi energi yang adil</text>
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return { buffer, meta: { judul: judulFinal, palet: p.nama, ukuran, baris: barisJudul } };
}

function edisiHariIni() {
  const WIB = 7 * 3600000;
  const d = new Date(Date.now() + WIB);
  const bln = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${bln} ${d.getUTCFullYear()}`;
}

// Generate banner, simpan ke disk, kembalikan { nama, path, buffer, meta }.
async function buatBanner({ caption, judul, badge, kategori, edisi } = {}) {
  await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  const { buffer, meta } = await bangunBuffer({ caption, judul, badge, kategori, edisi });
  const nama = `cahaya-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
  const filePath = path.join(MEDIA_DIR, nama);
  await fs.promises.writeFile(filePath, buffer);
  return { nama, path: filePath, buffer, meta };
}

module.exports = { buatBanner, bangunBuffer, MEDIA_DIR, judulDari, PALET };
