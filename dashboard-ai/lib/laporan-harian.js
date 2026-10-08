// lib/laporan-harian.js
// Susun & kirim LAPORAN HARIAN agent Sena ke WhatsApp via WAHA.
//
// Isi laporan dibaca dari hasil-hasil script sebelumnya:
//   - Carousel kompetitor dibedah  : dari .hermes3d/sena/output/ringkasan-*.json
//   - Konten dijadwalkan           : dari .hermes3d/sena/publish/terjadwal.json
//   - Tayang berikutnya            : dari GET /schedules (SocialHub/Doea)
//
// Kirim WAHA memakai ulang lib/whatsapp.js (session check, normalisasi nomor,
// retry, multi-pesan) — tidak menulis ulang koneksi WhatsApp.

const fs = require("fs");
const path = require("path");
const { doea } = require("./doea");
const {
  statusSesi,
  kirimTeks,
  normalisasiNomor,
  normalisasiDigit,
} = require("./whatsapp");

const DIR_SENA = path.join(__dirname, "..", ".hermes3d", "sena");
const DIR_OUTPUT = path.join(DIR_SENA, "output");
const DIR_PUBLISH = path.join(DIR_SENA, "publish");
const TERJADWAL_PATH = path.join(DIR_PUBLISH, "terjadwal.json");
const CONFIG_PATH = path.join(DIR_PUBLISH, "config.json");

// Log kirim WhatsApp (untuk dashboard). Struktur: [{ waktu, tujuan, status, error }].
const DIR_WA = path.join(__dirname, "..", ".hermes3d", "wa");
const WA_LOG_PATH = path.join(DIR_WA, "kirim-log.json");

// Nomor tujuan tes (owner). Dipakai sebagai default & pengaman.
function nomorTes() {
  return process.env.NOMOR_TES || process.env.WA_OWNER_NOMOR || process.env.WA_NOTIF_NOMOR || "";
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
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

// Catat log kirim WA (sukses/gagal) ke file. Append ke daftar lama.
function catatKirimWa({ tujuan, status, error = "" }) {
  const list = bacaJSON(WA_LOG_PATH, []);
  list.push({ waktu: new Date().toISOString(), tujuan, status, error });
  tulisJSON(WA_LOG_PATH, list);
}

// --- Kumpulkan data laporan -----------------------------------------------
// Jumlah carousel yang dibedah (jumlah total post UNIK dari semua ringkasan akun).
// File ringkasan bisa tumpang tindih (subset), jadi dedup berdasarkan shortcode.
function ringkasanBedah() {
  if (!fs.existsSync(DIR_OUTPUT)) return { totalPost: 0, akun: [] };
  const perAkun = new Map(); // nama -> Set(shortcode)
  const seen = new Set();
  let totalPost = 0;
  for (const f of fs.readdirSync(DIR_OUTPUT)) {
    if (!f.startsWith("ringkasan-") || !f.endsWith(".json")) continue;
    const d = bacaJSON(path.join(DIR_OUTPUT, f), null);
    if (!d) continue;
    const nama = (d.akun || f).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const posts = Array.isArray(d.posts) ? d.posts : [];
    if (!perAkun.has(nama)) perAkun.set(nama, new Set());
    for (const p of posts) {
      const sc = p?.shortcode || p?.url || null;
      if (!sc) continue;
      if (seen.has(sc)) continue;
      seen.add(sc);
      perAkun.get(nama).add(sc);
      totalPost++;
    }
  }
  const akun = [...perAkun.entries()]
    .filter(([, s]) => s.size > 0)
    .map(([nama, s]) => ({ nama, jumlah: s.size }));
  return { totalPost, akun };
}

// Konten yang sudah dijadwalkan (shortcode dari anti-dobel).
function kontenDijadwalkan() {
  const list = bacaJSON(TERJADWAL_PATH, []);
  const config = bacaJSON(CONFIG_PATH, {});
  return { shortcodes: Array.isArray(list) ? list : [], akun: config };
}

// Jadwal tayang berikutnya (status pending, scheduleAt >= sekarang, urut naik).
async function tayangBerikutnya() {
  try {
    const r = await doea("GET", "/schedules");
    const docs = Array.isArray(r) ? r : r.docs || [];
    const now = Date.now();
    const pending = docs
      .filter((j) => !j.status || j.status === "pending")
      .map((j) => ({ id: j.id || j._id, title: j.title || "", scheduleAt: j.scheduleAt, status: j.status }))
      .filter((j) => j.scheduleAt && new Date(j.scheduleAt).getTime() >= now)
      .sort((a, b) => new Date(a.scheduleAt) - new Date(b.scheduleAt));
    return pending[0] || null;
  } catch (e) {
    return { error: e.message };
  }
}

// Format jam WIB dari ISO UTC.
function wibDariIso(isoUtc) {
  const d = new Date(isoUtc);
  return new Date(d.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d{2}\.\d{3}Z$/, "");
}

// Bangun teks laporan harian (SATU pesan, ringkas).
function susunLaporan({ bedah, jadwal, tayang }) {
  const tgl = new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const baris = [];
  baris.push(`📊 *Laporan Harian — ${tgl}*`);
  baris.push(`_${new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 16)} WIB_`);
  baris.push("");

  // 1. Carousel dibedah
  if (bedah.totalPost > 0) {
    baris.push(`• Carousel kompetitor dibedah: *${bedah.totalPost} post*`);
    for (const a of bedah.akun) baris.push(`    - ${a.nama}: ${a.jumlah}`);
  } else {
    baris.push("• Carousel kompetitor dibedah: -");
  }

  // 2. Konten dijadwalkan
  if (jadwal.shortcodes.length > 0) {
    baris.push(`• Konten dijadwalkan: *${jadwal.shortcodes.length}*`);
  } else {
    baris.push("• Konten dijadwalkan: -");
  }

  // 3. Tayang berikutnya
  if (tayang && tayang.scheduleAt) {
    baris.push(`• Tayang berikutnya: *${wibDariIso(tayang.scheduleAt)} WIB*`);
    baris.push(`    - ${tayang.title}`);
  } else if (tayang && tayang.error) {
    baris.push("• Tayang berikutnya: (gagal baca jadwal)");
  } else {
    baris.push("• Tayang berikutnya: (belum ada)");
  }

  baris.push("");
  baris.push("🤖 Dikirim otomatis oleh Sena.");
  return baris.join("\n");
}

// --- Kirim laporan --------------------------------------------------------
// opsi: { dryRun, nomor, retry, jedaRetryMs }
async function kirimLaporanHarian({
  dryRun = false,
  nomor = null,
  retry = true,
  jedaRetryMs = 5000,
} = {}) {
  // 1. Cek session dulu (wajib, sesuai langkah 1).
  let sesi;
  try {
    sesi = await statusSesi();
  } catch (e) {
    throw new Error(`tidak bisa cek session WAHA: ${e.message}`);
  }
  if (sesi.status !== "WORKING") {
    throw new Error(
      `session WAHA "${sesi.nama}" tidak WORKING (status: ${sesi.status}). ` +
      (sesi.status === "SCAN_QR_CODE" ? "Belum discan — scan QR dulu di WAHA." : "Cek koneksi WAHA.")
    );
  }

  // 2. Susun isi laporan.
  const bedah = ringkasanBedah();
  const jadwal = kontenDijadwalkan();
  const tayang = await tayangBerikutnya();
  const teks = susunLaporan({ bedah, jadwal, tayang });

  // 3. Tentukan nomor tujuan + pengaman.
  const tes = nomorTes();
  const tujuan = nomor ? normalisasiNomor(nomor) : normalisasiNomor(tes);
  if (!tujuan) throw new Error("NOMOR_TES belum diisi di .env dan tidak ada --nomor");

  // Pengaman: kalau tujuan bukan nomor tes, minta konfirmasi dulu.
  if (nomor && nomorTes() && normalisasiDigit(nomor) !== normalisasiDigit(nomorTes())) {
    const konfirmasi = process.env.CONFIRM_KIRIM === "1" || process.argv.includes("--iya");
    if (!konfirmasi) {
      throw new Error(
        `nomor tujuan (${normalisasiDigit(nomor)}) BUKAN NOMOR_TES (${normalisasiDigit(nomorTes())}). ` +
        `Kirim ulang dengan --iya untuk konfirmasi, atau ubah --nomor ke nomor tes.`
      );
    }
  }

  const hasil = { session: sesi, nomorTujuan: tujuan, dryRun, teks, terkirim: null };

  if (dryRun) {
    return hasil;
  }

  // 4. Kirim (dengan retry 1x setelah 5 detik).
  const cobaKirim = async () => kirimTeks(tujuan, teks);
  try {
    const r = await cobaKirim();
    hasil.terkirim = r;
    catatKirimWa({ tujuan, status: "sukses" });
  } catch (e) {
    if (retry) {
      await new Promise((res) => setTimeout(res, jedaRetryMs));
      try {
        const r2 = await cobaKirim();
        hasil.terkirim = r2;
        hasil.retried = true;
        catatKirimWa({ tujuan, status: "sukses" });
      } catch (e2) {
        catatKirimWa({ tujuan, status: "gagal", error: e2.message });
        throw new Error(`gagal kirim (setelah retry): ${e2.message} | error awal: ${e.message}`);
      }
    } else {
      catatKirimWa({ tujuan, status: "gagal", error: e.message });
      throw new Error(`gagal kirim: ${e.message}`);
    }
  }
  return hasil;
}

module.exports = {
  kirimLaporanHarian,
  susunLaporan,
  ringkasanBedah,
  kontenDijadwalkan,
  tayangBerikutnya,
  nomorTes,
  wibDariIso,
  catatKirimWa,
  WA_LOG_PATH,
};
