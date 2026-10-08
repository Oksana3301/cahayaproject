// lib/webhook-resend.js — Handler webhook Resend (Fase 5).
// J1: verifikasi Svix dari RAW body (Buffer) SEBELUM JSON.parse.
const { Webhook } = require("svix");
const db = require("./db");
const resend = require("./resend");
const outreach = require("./outreach");

function verifikasi(rawBody, headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  if (!secret) return { ok: false, alasan: "RESEND_WEBHOOK_SECRET kosong" };
  try {
    const wh = new Webhook(secret);
    wh.verify(rawBody, headers);
    return { ok: true };
  } catch (e) {
    return { ok: false, alasan: e.message };
  }
}

// Potong kutipan lama (email klien biasanya menyertakan utas sebelumnya).
function potongKutipan(isi) {
  if (!isi) return "";
  const batas = isi.search(/On .+ wrote:|Pada .+ menulis:|On .+, .+ wrote:/i);
  return batas >= 0 ? isi.slice(0, batas).trim() : isi.trim();
}

function regexProspekId(teks) {
  const m = String(teks || "").match(/p(\d+)@/);
  return m ? Number(m[1]) : null;
}

async function cocokkanProspek(data) {
  // a. regex ^p(\d+)@ di received_for[] lalu to[]
  const kandidat = [].concat(data.received_for || [], data.to || []);
  for (const k of kandidat) {
    const id = regexProspekId(k);
    if (id) return id;
  }
  // b. In-Reply-To / References vs referensi_thread
  const inReplyTo = data.message_id ? null : null; // header masuk tidak ada di payload metadata
  // Payload email.received tidak bawa In-Reply-To; cari via ambilMasuk headers.
  return null;
}

async function handleSent(data) {
  // data.email_id = resend_id. Isi message_id ke pesan.
  const resendId = data.email_id;
  if (!resendId) return { event: "email.sent", status: "noop" };
  const messageId = data.message_id || null;
  const r = await db.query(
    `UPDATE pesan SET message_id = COALESCE($2, message_id) WHERE resend_id = $1 RETURNING id`,
    [resendId, messageId]
  );
  if (r.rows.length && messageId) {
    await db.query(`UPDATE prospek SET message_id_terakhir = $1, referensi_thread = CASE WHEN referensi_thread IS NULL OR referensi_thread = '' THEN $1 ELSE referensi_thread || ' ' || $1 END WHERE id = (SELECT prospek_id FROM pesan WHERE resend_id = $2 LIMIT 1)`, [messageId, resendId]);
  }
  return { event: "email.sent", status: r.rows.length ? "updated" : "notfound", resendId };
}

async function handleDelivered(data) {
  const resendId = data.email_id;
  if (!resendId) return { event: "email.delivered", status: "noop" };
  await db.query(`UPDATE pesan SET status_kirim = 'delivered' WHERE resend_id = $1`, [resendId]);
  return { event: "email.delivered", status: "ok" };
}

async function handleBouncedComplained(data, jenis) {
  const resendId = data.email_id;
  const catatan = (data.type || jenis) + (data.reason ? ": " + data.reason : "");
  if (resendId) {
    await db.query(`UPDATE pesan SET status_kirim = $1 WHERE resend_id = $2`, [jenis, resendId]);
  }
  // tandai prospek tidak pernah dikirimi lagi
  const p = resendId
    ? await db.ambilSatu(`SELECT prospek_id FROM pesan WHERE resend_id = $1 LIMIT 1`, [resendId])
    : null;
  if (p && p.prospek_id) {
    await db.query(`UPDATE prospek SET email_valid = false, catatan = COALESCE(catatan,'') || $1 WHERE id = $2`, [" | " + jenis + ": " + catatan, p.prospek_id]);
  }
  // jalankan cekReputasi
  await outreach.jalankanCekReputasi().catch((e) => console.error("[webhook] cekReputasi gagal:", e.message));
  return { event: "email." + jenis, status: "ok" };
}

async function handleReceived(data, rawBody) {
  const emailId = data.email_id;
  if (!emailId) return { event: "email.received", status: "noop" };
  const masuk = await resend.ambilMasuk(emailId).catch((e) => ({ error: e.message }));
  if (masuk.error) return { event: "email.received", status: "ambilMasuk gagal", error: masuk.error };

  const teks = masuk.text || masuk.html || "";
  const fromEmail = masuk.from || (data.from && data.from[0]) || null;

  // cocokkan prospek
  let prospekId = cocokkanProspek(data);
  if (!prospekId) {
    // coba dari header In-Reply-To / References di email masuk
    const headers = masuk.headers || {};
    const refs = headers["in-reply-to"] || headers["references"] || "";
    const r = await db.ambilSatu(`SELECT id FROM prospek WHERE referensi_thread IS NOT NULL AND $1 LIKE '%' || message_id_terakhir || '%' LIMIT 1`, [refs]);
    if (r) prospekId = r.id;
  }

  const isiBersih = potongKutipan(teks);

  if (prospekId) {
    const p = await db.ambilSatu(`SELECT * FROM prospek WHERE id = $1`, [prospekId]);
    // STOP / unsubscribe
    if (/^\s*(stop|unsubscribe|berhenti)\s*$/i.test(isiBersih) || (masuk.subject && /unsubscribe/i.test(masuk.subject))) {
      await db.query(`UPDATE prospek SET tahap = 'tolak', catatan = COALESCE(catatan,'') || ' | berhenti (STOP/unsubscribe)' WHERE id = $1`, [prospekId]);
      await db.query(`INSERT INTO pesan (prospek_id, arah, dari_email, subject, isi, message_id, sudah_dibalas) VALUES ($1,'masuk',$2,$3,$4,$5,true)`, [prospekId, fromEmail, masuk.subject || null, isiBersih, data.message_id || null]);
      return { event: "email.received", status: "stop", prospekId };
    }
    // simpan baris masuk
    await db.query(`INSERT INTO pesan (prospek_id, arah, dari_email, subject, isi, message_id, in_reply_to, sudah_dibalas) VALUES ($1,'masuk',$2,$3,$4,$5,$6,false)`, [prospekId, fromEmail, masuk.subject || null, isiBersih, data.message_id || null, null]);
    await db.query(`UPDATE prospek SET tahap = 'sudah_contact', terakhir_dihubungi = now() WHERE id = $1`, [prospekId]);
    // buat tugas "tangani balasan prospek <id>" kalau belum ada
    const sudah = await db.ambilSatu(`SELECT 1 FROM tugas WHERE judul = $1 AND status IN ('menunggu','perlu_persetujuan') LIMIT 1`, ["tangani balasan prospek " + prospekId]);
    if (!sudah) {
      await db.query(`INSERT INTO tugas (judul, isi, status, agent_yang_boleh, agent_pemilik, dibuat_oleh) VALUES ($1,$2,'menunggu',$3,$4,'sistem')`, ["tangani balasan prospek " + prospekId, "prospek " + prospekId, ["humas"], "humas"]);
    }
    return { event: "email.received", status: "terpaut", prospekId };
  }

  // tidak terpaut
  await db.query(`INSERT INTO pesan (prospek_id, arah, dari_email, subject, isi, message_id, catatan) VALUES (NULL,'masuk',$1,$2,$3,$4,'balasan tak terpaut')`, [fromEmail, masuk.subject || null, isiBersih, data.message_id || null]);
  return { event: "email.received", status: "tak terpaut" };
}

async function tanganiWebhook(rawBody, headers) {
  const v = verifikasi(rawBody, headers);
  if (!v.ok) {
    const err = new Error("verifikasi Svix gagal: " + v.alasan);
    err.status = 400;
    throw err;
  }
  const data = JSON.parse(rawBody.toString("utf8"));
  const jenis = data.type || data.event || "";
  const payload = data.data || data;

  let hasil;
  if (jenis === "email.sent") hasil = await handleSent(payload);
  else if (jenis === "email.delivered") hasil = await handleDelivered(payload);
  else if (jenis === "email.bounced") hasil = await handleBouncedComplained(payload, "bounced");
  else if (jenis === "email.complained") hasil = await handleBouncedComplained(payload, "complained");
  else if (jenis === "email.received") hasil = await handleReceived(payload, rawBody);
  else hasil = { event: jenis, status: "diabaikan" };

  return hasil;
}

module.exports = { tanganiWebhook, verifikasi };
