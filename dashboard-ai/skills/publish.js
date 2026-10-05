const db = require("../lib/db");
const { chatJSON } = require("../lib/llm");
const { doea } = require("../lib/doea");
const { bolehPakaiSkill, cekJatah, catatPemakaian } = require("../agents/wewenang");

const AKUN_ID = process.env.DOEA_ACCOUNT_ID || "6abfbca762caae1e045b0392";
const ZONA = process.env.ZONA_WAKTU || "Asia/Jakarta";
const JAM_TAYANG = [19, 30]; // 19.30 WIB default dari BRIEF

// BRIEF: kata terlarang, pantangan, panjang caption, tagar
const KATA_TERLARANG = ["save the planet", "kamu harus", "100% sustainable", "ramah lingkungan"];
const PANTANGAN = [
  "Tidak membuat klaim medis atau kesehatan sebagai diagnosis atau pengobatan.",
  "Tidak menjanjikan penghasilan, keuntungan investasi, atau hasil finansial tertentu.",
  "Tidak memberikan jaminan hasil instan dari webinar, course, digital product, atau program.",
  "Tidak menggunakan klaim sustainability absolut tanpa bukti (100% sustainable, zero impact, carbon neutral, eco-friendly, bebas emisi).",
  "Tidak menyajikan opini, prediksi, atau rumor sebagai fakta.",
  "Tidak menuduh individu, perusahaan, atau organisasi tanpa dasar yang dapat diverifikasi.",
  "Tidak membuat promosi yang menyesatkan (fake scarcity, harga palsu, testimoni rekaan, biaya tersembunyi).",
  "Tidak menggunakan atau menyebarkan data pribadi tanpa izin.",
  "Tidak menyalin karya pihak lain tanpa izin atau atribusi.",
];
const CONTOH_NADA =
  "Dunia memang lagi berubah cepat—tapi sebelum panik, yuk kita pahami apa yang sebenarnya terjadi, " +
  "siapa yang terdampak, dan apa yang masih bisa kita lakukan untuk membuatnya sedikit lebih baik.";

function cekKataTerlarang(teks) {
  const lower = (teks || "").toLowerCase();
  for (const k of KATA_TERLARANG) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return null;
}

// ---------- 4.2 susunDraft ----------
async function susunDraft({ ringkasanId, sudutIndex, agentKode, alasanTolakSebelumnya }) {
  const kode = agentKode || "laras";
  await bolehPakaiSkill(kode, "riset");
  await cekJatah(kode);

  // 7.4: ambil alasan penolakan terakhir untuk ringkasan+sudut ini
  let alasanTerakhir = alasanTolakSebelumnya || null;
  if (!alasanTerakhir) {
    const jejak = await db.ambilSatu(
      `SELECT j.alasan FROM jejak j
       JOIN draft_konten d ON d.id = j.objek_id
       WHERE j.jenis = 'draft' AND j.keputusan = 'ditolak' AND j.alasan IS NOT NULL
         AND d.ringkasan_id = $1 AND d.sudut = $2
       ORDER BY j.dibuat_pada DESC LIMIT 1`,
      [ringkasanId, sudutIndex]
    );
    if (jejak) alasanTerakhir = jejak.alasan;
  }

  const ringkasan = await db.ambilSatu(
    "SELECT * FROM riset_ringkasan WHERE id = $1",
    [ringkasanId]
  );
  if (!ringkasan) throw new Error(`ringkasan id ${ringkasanId} tidak ditemukan`);
  const sudutArr = ringkasan.sudut || [];
  const sudut = sudutArr[sudutIndex];
  if (!sudut) throw new Error(`sudut index ${sudutIndex} tidak ada di ringkasan ini`);

  const system =
    "Kamu adalah Laras, penulis konten Cahaya Project. " +
    "Cahaya Project membahas sustainability, green transition, policy, risk, human behavior, " +
    "future trends, dan solutions & innovation untuk audiens usia 22-38 tahun di kota besar Indonesia. " +
    "Nada bicara kamu: santai, cerdas, hangat, kritis, dan solutif. Membicarakan isu serius dengan " +
    "bahasa manusia yang mudah dipahami, tanpa menggurui atau menakut-nakuti. " +
    "Kalimat yang terdengar seperti kamu: " + CONTOH_NADA + "\n\n" +
    "KATA TERLARANG (jangan pernah muncul): " + KATA_TERLARANG.join(", ") + "\n\n" +
    "PANTANGAN (jangan pernah dilanggar):\n- " + PANTANGAN.join("\n- ") + "\n\n" +
    "Aturan caption: panjang sedang, 500-1000 karakter. " +
    "Struktur: hook singkat -> konteks -> why it matters -> insight Cahaya Project -> CTA atau pertanyaan diskusi. " +
    "Aturan tagar: 3-5 hashtag, wajib #CahayaProject, sisanya sesuai topik. " +
    (alasanTerakhir
      ? `\n\nPERHATIAN: percobaan sebelumnya ditolak karena: ${alasanTerakhir}. Jangan ulangi. Perbaiki kesalahan itu.`
      : "");

  const user =
    `Buat satu draft konten Instagram dari sudut pandang berikut:\n` +
    `Judul sudut: ${sudut.judul}\n` +
    `Alasan: ${sudut.alasan}\n` +
    `Bukti: ${(sudut.bukti || []).join(", ")}\n` +
    `Kata kunci riset: ${ringkasan.keyword}\n\n` +
    `Kembalikan JSON persis:\n` +
    `{"judul": "...", "caption": "...", "tagar": ["#CahayaProject", "..."]}`;

  const json = await chatJSON({
    agent: kode,
    skill: "riset",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 4096,
  });

  const judul = (json.judul || "").trim();
  const caption = (json.caption || "").trim();
  let tagar = Array.isArray(json.tagar) ? json.tagar : [];
  if (!tagar.includes("#CahayaProject")) tagar = ["#CahayaProject", ...tagar];
  tagar = tagar.slice(0, 5);

  if (!judul || !caption) throw new Error("draft kosong dari model");

  // 4.2 cek kata terlarang, ulangi sekali
  const terlarang = cekKataTerlarang(caption) || cekKataTerlarang(judul);
  let captionFinal = caption;
  let judulFinal = judul;
  if (terlarang) {
    const ulang = await chatJSON({
      agent: kode,
      skill: "riset",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        {
          role: "user",
          content: `Draf sebelumnya mengandung kata terlarang "${terlarang}". Tulis ulang tanpa kata itu. Kembalikan JSON {"judul": "...", "caption": "...", "tagar": [...]}.`,
        },
      ],
      maxTokens: 8192,
    });
    captionFinal = (ulang.caption || "").trim();
    judulFinal = (ulang.judul || judul).trim();
    tagar = Array.isArray(ulang.tagar) ? ulang.tagar : tagar;
    if (!tagar.includes("#CahayaProject")) tagar = ["#CahayaProject", ...tagar];
    tagar = tagar.slice(0, 5);
  }

  const r = await db.query(
    `INSERT INTO draft_konten (ringkasan_id, sudut, akun_id, judul, caption, tagar, media, status, dibuat_pada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'menunggu', now()) RETURNING *`,
    [ringkasanId, sudutIndex, AKUN_ID, judulFinal, captionFinal, tagar, json.media || null]
  );
  const draft = r.rows[0];
  await catatPemakaian(kode, 0); // token sudah dicatat di lib/llm
  return draft;
}

// ---------- 4.3 setujui (SATU-SATUNYA tempat POST /schedules) ----------
async function slotBerikutnya() {
  const r = await db.query(
    `SELECT jadwal_pada FROM draft_konten WHERE jadwal_pada IS NOT NULL`
  );
  const dipakai = new Set(r.rows.map((x) => new Date(x.jadwal_pada).getTime()));
  const jam = JAM_TAYANG[0], menit = JAM_TAYANG[1];
  const sekarang = Date.now();
  let kandidat = null;
  for (let offset = 0; offset < 10; offset++) {
    const hari = new Date(sekarang + offset * 24 * 60 * 60 * 1000);
    const tglWIB = new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(hari);
    const [y, m, d] = tglWIB.split("-").map(Number);
    const komponen = new Date(Date.UTC(y, m - 1, d, jam, menit, 0, 0));
    const kandidatUtc = komponen.getTime() - 7 * 60 * 60 * 1000;
    if (kandidatUtc > sekarang && !dipakai.has(kandidatUtc)) {
      kandidat = new Date(kandidatUtc);
      break;
    }
  }
  if (!kandidat) throw new Error("tidak ada slot 19:30 WIB yang tersedia dalam 10 hari ke depan");
  return kandidat;
}

async function setujui(draftId, olehSiapa, slotIso, opsi = {}) {
  const draft = await db.ambilSatu("SELECT * FROM draft_konten WHERE id = $1", [draftId]);
  if (!draft) throw new Error(`draft ${draftId} tidak ditemukan`);
  if (draft.status !== "menunggu" && draft.status !== "gagal") {
    throw new Error(`draft ${draftId} berstatus ${draft.status}, tidak bisa disetujui`);
  }

  // PRE-PUBLISH GATE (4 prinsip wajib). Publish diblokir bila gagal, kecuali
  // override eksplisit { paksa: true } (dicatat sebagai pelanggaran).
  if (opsi.lewatiGate !== true && process.env.SKIP_PRE_PUBLISH_GATE !== "1") {
    const { jalankanGate } = require("../lib/pre-publish-gate");
    const gate = await jalankanGate(draft, { pakaiLLM: opsi.pakaiLLM !== false, paksa: opsi.paksa === true });
    if (!gate.lulus) {
      const e = new Error(
        `pre-publish gate TIDAK LULUS (skor ${gate.skor}). ` +
          `Blokir: ${gate.blokir.join("; ") || "-"}. Prinsip gagal: ${gate.gagalPrinsip.join(", ") || "-"}.`
      );
      e.gate = gate; e.kode = "GATE_GAGAL";
      throw e;
    }
    opsi._gate = gate;
  }

  // 4.6 accountId harus dalam daftar /accounts
  const accounts = await doea("GET", "/accounts");
  const ids = (accounts.docs || []).map((a) => a.id || a._id);
  if (!ids.includes(draft.akun_id || AKUN_ID)) {
    throw new Error(`accountId ${draft.akun_id || AKUN_ID} tidak ada di daftar akun. Yang tersedia: ${ids.join(", ")}`);
  }

  // Slot 19:30 WIB terdekat. Untuk UJI CEPAT, bisa di-override via argumen slotIso
  // atau env PUBLISH_SLOT_ISO (mis. 5 menit ke depan) tanpa mengubah perilaku normal.
  const paksaSlot = slotIso || process.env.PUBLISH_SLOT_ISO;
  const slot = paksaSlot ? new Date(paksaSlot) : await slotBerikutnya();
  const captionPenuh = draft.caption + "\n\n" + (draft.tagar || []).join(" ");

  // Instagram WAJIB punya media. Generate banner dari caption lalu host di URL
  // publik; tanpa ini Doea membuat schedule type:"text" yang selalu GAGAL
  // ("invalid postId: unsupported type schedule").
  const { buatBanner } = require("../lib/banner");
  const PUBLIC_HOST = process.env.PUBLIC_MEDIA_HOST || "https://agentsocmed.dirini.space";
  const banner = await buatBanner({ caption: captionPenuh, judul: draft.judul, badge: "Cahaya Project" });
  const mediaUrl = `${PUBLIC_HOST}/media/${banner.nama}`;

  const body = {
    accountId: draft.akun_id || AKUN_ID,
    title: draft.judul,
    description: captionPenuh,
    scheduleAt: slot.toISOString(),
    type: "image",
    topic: draft.judul,
    medias: [{ url: mediaUrl, type: "image" }],
  };

  const res = await doea("POST", "/schedules", { body });
  const scheduleId = res && (res.result && (res.result.scheduleId || res.result.id) || res.id || res._id || res.scheduleId);
  if (!scheduleId) throw new Error("Doea tidak mengembalikan schedule_id: " + JSON.stringify(res).slice(0, 200));

  await db.query(
    `UPDATE draft_konten
     SET status = 'terjadwal', disetujui_oleh = $1, disetujui_pada = now(),
         schedule_id = $2, jadwal_pada = $3, alasan_tolak = NULL, error = NULL
     WHERE id = $4`,
    [olehSiapa || "owner", String(scheduleId), slot, draftId]
  );
  await db.query(
    `INSERT INTO jejak (jenis, objek_id, keputusan, oleh, alasan, isi_saat_itu)
     VALUES ('draft', $1, 'disetujui', $2, NULL, $3)`,
    [draftId, olehSiapa || "owner", JSON.stringify({
      scheduleId: String(scheduleId),
      scheduleAt: slot.toISOString(),
      gate: opsi._gate ? { lulus: opsi._gate.lulus, skor: opsi._gate.skor, dipaksa: opsi._gate.dipaksa, blokir: opsi._gate.blokir } : null,
    })]
  );
  return { draftId, scheduleId: String(scheduleId), scheduleAt: slot, gate: opsi._gate || null };
}

// ---------- 4.4 tolak ----------
async function tolak(draftId, alasan) {
  if (!alasan || !alasan.trim()) throw new Error("alasan penolakan wajib diisi");
  const draft = await db.ambilSatu("SELECT * FROM draft_konten WHERE id = $1", [draftId]);
  if (!draft) throw new Error(`draft ${draftId} tidak ditemukan`);
  await db.query(
    `UPDATE draft_konten SET status = 'ditolak', alasan_tolak = $1 WHERE id = $2`,
    [alasan.trim(), draftId]
  );
  await db.query(
    `INSERT INTO jejak (jenis, objek_id, keputusan, oleh, alasan, isi_saat_itu)
     VALUES ('draft', $1, 'ditolak', 'owner', $2, $3)`,
    [draftId, alasan.trim(), JSON.stringify({ judul: draft.judul, caption: (draft.caption || "").slice(0, 300) })]
  );
  return { draftId, status: "ditolak", alasan: alasan.trim() };
}

// ---------- 4.5 sinkronStatus ----------
async function sinkronStatus() {
  const lokal = await db.ambilBanyak(
    `SELECT * FROM draft_konten WHERE status = 'terjadwal' AND schedule_id IS NOT NULL`
  );
  if (!lokal.length) return { disinkronkan: 0 };
  const jadwal = await doea("GET", "/schedules");
  const peta = new Map();
  for (const s of (jadwal.docs || jadwal || [])) {
    peta.set(String(s.id || s._id), s);
  }
  let jumlah = 0;
  for (const d of lokal) {
    const s = peta.get(String(d.schedule_id));
    if (!s) continue;
    const statusDoea = (s.status || "").toLowerCase();
    if (statusDoea === "published" || statusDoea === "success") {
      await db.query(`UPDATE draft_konten SET status = 'terbit' WHERE id = $1`, [d.id]);
      jumlah++;
    } else if (statusDoea === "failed" || statusDoea === "error") {
      await db.query(
        `UPDATE draft_konten SET status = 'gagal', error = $1 WHERE id = $2`,
        [String(s.error || s.message || "gagal di Doea").slice(0, 300), d.id]
      );
      jumlah++;
    }
  }
  return { disinkronkan: jumlah };
}

module.exports = {
  susunDraft,
  setujui,
  tolak,
  sinkronStatus,
  slotBerikutnya,
  cekKataTerlarang,
  KATA_TERLARANG,
  PANTANGAN,
};
