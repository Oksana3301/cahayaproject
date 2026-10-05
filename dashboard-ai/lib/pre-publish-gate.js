// lib/pre-publish-gate.js
// PRE-PUBLISH GATE — gerbang wajib sebelum publikasi Cahaya Project.
//
// Latar: hasil rapat kesepakatan agent menuntut "pre-publish gate" (checklist
// manusia 2 menit) sebelum publish. Gate ini menerjemahkan 4 PRINSIP WAJIB
// menjadi checklist yang dievaluasi otomatis, dengan dua lapis:
//
//   LAPIS 1 — DETERMINISTIK (tak butuh LLM, selalu dijalankan):
//     • panjang caption & struktur (hook/konteks/insight/CTA)
//     • kata terlarang & pantangan (BRIEF skills/publish)
//     • tagar (3-5, wajib #CahayaProject)
//     • klaim absolut/risiko (medis, finansial, sustainability absolut)
//
//   LAPIS 2 — LLM (opsional, default aktif; bisa dimatikan utk uji/offline):
//     • Strategic Storytelling  — 1 aset 1 pesan, ada sudut & manfaat jelas
//     • Digital Literacy        — tak menyajikan opini/prediksi sebagai fakta
//     • Storytelling & Creation — busur naratif utuh, layak dibagikan
//     • Responsible Communication — tidak menyesatkan / menuduh / menakut-nakuti
//
// Hasil: { lulus, skor, prinsip: {...}, blokir: [...], catatan: [...] }.
// Publish DIBLOKIR bila lulus=false, kecuali opsi { paksa: true } (override owner)
// yang akan tetap dicatat sebagai pelanggaran jejak.

const { KATA_TERLARANG, PANTANGAN } = require("../skills/publish");

const PRINSIP = {
  strategi: "Strategic Storytelling",
  literasi: "Digital Literacy",
  narasi: "Storytelling & Content Creation",
  tanggungJawab: "Responsible Communication",
};

// Frasa absolut / klaim berisiko tinggi (deterministik), dipisah per prinsip.
const POLA_RISIKO = [
  // Responsible Communication — klaim sustainability absolut / hiperbola
  { re: /\b(100\s*%|seratus persen)\s*(sustainab\w*|ramah lingkungan|bebas emisi|zero\s*emisi|net\s*zero)/i, prinsip: "tanggungJawab", pesan: "klaim sustainability absolut tanpa bukti" },
  { re: /\b(zero|nol)\s*(impact|dampak|emisi|karbon)/i, prinsip: "tanggungJawab", pesan: "klaim zero-impact/zero-emission absolut" },
  { re: /\b(carbon\s*neutral|netral karbon)\b/i, prinsip: "tanggungJawab", pesan: "klaim carbon neutral tanpa bukti" },
  { re: /\b(pasti|certain|dijamin|guaranteed|100%)\s*(untung|cuan|profit|sukses|berhasil|sembuh)/i, prinsip: "tanggungJawab", pesan: "jaminan hasil finansial/kesuksesan" },
  { re: /\b(sembuh|menyembuhkan|obat|terapi|diagnosis)\b/i, prinsip: "tanggungJawab", pesan: "klaim medis/kesehatan sebagai diagnosis atau pengobatan" },
  { re: /\b(rahasia|secret)\s+(sukses|kaya|cuan|investasi)\b/i, prinsip: "tanggungJawab", pesan: "iming-iming rahasia sukses (menyesatkan)" },
  // Digital Literacy — menyajikan opini/prediksi/rumor sebagai fakta
  { re: /\b(faktanya|sudah pasti|terbukti bahwa|dipastikan bahwa|dipastikan akan|dijamin pasti)\b/i, prinsip: "literasi", pesan: "menyatakan opini/prediksi sebagai fakta" },
  { re: /\b(katanya|konon|kabarnya|rumor|gosip|isunya)\b/i, prinsip: "literasi", pesan: "menyebarkan rumor tanpa verifikasi" },
  // Responsibel — menakut-nakuti berlebihan
  { re: /\b(kiamat|kehancuran total|dunia berakhir|tak ada harapan|sekarat)\b/i, prinsip: "tanggungJawab", pesan: "nada menakut-nakuti berlebihan" },
];

const CTA_MARK = /(\byuk\b|\bay\b|\bmar[iy]\b|bagaimana|menurut|setuju|komentar|diskusi|\?|👇|simak|baca|share|bagikan|coba|mulai|ubah|pikir|kira-kira)/i;
const STRUKTUR_MARK = {
  hook: /^.{0,220}/s, // selalu ada; keberadaan dinilai via panjang kalimat pertama
  konteks: /(sekarang|akhir-akhir ini|belakangan|tahun ini|faktanya|data|riset|laporan|kondisi|dunia|kita|pernah dengar|sering|dikenal|praktik|kenapa ini penting|di permukaan|padahal|sebenarnya|ketika|jika|kalau|saat|bukti|temuan|menurut laporan|di indonesia|studi|contoh)/i,
  insight: /(artinya|yang jadi|intinya|pelajarannya|kuncinya|insight|justru|yang menarik|poinnya|solusinya|yang perlu|yang harus|cahaya project|percaya|pesannya|ambil pelajaran|konsekuensinya|risikonya|implikasinya|maknanya|inilah|di situlah|yang perlu ditanyakan|yang perlu kita|bukan soal|tapi kenapa|padahal|sebenarnya|rebuild|model|skema|solusi|kenapa)/i,
};

function panjangBersih(s) {
  return String(s || "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
}

// LAPIS 1 — deterministik.
function cekDeterministik(draft) {
  const caption = String(draft.caption || "");
  const judul = String(draft.judul || "");
  const teks = `${judul}\n${caption}`;
  const tagar = Array.isArray(draft.tagar) ? draft.tagar : [];
  const temuan = [];
  const prinsip = { strategi: [], literasi: [], narasi: [], tanggungJawab: [] };

  // kata terlarang BRIEF
  const lower = teks.toLowerCase();
  for (const k of KATA_TERLARANG) {
    if (lower.includes(k.toLowerCase())) {
      temuan.push({ prinsip: "tanggungJawab", level: "blokir", pesan: `kata terlarang: "${k}"` });
      prinsip.tanggungJawab.push(`kata terlarang: ${k}`);
    }
  }
  // pola risiko
  for (const p of POLA_RISIKO) {
    const m = teks.match(p.re);
    if (m) {
      temuan.push({ prinsip: p.prinsip, level: "blokir", pesan: `${p.pesan} ("${m[0].trim()}")` });
      prinsip[p.prinsip].push(`${p.pesan}: ${m[0].trim()}`);
    }
  }

  // panjang caption (BRIEF: 500-1000; toleransi 350-1200)
  const n = panjangBersih(caption).length;
  if (n < 350) { temuan.push({ prinsip: "narasi", level: "peringatan", pesan: `caption terlalu pendek (${n} char)` }); prinsip.narasi.push(`caption pendek (${n})`); }
  else if (n > 1200) { temuan.push({ prinsip: "narasi", level: "peringatan", pesan: `caption terlalu panjang (${n} char)` }); prinsip.narasi.push(`caption panjang (${n})`); }

  // struktur: konteks + insight
  if (!STRUKTUR_MARK.konteks.test(caption)) { temuan.push({ prinsip: "narasi", level: "peringatan", pesan: "tidak ada penanda 'konteks'" }); prinsip.narasi.push("tanpa konteks"); }
  if (!STRUKTUR_MARK.insight.test(caption)) { temuan.push({ prinsip: "strategi", level: "peringatan", pesan: "tidak ada penanda 'insight/pesan inti'" }); prinsip.strategi.push("tanpa insight/pesan inti"); }
  // CTA
  if (!CTA_MARK.test(caption)) { temuan.push({ prinsip: "strategi", level: "peringatan", pesan: "tidak ada ajakan/pertanyaan penutup (CTA)" }); prinsip.strategi.push("tanpa CTA"); }
  // satu pesan: judul tidak terlalu panjang
  if (panjangBersih(judul).length > 120) { temuan.push({ prinsip: "strategi", level: "peringatan", pesan: "judul terlalu panjang (sulit menangkap 1 pesan)" }); prinsip.strategi.push("judul terlalu panjang"); }

  // tagar
  if (!tagar.includes("#CahayaProject")) { temuan.push({ prinsip: "strategi", level: "blokir", pesan: "tagar wajib #CahayaProject tidak ada" }); prinsip.strategi.push("tanpa #CahayaProject"); }
  if (tagar.length < 3 || tagar.length > 5) { temuan.push({ prinsip: "strategi", level: "peringatan", pesan: `jumlah tagar ${tagar.length} (disarankan 3-5)` }); prinsip.strategi.push(`tagar ${tagar.length}`); }

  const blokir = temuan.filter((t) => t.level === "blokir");
  return { temuan, prinsip, blokir };
}

// LAPIS 2 — LLM (4 prinsip). Mengembalikan penilaian per prinsip.
async function cekLLM(draft, { maxTokens = 2500 } = {}) {
  const { chatJSON } = require("./llm");
  const pesan = [
    "Kamu panel penjaga mutu Cahaya Project. Nilai draft konten Instagram berikut",
    "terhadap EMPAT PRINSIP WAJIB. Bersikap tegas; kalau ragu, tandai 'gagal'.",
    "",
    "PRINSIP:",
    "1. Strategic Storytelling — satu aset satu pesan; ada sudut jelas dan manfaat bagi pembaca.",
    "2. Digital Literacy — tidak menyajikan opini/prediksi/rumor sebagai fakta; klaim tidak berlebihan; mendorong verifikasi.",
    "3. Storytelling & Content Creation — busur naratif utuh (hook -> konteks -> insight -> penutup); enak dibaca; layak dibagikan.",
    "4. Responsible Communication — tidak menyesatkan, tidak menuduh tanpa dasar, tidak menakut-nakuti, tidak klaim medis/finansial.",
    "",
    `JUDUL: ${draft.judul}`,
    `CAPTION: ${draft.caption}`,
    `TAGAR: ${(draft.tagar || []).join(" ")}`,
    "",
    "Balas JSON SAJA dengan bentuk:",
    '{"strategi":{"lulus":true,"catatan":"..."},',
    ' "literasi":{"lulus":true,"catatan":"..."},',
    ' "narasi":{"lulus":true,"catatan":"..."},',
    ' "tanggungJawab":{"lulus":true,"catatan":"..."},',
    ' "ringkas":"...", "catatan":["..."]}',
  ].join("\n");

  const j = await chatJSON({
    agent: "kirana",
    skill: "analytics",
    messages: [
      { role: "system", content: "Kamu kirana, Editor-in-Chief Cahaya Project. Tegas, ringkas, jaga mutu." },
      { role: "user", content: pesan },
    ],
    maxTokens,
  });
  return j || {};
}

// GATE UTAMA. options: { pakaiLLM=true, paksa=false, maxTokens }
async function jalankanGate(draft, { pakaiLLM = true, paksa = false, maxTokens = 2500 } = {}) {
  if (!draft) throw new Error("draft wajib diisi untuk pre-publish gate");
  const det = cekDeterministik(draft);

  let llm = null, llmErr = null;
  if (pakaiLLM) {
    try { llm = await cekLLM(draft, { maxTokens }); }
    catch (e) { llmErr = e.message; }
  }

  // gabungkan penilaian per prinsip
  const prinsip = {};
  for (const k of Object.keys(PRINSIP)) {
    const det_k = det.prinsip[k] || [];
    const llm_k = llm?.[k];
    const llmLulus = llm_k ? llm_k.lulus !== false : null;
    const lulus = det_k.length === 0 && llmLulus !== false;
    prinsip[k] = {
      nama: PRINSIP[k],
      lulus,
      deteksi: det_k,
      llmCatatan: llm_k?.catatan || null,
      llmDiperiksa: llm_k != null,
    };
  }

  const blokir = det.blokir.map((b) => `[${PRINSIP[b.prinsip]}] ${b.pesan}`);
  const gagalPrinsip = Object.entries(prinsip).filter(([, v]) => !v.lulus && v.llmDiperiksa).map(([, v]) => v.nama);
  const lulus = blokir.length === 0 && gagalPrinsip.length === 0;

  const jumlahPrinsipLulus = Object.values(prinsip).filter((v) => v.lulus).length;
  const skor = Math.round((jumlahPrinsipLulus / 4) * 100);

  return {
    lulus: paksa ? true : lulus,
    dipaksa: !!paksa,
    lulusSejati: lulus,
    skor,
    prinsip,
    blokir,
    gagalPrinsip,
    catatan: llm?.catatan || [],
    ringkas: llm?.ringkas || "",
    llmErr,
    pakaiLLM,
    draftId: draft.id ?? null,
    judul: draft.judul ?? null,
  };
}

module.exports = { jalankanGate, cekDeterministik, cekLLM, PRINSIP, POLA_RISIKO };
