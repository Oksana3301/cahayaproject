// lib/publish.js
// Alur publish Cahaya Project ke Instagram (via Doea hub: hub.doea.net/v1).
//
// PENTING (temuan hasil uji end-to-end):
//   Instagram Graph API WAJIB punya media. Schedule dengan type:"text" TANPA
//   medias selalu GAGAL dengan "invalid postId: unsupported type schedule".
//   Karena itu publish di sini SELALU:
//     1) generate banner (lib/banner.js) dari caption,
//     2) host banner di URL publik (https://<PUBLIC_HOST>/media/<nama>),
//     3) buat schedule Doea dengan type:"image" + medias:[{url,type:"image"}].
//
// Catatan: IG hanya menerima 1 gambar per post (single image), feed 1080x1080.

const fs = require("fs");
const path = require("path");
const { doea } = require("./doea");
const { buatBanner } = require("./banner");
const { hitungNextRunMs } = require("./jembatan");

const PUBLIC_HOST = process.env.PUBLIC_MEDIA_HOST || "https://agentsocmed.dirini.space";

function akunUtama() {
  return doea("GET", "/accounts").then((r) => (r.docs || [])[0] || null);
}

// Buat schedule publish ke Doea. Mengembalikan { ok, scheduleId, mediaUrl, ... }.
//   { caption, title?, scheduleAt (ISO), accountId?, badge?, dryRun? }
async function buatSchedulePublish({ caption, title, scheduleAt, accountId, badge, dryRun } = {}) {
  const cap = String(caption || "").trim();
  if (!cap) throw new Error("caption wajib diisi untuk publish");

  const akun = accountId ? { _id: accountId } : await akunUtama();
  if (!akun || !akun._id) throw new Error("tidak ada akun Instagram terhubung di Doea");

  // 1) banner dari caption
  const banner = await buatBanner({ caption: cap, judul: title, badge: badge || "Insight Harian" });
  const mediaUrl = `${PUBLIC_HOST}/media/${banner.nama}`;

  // 2) judul singkat (IG pakai caption=description; title untuk internal Doea)
  const judul = String(title || banner.meta.judul || cap.split("\n")[0] || "Cahaya Project").slice(0, 200);

  // 3) waktu: default 19:30 WIB hari ini/besok terdekat
  const when = scheduleAt || defaultScheduleAt1930();

  const body = {
    accountId: akun._id,
    title: judul,
    description: cap,
    scheduleAt: when,
    type: "image",
    topic: judul,
    medias: [{ url: mediaUrl, type: "image" }],
  };

  if (dryRun) {
    return { ok: true, dryRun: true, body, mediaUrl, bannerNama: banner.nama, scheduleAt: when };
  }

  const r = await doea("POST", "/schedules", { body });
  const scheduleId = r?.result?.scheduleId || r?.scheduleId || r?._id || r?.result?._id || null;
  return { ok: Boolean(scheduleId), scheduleId, mediaUrl, bannerNama: banner.nama, scheduleAt: when, raw: r };
}

// 19:30 WIB terdekat (hari ini bila belum lewat, selain itu besok).
function defaultScheduleAt1930(fromMs = Date.now()) {
  const WIB = 7 * 3600000;
  const nowWib = new Date(fromMs + WIB);
  const target = new Date(nowWib);
  target.setUTCHours(19, 30, 0, 0); // "UTC" lokal WIB
  let targetMs = target.getTime() - WIB; // kembali ke epoch UTC
  if (targetMs <= fromMs + 60 * 1000) targetMs += 24 * 3600000;
  return new Date(targetMs).toISOString();
}

// Perbarui schedule yang sudah ada (PUT). Wajib: title, description, scheduleAt.
// Opsional: type, topic, medias.
async function perbaruiSchedule(scheduleId, { caption, title, scheduleAt, medias, type = "image", topic } = {}) {
  const cap = String(caption || "").trim();
  if (!cap) throw new Error("caption wajib diisi untuk update schedule");
  if (!scheduleAt) throw new Error("scheduleAt wajib diisi untuk update schedule");
  const judul = String(title || cap.split("\n")[0] || "Cahaya Project").slice(0, 200);
  const body = {
    title: judul,
    description: cap,
    scheduleAt,
    type,
    topic: topic || judul,
  };
  if (medias) body.medias = medias;
  const r = await doea("PUT", `/schedules/${scheduleId}`, { body });
  return { ok: true, scheduleId, raw: r };
}

// Ambil status satu schedule Doea.
async function statusSchedule(scheduleId) {
  const r = await doea("GET", `/schedules/${scheduleId}`);
  const s = r?.result || r;
  return {
    id: scheduleId,
    status: s?.status,
    type: s?.type,
    postId: s?.postId,
    errorMessage: s?.errorMessage,
    scheduleAt: s?.scheduleAt,
    title: s?.title,
    medias: Array.isArray(s?.medias) ? s.medias.length : 0,
    mediaUrl: Array.isArray(s?.medias) && s.medias[0] ? s.medias[0].url : null,
  };
}

// Daftar schedule terbaru (untuk dashboard/monitoring).
async function daftarSchedule(limit = 20) {
  const r = await doea("GET", "/schedules", { query: { limit } });
  return (r.docs || []).map((x) => ({
    id: x._id,
    title: x.title,
    status: x.status,
    type: x.type,
    medias: (x.medias || []).length,
    scheduleAt: x.scheduleAt,
    errorMessage: x.errorMessage || null,
  }));
}

module.exports = {
  buatSchedulePublish,
  perbaruiSchedule,
  defaultScheduleAt1930,
  statusSchedule,
  daftarSchedule,
  akunUtama,
  PUBLIC_HOST,
};
