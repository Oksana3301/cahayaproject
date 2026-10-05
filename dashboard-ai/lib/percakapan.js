// lib/percakapan.js
// Mencatat percakapan Owner ↔ agent (WhatsApp/UI) ke berkas JSON Lines per tanggal,
// agar seluruh riwayat percakapan terdokumentasi & dapat ditampilkan di section "Percakapan".
//
// Lokasi: <PercakapanDir>/owner-agent/<YYYY-MM-DD>.jsonl
// Env: PERCAKAPAN_DIR (default: <root repo>/percakapan, fallback .hermes3d/percakapan)

const fs = require("fs");
const path = require("path");

function dirPercakapan() {
  if (process.env.PERCAKAPAN_DIR) return process.env.PERCAKAPAN_DIR;
  // Kandidat: repo cahayaproject (jika ada), lalu fallback lokal .hermes3d/percakapan
  const kandidat = [
    path.join(__dirname, "..", "..", "cahayaproject", "percakapan"),
    path.join(__dirname, "..", ".hermes3d", "percakapan"),
  ];
  for (const k of kandidat) {
    try { if (fs.existsSync(path.dirname(k))) return k; } catch { /* lanjut */ }
  }
  return kandidat[1];
}

function tanggalWIB(d = new Date()) {
  const wib = new Date(d.getTime() + 7 * 3600000);
  return wib.toISOString().slice(0, 10);
}

function catat({ arah, nomor, agent, perintah, pesan, balasan, meta }) {
  try {
    const dir = path.join(dirPercakapan(), "owner-agent");
    fs.mkdirSync(dir, { recursive: true });
    const tanggal = tanggalWIB();
    const baris = JSON.stringify({
      waktu: new Date().toISOString(),
      arah,                 // "masuk" | "keluar"
      nomor: nomor || null,
      agent: agent || null,
      perintah: perintah || "-",
      pesan: pesan != null ? String(pesan) : null,
      balasan: balasan != null ? String(balasan) : null,
      ...(meta ? { meta } : {}),
    });
    fs.appendFileSync(path.join(dir, `${tanggal}.jsonl`), baris + "\n");
  } catch (e) {
    console.error("[percakapan] gagal catat:", e.message);
  }
}

// Baca riwayat (untuk UI / API). { tanggal?, batas? }
function baca({ tanggal, batas = 200 } = {}) {
  const dir = path.join(dirPercakapan(), "owner-agent");
  if (!fs.existsSync(dir)) return [];
  let berkas = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  if (tanggal) berkas = berkas.filter((f) => f.startsWith(tanggal));
  const hasil = [];
  for (const f of berkas) {
    const isi = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean);
    for (const l of isi) {
      try { hasil.push(JSON.parse(l)); } catch { /* lewati baris rusak */ }
    }
  }
  hasil.sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
  return hasil.slice(-batas);
}

function daftarTanggal() {
  const dir = path.join(dirPercakapan(), "owner-agent");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, "")).sort().reverse();
}

module.exports = { catat, baca, daftarTanggal, dirPercakapan, tanggalWIB };
