// lib/resend.js
// Kirim email via Resend (https://resend.com).
//
// Fitur:
//   - Blok CONFIG di paling atas (mudah diganti).
//   - Susun alamat pengirim otomatis: "FROM_NAME <FROM_USER@DOMAIN>",
//     atau "FROM_NAME <onboarding@resend.dev>" bila DOMAIN = "-".
//   - Cek kesiapan domain dulu (status verified/belum/didaftar + record DNS).
//   - Kirim dengan Idempotency-Key (anti dobel resmi Resend, kedaluwarsa 24 jam).
//   - Terjemah error Resend ke bahasa manusia.
//   - Pecah "to" > 50 alamat jadi beberapa batch.

const crypto = require("crypto");

// ============================================================================
// SATU BLOK CONFIG DI PALING ATAS — ganti nilainya sesuai kebutuhan.
// RESEND_API_KEY TIDAK ditaruh di sini (diambil dari .env).
// ============================================================================
const CONFIG = {
  DOMAIN: "dirini.id",         // domain pengirim; "-" kalau belum punya
  FROM_NAME: "Cahaya Project", // nama yang muncul di inbox
  FROM_USER: "halo",           // bagian sebelum @, contoh "halo"
  REPLY_TO: "",                // kosongin kalau sama kayak pengirim
  EMAIL_TES: "dewiatika4295@gmail.com", // alamat buat nyoba (diisi saat tes)
};
// ============================================================================

const API_KEY = () => process.env.RESEND_API_KEY || "";
const BASE_URL = "https://api.resend.com";

// --- Susun alamat pengirim ------------------------------------------------
// DOMAIN terisi -> "FROM_NAME <FROM_USER@DOMAIN>"
// DOMAIN "-"    -> "FROM_NAME <onboarding@resend.dev>"
function susunFrom() {
  const { DOMAIN, FROM_NAME, FROM_USER } = CONFIG;
  if (DOMAIN && DOMAIN !== "-") {
    return `${FROM_NAME} <${FROM_USER}@${DOMAIN}>`;
  }
  return `${FROM_NAME} <onboarding@resend.dev>`;
}

// --- Panggil API Resend ---------------------------------------------------
async function panggilResend(path, { method = "GET", body } = {}) {
  if (!API_KEY()) throw new Error("RESEND_API_KEY belum diisi di .env");
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok) {
    throw new Error(terjemahError(res.status, data));
  }
  return data;
}

// --- Terjemah error Resend ke bahasa manusia ------------------------------
function terjemahError(status, data) {
  const msg = data && typeof data === "object" ? (data.message || data.error || "") : String(data || "");
  const statusTeks = {
    401: "API key salah / tidak valid. Cek RESEND_API_KEY di .env.",
    403: "Ditolak (403). Kemungkinan besar domain belum verified. " +
         "Jalankan cek domain untuk lihat record DNS yang harus dipasang.",
    404: "Resource tidak ditemukan (404). Cek ID domain / endpoint.",
    422: "Payload tidak valid (422). Cek field from/to/subject.",
    429: "Terlalu banyak permintaan (429). Tunggu sebentar lalu coba lagi.",
  }[status] || `Resend error HTTP ${status}`;
  return msg ? `${statusTeks} — detail: ${msg}` : statusTeks;
}

// ============================================================================
// 1. CEK DOMAIN
// ============================================================================

// GET /domains -> daftar domain (id, name, status).
async function daftarDomain() {
  return panggilResend("/domains");
}

// GET /domains/:id -> detail (record DNS hanya ada di sini).
async function detailDomain(id) {
  return panggilResend(`/domains/${id}`);
}

// Cari domain CONFIG di daftar, kembalikan status dalam bahasa manusia.
async function cekDomain() {
  const daftar = await daftarDomain();
  const items = Array.isArray(daftar) ? daftar : daftar.data || [];
  const namaDomain = CONFIG.DOMAIN === "-" ? null : CONFIG.DOMAIN;

  if (!namaDomain) {
    // DOMAIN "-" => mode onboarding (tidak perlu domain sendiri).
    return {
      mode: "onboarding",
      pesan: "DOMAIN belum diset (mode onboarding@resend.dev). Tidak perlu cek domain sendiri.",
      status: null,
      records: [],
    };
  }

  const cocok = items.find((d) => d.name === namaDomain);
  if (!cocok) {
    return {
      mode: "custom",
      pesan: "domain belum didaftarin di Resend",
      status: "not-found",
      records: [],
    };
  }

  if (cocok.status !== "verified") {
    const detail = await detailDomain(cocok.id);
    const records = Array.isArray(detail.records) ? detail.records : detail.data?.records || [];
    return {
      mode: "custom",
      pesan: "udah didaftarin tapi belum verified",
      status: cocok.status,
      id: cocok.id,
      records,
    };
  }

  return {
    mode: "custom",
    pesan: "aman, siap kirim",
    status: "verified",
    id: cocok.id,
    records: [],
  };
}

// Format record DNS jadi tabel teks rapi.
function tabelRecords(records) {
  if (!records.length) return "(tidak ada record)";
  const lines = [];
  lines.push("  " + ["TYPE", "NAME", "VALUE", "PRIORITY", "TTL", "STATUS"].join("\t"));
  for (const r of records) {
    lines.push(
      "  " + [
        r.type || "-",
        r.name || "-",
        (r.value || "-").slice(0, 60),
        r.priority ?? "-",
        r.ttl ?? "-",
        r.status || "-",
      ].join("\t")
    );
  }
  return lines.join("\n");
}

// ============================================================================
// 2. KIRIM EMAIL
// ============================================================================

// Buat Idempotency-Key unik per email (hash tujuan + tanggal + isi).
function buatIdempotencyKey({ to, subject, html }) {
  const bahan = JSON.stringify({ to: [].concat(to), subject, html, tgl: new Date().toISOString().slice(0, 10) });
  return crypto.createHash("sha256").update(bahan).digest("hex").slice(0, 32);
}

// Susun body email (from, to, reply_to opsional, subject, html, text).
function susunBody({ tujuan, subject, html, text }) {
  const body = {
    from: susunFrom(),
    to: [].concat(tujuan),
    subject,
    html,
    text: text || "",
  };
  if (CONFIG.REPLY_TO) body.reply_to = CONFIG.REPLY_TO;
  return body;
}

// Kirim satu batch email. Mengembalikan id email Resend.
async function kirimEmail({ tujuan, subject, html, text }) {
  const body = susunBody({ tujuan, subject, html, text });
  const idem = buatIdempotencyKey({ to: tujuan, subject, html });
  return panggilResend("/emails", {
    method: "POST",
    body: {
      ...body,
      headers: { "Idempotency-Key": idem },
    },
  });
}

// Kirim ke daftar tujuan, pecah > 50 alamat jadi beberapa batch.
async function kirimBanyak({ tujuan, subject, html, text }) {
  const list = [].concat(tujuan);
  const batchSize = 50;
  const hasil = [];
  for (let i = 0; i < list.length; i += batchSize) {
    const potong = list.slice(i, i + batchSize);
    const r = await kirimEmail({ tujuan: potong, subject, html, text });
    hasil.push({ batch: i / batchSize + 1, jumlah: potong.length, resp: r });
  }
  return hasil;
}

module.exports = {
  CONFIG,
  susunFrom,
  cekDomain,
  daftarDomain,
  detailDomain,
  tabelRecords,
  kirimEmail,
  kirimBanyak,
  susunBody,
  buatIdempotencyKey,
  terjemahError,
  API_KEY,
};
