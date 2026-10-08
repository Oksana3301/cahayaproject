// lib/sena-publish.js
// Kirim hasil clone carousel (dari lib/sena-clone.js) ke SocialHub (Doea)
// supaya tayang otomatis. Dikerjakan oleh agent Sena.
//
// Alur:
//   1. GET /accounts -> pilih accountId (simpan ke config biar tidak tanya ulang).
//   2. Baca file .json hasil clone dari .hermes3d/sena/clone/output/.
//   3. Konversi jam tayang WIB -> UTC (scheduleAt berakhiran Z).
//   4. POST /schedules per konten (type text; image bila ada media).
//   5. GET /schedules untuk verifikasi + tampilkan dalam WIB.
//
// Sifat WAJIB:
//   - --dry-run : tampilkan apa yang BAKAL dikirim (tanpa kirim).
//   - Validasi field wajib (accountId/title/description/scheduleAt) sebelum kirim.
//   - Anti dobel: simpan shortcode yang sudah dijadwalkan, skip bila dijalankan lagi.
//   - Catat yang gagal beserta error-nya.
//
// Autentikasi HTTP Basic memakai lib/doea.js (DOEA_ACCESS_KEY + DOEA_SECRET_KEY).

const fs = require("fs");
const path = require("path");
const { doea } = require("./doea");

const DIR = path.join(__dirname, "..", ".hermes3d", "sena");
const DIR_CLONE_OUT = path.join(DIR, "clone", "output");
const DIR_PUBLISH = path.join(DIR, "publish");
const CONFIG_PATH = path.join(DIR_PUBLISH, "config.json");
const TERJADWAL_PATH = path.join(DIR_PUBLISH, "terjadwal.json");
const JADWAL_PATH = path.join(DIR_PUBLISH, "jadwal.json");

// ==================== KONFIGURASI DEFAULT ====================
// JAM_TAYANG = jam tayang dalam WIB (Asia/Jakarta, UTC+7).
// Bisa dioverride lewat env SENA_JAM_TAYANG (format "HH:mm" WIB).
const JAM_TAYANG = process.env.SENA_JAM_TAYANG || "19:00";
// =============================================================

function pastikanDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
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

// --- Konversi waktu WIB -> UTC --------------------------------------------
// WIB = UTC+7. scheduleAt harus UTC berakhiran Z.
// "19:00" WIB pada tanggal D -> "12:00:00.000Z" tanggal D (hari yang sama).
// Return: string ISO UTC.
function wibKeUtc(jamWib, tanggalWib) {
  // jamWib: "HH:mm" (mis "19:00"). tanggalWib: string "YYYY-MM-DD" atau Date.
  const [hh, mm] = String(jamWib).split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error(`jam tayang tidak valid: "${jamWib}" (harus HH:mm)`);
  }
  // Buat Date "seolah-olah" UTC pada jam hh:mm (WIB), lalu kurangi 7 jam.
  let base;
  if (tanggalWib instanceof Date) {
    base = new Date(Date.UTC(tanggalWib.getUTCFullYear(), tanggalWib.getUTCMonth(), tanggalWib.getUTCDate(), hh, mm, 0, 0));
  } else {
    const [y, mo, d] = String(tanggalWib).split("-").map((n) => parseInt(n, 10));
    base = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0, 0));
  }
  const utc = new Date(base.getTime() - 7 * 60 * 60 * 1000); // WIB -> UTC (kurangi 7 jam)
  return utc.toISOString(); // berakhiran Z, format .000Z
}

// Format tampilan WIB dari ISO UTC.
function utcKeWib(isoUtc) {
  const d = new Date(isoUtc);
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().replace("Z", " WIB").replace("T", " ");
}

// --- Config akun ----------------------------------------------------------
function bacaConfig() {
  return bacaJSON(CONFIG_PATH, {});
}

function simpanConfig(cfg) {
  tulisJSON(CONFIG_PATH, cfg);
}

function bacaTerjadwal() {
  return bacaJSON(TERJADWAL_PATH, []);
}

function simpanTerjadwal(list) {
  tulisJSON(TERJADWAL_PATH, list);
}

// Simpan snapshot jadwal antre tayang (untuk dashboard). Diisi setelah
// publish berhasil, dari GET /schedules. Struktur: { diperbarui, docs: [...] }.
function simpanJadwal(docs) {
  tulisJSON(JADWAL_PATH, { diperbarui: new Date().toISOString(), docs });
}

function bacaJadwal() {
  return bacaJSON(JADWAL_PATH, { diperbarui: null, docs: [] });
}

// --- 1. Daftar akun -------------------------------------------------------
async function daftarAkun() {
  const r = await doea("GET", "/accounts");
  const docs = Array.isArray(r) ? r : r.docs || [];
  return docs.map((a) => ({
    id: a.id,
    name: a.name || a.username || "",
    username: a.username || "",
    type: a.type || "",
    isConnected: a.isConnected,
  }));
}

// --- 2. Baca file clone JSON ----------------------------------------------
function bacaFileClone(dir) {
  pastikanDir(dir);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const hasil = [];
  for (const f of files) {
    const data = bacaJSON(path.join(dir, f), null);
    if (!data) continue;
    hasil.push({ file: f, shortcode: f.replace(/\.json$/, ""), data });
  }
  return hasil;
}

// Susun title/description dari hasil clone.
function susunKonten(clone) {
  const d = clone.data;
  const title = d.title || (d.slides && d.slides[0] && d.slides[0].isi ? d.slides[0].isi.split("\n")[0] : "Cahaya Project");
  // description = caption + hashtags + cta
  let description = d.caption || "";
  if (d.cta) description += (description ? "\n\n" : "") + d.cta;
  const tags = Array.isArray(d.hashtags) && d.hashtags.length ? "\n\n" + d.hashtags.join(" ") : "";
  description += tags;
  return { title, description, topic: d.topic || "" };
}

// --- 3. Validasi ----------------------------------------------------------
function validasiPayload(p) {
  const err = [];
  if (!p.accountId || !String(p.accountId).trim()) err.push("accountId kosong");
  if (!p.title || !String(p.title).trim()) err.push("title kosong");
  if (!p.description || !String(p.description).trim()) err.push("description kosong");
  if (!p.scheduleAt || !/Z$/.test(String(p.scheduleAt))) err.push(`scheduleAt harus UTC berakhiran Z (dapat: ${p.scheduleAt})`);
  return err;
}

// --- 4. Jadwalkan ---------------------------------------------------------
async function jadwalkan(payload) {
  const err = validasiPayload(payload);
  if (err.length) throw new Error(`validasi gagal: ${err.join("; ")}`);
  return doea("POST", "/schedules", { body: payload });
}

async function daftarJadwal({ status, fromDate, toDate } = {}) {
  const query = {};
  if (status) query.status = status;
  if (fromDate) query.fromDate = fromDate;
  if (toDate) query.toDate = toDate;
  const r = await doea("GET", "/schedules", { query });
  return Array.isArray(r) ? r : r.docs || [];
}

// --- 5. Orkestrator -------------------------------------------------------
async function publishClone({
  accountId = null,
  fileCloneDir = DIR_CLONE_OUT,
  jamTayang = JAM_TAYANG,
  tanggalMulai = null, // "YYYY-MM-DD" WIB; default hari ini WIB
  dryRun = false,
  jumlah = null, // batasi jumlah konten (default semua)
  ulang = false,
} = {}) {
  pastikanDir(DIR_PUBLISH);

  // 1. akun
  const akunList = await daftarAkun();
  if (!akunList.length) throw new Error("tidak ada akun tersambung di SocialHub");

  let akunDipilih = null;
  const cfg = bacaConfig();
  if (accountId) {
    akunDipilih = akunList.find((a) => a.id === accountId) || null;
    if (!akunDipilih) throw new Error(`accountId ${accountId} tidak ditemukan di daftar akun`);
  } else if (cfg.accountId) {
    akunDipilih = akunList.find((a) => a.id === cfg.accountId) || null;
  }

  if (!akunDipilih) {
    // tampilkan daftar & minta pilih (interaktif bila TTY)
    console.log("Akun tersambung:");
    akunList.forEach((a, i) => console.log(`  [${i + 1}] ${a.name} (@${a.username}) — ${a.type} — id ${a.id}`));
    if (akunList.length === 1) {
      akunDipilih = akunList[0];
      console.log(`  (hanya 1 akun, otomatis pilih: ${akunDipilih.name})`);
    } else {
      throw new Error("lebih dari satu akun; pilih lewat --account <id>");
    }
  }

  // simpan pilihan agar tidak tanya terus
  if (!cfg.accountId || cfg.accountId !== akunDipilih.id) {
    cfg.accountId = akunDipilih.id;
    cfg.name = akunDipilih.name;
    cfg.username = akunDipilih.username;
    simpanConfig(cfg);
  }

  // 2. baca file clone
  const clones = bacaFileClone(fileCloneDir);
  if (!clones.length) throw new Error(`tidak ada file .json clone di ${fileCloneDir}`);

  // 3. tanggal mulai (WIB)
  let tglMulai;
  if (tanggalMulai) {
    tglMulai = tanggalMulai; // string YYYY-MM-DD
  } else {
    const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    tglMulai = nowWib.toISOString().slice(0, 10);
  }

  // 4. anti dobel
  const sudah = ulang ? [] : bacaTerjadwal();
  const sudahSet = new Set(sudah);

  const daftarKirim = clones.filter((c) => !sudahSet.has(c.shortcode));
  const targetKirim = jumlah ? daftarKirim.slice(0, jumlah) : daftarKirim;

  console.log(`\n[pub] akun: ${akunDipilih.name} (@${akunDipilih.username}) — id ${akunDipilih.id}`);
  console.log(`[pub] jam tayang: ${jamTayang} WIB, mulai tanggal ${tglMulai} (WIB)`);
  console.log(`[pub] file clone: ${clones.length}, belum dijadwalkan: ${daftarKirim.length}, akan dikirim: ${targetKirim.length}`);
  if (dryRun) console.log(`[pub] MODE --dry-run (tidak mengirim)`);

  const hasil = [];
  const gagal = [];

  for (let i = 0; i < targetKirim.length; i++) {
    const c = targetKirim[i];
    const { title, description, topic } = susunKonten(c);

    // tanggal jadwal: tglMulai + i hari (5 konten -> 5 hari beruntun)
    const tgl = new Date(Date.parse(tglMulai + "T00:00:00Z"));
    tgl.setUTCDate(tgl.getUTCDate() + i);
    const tanggalIso = tgl.toISOString().slice(0, 10);
    const scheduleAt = wibKeUtc(jamTayang, tanggalIso);

    const payload = {
      accountId: akunDipilih.id,
      title,
      description,
      scheduleAt,
      type: "text",
      topic: topic || "",
      medias: [],
    };

    const errValidasi = validasiPayload(payload);
    const item = { shortcode: c.shortcode, file: c.file, title, scheduleAt, scheduleAtWib: utcKeWib(scheduleAt), payload };

    if (errValidasi.length) {
      gagal.push({ ...item, error: `validasi: ${errValidasi.join("; ")}` });
      console.log(`  [${i + 1}/${targetKirim.length}] ${c.shortcode} -> GAGAL validasi (${errValidasi.join("; ")})`);
      continue;
    }

    if (dryRun) {
      console.log(`  [${i + 1}/${targetKirim.length}] ${c.shortcode} -> (dry-run) ${scheduleAt} (${utcKeWib(scheduleAt)})`);
      hasil.push({ ...item, dryRun: true });
      continue;
    }

    try {
      const resp = await jadwalkan(payload);
      // id jadwal bisa di resp.id / resp._id / resp.docs[0].id / resp.data.id
      const idTerkirim = resp?.id || resp?._id || resp?.docs?.[0]?.id || resp?.data?.id || "";
      console.log(`  [${i + 1}/${targetKirim.length}] ${c.shortcode} -> TERKIRIM${idTerkirim ? ` (id ${idTerkirim})` : ""} @ ${utcKeWib(scheduleAt)}`);
      hasil.push({ ...item, resp });
      // catat anti dobel
      sudahSet.add(c.shortcode);
      simpanTerjadwal([...sudahSet]);
    } catch (e) {
      gagal.push({ ...item, error: e.message });
      console.log(`  [${i + 1}/${targetKirim.length}] ${c.shortcode} -> GAGAL (${e.message})`);
    }
  }

  console.log(`\n[pub] selesai: ${hasil.length} terkirim/dry-run, ${gagal.length} gagal`);
  if (gagal.length) {
    console.log("[pub] detail gagal:");
    for (const g of gagal) console.log(`  - ${g.shortcode}: ${g.error}`);
  }

  // Simpan snapshot jadwal antre (untuk dashboard). Hanya saat bukan dry-run.
  if (!dryRun) {
    try {
      const jadwal = await daftarJadwal({});
      simpanJadwal(jadwal);
      console.log(`[pub] snapshot jadwal tersimpan: ${jadwal.length} antre`);
    } catch (e) {
      console.log(`[pub] (gagal simpan snapshot jadwal: ${e.message})`);
    }
  }

  return { akun: akunDipilih, hasil, gagal, scheduleAtDipakai: hasil.map((h) => h.scheduleAt), terjadwal: [...sudahSet] };
}

module.exports = {
  publishClone,
  daftarAkun,
  daftarJadwal,
  jadwalkan,
  wibKeUtc,
  utcKeWib,
  validasiPayload,
  susunKonten,
  bacaFileClone,
  bacaConfig,
  bacaTerjadwal,
  simpanJadwal,
  bacaJadwal,
  JAM_TAYANG,
  DIR_PUBLISH,
  DIR_CLONE_OUT,
  CONFIG_PATH,
  JADWAL_PATH,
};
