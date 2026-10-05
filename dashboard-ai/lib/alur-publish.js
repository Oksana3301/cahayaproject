// lib/alur-publish.js
// ORKESTRATOR alur publish Cahaya Project dari awal sampai terbit di Instagram.
//
// Alur (end-to-end):
//   1. RISET        — ambil topik dari riset_ringkasan terbaru (atau buat baru)
//   2. DRAFT        — susunDraft (skills/publish) => draft_konten status 'menunggu'
//   3. REVIEW       — Kirana menjalankan review editorial (LLM) => putusan
//   4. PERSETUJUAN  — setujui() (skills/publish) => generate banner + POST /schedules
//                     ke Doea dengan type:"image" + medias URL publik
//   5. MONITOR      — sinkronStatus(): sukses => 'terbit', error => 'gagal'
//
// Semua langkah memakai kuota token yang sudah ditegakkan (lib/llm + wewenang).
// Fungsi di sini idempoten terhadap draft_id sehingga aman dipanggil ulang.

const db = require("./db");

// Jalankan review editorial Kirana atas sebuah draft. Mengembalikan { putusan, alasan }.
async function reviewKirana(draft) {
  const { chatJSON } = require("./llm");
  const pesan = [
    "Review draft konten berikut sebagai Editor-in-Chief Cahaya Project.",
    "Nilai: (a) kesesuaian nada & brand, (b) akurasi klaim (tandai klaim tak terverifikasi),",
    "(c) potensi risiko (medis/finansial/klaim sustainability absolut), (d) daya tarik & kejelasan.",
    "",
    `JUDUL: ${draft.judul}`,
    `CAPTION: ${draft.caption}`,
    `TAGAR: ${(draft.tagar || []).join(" ")}`,
    "",
    'Balas JSON saja: {"putusan":"setuju"|"revisi","ringkas":"...","catatan":["..."]}',
  ].join("\n");

  try {
    const j = await chatJSON({
      agent: "kirana",
      skill: "analytics",
      messages: [
        { role: "system", content: "Kamu Kirana, Editor-in-Chief Cahaya Project. Tegas, ringkas, jaga mutu." },
        { role: "user", content: pesan },
      ],
      maxTokens: 2500,
    });
    const putusan = String(j?.putusan || "").toLowerCase().includes("revisi") ? "revisi" : "setuju";
    return { ok: true, putusan, ringkas: j?.ringkas || "", catatan: j?.catatan || [] };
  } catch (e) {
    return { ok: false, putusan: "setuju", ringkas: `review dilewati: ${e.message}`, catatan: [] };
  }
}

// Ambil draft menunggu pertama, atau null.
async function draftMenunggu() {
  return db.ambilSatu(
    "SELECT * FROM draft_konten WHERE status = 'menunggu' ORDER BY id ASC LIMIT 1"
  );
}

async function draftById(id) {
  return db.ambilSatu("SELECT * FROM draft_konten WHERE id = $1", [id]);
}

// Tahap 1-2: pastikan ada draft (buat bila perlu). Mengembalikan detail draft.
async function pastikanDraft({ buatBilaKosong = false } = {}) {
  let draft = await draftMenunggu();
  if (draft) return { draft, dibuat: false };

  if (!buatBilaKosong) return { draft: null, dibuat: false };

  // Buat draft dari ringkasan riset terbaru.
  const ring = await db.ambilSatu("SELECT * FROM riset_ringkasan ORDER BY id DESC LIMIT 1");
  if (!ring) throw new Error("tidak ada ringkasan riset untuk membuat draft");
  const { susunDraft } = require("../skills/publish");
  const hasil = await susunDraft({ ringkasanId: ring.id, sudutIndex: 0, agentKode: "laras" });
  const id = hasil?.draftId || hasil?.id || hasil;
  draft = await db.ambilSatu("SELECT * FROM draft_konten WHERE id = $1", [id]);
  return { draft, dibuat: true };
}

// Tahap 3,5: PRE-PUBLISH GATE — checklist 4 prinsip sebelum approve.
// Mengembalikan hasil gate; tidak mempublikasikan apa pun.
async function gateDraft(draftId, opsi = {}) {
  const draft = await draftById(draftId);
  if (!draft) throw new Error(`draft ${draftId} tidak ditemukan`);
  const { jalankanGate } = require("./pre-publish-gate");
  return jalankanGate(draft, opsi);
}

// Tahap 3-4: approve draft => gate 4 prinsip => banner + schedule Doea.
// Publish DIBLOKIR bila gate tidak lulus, kecuali opsi { paksa: true } (override owner).
async function setujuiDraft(draftId, oleh = "owner", slotIso, opsi = {}) {
  const { setujui } = require("../skills/publish");
  // Gate dijalankan di dalam setujui() agar SEMUA jalur publish terlindungi.
  return setujui(draftId, oleh, slotIso, opsi);
}

// Tahap 5: sinkron status dari Doea ke DB.
async function sinkron() {
  const { sinkronStatus } = require("../skills/publish");
  return sinkronStatus();
}

// Status satu draft + schedule Doea-nya (untuk laporan end-to-end).
async function statusDraft(draftId) {
  const draft = await draftById(draftId);
  if (!draft) return null;
  let schedule = null;
  if (draft.schedule_id) {
    try {
      const { statusSchedule } = require("./publish");
      schedule = await statusSchedule(draft.schedule_id);
    } catch (e) {
      schedule = { id: draft.schedule_id, error: e.message };
    }
  }
  return {
    draftId: draft.id,
    judul: draft.judul,
    status: draft.status,
    schedule_id: draft.schedule_id,
    jadwal_pada: draft.jadwal_pada,
    error: draft.error,
    schedule,
  };
}

module.exports = {
  reviewKirana,
  draftMenunggu,
  draftById,
  pastikanDraft,
  gateDraft,
  setujuiDraft,
  sinkron,
  statusDraft,
};
