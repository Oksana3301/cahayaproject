// lib/whatsapp.js
// Kirim pesan WhatsApp via gateway WAHA (WhatsApp HTTP API) yang sudah berjalan
// di server ini sebagai container Docker (127.0.0.1:3000, session "tophillshape").
//
// Konfigurasi (env, sudah ada / dapat diisi di .env):
//   WAHA_BASE_URL   default: http://127.0.0.1:3000
//   WAHA_API_KEY    (wajib) X-Api-Key
//   WAHA_SESSION    default: tophillshape
//
// Nomor Indonesia dinormalisasi ke format internasional: 08xx -> 628xx,
// dan ditambah akhiran "@c.us" untuk chat pribadi.

const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const WAHA_SESSION = process.env.WAHA_SESSION || "tophillshape";

function apiKey() {
  return process.env.WAHA_API_KEY || "";
}

// 0895610524580 / +62 895... / 62895... -> "62895610524580@c.us"
function normalisasiNomor(nomor) {
  let n = String(nomor || "").replace(/[^0-9]/g, "");
  if (!n) throw new Error("nomor WhatsApp kosong");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  else if (n.startsWith("620")) n = "62" + n.slice(3);
  else if (!n.startsWith("62")) n = "62" + n;
  return n + "@c.us";
}

async function panggilWa(path, { method = "POST", body } = {}) {
  const url = `${WAHA_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok) {
    throw new Error(`WAHA ${method} ${path} gagal (HTTP ${res.status}): ${txt.slice(0, 300)}`);
  }
  return data;
}

// Kirim teks. Mengembalikan { ok, id, ke }.
async function kirimTeks(nomor, teks, { session = WAHA_SESSION } = {}) {
  if (!apiKey()) throw new Error("WAHA_API_KEY belum diisi (env)");
  const chatId = normalisasiNomor(nomor);
  const text = String(teks || "").trim();
  if (!text) throw new Error("teks WhatsApp kosong");
  const r = await panggilWa("/api/sendText", {
    body: { session, chatId, text },
  });
  return { ok: true, id: r?.id?._serialized || r?.id?.id || null, ke: chatId };
}

// Cek status koneksi session WAHA.
async function statusSesi(session = WAHA_SESSION) {
  const r = await panggilWa(`/api/sessions/${session}`, { method: "GET" });
  return { nama: r?.name, status: r?.status, nomor: r?.me?.id || null, pushName: r?.me?.pushName || null };
}

// Bangun ringkasan rapat (ramah WhatsApp: SATU pesan, ringkas, tidak spam).
// hasil = { jenis, label, agenda, diundang[], pendapat[], notulen }
function ringkasRapatUntukWa(hasil, { maxPendapat = 3, maxNotulen = 2600 } = {}) {
  const jenis = hasil?.jenis || "manual";
  const judul = {
    pagi: "☀️ RAPAT PAGI — Daily Standup",
    siang: "🕐 RAPAT SIANG — Progress Update",
    sore: "🌙 RAPAT SORE — Rekap Harian",
    manual: "RAPAT CAHAYA PROJECT",
  }[jenis] || "RAPAT CAHAYA PROJECT";

  const agenda = hasil?.agenda || "(tanpa agenda)";
  const diundang = (hasil?.diundang || []).join(", ") || "-";

  // Rapat SORE: notulen sudah berupa REKAP HARIAN lengkap -> kirim utuh.
  // Rapat lain: sertakan sekilas pendapat + notulen.
  const pendapat = (hasil?.pendapat || [])
    .slice(0, maxPendapat)
    .map((p) => `• ${p.nama || p.kode || "?"}: ${String(p.pendapat || "").replace(/\s+/g, " ").slice(0, 320)}`)
    .join("\n");

  let notulen = String(hasil?.notulen || "").trim();
  if (notulen.length > maxNotulen) notulen = notulen.slice(0, maxNotulen) + " …";

  const jamKirim = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

  const baris = [
    `*${judul}*`,
    `_${jamKirim} WIB_`,
    "",
    `Agenda: ${agenda}`,
    `Dihadiri: ${diundang}`,
    "",
    pendapat && jenis !== "sore" ? "• *Pendapat singkat:*\n" + pendapat + "\n" : "",
    jenis === "sore" ? "*REKAP HARIAN (semua notulen + next action):*\n" : "*Notulen:*\n",
    notulen || "(belum ada)",
  ];
  return baris.filter((x) => x !== "").join("\n");
}

module.exports = { kirimTeks, statusSesi, normalisasiNomor, ringkasRapatUntukWa, WAHA_SESSION };
