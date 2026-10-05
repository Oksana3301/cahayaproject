// lib/jadwal-harian.js
// Penjadwal tugas harian Cahaya Project (WIB / UTC+7).
// Mengisi tabel `tugas` dengan tugas berkala yang kemudian DIKERJAKAN oleh
// heartbeat loop (putaranDetak -> detak) di server.js.
//
// Prinsip:
//  - Hemat token: hanya tugas yang benar-benar dikenali skills (riset & draft).
//  - Patuh kuota: antar-jam, tidak menumpuk; risiko dijalankan oleh loop
//    yang sudah menghormati jatah_token_harian & PLAFON_TOKEN_HARIAN.
//  - Idempoten: sekali per hari per slot (dilacak di .hermes3d/jadwal-harian-state.json).

const fs = require("fs");
const path = require("path");
const db = require("./db");

const STATE_DIR = process.env.HERMES_STATE_DIR || path.join("/opt/dashboard-ai", ".hermes3d");
const STATE_PATH = path.join(STATE_DIR, "jadwal-harian-state.json");

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Slot jadwal harian (jam WIB). Tiap slot idempoten per (tanggalWIB, id).
// agent_yang_boleh HARUS agent yang berwenang skill yang dipakai:
//   riset  : aruna, nala, jati, bima, laras, kirana
//   draft  : laras
const SLOT_HARIAN = [
  {
    id: "riset-pagi",
    jam: 7,
    menit: 0,
    ttlMs: 6 * 60 * 60 * 1000,
    tugas: {
      judul: "Riset pagi: 25 sinyal terbaru",
      isi: "Riset topik sustainability; kumpulkan tepat 25 item sinyal terbaru dari sumber kredibel dan rangkum tepat tiga sudut pandang untuk briefing pagi.",
      agent_yang_boleh: ["aruna", "nala"],
    },
  },
  {
    id: "verifikasi-pagi",
    jam: 7,
    menit: 30,
    ttlMs: 6 * 60 * 60 * 1000,
    tugas: {
      judul: "Riset verifikasi evidence & compliance",
      isi: "Riset topik sustainability; fokus verifikasi klaim dan kelayakan compliance: kumpulkan sumber primer, tandai kategori FACT/ANALYSIS/INFERENCE/OPINION/UNKNOWN.",
      agent_yang_boleh: ["jati"],
    },
  },
  {
    id: "draft-siang",
    jam: 12,
    menit: 0,
    ttlMs: 6 * 60 * 60 * 1000,
    tugas: {
      judul: "Susun 3 draft konten",
      isi: "Susun 3 draft dari hasil riset terbaru (1 timely, 1 educational, 1 engagement) dan hentikan semuanya untuk persetujuan Owner.",
      agent_yang_boleh: ["laras"],
    },
  },
  {
    id: "redteam-sore",
    jam: 15,
    menit: 0,
    ttlMs: 6 * 60 * 60 * 1000,
    tugas: {
      judul: "Riset red team: uji asumsi & risiko",
      isi: "Riset topik sustainability; uji asumsi dan riset risiko: cari kontra-argumen, bias, dan celah data dari temuan pagi.",
      agent_yang_boleh: ["bima"],
    },
  },
];

function tanggalWIB(now = new Date()) {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return wib.toISOString().slice(0, 10); // YYYY-MM-DD
}

function menitWIB(now = new Date()) {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

function bacaState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function tulisState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("[jadwal-harian] gagal menyimpan state:", e.message);
  }
}

async function sudahAdaDenganJudul(judul) {
  const r = await db.query(
    `SELECT 1 FROM tugas
       WHERE judul = $1
         AND status IN ('menunggu','dikerjakan','perlu_persetujuan')
         AND dibuat_pada > now() - interval '20 hours'
       LIMIT 1`,
    [judul]
  );
  return r.rows.length > 0;
}

async function buatTugasHarian(tugas, dibuatOleh) {
  const r = await db.query(
    `INSERT INTO tugas (judul, isi, status, agent_yang_boleh, dibuat_oleh, dibuat_pada)
     VALUES ($1,$2,'menunggu',$3,$4,now()) RETURNING id, judul`,
    [tugas.judul, tugas.isi, tugas.agent_yang_boleh, dibuatOleh]
  );
  return r.rows[0];
}

// Dipanggil periodik oleh server. Menyemai slot yang jadwalnya sudah tiba
// hari ini dan belum pernah disemai.
async function jadwalkanHarian(now = new Date()) {
  const tgl = tanggalWIB(now);
  const menit = menitWIB(now);
  const state = bacaState();
  state[tgl] = state[tgl] && typeof state[tgl] === "object" ? state[tgl] : {};
  const sudah = state[tgl];

  // buang tanggal lama (simpan 3 hari terakhir)
  const tanggalList = Object.keys(state).sort();
  while (tanggalList.length > 3) delete state[tanggalList.shift()];

  const dibuat = [];
  for (const slot of SLOT_HARIAN) {
    if (sudah[slot.id]) continue;
    if (menit < slot.jam * 60 + slot.menit) continue;
    // jangan menyemai tugas yang sudah lewat jauh (mis. service baru hidup sore)
    if (menit > slot.jam * 60 + slot.menit + 180) {
      sudah[slot.id] = "dilewati";
      continue;
    }
    try {
      if (await sudahAdaDenganJudul(slot.tugas.judul)) {
        sudah[slot.id] = "sudah_ada";
        continue;
      }
      const row = await buatTugasHarian(slot.tugas, "jadwal-harian");
      sudah[slot.id] = new Date().toISOString();
      dibuat.push(row);
      console.log(`[jadwal-harian] tugas disemai: ${row.judul} (#${row.id})`);
    } catch (e) {
      console.error(`[jadwal-harian] gagal menyemai ${slot.id}:`, e.message);
    }
  }

  if (dibuat.length) tulisState(state);
  return { tanggal: tgl, dibuat };
}

module.exports = { jadwalkanHarian, SLOT_HARIAN, tanggalWIB };
