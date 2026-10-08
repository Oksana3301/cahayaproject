// lib/pitch.js — Draft & kirim pitch outreach (Fase 4 & 6).
const { chatJSON } = require("./llm");
const db = require("./db");
const outreach = require("./outreach");

// ============================================================================
// CEK KATA TERLARANG (Fase 4.2)
// ============================================================================
function cekKataTerlarang(teks, kataTerlarang) {
  const daftar = [].concat(kataTerlarang || []).filter(Boolean);
  const teksLower = String(teks || "").toLowerCase();
  const ketemu = daftar.filter((k) => teksLower.includes(String(k).toLowerCase()));
  return ketemu;
}

// ============================================================================
// DRAFT PITCH (Fase 4.1)
// ============================================================================
async function draftPitch(prospekId) {
  const p = await db.ambilSatu(`SELECT * FROM prospek WHERE id = $1`, [prospekId]);
  if (!p) throw new Error(`prospek ${prospekId} tidak ditemukan`);
  if (!p.email) throw new Error(`prospek ${prospekId} tanpa email, tidak bisa draft pitch`);

  const pengaturan = await outreach.semuaPengaturan();
  const kataTerlarang = pengaturan.kata_terlarang || [];

  const system = [
    "Kamu Humas Cahaya Project, Manajer Kemitraan. Tulis email outreach (pitch) untuk calon client/partner.",
    `Tujuan sasaran: ${pengaturan.tujuan || "client+partner"}.`,
    `Tawaran client: ${pengaturan.tawaran_client || ""}`,
    `Tawaran partner: ${pengaturan.tawaran_partner || ""}`,
    `Nilai inti (hook): ${pengaturan.nilai_inti || ""}`,
    `Nada: ${pengaturan.nada || "santai tapi profesional"}`,
    `Kata/janji yang DILARANG muncul: ${kataTerlarang.join(", ") || "-"}`,
    "",
    "ATURAN TULIS:",
    "- Maksimal 120 kata.",
    "- Sebut SATU hal spesifik dari bisnis/kategori prospek (jangan generik).",
    "- Jelaskan kenapa menghubungi (satu kalimat, jujur, relevan).",
    "- Satu ajakan balas yang ringan (bukan CTA agresif).",
    '- Penutup WAJIB: "Kalau nggak relevan, balas STOP aja, saya nggak akan ganggu lagi."',
    "- Tanpa lampiran/gambar, maksimal SATU tautan.",
    "- Jangan janjikan hasil finansial, jangan klaim absolut tanpa bukti.",
  ].join("\n");

  const user = [
    "Data prospek:",
    `Nama: ${p.nama || "(tidak diketahui)"}`,
    `Kategori: ${p.kategori || "-"}`,
    `Deskripsi: ${(p.deskripsi || "").slice(0, 400)}`,
    `Kota: ${p.kota || "-"}`,
    `Website: ${p.website || "-"}`,
    `Instagram: ${p.instagram || "-"}`,
    `Sumber: ${p.sumber || "-"}`,
    "",
    'Balas JSON {"subject":"...","email":"..."}',
  ].join("\n");

  const hasil = await chatJSON({ agent: "humas", skill: "pr", messages: [{ role: "system", content: system }, { role: "user", content: user }], maxTokens: 1200, noReasoning: true });
  const subject = hasil.subject || hasil.judul || "";
  const email = hasil.email || hasil.isi || hasil.body || "";
  if (!email.trim()) throw new Error("draftPitch: email kosong dari LLM");

  return { subject, email };
}

// ============================================================================
// SIMPAN DRAFT PITCH KE GERBANG PERSETUJUAN (Fase 4.3)
// ============================================================================
async function mintaPersetujuanPitch(prospekId) {
  const p = await db.ambilSatu(`SELECT * FROM prospek WHERE id = $1`, [prospekId]);
  if (!p) throw new Error(`prospek ${prospekId} tidak ditemukan`);

  const draft = await draftPitch(prospekId);
  const pengaturan = await outreach.semuaPengaturan();
  const kataTerlarang = pengaturan.kata_terlarang || [];
  const langgar = cekKataTerlarang(draft.subject + " " + draft.email, kataTerlarang);

  let catatan = null;
  if (langgar.length) {
    // Ulangi sekali dengan peringatan.
    const system2 = [
      "Email kamu mengandung kata terlarang. Tulis ulang TANPA kata berikut: " + langgar.join(", "),
      "Balas JSON {\"subject\":\"...\",\"email\":\"...\"}",
    ].join("\n");
    try {
      const ulang = await chatJSON({ agent: "humas", skill: "pr", messages: [{ role: "system", content: system2 }, { role: "user", content: "Tulis ulang email pitch yang bersih." }], maxTokens: 1200, noReasoning: true });
      draft.subject = ulang.subject || draft.subject;
      draft.email = ulang.email || draft.email;
      const langgar2 = cekKataTerlarang(draft.subject + " " + draft.email, kataTerlarang);
      if (langgar2.length) catatan = "MASIH mengandung kata terlarang: " + langgar2.join(", ") + " (JANGAN auto-kirim)";
    } catch (e) {
      catatan = "MASIH mengandung kata terlarang: " + langgar.join(", ") + " (JANGAN auto-kirim)";
    }
  }

  // Simpan subject_awal + pitch ke prospek (sebelum persetujuan)
  await db.query(`UPDATE prospek SET subject_awal = $1, pitch = $2 WHERE id = $3`, [draft.subject, draft.email, prospekId]);

  // Simpan ke tabel tugas (persetujuan).
  const hasil = { jenis: "pitch", prospek_id: prospekId, subject: draft.subject, isi: draft.email, kata_terlarang: langgar.length ? langgar : [] };
  await db.query(
    `INSERT INTO tugas (judul, isi, status, agent_yang_boleh, agent_pemilik, dibuat_oleh, hasil)
     VALUES ($1, $2, 'perlu_persetujuan', $3, $4, $5, $6)`,
    [`Pitch untuk ${p.nama || ("#" + prospekId)}`, draft.email.slice(0, 500), ["humas"], "humas", "humas", JSON.stringify(hasil)]
  );

  return { prospekId, subject: draft.subject, email: draft.email, kata_terlarang: langgar, catatan };
}

// ============================================================================
// KIRIM EMAIL (Fase 6) — pengaman reputasi + kuota + jeda.
// ============================================================================
const resend = require("./resend");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Idempotency-Key unik per pengiriman (J4): maks 256 char, berlaku 24 jam.
// Dipakai untuk mencegah kirim ganda pada retry jaringan, TAPI tetap unik
// antar-pengiriman nyata (agar kirim pitch yang sama 2x = 2 email, bukan dedupe).
function buatIdempotensi(prefix) {
  const acak = Math.random().toString(36).slice(2, 10);
  return (prefix + ":" + Date.now().toString(36) + ":" + acak).slice(0, 256);
}

// Versi teks polos dari HTML (sederhana, buang tag).
function htmlKeTeks(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Jeda acak 20-90 detik antar email keluar (Fase 6.4).
async function jedaAntarEmail() {
  const ms = 20000 + Math.floor(Math.random() * 70000);
  await sleep(ms);
}

async function _cekBolehKirim(p) {
  // rem reputasi aktif -> tolak
  const rem = await outreach.cekRemReputasi();
  if (rem && rem.aktif) {
    throw new Error("rem reputasi aktif, semua pengiriman dihentikan: " + (rem.alasan || ""));
  }
  // lewati tolak/bounce/complain/email tidak valid
  if (p.tahap === "tolak") throw new Error("prospek sudah menolak (STOP/unsubscribe)");
  if (p.email_valid === false) throw new Error("email tidak valid, tidak dikirim");
  // cek domain MX
  const cek = await outreach.cekEmail(p.email);
  if (!cek.valid) {
    await db.query(`UPDATE prospek SET email_valid = false, catatan = COALESCE(catatan, '') || $1 WHERE id = $2`, [" | email tidak valid: " + cek.alasan, p.id]);
    throw new Error("email tidak valid: " + cek.alasan);
  }
}

async function _kirimDenganKuota({ to, subject, html, text, replyTo, headers, idempotencyKey }) {
  // klaim jatah
  const dapat = await outreach.klaimJatah();
  if (!dapat) throw new Error("kuota harian penuh, tunda sampai besok");
  try {
    const r = await resend.kirimEmail({ to, subject, html, text, replyTo, headers, idempotencyKey });
    return r;
  } catch (e) {
    await outreach.kembalikanJatah();
    throw e;
  }
}

// KIRIM PITCH (Fase 6.2) — dipanggil dari tombol Setujui.
async function kirimPitch(prospekId) {
  const p = await db.ambilSatu(`SELECT * FROM prospek WHERE id = $1`, [prospekId]);
  if (!p) throw new Error(`prospek ${prospekId} tidak ditemukan`);
  if (!p.email) throw new Error("prospek tanpa email");
  await _cekBolehKirim(p);

  const replyTo = "p" + p.id + "@" + process.env.INBOUND_SUBDOMAIN;
  const headers = {
    "List-Unsubscribe": "<mailto:" + replyTo + "?subject=unsubscribe>",
  };
  const subject = p.subject_awal || "Halo dari Cahaya Project";
  const html = p.pitch || "";
  const text = htmlKeTeks(html);

  await jedaAntarEmail();
  const r = await _kirimDenganKuota({
    to: p.email,
    subject,
    html,
    text,
    replyTo,
    headers,
    idempotencyKey: buatIdempotensi("pitch:" + p.id),
  });

  // simpan resend_id + baris pesan 'keluar'; JANGAN GET message_id (J3).
  await db.query(`UPDATE prospek SET resend_id_terakhir = $1, tahap = 'sudah_contact', terakhir_dihubungi = now() WHERE id = $2`, [r.id, p.id]);
  await db.query(
    `INSERT INTO pesan (prospek_id, arah, dari_email, subject, isi, resend_id, status_kirim)
     VALUES ($1, 'keluar', $2, $3, $4, $5, 'terkirim')`,
    [p.id, process.env.FROM_EMAIL, subject, html, r.id]
  );

  // catat tanggal email pertama sepanjang masa
  const tglPertama = await outreach.ambilPengaturan("tanggal_email_pertama");
  if (!tglPertama) await outreach.simpanPengaturan("tanggal_email_pertama", new Date().toISOString().slice(0, 10));

  return { resend_id: r.id, to: p.email, tahap: "sudah_contact" };
}

// KIRIM BALASAN (Fase 7.1d) — threaded.
async function kirimBalasan(prospekId, pesanMasukId) {
  const p = await db.ambilSatu(`SELECT * FROM prospek WHERE id = $1`, [prospekId]);
  if (!p) throw new Error(`prospek ${prospekId} tidak ditemukan`);
  const masuk = await db.ambilSatu(`SELECT * FROM pesan WHERE id = $1 AND arah = 'masuk'`, [pesanMasukId]);
  if (!masuk) throw new Error(`pesan masuk ${pesanMasukId} tidak ditemukan`);
  await _cekBolehKirim(p);

  // ambil balasan yang sudah disiapkan (di hasil tugas / prospek.pitch? gunakan kolom sementara).
  // Balasan siap-kirim disimpan di prospek.catatan? Lebih baik ambil dari tugas.
  const t = await db.ambilSatu(
    `SELECT * FROM tugas WHERE hasil->>'jenis' = 'balasan' AND hasil->>'prospek_id' = $1::text AND status = 'perlu_persetujuan' ORDER BY dibuat_pada DESC LIMIT 1`,
    [prospekId]
  );
  const isi = (t && t.hasil && t.hasil.isi) || "";
  const subjectBalas = (t && t.hasil && t.hasil.subject) || ("Re: " + (p.subject_awal || "").replace(/^Re:\s*/i, ""));

  const replyTo = "p" + p.id + "@" + process.env.INBOUND_SUBDOMAIN;
  const headers = {
    "List-Unsubscribe": "<mailto:" + replyTo + "?subject=unsubscribe>",
    "In-Reply-To": masuk.message_id || "",
    "References": (p.referensi_thread || masuk.message_id || "").trim(),
  };
  const text = htmlKeTeks(isi);

  await jedaAntarEmail();
  const r = await _kirimDenganKuota({
    to: p.email,
    subject: subjectBalas,
    html: isi,
    text,
    replyTo,
    headers,
    idempotencyKey: buatIdempotensi("reply:" + p.id + ":" + pesanMasukId),
  });

  // catat 'keluar' + tandai sudah_dibalas di transaksi yang sama.
  await db.query(
    `INSERT INTO pesan (prospek_id, arah, dari_email, subject, isi, resend_id, in_reply_to, status_kirim)
     VALUES ($1, 'keluar', $2, $3, $4, $5, $6, 'terkirim')`,
    [p.id, process.env.FROM_EMAIL, subjectBalas, isi, r.id, masuk.message_id || null]
  );
  await db.query(`UPDATE pesan SET sudah_dibalas = true WHERE id = $1`, [pesanMasukId]);
  await db.query(`UPDATE prospek SET resend_id_terakhir = $1, terakhir_dihubungi = now(), tahap = 'sudah_contact' WHERE id = $2`, [r.id, p.id]);

  return { resend_id: r.id, to: p.email };
}

module.exports = { draftPitch, cekKataTerlarang, mintaPersetujuanPitch, kirimPitch, kirimBalasan };
