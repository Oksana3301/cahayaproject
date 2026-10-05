const db = require("../lib/db");
const { chatJSON } = require("../lib/llm");
const { doea } = require("../lib/doea");
const { jalankanActor } = require("../lib/apify");

const AKUN_ID = process.env.DOEA_ACCOUNT_ID || "6abfbca762caae1e045b0392";
const REFERENSI_IG = ["projectm_org", "gnfi", "intersectionalenvironmentalist"];
const REFERENSI_TT = ["jerhemynemoo", "earthtopia"];

const FEED_RSS = [
  { nama: "Carbon Brief", url: "https://www.carbonbrief.org/feed/" },
  { nama: "Mongabay Indonesia", url: "https://www.mongabay.co.id/feed/" },
  { nama: "Mongabay Global", url: "https://news.mongabay.com/feed/" },
  { nama: "BBC Science & Environment", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" },
  { nama: "The Guardian Environment", url: "https://www.theguardian.com/environment/rss" },
];

function normalkanTanggal(nilai) {
  if (!nilai) return null;
  if (nilai instanceof Date) {
    return isNaN(nilai.getTime()) ? null : nilai.toISOString();
  }
  const s = String(nilai).trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    const d2 = new Date(s.replace(/^[A-Za-z]{3},\s*/, ""));
    if (isNaN(d2.getTime())) return null;
    return d2.toISOString();
  }
  return d.toISOString();
}

function normalkan(item) {
  return {
    sumber: item.sumber || null,
    penulis: item.penulis || null,
    teks: item.teks || null,
    url: item.url || null,
    suka: item.suka === undefined ? null : item.suka,
    komentar: item.komentar === undefined ? null : item.komentar,
    tanggal: normalkanTanggal(item.tanggal),
  };
}

// ---------- (a) Threads via Doea ----------
async function risetThreads({ keyword, sort, limit }) {
  const hasil = [];
  let nextToken = null;
  let sisa = limit || 25;
  let halaman = 0;
  const maxHalaman = 5;
  while (sisa > 0 && halaman < maxHalaman) {
    const query = {
      accountId: AKUN_ID,
      search: keyword,
      sort: sort || "TOP",
      mode: "KEYWORD",
      type: "TEXT",
    };
    if (nextToken) query.nextToken = nextToken;
    const res = await doea("GET", "/research/threads", { query });
    const docs = (res && res.docs) || [];
    if (!docs.length) break;
    for (const d of docs) {
      if (sisa <= 0) break;
      hasil.push(normalkan({
        sumber: "threads",
        penulis: d.author && (d.author.username || d.author.name) || null,
        teks: d.text || d.caption || null,
        url: d.url || d.permalink || null,
        suka: d.likeCount !== undefined ? d.likeCount : (d.likes !== undefined ? d.likes : null),
        komentar: d.replyCount !== undefined ? d.replyCount : (d.replies !== undefined ? d.replies : null),
        tanggal: d.createdAt || d.timestamp || null,
      }));
      sisa--;
    }
    nextToken = res && res.nextToken ? res.nextToken : null;
    if (!nextToken) break;
    halaman++;
  }
  return { sumber: "threads", items: hasil, error: null };
}

// ---------- (b) Apify (Instagram + TikTok) ----------
async function risetApify({ keyword, maxItems, referensi }) {
  const refIg = referensi && referensi.instagram ? referensi.instagram : REFERENSI_IG;
  const refTt = referensi && referensi.tiktok ? referensi.tiktok : REFERENSI_TT;
  const hasil = [];
  const errors = [];
  const perSumber = Math.max(2, Math.ceil((maxItems || 25) / Math.max(1, refIg.length + refTt.length)));

  async function ambilIg(username) {
    const items = await jalankanActor("apify~instagram-post-scraper", {
      username: [username],
      resultsLimit: perSumber,
    }, perSumber);
    for (const p of items) {
      hasil.push(normalkan({
        sumber: "instagram",
        penulis: username,
        teks: p.caption || p.text || null,
        url: p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}` : null),
        suka: p.likesCount !== undefined ? p.likesCount : (p.likes !== undefined ? p.likes : null),
        komentar: p.commentsCount !== undefined ? p.commentsCount : (p.comments !== undefined ? p.comments : null),
        tanggal: p.timestamp || p.takenAt || null,
      }));
    }
  }

  async function ambilTt(username) {
    const items = await jalankanActor("clockworks~tiktok-scraper", {
      profiles: [username],
      resultsPerPage: perSumber,
    }, perSumber);
    for (const p of items) {
      hasil.push(normalkan({
        sumber: "tiktok",
        penulis: username,
        teks: p.text || p.caption || null,
        url: p.webVideoUrl || p.url || null,
        suka: p.diggCount !== undefined ? p.diggCount : (p.likes !== undefined ? p.likes : null),
        komentar: p.commentCount !== undefined ? p.commentCount : (p.comments !== undefined ? p.comments : null),
        tanggal: p.createTime || p.createdAt || null,
      }));
    }
  }

  for (const u of refIg) {
    try {
      await ambilIg(u);
    } catch (e) {
      errors.push(`instagram@${u}: ${e.message}`);
    }
  }
  for (const u of refTt) {
    try {
      await ambilTt(u);
    } catch (e) {
      errors.push(`tiktok@${u}: ${e.message}`);
    }
  }
  const dipotong = hasil.slice(0, maxItems || 25);
  return { sumber: "apify", items: dipotong, error: errors.length ? errors.join("; ") : null };
}

// ---------- (c) RSS ----------
function parseRSS(xml, namaSumber) {
  const items = [];
  const reItem = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reItem.exec(xml)) !== null) {
    const blok = m[1];
    const judul = (blok.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1];
    const link = (blok.match(/<link>([\s\S]*?)<\/link>/i) || [])[1];
    const tanggal = (blok.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
    items.push(normalkan({
      sumber: "rss:" + namaSumber,
      penulis: namaSumber,
      teks: judul ? judul.trim() : null,
      url: link ? link.trim() : null,
      suka: null,
      komentar: null,
      tanggal: tanggal ? tanggal.trim() : null,
    }));
  }
  return items;
}

async function risetRSS() {
  const errors = [];
  const hasilSemua = await Promise.allSettled(
    FEED_RSS.map(async (feed) => {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        throw new Error(`${feed.nama}: HTTP ${res.status}`);
      }
      const xml = await res.text();
      return parseRSS(xml, feed.nama).slice(0, 5);
    })
  );
  const hasil = [];
  for (const r of hasilSemua) {
    if (r.status === "fulfilled") hasil.push(...r.value);
    else errors.push(r.reason && r.reason.message ? r.reason.message : String(r.reason));
  }
  return { sumber: "rss", items: hasil, error: errors.length ? errors.join("; ") : null };
}

// ---------- simpan ke DB ----------
async function simpanHasil(keyword, items) {
  const rows = items.map((it) => [
    keyword, it.sumber, it.penulis, it.teks, it.url, it.suka, it.komentar, it.tanggal,
  ]);
  if (!rows.length) return 0;
  let values = [];
  let placeholders = [];
  let i = 1;
  for (const r of rows) {
    placeholders.push(`($${i},$${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$${i + 7})`);
    values.push(...r);
    i += 8;
  }
  await db.query(
    `INSERT INTO riset_hasil (keyword, sumber, penulis, teks, url, suka, komentar, tanggal)
     VALUES ${placeholders.join(",")}`,
    values
  );
  return rows.length;
}

// ---------- rangkum jadi 3 sudut ----------
async function rangkumSudut(keyword, items) {
  const contoh = items.slice(0, 10).map((it, idx) => {
    const teks = (it.teks || "").slice(0, 200);
    return `[${idx + 1}] sumber: ${it.sumber} | penulis: ${it.penulis || "-"} | url: ${it.url || "-"}\n${teks}`;
  });

  const system =
    "Kamu adalah analis riset konten untuk Cahaya Project, media yang membahas sustainability, " +
    "green transition, policy, risk, human behavior, future trends, dan solutions & innovation " +
    "dengan nada santai, cerdas, hangat, kritis, dan solutif. " +
    "Tugasmu: membaca hasil riset dan menemukan TEPAT TIGA sudut pandang konten yang layak dibuat. " +
    "Setiap sudut harus berbeda: bisa satu yang timely/news, satu yang insight/educational, satu yang engagement/community. " +
    "Alasan harus menjelaskan kenapa sudut ini menarik untuk audiens usia 22-38 tahun di kota besar Indonesia. " +
    "Bukti harus berupa url dari hasil riset yang mendukung sudut tersebut.";

  const user =
    `Kata kunci riset: "${keyword}"\n\n` +
    `Berikut ${contoh.length} contoh hasil riset:\n\n` +
    contoh.join("\n\n") +
    `\n\nKembalikan JSON dengan bentuk persis:\n` +
    `{"sudut": [{"judul": "...", "alasan": "...", "bukti": ["url1","url2"]}, ...]}\n` +
    `Tepat tiga sudut. Jangan lebih, jangan kurang.`;

  const json = await chatJSON({
    agent: "aruna",
    skill: "riset",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 4096,
  });

  const sudut = (json && json.sudut) || [];
  const r = await db.query(
    `INSERT INTO riset_ringkasan (keyword, sudut) VALUES ($1, $2) RETURNING id`,
    [keyword, JSON.stringify(sudut)]
  );
  return { ringkasanId: r.rows[0].id, sudut };
}

// ---------- orkestrasi ----------
async function jalankanRiset({ keyword, sort, limit, maxItems, referensi, simpan }) {
  const l = limit || maxItems || 25;
  const laporan = { keyword, sumber: {}, total: 0, sudut: [], ringkasanId: null, errors: [] };

  const sumberBerjalan = [];
  const sumberMati = [];

  // Threads (Doea)
  try {
    const t = await risetThreads({ keyword, sort, limit: l });
    laporan.sumber.threads = t.items.length;
    laporan.errors.push(...(t.error ? [t.error] : []));
    sumberBerjalan.push(...t.items);
  } catch (e) {
    laporan.sumber.threads = 0;
    laporan.errors.push("threads: " + e.message);
    sumberMati.push("threads");
  }

  // Apify
  try {
    const a = await risetApify({ keyword, maxItems: l, referensi });
    laporan.sumber.apify = a.items.length;
    if (a.error) laporan.errors.push(a.error);
    sumberBerjalan.push(...a.items);
  } catch (e) {
    laporan.sumber.apify = 0;
    laporan.errors.push("apify: " + e.message);
    sumberMati.push("apify");
  }

  // RSS
  try {
    const r = await risetRSS();
    laporan.sumber.rss = r.items.length;
    if (r.error) laporan.errors.push(r.error);
    sumberBerjalan.push(...r.items);
  } catch (e) {
    laporan.sumber.rss = 0;
    laporan.errors.push("rss: " + e.message);
    sumberMati.push("rss");
  }

  if (sumberBerjalan.length === 0 && sumberMati.length >= 3) {
    throw new Error(`semua sumber riset gagal: ${laporan.errors.join("; ")}`);
  }

  laporan.total = sumberBerjalan.length;
  if (simpan !== false) {
    await simpanHasil(keyword, sumberBerjalan);
  }
  laporan.itemPertama = sumberBerjalan.slice(0, 3);
  return { laporan, items: sumberBerjalan };
}

module.exports = {
  risetThreads,
  risetApify,
  risetRSS,
  jalankanRiset,
  simpanHasil,
  rangkumSudut,
  normalkan,
  FEED_RSS,
};
