// lib/rapat.js
// Modul RAPAT multi-agent Cahaya Project.
//
// Alur harian (3 rapat, masing-masing SATU pesan WhatsApp):
//   - PAGI  (08:00 WIB): daily standup — update malam & rencana kerja hari ini.
//   - SIANG (13:00 WIB): progress update — sejauh mana, ada blocker?
//   - SORE  (19:00 WIB): diskusi + GABUNGAN semua notulen hari itu + next action
//                        untuk malam ini & besok (dengan jam).
//
// Hemat token:
//   - Jumlah peserta terbatas per jenis rapat.
//   - Rapat SORE tidak mengulang pendapat semua agent; ia merangkum notulen
//     yang SUDAH tersimpan hari itu (hasil pagi & siang) + diskusi singkat.
//
// Dipakai oleh:
//   - endpoint /api/rapat (trigger manual / UI, jenis opsional)
//   - cron playbook rapat (pagi/siang/sore)

const fs = require("fs");
const path = require("path");
const roster = require("../agents/roster");

const PRINSIP_RINGKAS =
  "EMPAT PRINSIP WAJIB (dijunjung tinggi): " +
  "(1) Strategic Storytelling — tujuan dulu lalu cerita, satu aset satu pesan, ada busur naratif & ajakan; " +
  "(2) Digital Literacy — verifikasi sebelum virality, bedakan fakta/opini/prediksi, akui ketidakpastian, pahami platform; " +
  "(3) Storytelling & Content Creation — mulai dari manusia, nada smart-warm-relaxed-critical-constructive-hopeful, caption 500-1000 karakter, 3-5 hashtag termasuk #CahayaProject, visual bermakna; " +
  "(4) Responsible Communication — tanpa klaim medis/finansial/hukum tanpa dasar, tanpa klaim sustainability absolut tanpa bukti, tanpa menuduh tanpa verifikasi, lindungi data pribadi, hindari clickbait, koreksi terbuka, empati, persetujuan manusia untuk publikasi berisiko.";

// Susunan default (rapat manual). Bisa di-override.
const SUSUNAN_DEFAULT = ["nala", "aruna", "jati", "bima", "laras", "raya", "tara"];

// Preset tiap jenis rapat: agenda, peserta (hemat token), dan label.
const PRESET = {
  pagi: {
    label: "Rapat Pagi — Daily Standup",
    agenda:
      "Daily standup pagi: apa yang dikerjakan semalam? Apa rencana kerja & prioritas hari ini? " +
      "Tetapkan 3 prioritas utama dan pemiliknya.",
    undangan: ["nala", "laras", "tara", "jati"],
    maxPendapatAgent: 1600,
    maxNotulen: 2600,
  },
  siang: {
    label: "Rapat Siang — Progress Update",
    agenda:
      "Update progres siang: sejauh mana pekerjaan hari ini berjalan? Apa yang selesai, apa yang tertunda, " +
      "dan adakah blocker yang butuh keputusan Owner?",
    undangan: ["nala", "tara", "bima"],
    maxPendapatAgent: 1600,
    maxNotulen: 2600,
  },
  sore: {
    label: "Rapat Sore — Rekap Harian & Rencana Lanjutan",
    agenda:
      "Rekap akhir hari: rangkum semua yang terjadi hari ini, putuskan penutup hari, " +
      "dan susun rencana malam ini + besok.",
    undangan: ["nala", "tara", "laras"],
    maxPendapatAgent: 1600,
    maxNotulen: 2600,
  },
};

const DIR = path.join(__dirname, "..", ".hermes3d");
const DIR_NOTULEN = path.join(DIR, "notulen-harian");

function tanggalWIB(d = new Date()) {
  // YYYY-MM-DD menurut WIB (UTC+7), apa pun TZ server.
  const wib = new Date(d.getTime() + 7 * 3600000);
  return wib.toISOString().slice(0, 10);
}

function bacaNotulenHarian(tanggal) {
  try {
    const b = path.join(DIR_NOTULEN, `${tanggal}.json`);
    if (!fs.existsSync(b)) return { tanggal, sesi: [] };
    const d = JSON.parse(fs.readFileSync(b, "utf8"));
    if (!Array.isArray(d.sesi)) d.sesi = [];
    return d;
  } catch {
    return { tanggal, sesi: [] };
  }
}

function simpanNotulenHarian(data) {
  try {
    fs.mkdirSync(DIR_NOTULEN, { recursive: true });
    fs.writeFileSync(path.join(DIR_NOTULEN, `${data.tanggal}.json`), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[rapat] gagal simpan notulen harian:", e.message);
  }
}

function undanganDari(kodeList, fallback) {
  const sumber = kodeList && kodeList.length ? kodeList : fallback && fallback.length ? fallback : SUSUNAN_DEFAULT;
  return sumber.filter((k) => roster.ambil(k));
}

// Panggil chat() dan ulangi bila respons kosong (provider kadang mengembalikan
// content kosong walau status "sukses", yang membuat notulen rapat jadi hampa).
async function chatNonKosong(opts, { maxUlang = 2 } = {}) {
  const { chat } = require("./llm");
  let teks = "";
  for (let i = 0; i <= maxUlang; i++) {
    const data = await chat(opts);
    const msg = data.choices?.[0]?.message || {};
    // Model reasoning (Atria-Dawn-Preview) kadang menghabiskan seluruh token
    // untuk "berpikir" (reasoning_content) dan menyisakan content kosong.
    // Fallback: pakai reasoning_content bila content hampa.
    teks = (msg.content || msg.reasoning_content || "").trim();
    if (teks) return teks;
    if (i < maxUlang) {
      // Naikkan sisa token & minta model langsung menjawab tanpa berpikir panjang.
      if (typeof opts.maxTokens === "number") opts.maxTokens = Math.max(opts.maxTokens, 2048);
      opts.messages = [...(opts.messages || []), { role: "user", content: "(Jawab langsung dengan teks final, jangan kosong.)" }];
    }
  }
  return teks;
}

// Satu agent berpendapat.
async function pendapatAgent(kode, agenda, konteks, maxTokens = 1200) {
  const a = roster.ambil(kode);
  if (!a) return null;
  const pesan = [
    `RAPAT CAHAYA PROJECT — agenda: ${agenda}`,
    konteks ? `Konteks: ${konteks}` : "",
    "",
    `Kamu ${a.nama} (${a.jabatan}). Sampaikan pendapatmu sebagai ${a.jabatan}:`,
    "- 2–3 poin ringkas, konkret, sesuai keahlianmu.",
    "- Kaitkan dengan EMPAT PRINSIP wajib bila relevan.",
    "- Boleh menyoroti risiko/titik buta. Jangan mengarang data.",
    "- Bahasa Indonesia, tegas, tanpa pembuka/penutup basa-basi.",
  ]
    .filter(Boolean)
    .join("\n");

  const teks = await chatNonKosong({
    agent: kode,
    skill: a.skill_diizinkan.includes("analytics") ? "analytics" : "riset",
    messages: [
      {
        role: "system",
        content:
          `Kamu ${a.nama}, ${a.jabatan} di Cahaya Project. ` +
          "Smart, warm, relaxed, critical, constructive, hopeful. " +
          PRINSIP_RINGKAS +
          " Bahasa Indonesia yang jelas dan manusiawi.",
      },
      { role: "user", content: pesan },
    ],
    maxTokens,
  });
  return { kode, nama: a.nama, jabatan: a.jabatan, pendapat: teks };
}

// Susun notulen dari pendapat (rapat pagi/siang/manual).
async function notulenKirana(agenda, pendapatArr, { maxNotulen = 2600, mintaNextAction = false } = {}) {
  const kumpulan = pendapatArr
    .map((p) => `### ${p.nama} (${p.jabatan})\n${p.pendapat}`)
    .join("\n\n");

  const format =
    "Susun NOTULEN dengan format:\n" +
    "1) RINGKASAN (2–4 baris)\n" +
    "2) POIN PENTING (bullet)\n" +
    "3) RISIKO / BLOCKER (bullet; tulis 'tidak ada' bila nihil)\n" +
    "4) KEPUTUSAN (tegas: lanjut/tahan/revisi + alasan)\n" +
    "5) AKSI & PENANGGUNG JAWAB (siapa melakukan apa)\n" +
    (mintaNextAction ? "6) NEXT ACTION (langkah konkret berikutnya, singkat)\n" : "") +
    "7) CATATAN TERHADAP 4 PRINSIP (mana yang paling relevan & mengapa, 1–2 baris).";

  return await chatNonKosong({
    agent: "kirana",
    skill: "approval",
    messages: [
      {
        role: "system",
        content:
          "Kamu adalah Kirana, Editor-in-Chief & Orchestrator Cahaya Project. " +
          PRINSIP_RINGKAS +
          " Tugasmu merangkum rapat menjadi notulen yang tegas dan dapat ditindaklanjuti. Bahasa Indonesia. Ringkas namun lengkap.",
      },
      { role: "user", content: `Agenda rapat: ${agenda}\n\nPendapat para agent:\n${kumpulan}\n\n${format}` },
    ],
    maxTokens: maxNotulen,
  });
}

// Notulen SORE: gabungkan semua notulen hari itu + next action berjam.
async function rekapHarianKirana(tanggal, sesiArr, agendaSore) {
  const rekap = sesiArr
    .map((s) => {
      const wkt = new Date(s.waktu).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
      return `### ${s.label || s.jenis} (${wkt} WIB)\n${String(s.notulen || "").slice(0, 1800)}`;
    })
    .join("\n\n");

  const jam = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const teks = await chatNonKosong({
    agent: "kirana",
    skill: "approval",
    messages: [
      {
        role: "system",
        content:
          "Kamu adalah Kirana, Editor-in-Chief & Orchestrator Cahaya Project. " +
          PRINSIP_RINGKAS +
          " Bahasa Indonesia, ringkas, tegas, dapat langsung dieksekusi. Tanpa basa-basi.",
      },
      {
        role: "user",
        content:
          `Tanggal: ${tanggal} (sekarang ${jam} WIB).\n\n` +
          `Berikut catatan SEMUA rapat hari ini (pagi, siang, sore):\n\n${rekap}\n\n` +
          "Susun REKAP HARIAN KOMPREHENSIF dengan format PERSIS seperti ini:\n\n" +
          "## RINGKASAN HARI INI (3–5 baris)\n\n" +
          "## YANG SELESAI\n- ...\n\n" +
          "## BLOCKER / PERHATIAN\n- ... (tulis 'tidak ada' bila nihil)\n\n" +
          "## YANG BELUM SELESAI\n- ...\n\n" +
          "## NEXT ACTION MALAM INI\n- [jam] aksi — penanggung jawab\n\n" +
          "## NEXT ACTION BESOK\n- [jam] aksi — penanggung jawab\n\n" +
          "## CATATAN TERHADAP 4 PRINSIP\n- ...\n\n" +
          "Catatan: untuk jam, gunakan jadwal kerja Cahaya Project (08:00 standup, " +
          "13:00 update siang, dan sinkronkan dengan jadwal playbook bila relevan). " +
          "Pastikan setiap NEXT ACTION punya jam yang jelas.",
      },
    ],
    maxTokens: 3000,
  });
  return teks;
}

// Jalankan rapat lengkap.
// jenis: "pagi" | "siang" | "sore" | undefined (manual)
// kirimWa: kirim ringkasan otomatis (default true). waNomor: tujuan (default WA_NOTIF_NOMOR).
// Mengembalikan { jenis, label, agenda, pendapat[], notulen, tanggal, waTerkirim? }.
async function jalankanRapat({ jenis, agenda, konteks, undangan, kirimWa = true, waNomor } = {}) {
  const pres = PRESET[jenis] || null;
  const label = pres?.label || "Rapat (manual) — 4 Prinsip Wajib";
  const agendaFinal = String(agenda || pres?.agenda || "Bagaimana menerapkan 4 prinsip wajib dalam publikasi Cahaya Project?").trim();
  const kode = undanganDari(undangan, pres?.undangan);
  const tanggal = tanggalWIB();
  const mulai = Date.now();

  // Rapat SORE: tidak mengumpulkan pendapat semua agent; cuplikan notulen harian
  // sudah cukup + diskusi singkat dari peserta sore, lalu Kirana merekap.
  let pendapat = [];
  let notulen = "";
  if (jenis === "sore") {
    for (const k of kode) {
      try {
        const p = await pendapatAgent(k, agendaFinal, konteks, pres?.maxPendapatAgent || 800);
        if (p) pendapat.push(p);
      } catch (e) {
        pendapat.push({ kode: k, nama: roster.ambil(k)?.nama || k, jabatan: roster.ambil(k)?.jabatan || "", pendapat: `(tidak hadir: ${e.message})` });
      }
    }
    const harian = bacaNotulenHarian(tanggal);
    const sesiSebelumnya = harian.sesi.filter((s) => s.jenis !== "sore");
    const sesiUntukRekap = [
      ...sesiSebelumnya,
      {
        jenis: "sore",
        label: label,
        waktu: new Date().toISOString(),
        notulen:
          "PENDAPAT PESERTA RAPAT SORE:\n" +
          pendapat.map((p) => `### ${p.nama}\n${p.pendapat}`).join("\n\n"),
      },
    ];
    try {
      notulen = await rekapHarianKirana(tanggal, sesiUntukRekap, agendaFinal);
    } catch (e) {
      notulen = `(rekap harian gagal: ${e.message})`;
    }
  } else {
    for (const k of kode) {
      try {
        const p = await pendapatAgent(k, agendaFinal, konteks, pres?.maxPendapatAgent || 1200);
        if (p) pendapat.push(p);
      } catch (e) {
        pendapat.push({ kode: k, nama: roster.ambil(k)?.nama || k, jabatan: roster.ambil(k)?.jabatan || "", pendapat: `(tidak hadir: ${e.message})` });
      }
    }
    try {
      notulen = await notulenKirana(agendaFinal, pendapat, {
        maxNotulen: pres?.maxNotulen || 2600,
        mintaNextAction: jenis === "pagi" || jenis === "siang",
      });
    } catch (e) {
      notulen = `(notulen gagal: ${e.message})`;
    }
  }

  const hasil = {
    jenis: jenis || "manual",
    label,
    agenda: agendaFinal,
    diundang: kode,
    pendapat,
    notulen,
    tanggal,
    waktu: new Date().toISOString(),
  };

  // Simpan hasil terakhir (kompatibel UI) + arsip mentah + akumulasi harian.
  try {
    fs.writeFileSync(path.join(DIR, "rapat-terakhir.json"), JSON.stringify(hasil, null, 2));
    const arsipDir = path.join(DIR, "rapat");
    fs.mkdirSync(arsipDir, { recursive: true });
    const stempel = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(arsipDir, `rapat-${stempel}.json`), JSON.stringify(hasil, null, 2));

    const harian = bacaNotulenHarian(tanggal);
    // Ganti entri jenis yang sama pada hari yang sama (hindari duplikat).
    harian.sesi = harian.sesi.filter((s) => s.jenis !== hasil.jenis);
    harian.sesi.push({ jenis: hasil.jenis, label, waktu: hasil.waktu, agenda: agendaFinal, notulen });
    harian.sesi.sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
    simpanNotulenHarian(harian);
  } catch (e) {
    console.error("[rapat] gagal simpan hasil:", e.message);
  }

  // Kirim ringkasan rapat ke WhatsApp (dipisah beberapa pesan agar tidak terpotong).
  const nomorWa = String(waNomor || process.env.WA_NOTIF_NOMOR || process.env.WA_WA_NOTIF || "").trim();
  if (kirimWa && nomorWa) {
    try {
      const wa = require("./whatsapp");
      const tanggalHarian = bacaNotulenHarian(tanggal);
      const r = await wa.kirimRapatWa(nomorWa, { ...hasil, tanggalHarian });
      hasil.waTerkirim = nomorWa;
      hasil.waJumlahPesan = r.jumlah;
      console.log(`[rapat] ringkasan ${hasil.jenis} dikirim ke WhatsApp ${nomorWa} (${r.jumlah} pesan)`);
    } catch (e) {
      hasil.waError = e.message;
      console.error("[rapat] gagal kirim WhatsApp:", e.message);
    }
  }
  hasil.durasiMs = Date.now() - mulai;
  return hasil;
}

module.exports = { jalankanRapat, SUSUNAN_DEFAULT, PRINSIP_RINGKAS, PRESET, tanggalWIB, bacaNotulenHarian };
