// lib/sena-clone.js
// Pipeline "clone carousel" — mengubah carousel kompetitor (hasil bedah xlsx)
// menjadi carousel versi brand kita. Dikerjakan oleh agent Sena.
//
// Alur:
//   1. Baca file .xlsx hasil bedah carousel (satu baris = satu carousel).
//   2. Pilih baris: nomor tertentu ATAU "N teratas" berdasarkan Jumlah Like.
//   3. Kirim slide kompetitor + identitas brand ke LLM (kerangka diambil, bukan jiplakan).
//   4. Validasi JSON + max 45 kata/slide + cek jiplakan (anti-copy).
//   5. Simpan .json (mentah) + .txt (enak dibaca, nomor "1 / N").
//
// Sifat WAJIB:
//   - CACHE DISK: carousel yang sudah di-clone tidak diproses ulang (kecuali --ulang).
//   - Validasi ketat: JSON valid, tiap slide <= 45 kata, kalau lewat minta ulang (max 2x).
//   - Cek jiplakan: kalimat sama persis dengan teks kompetitor -> TOLAK & minta ulang.
//   - .env untuk API key (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL).
//
// Dipakai oleh:
//   - CLI manual: node sena-clone-cli.js [--top N | --row N] [--ulang]

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { chatJSON } = require("./llm");

const DIR = path.join(__dirname, "..", ".hermes3d", "sena");
const DIR_CLONE = path.join(DIR, "clone");
const DIR_OUT = path.join(DIR_CLONE, "output");
const DIR_CACHE = path.join(DIR_CLONE, "cache");

// ==================== IDENTITAS BRAND (ganti di sini) =======================
const BRAND = {
  brand: "HANDLE_LO",
  kategori: "KATEGORI",
  niche: "NICHE_LO",
  audiens: "SIAPA_AUDIENS",
  gaya: "GAYA_NGOMONG",
  jualan: "YANG_GW_JUAL",
};
// ============================================================================

const MAX_KATA_PER_SLIDE = 45;
const MAX_MINTAL_ULANG = 2;

// --- util -------------------------------------------------------------
function pastikanDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function bacaJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function tulisJSON(p, data) {
  pastikanDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function hitungKata(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

// Normalisasi teks agar perbandingan jiplakan tidak sensitif spasi/huruf besar.
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// --- 1. Baca xlsx -> daftar post (baris) ---------------------------------
async function bacaXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const posts = [];
  // baris 1 = header; data mulai baris 2.
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const v = row.values; // v[0] undefined, v[1] = No, dst.
    const slideTeks = [];
    // Kolom Slide 1..17 = index 9..25.
    for (let i = 0; i < 17; i++) {
      const val = v[9 + i];
      if (val && String(val).trim()) slideTeks.push(String(val));
    }
    posts.push({
      no: v[1],
      shortcode: String(v[7] || ""),
      url: String(v[8] || ""),
      likesCount: Number(v[3] || 0),
      commentsCount: Number(v[4] || 0),
      jumlahSlide: Number(v[6] || 0),
      caption: String(v[26] || ""),
      slideTeks,
    });
  });
  return posts;
}

// --- 2. Pilih baris yang mau di-clone -------------------------------------
// mode: { jenis: "row", no: N } | { jenis: "top", N: k } | default top 1.
function pilihPost(posts, { jenis = "top", nilai = 1 } = {}) {
  const urutLike = [...posts].sort((a, b) => b.likesCount - a.likesCount);
  if (jenis === "row") {
    const target = urutLike.find((p) => String(p.no) === String(nilai));
    if (!target) throw new Error(`baris nomor ${nilai} tidak ditemukan (no valid: ${urutLike.map((p) => p.no).join(", ")})`);
    return [target];
  }
  // top N
  return urutLike.slice(0, Math.max(1, Number(nilai) || 1));
}

// --- 3. Susun prompt ------------------------------------------------------
function susunPrompt(post) {
  const slideKompetitor = post.slideTeks
    .map((t, i) => `Slide ${i + 1}:\n${t}`)
    .join("\n\n");
  return (
    `Lo copywriter carousel buat brand: ${BRAND.brand}, kategori: ${BRAND.kategori}.\n` +
    `Niche: ${BRAND.niche}. Audiens: ${BRAND.audiens}. Gaya ngomong: ${BRAND.gaya}.\n` +
    `Yang dijual: ${BRAND.jualan}.\n` +
    `\n` +
    `Di bawah ini satu carousel kompetitor yang perform, dibedah per slide:\n` +
    `${slideKompetitor}\n` +
    `\n` +
    `TUGAS - bukan nyalin, yang diambil KERANGKANYA.\n` +
    `Langkah 1: petakan dulu tiap slide di atas perannya apa. Contoh peran: hook+janji / sinyal-1 / sinyal-2 / bantahan keberatan / penutup bikin share.\n` +
    `Langkah 2: isi kerangka itu pakai materi dari niche gw.\n` +
    `\n` +
    `BENTUK TIAP SLIDE - nanti dicetak di template dengan susunan:\n` +
    `  {brand}\n` +
    `  {kategori}\n` +
    `       /\n` +
    `Jadi lo cuma nulis bagian "isi slide". Handle, kategori, tanggal, dan nomor\n` +
    `diisi otomatis - jangan ditulis ulang di dalam teksnya.\n` +
    `PENTING: JANGAN tulis nama brand/handle, kategori, nomor slide, atau tanggal\n` +
    `di dalam "isi". Bagian "isi" harus MULAI langsung ke kalimat/konten slide.\n` +
    `\n` +
    `Contoh isi slide yang bentuknya udah bener:\n` +
    `  Slide 1:\n` +
    `  "Shopee diam-diam ngukur seberapa tajir lo, terus naikin harganya.\n` +
    `   Barang sama, harga beda tiap orang. Bukan bug, itu strategi.\n` +
    `   Yang 'keliatan butuh' dikasih harga paling mahal.\n` +
    `   Gini caranya biar dianggap miskin sama algoritma:"\n` +
    `  Slide 2:\n` +
    `  "Sinyal 1 - HP mahal = harga mahal\n` +
    `   iPhone atau HP flagship dibaca dompet tebel.\n` +
    `   Cek harga barang sama di browser desktop mode guest.\n` +
    `   Bedanya bisa ratusan ribu buat satu barang."\n` +
    `\n` +
    `Polanya: slide 1 = klaim bikin kaget + janji. Slide berikutnya = nama sinyal,\n` +
    `kenapa itu kejadian, terus AKSI konkret. Tiap slide harus bisa berdiri sendiri\n` +
    `kalau di-screenshot orang.\n` +
    `\n` +
    `ATURAN KERAS:\n` +
    `1. DILARANG nyalin kalimat kompetitor. Yang ditiru urutan PERAN-nya doang.\n` +
    `2. Slide yang isinya terlalu nempel ke dia (nyebut app atau angka yang nggak\n` +
    `   nyambung), ganti materinya. Jangan dipaksain.\n` +
    `3. Jangan ngarang angka atau klaim soal produk gw. Butuh data yang belum ada?\n` +
    `   Tulis [ISI SENDIRI].\n` +
    `4. Tiap slide MAKSIMAL 45 kata. Lebih dari itu nggak muat di gambar.\n` +
    `5. Jumlah slide boleh beda dari aslinya kalau materinya emang segitu.\n` +
    `\n` +
    `Balikin HANYA JSON valid:\n` +
    `{\n` +
    `  "kerangka_asli": ["peran slide 1", "peran slide 2", "..."],\n` +
    `  "slides": [{ "no": 1, "peran": "hook + janji", "isi": "teks slide" }],\n` +
    `  "caption": "3-6 kalimat buat caption IG",\n` +
    `  "cta": "1 kalimat ajakan, halus",\n` +
    `  "hashtags": ["5-8 hashtag"],\n` +
    `  "niru_dari": "${post.url || ""}",\n` +
    `  "kenapa_ini_jalan": "1-2 kalimat: kenapa urutan peran itu bikin orang save"\n` +
    `}`
  );
}

// --- 4. Validasi hasil ----------------------------------------------------
// Cek kalimat hasil yang identik (persis) dengan teks kompetitor.
function cekJiplak(hasil, post) {
  const sumber = post.slideTeks.map((t) => norm(t)).filter(Boolean).join("\n");
  const kalimatSumber = sumber
    .split(/[.!?\n]+/)
    .map((s) => norm(s))
    .filter((s) => s.length > 12); // kalimat pendek (kata sambung) diabaikan

  const pelanggaran = [];
  for (const slide of hasil.slides || []) {
    const kalimatHasil = String(slide.isi || "")
      .split(/[.!?\n]+/)
      .map((s) => norm(s))
      .filter((s) => s.length > 12);
    for (const k of kalimatHasil) {
      if (kalimatSumber.includes(k)) {
        pelanggaran.push({ slide: slide.no, kalimat: k });
      }
    }
  }
  return pelanggaran;
}

function validasiHasil(hasil, post) {
  const err = [];
  if (!hasil || typeof hasil !== "object") return ["hasil bukan objek"];
  if (!Array.isArray(hasil.slides) || !hasil.slides.length) err.push("slides kosong/bukan array");

  // tiap slide <= 45 kata
  for (const s of hasil.slides || []) {
    const n = hitungKata(s.isi);
    if (n > MAX_KATA_PER_SLIDE) {
      err.push(`slide ${s.no} = ${n} kata (maks ${MAX_KATA_PER_SLIDE})`);
    }
    // tolak isi yang masih memuat header brand/kategori/nomor (diisi otomatis template)
    const isi = String(s.isi || "");
    if (/^HANDLE_LO\b|^KATEGORI\b/i.test(isi.trim())) {
      err.push(`slide ${s.no} masih memuat header brand/kategori (${isi.slice(0, 30)}...)`);
    }
    if (/^\d+\s*\/\s*\d+/.test(isi.trim())) {
      err.push(`slide ${s.no} diawali nomor slide (nomor diisi otomatis template)`);
    }
  }
  // cek jiplakan
  const jp = cekJiplak(hasil, post);
  if (jp.length) {
    err.push(`JIPLAK terdeteksi: ${jp.map((j) => `slide ${j.slide} "${j.kalimat}"`).join("; ")}`);
  }
  return err;
}

// --- 5. Panggil LLM (dengan minta ulang bila tidak lolos validasi) --------
async function cloneSekali(post) {
  const messages = [
    { role: "user", content: susunPrompt(post) },
  ];
  const data = await chatJSON({ agent: "sena", skill: "riset", messages, maxTokens: 4096, noReasoning: false });
  return data;
}

async function cloneDenganValidasi(post) {
  let lastErr = [];
  for (let percobaan = 0; percobaan <= MAX_MINTAL_ULANG; percobaan++) {
    let hasil;
    try {
      hasil = await cloneSekali(post);
    } catch (e) {
      // JSON gagal parse -> ulang
      lastErr = [e.message];
      if (percobaan >= MAX_MINTAL_ULANG) throw new Error(`gagal dapat JSON valid setelah ${MAX_MINTAL_ULANG + 1}x: ${e.message}`);
      continue;
    }
    const err = validasiHasil(hasil, post);
    if (!err.length) return hasil;
    lastErr = err;
    if (percobaan >= MAX_MINTAL_ULANG) break;
    console.warn(`[clone] validasi gagal (${err.join(" | ")}), minta ulang...`);
  }
  throw new Error(`validasi tetap gagal setelah ${MAX_MINTAL_ULANG + 1}x: ${lastErr.join(" | ")}`);
}

// --- 6. Output .txt (enak dibaca) ----------------------------------------
function susunTxt(hasil, post) {
  const n = hasil.slides.length;
  const baris = [];
  baris.push(`${BRAND.brand} — ${BRAND.kategori}`);
  baris.push(`Clone dari: ${post.url}`);
  baris.push(`Kerangka asli: ${(hasil.kerangka_asli || []).join(" -> ")}`);
  baris.push("=".repeat(60));
  for (const s of hasil.slides) {
    baris.push(`\n${s.no} / ${n}`);
    baris.push(String(s.isi || ""));
    baris.push("-".repeat(40));
  }
  baris.push(`\nCAPTION:\n${hasil.caption || ""}`);
  baris.push(`\nCTA: ${hasil.cta || ""}`);
  baris.push(`\nHASHTAGS: ${(hasil.hashtags || []).join(" ")}`);
  baris.push(`\nKenapa ini jalan: ${hasil.kenapa_ini_jalan || ""}`);
  return baris.join("\n");
}

// --- 7. Orkestrator -------------------------------------------------------
async function cloneCarousel({ fileXlsx, jenis = "top", nilai = 1, ulang = false } = {}) {
  pastikanDir(DIR_OUT);
  pastikanDir(DIR_CACHE);

  if (!fileXlsx || !fs.existsSync(fileXlsx)) {
    throw new Error(`file xlsx tidak ditemukan: ${fileXlsx || "(tidak diberi)"}`);
  }

  const posts = await bacaXlsx(fileXlsx);
  const target = pilihPost(posts, { jenis, nilai });
  console.log(`[clone] ${posts.length} baris dibaca, clone ${target.length} baris (${jenis} ${nilai})`);

  const hasilSemua = [];
  for (const post of target) {
    const key = `${post.shortcode || post.no}`;
    const cachePath = path.join(DIR_CACHE, `${key}.json`);
    const txtPath = path.join(DIR_OUT, `${key}.txt`);
    const jsonPath = path.join(DIR_OUT, `${key}.json`);

    let hasil;
    if (!ulang && fs.existsSync(cachePath)) {
      hasil = bacaJSON(cachePath, null);
      console.log(`[clone] cache dipakai: ${key}`);
    }

    if (!hasil) {
      console.log(`[clone] memproses ${key} (${post.jumlahSlide} slide, ${post.likesCount} like)...`);
      hasil = await cloneDenganValidasi(post);
      // catat metadata tambahan
      hasil._meta = { shortcode: post.shortcode, url: post.url, likesCount: post.likesCount, clonedAt: new Date().toISOString() };
      tulisJSON(cachePath, hasil);
    }

    // tulis output json + txt (selalu tulis ulang, murah)
    tulisJSON(jsonPath, hasil);
    const txt = susunTxt(hasil, post);
    fs.writeFileSync(txtPath, txt, "utf8");

    hasilSemua.push({ post, hasil, jsonPath, txtPath });
  }

  return { jumlah: hasilSemua.length, hasil: hasilSemua, dirOut: DIR_OUT };
}

module.exports = {
  cloneCarousel,
  bacaXlsx,
  pilihPost,
  susunPrompt,
  validasiHasil,
  cekJiplak,
  hitungKata,
  BRAND,
  MAX_KATA_PER_SLIDE,
  DIR_CLONE,
  DIR_OUT,
};
