// lib/sena.js
// Pipeline "bedah carousel Instagram kompetitor" — dikerjakan oleh agent Sena.
//
// Alur:
//   1. Ambil data post dari Apify Instagram Scraper (run-sync-get-dataset-items).
//   2. Saring type == "Sidecar" (carousel). Foto tunggal & reel dibuang.
//   3. OCR tiap gambar slide pakai model vision (multimodal) lewat lib/llm.
//   4. Susun satu baris per post ke file .xlsx (cover tertanam, teks slide per kolom).
//
// Sifat WAJIB:
//   - CACHE KE DISK: hasil mentah Apify + hasil OCR disimpan; re-run tidak
//     meng-OCR ulang gambar yang sudah pernah diproses (hemat biaya).
//   - HITUNG ONGKOS DULU: sebelum OCR, laporkan jumlah post & total gambar,
//     lalu minta konfirmasi lanjut (kecuali dijalankan non-interaktif).
//   - Tahan banting 429 (retry backoff) dan gambar gagal -> "[OCR GAGAL]" (lanjut).
//   - Progress tampil saat berjalan.
//
// Dipakai oleh:
//   - skills/sena.js (skill agent, dipanggil cron 3-hari-sekali)
//   - CLI manual: node -e "require('./lib/sena').bedah({...})"

const fs = require("fs");
const path = require("path");
const os = require("os");

const DIR = path.join(__dirname, "..", ".hermes3d", "sena");
const DIR_CACHE = path.join(DIR, "cache");
const DIR_OUT = path.join(DIR, "output");

// --- util kecil -----------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pastikanDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function slugAkun(url) {
  // https://www.instagram.com/uzi.philosophy/ -> uzi.philosophy
  const m = String(url).match(/instagram\.com\/([^/?#]+)/i);
  return m ? m[1].replace(/\/$/, "") : String(url).replace(/[^a-zA-Z0-9._-]/g, "_");
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
  try {
    pastikanDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(`[sena] gagal tulis ${p}:`, e.message);
  }
}

// --- 1. Ambil data Apify (dengan cache disk) ------------------------------
async function ambilPostApify({ akun, resultsLimit, apifyToken, gunakanCache = true }) {
  const token = apifyToken || process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN kosong");
  const cacheKey = `${slugAkun(akun)}-${resultsLimit}.json`;
  const cachePath = path.join(DIR_CACHE, cacheKey);
  if (gunakanCache && fs.existsSync(cachePath)) {
    console.log(`[sena] cache Apify dipakai: ${cacheKey}`);
    return bacaJSON(cachePath, []);
  }
  const url = "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
  const body = {
    directUrls: [akun],
    resultsType: "posts",
    resultsLimit: resultsLimit,
    addParentData: false,
  };
  console.log(`[sena] memanggil Apify untuk ${akun} (limit ${resultsLimit})...`);
  const res = await fetch(`${url}?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const teks = await res.text();
  if (res.status === 402 || /usage limit/i.test(teks)) {
    throw new Error(`Apify kredit habis (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`Apify HTTP ${res.status}: ${teks.slice(0, 300)}`);
  }
  let json;
  try {
    json = JSON.parse(teks);
  } catch {
    json = [];
  }
  if (!Array.isArray(json)) json = [];
  if (gunakanCache) tulisJSON(cachePath, json);
  console.log(`[sena] ${json.length} item mentah dari Apify`);
  return json;
}

// --- 2. Saring Sidecar + ekstrak field yang dibutuhkan --------------------
function saringCarousel(items) {
  const hasil = [];
  for (const it of items || []) {
    if (String(it.type || "").toLowerCase() !== "sidecar") continue;
    // URL gambar slide: bisa di images (array) atau childPosts[].displayUrl.
    let slides = [];
    if (Array.isArray(it.images) && it.images.length) {
      slides = it.images.map((u) => String(u));
    } else if (Array.isArray(it.childPosts)) {
      slides = it.childPosts
        .map((c) => c && (c.displayUrl || c.imageDisplayUrl || c.display_url))
        .filter(Boolean)
        .map((u) => String(u));
    }
    if (!slides.length) {
      // Fallback: cover saja.
      if (it.displayUrl) slides = [String(it.displayUrl)];
    }
    hasil.push({
      shortcode: it.shortCode || it.shortcode || it.code || "",
      url: it.url || `https://www.instagram.com/p/${it.shortCode || it.shortcode || ""}/`,
      caption: it.caption || "",
      likesCount: Number(it.likesCount ?? it.likes ?? 0),
      commentsCount: Number(it.commentsCount ?? it.comments ?? 0),
      timestamp: it.timestamp || it.createdAt || "",
      coverUrl: it.displayUrl || it.coverDisplayUrl || (slides[0] || ""),
      slides,
      jumlahSlide: slides.length,
    });
  }
  // Urut dari like terbanyak (wajib).
  hasil.sort((a, b) => b.likesCount - a.likesCount);
  return hasil;
}

// --- 3. Unduh gambar (dengan cache) ---------------------------------------
// Antrean/jeda antar unduhan untuk menghindari rate-limit CDN Instagram.
let _unduhTerakhir = 0;
let _unduhDelayMs = 300;

// Beberapa post memakai CDN region jauh (mis. scontent-gru*.cdninstagram.com)
// yang timeout dari server. Fallback: ganti ke host region-agnostic yang
// redirect ke CDN terdekat.
function urlFallbackCdn(url) {
  try {
    const u = new URL(url);
    // CDN Instagram klasik: scontent-<region>.cdninstagram.com -> scontent.cdninstagram.com
    if (/^scontent(-[\w]+)*\.cdninstagram\.com$/.test(u.hostname)) {
      u.hostname = "scontent.cdninstagram.com";
      return u.toString();
    }
    // CDN Facebook: instagram.f<region>.fna.fbcdn.net -> scontent.cdninstagram.com
    // (path/object key sama, scontent region-agnostic redirect ke CDN terdekat)
    if (/^instagram\.f[\w-]+\.fna\.fbcdn\.net$/.test(u.hostname)) {
      u.hostname = "scontent.cdninstagram.com";
      return u.toString();
    }
  } catch {}
  return null;
}

async function unduhGambar(url, cachePath, { retry = 4 } = {}) {
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return fs.readFileSync(cachePath);
  }
  const BACKOFF = [1000, 2000, 4000, 8000, 16000];
  let lastErr;
  let urlAktif = url;
  for (let i = 0; i <= retry; i++) {
    // jeda agar tidak menembak CDN terlalu cepat
    const sekarang = Date.now();
    const tunggu = _unduhTerakhir + _unduhDelayMs - sekarang;
    if (tunggu > 0) await sleep(tunggu);
    _unduhTerakhir = Date.now();
    try {
      const res = await fetch(urlAktif, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) {
        if (i < retry) {
          _unduhDelayMs = Math.min(_unduhDelayMs * 2, 3000);
          await sleep(BACKOFF[Math.min(i, BACKOFF.length - 1)]);
          continue;
        }
        throw new Error(`unduh gambar HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`unduh gambar HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      pastikanDir(path.dirname(cachePath));
      fs.writeFileSync(cachePath, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      const netError = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|network/i.test(String(e.message || e));
      // Coba fallback host CDN sekali bila error jaringan / timeout.
      if (netError || (e && e.name === "TimeoutError")) {
        const fb = urlFallbackCdn(url);
        if (fb && fb !== urlAktif) {
          urlAktif = fb;
        }
      }
      if (i < retry) {
        _unduhDelayMs = Math.min(_unduhDelayMs * 2, 3000);
        await sleep(BACKOFF[Math.min(i, BACKOFF.length - 1)]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("unduh gambar gagal");
}

function cachePathGambar(akun, shortcode, idx) {
  const s = slugAkun(akun);
  return path.join(DIR_CACHE, "img", s, `${shortcode}-${idx}.jpg`);
}

// --- 4. OCR satu gambar (vision) ------------------------------------------
const PROMPT_OCR =
  "Baca semua teks yang ada di gambar ini. Balikin APA ADANYA:\n" +
  "- Urut dari atas ke bawah\n" +
  "- Pertahankan baris baru dan baris kosong antar paragraf\n" +
  "- Ikutkan juga handle/username, watermark, dan penomoran slide kalau ada\n" +
  "- JANGAN diterjemahin, JANGAN dirangkum, JANGAN dirapihin bahasanya\n" +
  "- Kalau gambarnya nggak ada teks sama sekali, balikin string kosong";

async function ocrGambar({ imageBase64, model, baseUrl, key, maxTokens = 1500 }) {
  const m = model || process.env.SENA_VISION_MODEL || process.env.VISION_MODEL || "cbcn/glm-5v-turbo";
  const b = baseUrl || process.env.SENA_VISION_BASE_URL || process.env.LLM_BASE_URL;
  const k = key || process.env.SENA_VISION_API_KEY || process.env.LLM_API_KEY;
  if (!b || !k) throw new Error("vision base/key kosong");
  const body = {
    model: m,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBase64 } },
          { type: "text", text: PROMPT_OCR },
        ],
      },
    ],
    max_tokens: maxTokens,
  };
  // Retry 429 / 5xx dengan backoff (tahan banting rate limit).
  const BACKOFF = [2000, 4000, 8000, 16000, 32000];
  let lastErr;
  for (let i = 0; i <= BACKOFF.length; i++) {
    let res;
    try {
      res = await fetch(`${b.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      if (i < BACKOFF.length) {
        console.warn(`  [sena] vision network error, retry ${BACKOFF[i]}ms`);
        await sleep(BACKOFF[i]);
        continue;
      }
      throw e;
    }
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      if (i < BACKOFF.length) {
        console.warn(`  [sena] vision HTTP ${res.status}, retry ${BACKOFF[i]}ms`);
        await sleep(BACKOFF[i]);
        continue;
      }
      const t = await res.text().catch(() => "");
      throw new Error(`vision HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`vision HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
  throw lastErr || new Error("vision gagal tanpa sebab");
}

function dataUrlBase64(mime, buf) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Deteksi mime dari magic bytes (jpeg / png / webp / heic).
function deteksiMime(buf) {
  if (!buf || buf.length < 12) return "image/jpeg";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // RIFF....WEBP
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  // isobmff (heic/heif)
  if (buf.slice(4, 8).toString() === "ftyp") return "image/heic";
  return "image/jpeg";
}

// --- 5. Bedah lengkap -----------------------------------------------------
async function bedah({
  akun,
  resultsLimit = 15,
  apifyToken,
  gunakanCache = true,
  interaktif = false,
  ocr = true,
  lanjutOtomatis = false,
  onKonfirmasi = null,
} = {}) {
  pastikanDir(DIR_CACHE);
  pastikanDir(DIR_OUT);
  const s = slugAkun(akun);

  // Cache metadata OCR per post.
  const metaCachePath = path.join(DIR_CACHE, `ocr-${s}-${resultsLimit}.json`);
  const metaCache = gunakanCache ? bacaJSON(metaCachePath, {}) : {};

  // 1. Apify
  const items = await ambilPostApify({ akun, resultsLimit, apifyToken, gunakanCache });

  // 2. Saring Sidecar
  const posts = saringCarousel(items);
  console.log(`[sena] ${akun}: ${posts.length} carousel tersaring dari ${items.length} item`);

  // 3. Hitung ongkos & konfirmasi
  let totalGambar = 0;
  let totalGambarBaru = 0;
  for (const p of posts) {
    totalGambar += p.slides.length;
    for (let i = 0; i < p.slides.length; i++) {
      const key = `${p.shortcode}-${i}`;
      if (!metaCache[key]) totalGambarBaru += 1;
    }
  }
  console.log(`[sena] ongkos OCR: ${posts.length} post, ${totalGambar} total gambar (${totalGambarBaru} belum di-OCR)`);

  if (ocr && !lanjutOtomatis) {
    if (onKonfirmasi) {
      const lanjut = await onKonfirmasi({ posts: posts.length, totalGambar, totalGambarBaru });
      if (!lanjut) {
        console.log("[sena] dibatalkan oleh konfirmasi.");
        return { dibatalkan: true, posts: posts.length, totalGambar };
      }
    } else if (interaktif) {
      // mode tanya interaktif via readline
      const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
      const jawab = await new Promise((resolve) =>
        rl.question(`Lanjut OCR ${totalGambarBaru} gambar? (y/n): `, (a) => resolve(a.trim().toLowerCase()))
      );
      rl.close();
      if (jawab !== "y" && jawab !== "yes") {
        console.log("[sena] dibatalkan.");
        return { dibatalkan: true, posts: posts.length, totalGambar };
      }
    }
  }

  // 4. OCR tiap slide (dengan cache)
  const hasil = [];
  for (let pi = 0; pi < posts.length; pi++) {
    const p = posts[pi];
    console.log(`[sena] post ${pi + 1}/${posts.length}: ${p.shortcode} (${p.jumlahSlide} slide, ${p.likesCount} like)`);
    const slideTeks = [];
    for (let si = 0; si < p.slides.length; si++) {
      const key = `${p.shortcode}-${si}`;
      let teks;
      if (ocr && metaCache[key]) {
        teks = metaCache[key];
      } else if (ocr) {
        const imgPath = cachePathGambar(akun, p.shortcode, si);
        try {
          const buf = await unduhGambar(p.slides[si], imgPath);
          console.log(`  slide ${si + 1}/${p.slides.length}: OCR...`);
          teks = await ocrGambar({ imageBase64: dataUrlBase64(deteksiMime(buf), buf) });
          metaCache[key] = teks;
          tulisJSON(metaCachePath, metaCache);
        } catch (e) {
          console.warn(`  slide ${si + 1}: GAGAL (${e.message})`);
          teks = "[OCR GAGAL]";
        }
      } else {
        teks = "";
      }
      slideTeks.push(teks);
    }
    hasil.push({ ...p, slideTeks });
  }

  // 5. Simpan ringkasan hasil (metadata) untuk pembuatan xlsx
  const ringkasanPath = path.join(DIR_OUT, `ringkasan-${s}-${resultsLimit}.json`);
  tulisJSON(ringkasanPath, { akun, posts: hasil, jumlah: hasil.length, dibuatPada: new Date().toISOString() });

  return { akun, posts: hasil, jumlah: hasil.length, totalGambar, totalGambarBaru, ringkasanPath, metaCachePath };
}

module.exports = {
  bedah,
  saringCarousel,
  ambilPostApify,
  ocrGambar,
  unduhGambar,
  PROMPT_OCR,
  DIR,
  DIR_CACHE,
  DIR_OUT,
  slugAkun,
  cachePathGambar,
};
