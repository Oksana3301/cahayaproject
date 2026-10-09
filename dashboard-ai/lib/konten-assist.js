// lib/konten-assist.js
// Asisten ide konten MANUAL — Cahaya Project.
//
// Flow baru (per 2026-10-09): posting dilakukan MANUAL oleh Owner. Gambar
// disediakan sendiri oleh Owner. Sistem/AI hanya menyediakan assist:
//   1. Ide + kerangka posting
//   2. Jumlah carousel (berapa slide + isi tiap slide)
//   3. Ide caption
//   4. Hashtag
//   5. Analisa gabungan "kenapa ini layak jadi konten" (sudut pandang semua agent)
//
// Dipanggil dari perintah WhatsApp `/konten <topik>` (lihat server.js).
// Hasil dikirim ke WhatsApp Owner via WAHA.

const { chatJSON } = require("./llm");
const { bolehPakaiSkill, cekJatah } = require("../agents/wewenang");
const roster = require("../agents/roster");

const AGENT = "kirana"; // orchestrator, punya skill publish + riset
const SKILL = "publish";

const KATA_TERLARANG = ["save the planet", "kamu harus", "100% sustainable", "ramah lingkungan"];
const PANTANGAN = [
  "Tidak membuat klaim medis/kesehatan sebagai diagnosis/pengobatan.",
  "Tidak menjanjikan penghasilan, keuntungan, atau hasil finansial tertentu.",
  "Tidak menjamin hasil instan dari webinar/course/produk/program.",
  "Tidak membuat klaim sustainability absolut tanpa bukti.",
  "Tidak menyajikan opini/prediksi/rumor sebagai fakta.",
  "Tidak menuduh individu/perusahaan/organisasi tanpa bukti.",
  "Tidak membuat promosi menyesatkan (fake scarcity, harga palsu, testimoni rekaan).",
  "Tidak menyebarkan data pribadi tanpa izin.",
  "Tidak menyalin karya pihak lain tanpa izin/atribusi.",
];

function cekKataTerlarang(teks) {
  const lower = String(teks || "").toLowerCase();
  for (const k of KATA_TERLARANG) if (lower.includes(k.toLowerCase())) return k;
  return null;
}

// ---------------------------------------------------------------------------
// 1. Ide + kerangka + carousel + caption + hashtag
// ---------------------------------------------------------------------------
async function buatKerangka(topik) {
  const system =
    "Kamu adalah Kirana, Editor-in-Chief Cahaya Project. " +
    "Cahaya Project membahas sustainability, green transition, policy, risk, human behavior, " +
    "future trends, dan solutions & innovation untuk audiens 22-38 tahun kota besar Indonesia. " +
    "Nada: santai, cerdas, hangat, kritis, solutif — seperti teman pintar, bukan menggurui. " +
    "Posting dilakukan MANUAL oleh Owner (gambar disediakan Owner sendiri), jadi kamu fokus " +
    "memberi ide konten, struktur carousel, caption, dan hashtag.\n\n" +
    "KATA TERLARANG: " + KATA_TERLARANG.join(", ") + "\n\n" +
    "PANTANGAN:\n- " + PANTANGAN.join("\n- ");

  const user =
    `Buat ide konten Instagram dari topik berikut:\n${topik}\n\n` +
    `Kembalikan JSON persis dengan struktur ini:\n` +
    `{\n` +
    `  "judul": "judul utama posting",\n` +
    `  "ide": "1 kalimat inti konsep konten (angle/pesan utama)",\n` +
    `  "kerangka": ["poin 1", "poin 2", "poin 3"],\n` +
    `  "carousel": {\n` +
    `    "jumlah": <angka 1-10>,\n` +
    `    "alasan": "kenapa jumlah slide ini paling pas",\n` +
    `    "slide": [\n` +
    `      {"no": 1, "jenis": "cover|isi|cta", "isi": "teks/gambaran slide ini"},\n` +
    `      ...\n` +
    `    ]\n` +
    `  },\n` +
    `  "caption": "caption lengkap (500-1000 karakter, hook -> konteks -> why it matters -> CTA/pertanyaan)",\n` +
    `  "hashtag": ["#CahayaProject", "..."]\n` +
    `}`;

  const json = await chatJSON({ agent: AGENT, skill: SKILL, messages: [{ role: "system", content: system }, { role: "user", content: user }], maxTokens: 6000 });

  // pastikan hashtag selalu ada #CahayaProject
  let tagar = Array.isArray(json.hashtag) ? json.hashtag : [];
  if (!tagar.map((t) => t.toLowerCase()).includes("#cahayaproject")) tagar = ["#CahayaProject", ...tagar];
  json.hashtag = tagar.slice(0, 8);

  return json;
}

// ---------------------------------------------------------------------------
// 2. Analisa gabungan: kenapa ini layak jadi konten (sudut pandang semua agent)
// ---------------------------------------------------------------------------
async function buatAnalisa(topik, kerangka) {
  const daftarAgent = roster.semua()
    .filter((a) => a.kode !== "humas") // humas fokus outreach, bukan konten
    .map((a) => `- ${a.nama} (${a.jabatan}): ${a.persona ? a.persona.slice(0, 120) : ""}`)
    .join("\n");

  const system =
    "Kamu adalah Kirana, Editor-in-Chief Cahaya Project. Tugasmu memberi ANALISA GABUNGAN " +
    "mengapa sebuah ide konten layak tayang, ditinjau dari sudut pandang seluruh tim agent. " +
    "Nada: santai, jujur, kritis, solutif. Satu paragraf padat, bukan daftar per agent.\n\n" +
    "TIM AGENT (sudut pandang yang harus kamu wakili):\n" + daftarAgent;

  const user =
    `Topik: ${topik}\n\n` +
    `Kerangka konten:\n${JSON.stringify(kerangka, null, 2)}\n\n` +
    `Tulis SATU paragraf analisa gabungan (maks ~700 karakter) yang menjawab: ` +
    `kenapa konten ini layak jadi konten? Sebutkan: relevansi audiens (Tara), kekuatan narasi (Laras), ` +
    `visual/konsep (Raya), sinyal riset (Aruna), risiko/fakta (Jati/Bima), dan makna strategis (Nala). ` +
    `Jujur: kalau ada bagian yang lemah, sebutkan. Kembalikan JSON {"analisa": "..."}.`;

  const json = await chatJSON({ agent: AGENT, skill: SKILL, messages: [{ role: "system", content: system }, { role: "user", content: user }], maxTokens: 2000 });
  return json.analisa || "";
}

// ---------------------------------------------------------------------------
// FUNGSI UTAMA
// ---------------------------------------------------------------------------
async function buatAssistKonten(topik) {
  if (!topik || !String(topik).trim()) throw new Error("topik wajib diisi");
  await bolehPakaiSkill(AGENT, SKILL);
  await cekJatah(AGENT);

  const kerangka = await buatKerangka(String(topik).trim());
  const terlarang = cekKataTerlarang(kerangka.caption) || cekKataTerlarang(kerangka.judul);
  if (terlarang) {
    // ulangi sekali bila ada kata terlarang
    const ulang = await buatKerangka(String(topik).trim() + `\n(ingat: hindari kata terlarang "${terlarang}")`);
    kerangka.judul = ulang.judul || kerangka.judul;
    kerangka.caption = ulang.caption || kerangka.caption;
    kerangka.hashtag = ulang.hashtag || kerangka.hashtag;
  }

  const analisa = await buatAnalisa(topik, kerangka);
  return { topik: String(topik).trim(), kerangka, analisa };
}

// Format hasil untuk dikirim ke WhatsApp (teks rapi, mudah dibaca di HP).
function formatUntukWa(hasil) {
  const k = hasil.kerangka;
  const carousel = k.carousel || {};
  const slide = Array.isArray(carousel.slide) ? carousel.slide : [];

  const baris = [];
  baris.push("*IDE KONTEN — CAHAYA PROJECT*");
  baris.push("");
  baris.push(`*Judul:* ${k.judul || "-"}`);
  baris.push(`*Ide:* ${k.ide || "-"}`);
  baris.push("");
  baris.push("*Kerangka:*");
  for (const p of (k.kerangka || [])) baris.push(`• ${p}`);
  baris.push("");
  baris.push(`*Carousel — ${carousel.jumlah || slide.length || 1} slide*`);
  if (carousel.alasan) baris.push(`_${carousel.alasan}_`);
  for (const s of slide) baris.push(`${s.no || ""}. [${s.jenis || "isi"}] ${s.isi || ""}`);
  baris.push("");
  baris.push("*Caption:*");
  baris.push(k.caption || "-");
  baris.push("");
  baris.push("*Hashtag:*");
  baris.push((k.hashtag || []).join(" "));
  baris.push("");
  baris.push("*Kenapa ini jadi konten (analisa tim):*");
  baris.push(hasil.analisa || "-");
  return baris.join("\n");
}

module.exports = { buatAssistKonten, buatKerangka, buatAnalisa, formatUntukWa, cekKataTerlarang, KATA_TERLARANG };
