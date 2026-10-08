// lib/resend.js
// SATU-SATUNYA berkas yang memanggil api.resend.com (Misi 2 — outreach email).
//
// Aturan penting (sesuai kontrak):
//   - kirimEmail(): `to` WAJIB SATU alamat string (array -> error).
//   - idempotencyKey kosong -> LEMPAR error (anti dobel).
//   - replyTo -> body.reply_to (snake_case; "replyTo" diabaikan Resend).
//   - text wajib ikut (versi polos).
//   - 401 -> jangan retry; 429/5xx -> backoff 2s/4s/8s.
//   - return { id } = resend_id (BUKAN Message-ID).
//
// Fungsi lama (kirimBanyak untuk laporan harian Part 2) tetap dipertahankan
// agar cron-runner tidak rusak. Outreach TIDAK memakai kirimBanyak/BCC.

const crypto = require("crypto");

const BASE_URL = "https://api.resend.com";
const BACKOFF = [2000, 4000, 8000];

const API_KEY = () => process.env.RESEND_API_KEY || "";
const EMAIL_DOMAIN = () => process.env.EMAIL_DOMAIN || "";
const FROM_NAME = () => process.env.FROM_NAME || "Cahaya Project";
const FROM_EMAIL = () => process.env.FROM_EMAIL || "";
const INBOUND_SUBDOMAIN = () => process.env.INBOUND_SUBDOMAIN || "";

// Kompatibilitas dengan Part 2 (resend-cli.js / cron-runner.js) yang membaca
// R.CONFIG.EMAIL_TES. Nilai default EMAIL_TES diambil dari env bila ada.
const CONFIG = {
  DOMAIN: process.env.EMAIL_DOMAIN || "dirini.id",
  FROM_NAME: process.env.FROM_NAME || "Cahaya Project",
  FROM_USER: (process.env.FROM_EMAIL || "halo@dirini.id").split("@")[0] || "halo",
  REPLY_TO: "",
  EMAIL_TES: process.env.EMAIL_TES || "dewiatika4295@gmail.com",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Susun alamat pengirim: "FROM_NAME <FROM_EMAIL>".
function susunFrom() {
  if (FROM_EMAIL()) return `${FROM_NAME()} <${FROM_EMAIL()}>`;
  if (EMAIL_DOMAIN()) return `${FROM_NAME()} <halo@${EMAIL_DOMAIN()}>`;
  return `${FROM_NAME()} <onboarding@resend.dev>`;
}

// Panggil API Resend dengan backoff untuk 429/5xx. 401 langsung dilempar (tanpa retry).
async function panggilResend(path, { method = "GET", body, headers = {} } = {}) {
  if (!API_KEY()) throw new Error("RESEND_API_KEY belum diisi di .env");
  let lastErr = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${API_KEY()}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      lastErr = e;
      if (attempt >= BACKOFF.length) break;
      await sleep(BACKOFF[attempt]);
      continue;
    }
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

    if (res.status === 401) {
      throw new Error("Resend 401: API key tidak valid. JANGAN retry — minta Owner cek RESEND_API_KEY di .env.");
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Resend HTTP ${res.status}: ${resum(data)}`);
      if (attempt >= BACKOFF.length) throw lastErr;
      await sleep(BACKOFF[attempt]);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Resend HTTP ${res.status}: ${resum(data)}`);
    }
    return data;
  }
  throw lastErr || new Error("Resend gagal tanpa sebab jelas");
}

function resum(data) {
  if (data && typeof data === "object") return (data.message || data.error || JSON.stringify(data)).slice(0, 200);
  return String(data || "").slice(0, 200);
}

// ============================================================================
// KIRIM EMAIL (outreach) — `to` wajib satu alamat string.
// ============================================================================
async function kirimEmail({ to, subject, html, text, replyTo, headers, idempotencyKey }) {
  if (Array.isArray(to)) {
    throw new Error("kirimEmail: 'to' wajib SATU alamat string (bukan array). Outreach tidak boleh batch.");
  }
  if (!to || typeof to !== "string" || !to.includes("@")) {
    throw new Error("kirimEmail: 'to' harus alamat email string yang valid");
  }
  if (!subject || !String(subject).trim()) {
    throw new Error("kirimEmail: 'subject' wajib diisi");
  }
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new Error("kirimEmail: 'idempotencyKey' wajib diisi (unik per pesan)");
  }
  const body = {
    from: susunFrom(),
    to,
    subject,
    html: html || "",
    text: text || html || "",
  };
  if (replyTo) body.reply_to = replyTo; // snake_case, bukan replyTo
  const allHeaders = {
    ...(headers || {}),
    "Idempotency-Key": String(idempotencyKey).slice(0, 256),
  };
  return panggilResend("/emails", {
    method: "POST",
    body,
    headers: allHeaders,
  });
}

// ============================================================================
// KIRIM BANYAK (hanya untuk laporan harian Part 2, BUKAN outreach prospek).
// Kirim SATU per SATU (bukan BCC) demi reputasi. Return {batch, jumlah, resp}
// agar kompatibel dengan cron-runner.js / resend-cli.js.
// ============================================================================
async function kirimBanyak({ tujuan, subject, html, text }) {
  const list = [].concat(tujuan);
  const batchSize = 1;
  const hasil = [];
  for (let i = 0; i < list.length; i += batchSize) {
    const potong = list.slice(i, i + batchSize);
    const idem = crypto.createHash("sha256")
      .update(JSON.stringify({ to: potong, subject, html, tgl: new Date().toISOString() }))
      .digest("hex").slice(0, 32);
    const resp = await kirimEmail({ to: potong[0], subject, html, text, idempotencyKey: "laporan:" + idem });
    hasil.push({ batch: i / batchSize + 1, jumlah: potong.length, resp });
  }
  return hasil;
}

// ============================================================================
// AMBIL EMAIL MASUK (Resend receiving) — GET /emails/receiving/{emailId}
// ============================================================================
async function ambilMasuk(emailId) {
  if (!emailId) throw new Error("ambilMasuk: emailId wajib");
  const data = await panggilResend(`/emails/receiving/${encodeURIComponent(emailId)}`);
  // Bentuk Resend bisa {text, html, headers, ...} atau {data:{...}}
  return data && data.data ? data.data : data;
}

// ============================================================================
// CEK DOMAIN — status EMAIL_DOMAIN dari GET /domains
// ============================================================================
async function cekDomain() {
  const data = await panggilResend("/domains");
  const items = Array.isArray(data) ? data : data.data || [];
  const nama = EMAIL_DOMAIN();
  const cocok = items.find((d) => d.name === nama);
  if (!cocok) return { domain: nama, status: "not-found", verified: false };
  return { domain: nama, status: cocok.status, verified: cocok.status === "verified", id: cocok.id };
}

async function daftarDomain() {
  return panggilResend("/domains");
}

async function detailDomain(id) {
  return panggilResend(`/domains/${id}`);
}

module.exports = {
  BASE_URL,
  CONFIG,
  API_KEY,
  EMAIL_DOMAIN,
  FROM_NAME,
  FROM_EMAIL,
  INBOUND_SUBDOMAIN,
  susunFrom,
  kirimEmail,
  kirimBanyak,
  ambilMasuk,
  cekDomain,
  daftarDomain,
  detailDomain,
  panggilResend,
};
