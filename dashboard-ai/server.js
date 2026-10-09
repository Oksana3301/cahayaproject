require("./lib/env");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./lib/db");
const roster = require("./agents/roster");
const { detak } = require("./lib/detak");
const { bersihkanMacet } = require("./lib/tugas");
const { cekJatah, pemakaianHariIni, totalTokenHariIni } = require("./agents/wewenang");
const { doea } = require("./lib/doea");
const { sinkronStatus } = require("./skills/publish");
const { jadwalkanHarian } = require("./lib/jadwal-harian");

const PORT = Number(process.env.PORT) || 4300;
const PLAFON_HARIAN = Number(process.env.PLAFON_TOKEN_HARIAN) || 250000;
let REM_TANGAN = false;

// Alur posting otomatis (susunDraft -> setujui -> publish) SUDAH NONAKTIF.
// Posting kini MANUAL oleh Owner. Setel PUBLISH_OTOMATIS=true untuk mengaktifkan lagi.
const PUBLISH_OTOMATIS = String(process.env.PUBLISH_OTOMATIS || "false") === "true";
function pesanPublishNonaktif() {
  return "Alur publish otomatis sudah dinonaktifkan. Posting kini manual oleh Owner — gunakan /ide, /konten, /carousel, atau /posting di WhatsApp untuk minta ide konten.";
}

async function cekRemTangan() {
  if (REM_TANGAN) return true;
  const total = await totalTokenHariIni();
  if (total >= PLAFON_HARIAN) {
    REM_TANGAN = true;
    console.error("[heartbeat] REM TANGAN aktif: total", total, "mencapai plafon", PLAFON_HARIAN);
  }
  return REM_TANGAN;
}

function jedaAcak() {
  return Math.floor(Math.random() * 20000);
}

let detakBerjalan = false;
let SEDANG_MENUTUP = false;

async function putaranDetak() {
  if (detakBerjalan) return;
  detakBerjalan = true;
  try {
    if (await cekRemTangan()) return;
    const dibersihkan = await bersihkanMacet();
    if (dibersihkan) console.log(`[heartbeat] ${dibersihkan} tugas macet dikembalikan ke menunggu`);
    try {
      const synced = await sinkronStatus();
      if (synced.disinkronkan) console.log(`[heartbeat] ${synced.disinkronkan} status jadwal disinkronkan dari Doea`);
    } catch (e) {
      console.error("[heartbeat] sinkronisasi jadwal gagal:", e.message);
    }
    for (const agent of roster.ROSTER) {
      if (agent.aktif === false) continue;
      if (!agent.skill_diizinkan.length) continue;
      await new Promise((r) => setTimeout(r, jedaAcak()));
      if (SEDANG_MENUTUP) return;
      try {
        if (await cekRemTangan()) return;
        const info = await cekJatah(agent.kode).catch(() => null);
        if (!info) {
          console.log(`[heartbeat] agent ${agent.kode} jatahnya habis, dilewati`);
          continue;
        }
        const hasil = await detak(agent.kode);
        if (hasil) {
          console.log(`[heartbeat] agent ${agent.kode} menyelesaikan tugas ${hasil.tugasId} -> ${hasil.status}`);
        }
      } catch (e) {
        if (!SEDANG_MENUTUP) console.error(`[heartbeat] agent ${agent.kode} error:`, e.message);
      }
    }
  } finally {
    detakBerjalan = false;
  }
}

async function pingDb() {
  if (SEDANG_MENUTUP) return true;
  try {
    const r = await db.query("SELECT 1 AS ok");
    return r.rows[0] && r.rows[0].ok === 1;
  } catch (e) {
    if (!SEDANG_MENUTUP) console.error("[health] db gagal:", e.message);
    return false;
  }
}

async function pingAtria() {
  const base = process.env.ATRIA_BASE_URL || "https://api.atria-asi.ai/v1";
  const key = process.env.ATRIA_API_KEY;
  if (!key) { console.error("[health] atria: kunci kosong"); return false; }
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error("[health] atria HTTP", res.status);
    return res.ok;
  } catch (e) {
    console.error("[health] atria gagal:", e.message);
    return false;
  }
}

async function pingApify() {
  const token = process.env.APIFY_TOKEN;
  if (!token) { console.error("[health] apify: kunci kosong"); return false; }
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me?token=${token}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error("[health] apify HTTP", res.status);
    return res.ok;
  } catch (e) {
    console.error("[health] apify gagal:", e.message);
    return false;
  }
}

async function pingResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.error("[health] resend: kunci kosong"); return false; }
  try {
    const { cekDomain } = require("./lib/resend");
    const d = await cekDomain();
    return d.verified === true;
  } catch (e) {
    console.error("[health] resend gagal:", e.message);
    return false;
  }
}

async function pingDoea() {
  const base = process.env.DOEA_BASE_URL || "https://hub.doea.net/v1";
  const a = process.env.DOEA_ACCESS_KEY;
  const s = process.env.DOEA_SECRET_KEY;
  if (!a || !s) {
    console.error("[health] doea: kunci kosong access=" + (a||"").length + " secret=" + (s||"").length);
    return false;
  }
  try {
    const basic = Buffer.from(`${a}:${s}`).toString("base64");
    const res = await fetch(`${base}/me`, {
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[health] doea HTTP", res.status, t.slice(0, 120));
    }
    return res.ok;
  } catch (e) {
    console.error("[health] doea gagal:", e.message);
    return false;
  }
}

const app = express();
const pekerjaanLatar = new Map();

// ===== Fase 5: webhook Resend =====
// J1: RAW body (Buffer) SEBELUM express.json() global, agar verifikasi Svix
// memakai body mentah (bukan yang sudah di-parse). J2: dikecualikan dari
// middleware login karena dipanggil server Resend tanpa cookie sesi.
const { tanganiWebhook } = require("./lib/webhook-resend");
app.post("/webhook/resend", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  try {
    const hasil = await tanganiWebhook(req.body, req.headers);
    console.log("[webhook/resend]", hasil.event, hasil.status);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[webhook/resend] GAGAL:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.use(express.json({ limit: "4mb" }));
app.use(require("./lib/sesi").cookieParser);

// ===== Fase 8.2: halaman masuk =====
const sesiLib = require("./lib/sesi");

app.get("/masuk", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "masuk.html"));
});

app.post("/api/masuk", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (!sesiLib.rateLimit(ip)) {
    return res.status(429).json({ error: "terlalu banyak percobaan, coba lagi nanti" });
  }
  const u = req.body && req.body.pengguna;
  const p = req.body && req.body.sandi;
  if (!u || !p || u !== sesiLib.USER || p !== sesiLib.PASS) {
    sesiLib.catatGagal(ip);
    return res.status(401).json({ error: "pengguna atau kata sandi salah" });
  }
  const token = sesiLib.buatSesi(u, ip);
  sesiLib.catatSukses(ip);
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie("sesi", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post("/api/keluar", (req, res) => {
  res.clearCookie("sesi");
  res.json({ ok: true });
});

// ===== Media publik untuk posting (TANPA auth) =====
// Instagram Graph API (via Doea hub) harus bisa mengambil gambar dari URL publik.
// Hanya melayani file .png/.jpg di .hermes3d/media/ (cegah path traversal).
app.get("/media/:nama", (req, res) => {
  const nama = path.basename(String(req.params.nama || ""));
  if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/i.test(nama)) {
    return res.status(400).json({ error: "nama file tidak valid" });
  }
  const berkas = path.join(__dirname, ".hermes3d", "media", nama);
  if (!berkas.startsWith(path.join(__dirname, ".hermes3d", "media"))) {
    return res.status(400).json({ error: "jalur tidak valid" });
  }
  if (!fs.existsSync(berkas)) return res.status(404).json({ error: "tidak ditemukan" });
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(berkas);
});

// ===== Jembatan WhatsApp -> Agent Cahaya Project (webhook WAHA) =====
// Publik (sebelum middleware sesi) tapi diamankan dengan token rahasia.
// WAHA mengirim event {event:"message", payload:{from, body, ...}}.
// Perintah (prefix):
//   "@kirana <pertanyaan>"  -> tanya agent tertentu
//   "/tanya <pertanyaan>"   -> tanya Kirana (orchestrator)
//   "/status"               -> ringkasan status sistem
//   "/rapat <agenda>"       -> jalankan rapat multi-agent, balas ringkasan
// Pesan tanpa prefix diabaikan (biar ditangani front desk Top Hills).
app.post("/api/wa/inbound", async (req, res) => {
  // Otentikasi rahasia (header atau query). Jika token belum diset, terima (mode dev) tetap dicatat.
  const token = process.env.WA_INBOUND_TOKEN || "";
  const kirimToken = req.get("X-Wa-Token") || req.query.token || "";
  if (token && kirimToken !== token) return res.status(401).json({ ok: false, error: "token salah" });

  const env = req.body || {};
  const p = env.payload || env;
  // abaikan pesan yang kita kirim sendiri
  const fromMe = p.fromMe === true || env.fromMe === true;
  const chatId = p.from || p.chatId || env.from;
  // abaikan pesan grup (hanya layani chat pribadi)
  const dariGrup = typeof chatId === "string" && chatId.endsWith("@g.us");
  const body = String(p.body || p.text || env.body || "").trim();
  const nama = (p._data && p._data.notifyName) || p.pushName || "";
  if (fromMe || dariGrup || !chatId || !body) return res.json({ ok: true, diabaikan: true, alasan: fromMe ? "fromMe" : dariGrup ? "grup" : "kosong" });

  // HANYA layani nomor Owner (whitelist). Kirana khusus dipakai Owner untuk
  // mengobrol dengan agent; pesan dari nomor lain (customer/grup) diabaikan
  // agar tidak bentrok dengan bot front-desk hotel.
  const waLib = require("./lib/whatsapp");
  if (!waLib.izinkanPengirim(chatId)) {
    console.log(
      `[wa/inbound] diabaikan — bukan nomor Owner (jid=${chatId}, nomor=${waLib.nomorDariJid(chatId) || "-"}, whitelist=${waLib.daftarOwner().join("|") || "-"})`
    );
    return res.json({ ok: true, diabaikan: true, alasan: "bukan nomor Owner" });
  }

  // Tentukan tujuan balasan yang bisa DIKIRIM oleh WAHA. Bila pengirim datang
  // sebagai "@lid" (Owner via LID, engine WEBJS), WAHA menolak sendText ke
  // "…@lid" ("No LID for user") — maka balas ke nomor Owner "@c.us".
  const balasKe = String(chatId).endsWith("@lid")
    ? waLib.normalisasiNomor(waLib.daftarOwner()[0])
    : chatId;

  // Deteksi perintah
  const mAgent = body.match(/^@([a-zA-Z]+)\s+([\s\S]+)/);
  const mTanya = body.match(/^\/tanya\s+([\s\S]+)/i);
  const mStatus = /^\/(status|progress)\b/i.test(body);
  const mRapat = body.match(/^\/rapat\s+([\s\S]+)/i);
  const mKonten = body.match(/^\/(konten|ide|carousel|posting)\s+([\s\S]+)/i);
  const mBantuan = /^\/(bantuan|help|menu)\b/i.test(body);
  let target = null, pertanyaan = null, perintahKonten = "/konten";
  if (mBantuan) { target = "BANTUAN"; }
  else if (mRapat) { target = "RAPAT"; pertanyaan = mRapat[1].trim(); }
  else if (mKonten) { target = "KONTEN"; pertanyaan = mKonten[2].trim(); perintahKonten = "/" + mKonten[1].toLowerCase(); }
  else if (mAgent) { target = mAgent[1].toLowerCase(); pertanyaan = mAgent[2].trim(); }
  else if (mTanya) { target = "kirana"; pertanyaan = mTanya[1].trim(); }
  else if (mStatus) { target = "STATUS"; }

  if (!target) return res.json({ ok: true, diabaikan: true, alasan: "tanpa prefix perintah" });
  if (!["STATUS", "RAPAT", "BANTUAN", "KONTEN"].includes(target) && !roster.ambil(target)) {
    return res.json({ ok: true, diabaikan: true, alasan: `agent '${target}' tidak dikenal` });
  }

  const wa = require("./lib/whatsapp");
  const pc = require("./lib/percakapan");
  const perintahLabel = target === "BANTUAN" ? "/bantuan" : target === "STATUS" ? "/status" : target === "RAPAT" ? "/rapat" : target === "KONTEN" ? "/konten" : (mAgent ? `@${target}` : "/tanya");
  // Kirim balasan + catat ke riwayat percakapan. Pencatatan tetap dilakukan
  // walau pengiriman WA gagal (mis. sesi WAHA turun), agar riwayat utuh.
  const kirimDanCatat = async (ke, balasan, { agent = "kirana", perintah = perintahLabel } = {}) => {
    let terkirim = false;
    let galatKirim = null;
    try {
      await wa.kirimTeks(ke, balasan);
      terkirim = true;
    } catch (e) {
      galatKirim = e.message;
      console.error("[wa/inbound] gagal kirim balasan:", e.message);
    }
    pc.catat({ arah: "keluar", nomor: ke, agent, perintah, balasan, meta: terkirim ? undefined : { terkirim: false, galat: galatKirim } });
    return terkirim;
  };
  pc.catat({ arah: "masuk", nomor: chatId, agent: target === "BANTUAN" || target === "STATUS" ? "kirana" : target, perintah: perintahLabel, pesan: body, meta: { nama } });
  res.json({ ok: true, diproses: target }); // balas cepat ke WAHA

  try {
    if (target === "BANTUAN") {
      const daftarAgent = roster.semua().map((a) => `• @${a.kode} — ${a.nama} (${a.jabatan})`).join("\n");
      const teks = [
        "*BANTUAN — CAHAYA PROJECT via WhatsApp*",
        "",
        "Perintah yang tersedia:",
        "• `/status` — ringkasan token & jadwal IG",
        "• `/tanya <pertanyaan>` — tanya Kirana (Editor-in-Chief)",
        "• `@<agent> <pertanyaan>` — tanya agent tertentu",
        "• `/rapat <agenda>` — jalankan rapat 3 agent, balas notulen",
        "• `/konten <topik>` — ide konten (carousel + caption + hashtag + analisa)",
        "  alias: `/ide`, `/carousel`, `/posting` — semua sama",
        "• `/bantuan` — tampilkan menu ini",
        "",
        "Contoh:",
        "`@tara apa progress jadwal Instagram minggu ini?`",
        "`@aruna topik apa yang sedang naik hari ini?`",
        "`/rapat bagaimana meningkatkan engagement postingan?`",
        "`/ide tips mengurangi sampah plastik di rumah`",
        "",
        "*Agent yang bisa ditanya:*",
        daftarAgent,
      ].join("\n");
      await kirimDanCatat(balasKe, teks, { agent: "kirana", perintah: "/bantuan" });
      return;
    }
    if (target === "STATUS") {
      const rem = await cekRemTangan();
      const total = await totalTokenHariIni();
      const jadwal = await doea("GET", "/schedules").then((r) => r.docs || []).catch(() => []);
      const terbit = jadwal.filter((s) => (s.status || "").toLowerCase() === "success").length;
      const pending = jadwal.filter((s) => (s.status || "").toLowerCase() === "pending").length;
      const gagal = jadwal.filter((s) => ["error", "failed"].includes((s.status || "").toLowerCase())).length;
      const teks = [
        "*STATUS CAHAYA PROJECT*",
        "",
        `Token hari ini: ${total.toLocaleString("id-ID")} / ${PLAFON_HARIAN.toLocaleString("id-ID")}`,
        `Rem tangan: ${rem ? "AKTIF ⛔" : "normal ✅"}`,
        "",
        `Jadwal IG — terbit: ${terbit} | menunggu: ${pending} | gagal: ${gagal}`,
        "",
        "_Perintah: @kirana <tanya>, /tanya <tanya>, /rapat <agenda>, /status_",
      ].join("\n");
      await kirimDanCatat(balasKe, teks, { agent: "kirana", perintah: "/status" });
      return;
    }
    if (target === "RAPAT") {
      await kirimDanCatat(balasKe, `_Rapat dimulai: "${pertanyaan}". Notulen menyusul (beberapa menit)._`, { agent: "kirana", perintah: "/rapat" });
      const rapat = require("./lib/rapat");
      // jalankanRapat otomatis mengirim SATU ringkasan ke chat ini.
      const hasil = await rapat.jalankanRapat({ agenda: pertanyaan, undangan: ["nala", "laras", "tara"], waNomor: balasKe });
      const ringkasWa = wa.ringkasRapatUntukWa(hasil);
      if (!hasil.waTerkirim) {
        // Fallback bila pengiriman otomatis gagal: kirim multi-pesan.
        try { await wa.kirimRapatWa(balasKe, hasil); } catch (e) { console.error("[wa/inbound] gagal kirim notulen:", e.message); }
      }
      // Catat notulen ASLI ke riwayat percakapan (bukan placeholder).
      pc.catat({ arah: "keluar", nomor: chatId, agent: "kirana", perintah: "/rapat", balasan: ringkasWa, meta: { jenis: hasil.jenis, diundang: hasil.diundang, terkirim: !!hasil.waTerkirim } });
      return;
    }
    if (target === "KONTEN") {
      await kirimDanCatat(balasKe, `_Menyusun ide konten: "${pertanyaan}". Sebentar..._`, { agent: "kirana", perintah: perintahKonten });
      const assist = require("./lib/konten-assist");
      const hasil = await assist.buatAssistKonten(pertanyaan);
      const pesanPisah = assist.formatUntukWaPesan(hasil);
      // Kirim beberapa pesan terpisah (judul/kerangka -> carousel -> caption -> hashtag -> analisa).
      for (let i = 0; i < pesanPisah.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 600)); // jeda antarpesan agar tidak numpuk
        await kirimDanCatat(balasKe, pesanPisah[i], { agent: "kirana", perintah: perintahKonten });
      }
      return;
    }
    // Tanya satu agent
    const { chat } = require("./lib/llm");
    const sys = bangunSystemPromptAgent(target);
    const messages = [
      { role: "system", content: (sys || `Kamu ${roster.ambil(target)?.nama || target}, agent Cahaya Project.`) },
      {
        role: "user",
        content:
          `Pertanyaan dari Owner via WhatsApp${nama ? ` (dari ${nama})` : ""}: ${pertanyaan}\n\n` +
          "Jawab ringkas (maks ~1200 karakter), bahasa Indonesia santai-profesional. " +
          "Bila ditanya progress, sebutkan status terkini yang kamu ketahui; jangan mengarang.",
      },
    ];
    const data = await chat({ agent: target, skill: "analytics", messages, maxTokens: 1600, noReasoning: true });
    const jawab = (data.choices?.[0]?.message?.content || "(tidak ada jawaban)").trim();
    const balasan = `*${roster.ambil(target)?.nama || target}* ${roster.ambil(target)?.emoji || ""}\n\n${jawab}`;
    await kirimDanCatat(balasKe, balasan, { agent: target, perintah: perintahLabel });
  } catch (e) {
    console.error("[wa/inbound] gagal proses:", e.message);
    try {
      const pesanGagal = `Maaf, terjadi kendala: ${e.message.slice(0, 150)}`;
      await kirimDanCatat(balasKe, pesanGagal, { agent: target, perintah: perintahLabel });
    } catch {}
  }
});

// semua jalur lain wajib masuk
app.use(sesiLib.middleware);

app.get("/api/auth/check", (req, res) => {
  const ip = req.socket.remoteAddress || "";
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    return res.sendStatus(404);
  }
  res.sendStatus(204);
});

// file statis hanya setelah autentikasi
app.use(express.static(path.join(__dirname, "public")));

// route halaman HTML (Fase 8.3)
const HALAMAN = [
  "persetujuan", "riset", "tren", "draft", "jadwal",
  "pasukan", "kantor", "biaya", "jejak", "pengaturan",
];
for (const h of HALAMAN) {
  app.get("/" + h, (req, res) => {
    res.sendFile(path.join(__dirname, "public", h + ".html"));
  });
}

app.get("/health", async (req, res) => {
  const [dbOk, atria, apify, doea, resend] = await Promise.all([
    pingDb(),
    pingAtria(),
    pingApify(),
    pingDoea(),
    pingResend(),
  ]);
  const ok = dbOk && atria && apify && doea && resend;
  res.status(ok ? 200 : 503).json({ ok, db: dbOk, atria, apify, doea, resend });
});

// ===== Fase 7: gerbang persetujuan =====
const { setujui, tolak } = require("./skills/publish");
const { bagiTugas } = require("./lib/owner");

app.get("/api/persetujuan", async (req, res) => {
  try {
    const tugas = await db.ambilBanyak(
      `SELECT * FROM tugas WHERE status = 'perlu_persetujuan' ORDER BY dibuat_pada DESC`
    );
    const draftIds = new Set();
    for (const t of tugas) {
      if (t.hasil && Array.isArray(t.hasil.draft)) {
        for (const d of t.hasil.draft) draftIds.add(Number(d.id));
      }
    }
    // Hanya tampilkan draft yang MASIH bisa diputuskan (menunggu/gagal).
    const drafts = await db.ambilBanyak(
      `SELECT * FROM draft_konten
       WHERE status IN ('menunggu', 'gagal')
       ORDER BY dibuat_pada DESC`
    );
    // Tugas PR (pitch / balasan outreach) untuk ditampilkan di /persetujuan.
    const pr = [];
    for (const t of tugas) {
      const jenis = t.hasil && t.hasil.jenis;
      if (jenis === "pitch" || jenis === "balasan") {
        pr.push(t);
      }
    }
    res.json({ tugas, drafts, pr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/persetujuan/:id/ya", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const oleh = req.body && req.body.oleh ? req.body.oleh : "owner";
    // Cek apakah ini tugas PR (pitch/balasan).
    const t = await db.ambilSatu(`SELECT * FROM tugas WHERE id = $1`, [id]);
    if (t && t.hasil && (t.hasil.jenis === "pitch" || t.hasil.jenis === "balasan")) {
      const pr = require("./lib/pitch");
      if (t.hasil.jenis === "pitch") {
        const hasil = await pr.kirimPitch(t.hasil.prospek_id);
        await db.query(`UPDATE tugas SET status = 'selesai', selesai_pada = now() WHERE id = $1`, [id]);
        return res.json({ ok: true, jenis: "pitch", ...hasil });
      }
      const hasil = await pr.kirimBalasan(t.hasil.prospek_id, t.hasil.pesan_masuk_id);
      await db.query(`UPDATE tugas SET status = 'selesai', selesai_pada = now() WHERE id = $1`, [id]);
      return res.json({ ok: true, jenis: "balasan", ...hasil });
    }
    // Draft konten (bukan PR): alur publish otomatis sudah nonaktif.
    if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
    const hasil = await setujui(id, oleh, req.body?.slotIso, {
      paksa: req.body?.paksa === true,
      pakaiLLM: req.body?.pakaiLLM !== false,
      lewatiGate: req.body?.lewatiGate === true,
    });
    res.json(hasil);
  } catch (e) {
    if (e.kode === "GATE_GAGAL") return res.status(422).json({ ok: false, kode: e.kode, error: e.message, gate: e.gate });
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/persetujuan/:id/tidak", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const alasan = req.body && req.body.alasan;
    if (!alasan || !alasan.trim()) {
      return res.status(400).json({ error: "alasan wajib diisi" });
    }
    const t = await db.ambilSatu(`SELECT * FROM tugas WHERE id = $1`, [id]);
    if (t && t.hasil && (t.hasil.jenis === "pitch" || t.hasil.jenis === "balasan")) {
      // Catat alasan tolak draft + jejak.
      await db.query(`UPDATE prospek SET alasan_tolak_draft = $1 WHERE id = $2`, [alasan.trim(), t.hasil.prospek_id]);
      await db.query(`INSERT INTO jejak (jenis, objek_id, keputusan, oleh, alasan) VALUES ('pitch', $1, 'tolak_draft', $2, $3)`, [t.hasil.prospek_id, "owner", alasan.trim()]);
      await db.query(`UPDATE tugas SET status = 'selesai', selesai_pada = now(), hasil = hasil || $1::jsonb WHERE id = $2`, [JSON.stringify({ alasan_tolak: alasan.trim() }), id]);
      return res.json({ ok: true, alasan: alasan.trim() });
    }
    // Draft konten (bukan PR): alur publish otomatis sudah nonaktif.
    if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
    const hasil = await tolak(id, alasan);
    res.json(hasil);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== Fase 7: biaya dan jatah =====
app.get("/api/biaya", async (req, res) => {
  try {
    const rows = await db.ambilBanyak(
       `SELECT a.kode, a.nama, a.emoji, a.jabatan, a.skill_diizinkan, a.jatah_token_harian,

              GREATEST(
                COALESCE(p.token_terpakai, 0),
                COALESCE(r.token_terpakai, 0)
              )::bigint AS terpakai
       FROM agents a
       LEFT JOIN agent_pemakaian p
         ON p.agent_kode = a.kode AND p.tanggal = current_date
       LEFT JOIN (
         SELECT agent, SUM(prompt_tokens + completion_tokens)::bigint AS token_terpakai
         FROM runs WHERE created_at::date = current_date GROUP BY agent
       ) r ON r.agent = a.kode
       ORDER BY a.kode`
    );
    const r = await db.query(
      `SELECT COALESCE(SUM(r.completion_tokens), 0)::bigint AS completion,
              COALESCE(SUM(r.prompt_tokens), 0)::bigint AS prompt,
              COUNT(*)::int AS panggilan
       FROM runs r WHERE r.created_at::date = current_date`
    );
    const totalTerpakai = rows.reduce((s, x) => s + Number(x.terpakai || 0), 0);
    const perAgent = rows.map((x) => {
      const jatah = Number(x.jatah_token_harian);
      const dipakai = Number(x.terpakai || 0);
      return {
        kode: x.kode, nama: x.nama, emoji: x.emoji, jabatan: x.jabatan,
        skill: x.skill_diizinkan || [],
        jatah, terpakai: dipakai, sisa: Math.max(0, jatah - dipakai),
        persen: jatah > 0 ? Math.min(100, Math.round((dipakai / jatah) * 100)) : 100,
      };
    });
    res.json({
      per_agent: perAgent,
      total: {
        terpakai: totalTerpakai,
        plafon: PLAFON_HARIAN,
        persen: PLAFON_HARIAN > 0 ? Math.min(100, Math.round((totalTerpakai / PLAFON_HARIAN) * 100)) : 100,
        panggilan_hari_ini: r.rows[0].panggilan,
        prompt_tokens: Number(r.rows[0].prompt),
        completion_tokens: Number(r.rows[0].completion),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/rem-tangan/lepas", async (req, res) => {
  REM_TANGAN = false;
  console.log("[heartbeat] rem tangan dilepas oleh owner");
  res.json({ rem_tangan: false });
});

// ===== Fase 6: perintah owner (async, tidak diblokir timeout proxy) =====
app.post("/api/perintah", async (req, res) => {
  try {
    const perintah = req.body && req.body.perintah;
    if (!perintah || !perintah.trim()) {
      return res.status(400).json({ error: "perintah wajib diisi" });
    }
    const id = "job-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    pekerjaanLatar.set(id, { status: "berjalan", dibuat: Date.now(), hasil: null, error: null });
    bagiTugas(perintah.trim())
      .then((hasil) => pekerjaanLatar.set(id, { status: "selesai", dibuat: Date.now(), hasil, error: null }))
      .catch((e) => pekerjaanLatar.set(id, { status: "gagal", dibuat: Date.now(), hasil: null, error: e.message }));
    res.status(202).json({ pekerjaan: id, status: "berjalan" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/perintah/:id", (req, res) => {
  const p = pekerjaanLatar.get(req.params.id);
  if (!p) return res.status(404).json({ error: "pekerjaan tidak ditemukan" });
  res.json(p);
});

// ===== Fase 8: API untuk halaman =====
app.get("/api/tugas", async (req, res) => {
  try {
    const rows = await db.ambilBanyak(
      `SELECT t.*, a.emoji FROM tugas t LEFT JOIN agents a ON a.kode = t.agent_pemilik
       ORDER BY t.dibuat_pada DESC LIMIT 50`
    );
    const daftar = rows.map((t) => ({
      id: t.id, judul: t.judul, isi: t.isi, status: t.status,
      pemilik: t.agent_pemilik, emoji: t.emoji,
      diambil_pada: t.diambil_pada, dibuat_pada: t.dibuat_pada,
    }));
    res.json({ tugas: daftar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/draft", async (req, res) => {
  try {
    const rows = await db.ambilBanyak(
      `SELECT * FROM draft_konten ORDER BY dibuat_pada DESC LIMIT 50`
    );
    res.json({ drafts: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/draft", async (req, res) => {
  if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
  try {
    const { ringkasanId, sudutIndex } = req.body || {};
    if (!ringkasanId) return res.status(400).json({ error: "ringkasanId wajib" });
    const id = "job-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    pekerjaanLatar.set(id, { status: "berjalan", dibuat: Date.now(), hasil: null, error: null });
    const { susunDraft } = require("./skills/publish");
    susunDraft({ ringkasanId: Number(ringkasanId), sudutIndex: Number(sudutIndex || 0), agentKode: "laras" })
      .then((hasil) => pekerjaanLatar.set(id, { status: "selesai", dibuat: Date.now(), hasil, error: null }))
      .catch((e) => pekerjaanLatar.set(id, { status: "gagal", dibuat: Date.now(), hasil: null, error: e.message }));
    res.status(202).json({ pekerjaan: id, status: "berjalan" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ambil satu draft.
app.get("/api/draft/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    const draft = await db.ambilSatu(`SELECT * FROM draft_konten WHERE id = $1`, [id]);
    if (!draft) return res.status(404).json({ error: `draft ${id} tidak ditemukan` });
    res.json({ draft });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// EDIT draft: judul / caption / tagar. Hanya boleh saat belum terbit.
app.put("/api/draft/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    const draft = await db.ambilSatu(`SELECT * FROM draft_konten WHERE id = $1`, [id]);
    if (!draft) return res.status(404).json({ error: `draft ${id} tidak ditemukan` });
    if (draft.status === "terbit") {
      return res.status(400).json({ error: "draft sudah terbit, tidak bisa diedit" });
    }
    const { judul, caption, tagar } = req.body || {};
    const judulBaru = judul !== undefined ? String(judul).trim() : draft.judul;
    const captionBaru = caption !== undefined ? String(caption).trim() : draft.caption;
    let tagarBaru = draft.tagar || [];
    if (tagar !== undefined) {
      tagarBaru = Array.isArray(tagar)
        ? tagar.map((t) => String(t).trim()).filter(Boolean)
        : String(tagar).split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      tagarBaru = tagarBaru.map((t) => (t.startsWith("#") ? t : "#" + t)).slice(0, 8);
    }
    if (!judulBaru) return res.status(400).json({ error: "judul tidak boleh kosong" });
    if (!captionBaru) return res.status(400).json({ error: "caption tidak boleh kosong" });

    await db.query(
      `UPDATE draft_konten SET judul = $1, caption = $2, tagar = $3 WHERE id = $4`,
      [judulBaru, captionBaru, tagarBaru, id]
    );
    await db.query(
      `INSERT INTO jejak (jenis, objek_id, keputusan, oleh, alasan, isi_saat_itu)
       VALUES ('draft', $1, 'diedit', $2, NULL, $3)`,
      [id, (req.body?.oleh || "owner"), JSON.stringify({ judul: judulBaru, caption: captionBaru.slice(0, 300), tagar: tagarBaru })]
    );
    const baru = await db.ambilSatu(`SELECT * FROM draft_konten WHERE id = $1`, [id]);
    res.json({ ok: true, draft: baru });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// UBAH STATUS manual draft (mis. kembalikan 'ditolak' → 'menunggu', atau
// set 'menunggu' → 'ditolak' tanpa menjadwalkan). Status 'terjadwal'/'terbit'
// tidak diubah lewat sini (gunakan alur setujui / sinkron status Doea).
const STATUS_DIIZINKAN = ["menunggu", "ditolak", "gagal"];
app.post("/api/draft/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!STATUS_DIIZINKAN.includes(status)) {
      return res.status(400).json({ error: `status harus salah satu dari: ${STATUS_DIIZINKAN.join(", ")}` });
    }
    const draft = await db.ambilSatu(`SELECT * FROM draft_konten WHERE id = $1`, [id]);
    if (!draft) return res.status(404).json({ error: `draft ${id} tidak ditemukan` });
    if (["terjadwal", "terbit"].includes(draft.status)) {
      return res.status(400).json({
        error: `draft sedang berstatus '${draft.status}'. Batalkan jadwal di Doea terlebih dahulu sebelum mengubah status.`,
      });
    }
    const alasan = req.body?.alasan ? String(req.body.alasan).trim() : null;
    if (status === "ditolak" && !alasan) {
      return res.status(400).json({ error: "alasan wajib diisi saat menolak draft" });
    }
    await db.query(
      `UPDATE draft_konten SET status = $1, alasan_tolak = $2, error = NULL WHERE id = $3`,
      [status, status === "ditolak" ? alasan : null, id]
    );
    await db.query(
      `INSERT INTO jejak (jenis, objek_id, keputusan, oleh, alasan, isi_saat_itu)
       VALUES ('draft', $1, $2, $3, $4, $5)`,
      [id, status === "ditolak" ? "ditolak" : "status:" + status, (req.body?.oleh || "owner"), alasan,
       JSON.stringify({ dari: draft.status, ke: status })]
    );
    const baru = await db.ambilSatu(`SELECT * FROM draft_konten WHERE id = $1`, [id]);
    res.json({ ok: true, draft: baru });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/pekerjaan/:id", (req, res) => {
  const p = pekerjaanLatar.get(req.params.id);
  if (!p) return res.status(404).json({ error: "pekerjaan tidak ditemukan" });
  res.json(p);
});

app.post("/api/riset", async (req, res) => {
  try {
    const keyword = (req.body && req.body.keyword) || "sustainability";
    const id = "job-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    pekerjaanLatar.set(id, { status: "berjalan", dibuat: Date.now(), hasil: null, error: null });
    const { jalankanRiset, rangkumSudut } = require("./skills/riset");
    jalankanRiset({ keyword, limit: 25 })
      .then(async ({ laporan, items }) => {
        const { ringkasanId, sudut } = await rangkumSudut(keyword, items);
        pekerjaanLatar.set(id, { status: "selesai", dibuat: Date.now(), hasil: { laporan, ringkasanId, sudut }, error: null });
      })
      .catch((e) => pekerjaanLatar.set(id, { status: "gagal", dibuat: Date.now(), hasil: null, error: e.message }));
    res.status(202).json({ pekerjaan: id, status: "berjalan" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/jadwal", async (req, res) => {
  try {
    const s = await doea("GET", "/schedules");
    const daftar = (s.docs || s || []).map((x) => ({
      id: x.id || x._id, title: x.title || "", scheduleAt: x.scheduleAt || x.scheduledAt,
      status: (x.status || "unknown").toLowerCase(),
    }));
    res.json({ jadwal: daftar, terhubung: true, pesan: daftar.length ? null : "Antrean Doea kosong: setujui draft dari halaman Persetujuan untuk membuat jadwal." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/tren", async (req, res) => {
  try {
    const r = await doea("GET", "/tools/tiktok-music");
    const raw = r.docs || r.items || r.data || (Array.isArray(r) ? r : []) || [];
    const items = raw.map((x) => ({
      judul: x.title || x.name || "-",
      artis: x.author || x.artist || x.authorMeta || "-",
      popularitas: x.playCount || x.popularity || x.diggCount || (x.duration ? `${x.duration}s` : "-") ,
    }));
    res.json({ musik: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/jejak", async (req, res) => {
  try {
    const rows = await db.ambilBanyak("SELECT * FROM jejak ORDER BY dibuat_pada DESC LIMIT 100");
    res.json({ jejak: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/pengaturan", async (req, res) => {
  try {
    const fs = require("fs");
    let brief = "";
    try { brief = fs.readFileSync("/opt/dashboard-ai/BRIEF.md", "utf8"); } catch (e) {}
    const cek = (v) => (v && String(v).length > 0);
    res.json({
      brief,
      jam_tayang: "19:30 WIB",
      zona_waktu: process.env.ZONA_WAKTU || "Asia/Jakarta",
      plafon: process.env.PLAFON_TOKEN_HARIAN || "250000",
      port: process.env.PORT || "4300",
      kunci: {
        atria: cek(process.env.ATRIA_API_KEY),
        apify: cek(process.env.APIFY_TOKEN),
        doea: cek(process.env.DOEA_ACCESS_KEY) && cek(process.env.DOEA_SECRET_KEY),
        db: cek(process.env.DATABASE_URL),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/agent/:kode/riwayat", async (req, res) => {
  try {
    const rows = await db.ambilBanyak(
      `SELECT judul, status, selesai_pada FROM tugas
       WHERE agent_pemilik = $1 ORDER BY selesai_pada DESC NULLS LAST LIMIT 20`,
      [req.params.kode]
    );
    res.json({ riwayat: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/kantor", async (req, res) => {
  try {
    const rows = await db.ambilBanyak("SELECT * FROM agents ORDER BY id");
    const tugasAktif = await db.ambilBanyak(
      `SELECT agent_pemilik, judul, diambil_pada FROM tugas WHERE status = 'dikerjakan'`
    );
    const pemilikKeTugas = new Map();
    for (const t of tugasAktif) {
      if (t.agent_pemilik) pemilikKeTugas.set(t.agent_pemilik, t);
    }
    const sekarang = Date.now();
    const agents = rows.map((a, idx) => {
      const t = pemilikKeTugas.get(a.kode);
      let keadaan = "idle";
      let tugasSekarang = null;
      if (t) {
        tugasSekarang = t.judul;
        const diambil = t.diambil_pada ? new Date(t.diambil_pada).getTime() : 0;
        if (sekarang - diambil < 25000) keadaan = "jalan";
        else keadaan = "kerja";
      }
      return {
        kode: a.kode, nama: a.nama, emoji: a.emoji, jabatan: a.jabatan,
        warna: a.emoji, keadaan, tugas_sekarang: tugasSekarang, meja: idx,
      };
    });
    res.json({ agents });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/status", async (req, res) => {
  const rem = await cekRemTangan();
  const total = await totalTokenHariIni();
  res.json({ rem_tangan: rem, total_token_hari_ini: total, plafon: PLAFON_HARIAN });
});

// ===== Fase 9.6: jembatan data Hermes3D =====
const jembatan = require("./lib/jembatan");
const { listAgentsRpc } = jembatan;

app.get("/api/runtime/health", async (req, res) => {
  try {
    res.json(await jembatan.health());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/runtime/state", async (req, res) => {
  try {
    res.json(await jembatan.state());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/runtime/registry", async (req, res) => {
  try {
    res.json(await jembatan.registry());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Fase 9.7: RPC gateway bridge (skills / config / agents / usage) =====

async function bungkus(fn, req, res) {
  try {
    const hasil = await fn(req.method === "GET" ? req.query : req.body);
    res.json(hasil);
  } catch (e) {
    const status = /wajib diisi|tidak valid|Menolak/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
}

app.get("/api/runtime/agents", (req, res) => bungkus(listAgentsRpc, req, res));
app.post("/api/runtime/agents/create", (req, res) => bungkus(jembatan.agentsCreate, req, res));
app.post("/api/runtime/agents/update", (req, res) => bungkus(jembatan.agentsUpdate, req, res));
app.post("/api/runtime/agents/delete", (req, res) => bungkus(jembatan.agentsDelete, req, res));
app.get("/api/runtime/agents/files/get", (req, res) => bungkus(jembatan.agentsFilesGet, req, res));
app.post("/api/runtime/agents/files/set", (req, res) => bungkus(jembatan.agentsFilesSet, req, res));
app.get("/api/runtime/exec/approvals/get", (req, res) => bungkus(jembatan.execApprovalsGet, req, res));
app.post("/api/runtime/exec/approvals/set", (req, res) => bungkus(jembatan.execApprovalsSet, req, res));
app.post("/api/runtime/exec/approval/resolve", (req, res) => bungkus(jembatan.execApprovalResolve, req, res));
app.get("/api/runtime/skills/status", (req, res) => bungkus((q) => jembatan.skillsStatus(q.agentId), req, res));
app.post("/api/runtime/skills/install", (req, res) => bungkus(jembatan.skillsInstall, req, res));
app.post("/api/runtime/skills/install-packaged", (req, res) => bungkus(jembatan.skillsInstallPackaged, req, res));
app.post("/api/runtime/skills/update", (req, res) => bungkus(jembatan.skillsUpdate, req, res));
app.post("/api/runtime/skills/remove", (req, res) => bungkus(jembatan.skillsRemove, req, res));
app.get("/api/runtime/config", (req, res) => bungkus(jembatan.configGet, req, res));
app.post("/api/runtime/config/set", (req, res) => bungkus(jembatan.configSet, req, res));
app.post("/api/runtime/config/patch", (req, res) => bungkus(jembatan.configPatch, req, res));
app.get("/api/runtime/status", (req, res) => bungkus(jembatan.runtimeStatus, req, res));
app.get("/api/runtime/sessions/usage", (req, res) => bungkus(jembatan.sessionsUsage, req, res));
app.get("/api/runtime/usage/cost", (req, res) => bungkus(jembatan.usageCost, req, res));
app.get("/api/runtime/cron/list", (req, res) => bungkus(jembatan.cronList, req, res));
app.post("/api/runtime/cron/add", (req, res) => bungkus(jembatan.cronAdd, req, res));
app.post("/api/runtime/cron/remove", (req, res) => bungkus(jembatan.cronRemove, req, res));
app.post("/api/runtime/cron/run", async (req, res) => {
  try {
    const { jalankanJobSekarang } = require("./lib/cron-runner");
    const id = String(req.body?.id || req.query?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id wajib diisi" });

    // Mode fire-and-forget: balas cepat agar UI responsif, eksekusi (LLM ~2 menit)
    // berjalan di background. State runningAtMs/lastRunAtMs tetap dipersist.
    const promise = jalankanJobSekarang(id, { alasan: "manual" });
    // Sinkron singkat: kalau job tidak valid / dipegang seeder, hasilnya sudah pasti
    // dan tidak memanggil LLM. Deteksi lewat delay mikro sudah cukup untuk kasus ini
    // karena jalankanJobSekarang menulis state sebelum await eksekusiJob.
    const awal = await Promise.race([
      promise,
      new Promise((r) => setTimeout(() => r(null), 400)),
    ]);
    if (awal) return res.json(awal); // selesai sangat cepat (skip/error/instan)

    promise
      .then((h) => {
        if (!h?.ok) console.warn(`[cron-runner] RUN NOW ${id} selesai:`, h?.status, h?.error || "");
      })
      .catch((e) => console.error(`[cron-runner] RUN NOW ${id} gagal:`, e.message));
    return res.json({ ok: true, status: "running", id, note: "Playbook dijalankan di background." });
  } catch (e) {
    const status = /wajib diisi|tidak valid|Menolak/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});
app.get("/api/runtime/tasks/list", (req, res) => bungkus(jembatan.tasksList, req, res));
app.post("/api/runtime/tasks/create", (req, res) => bungkus(jembatan.tasksCreate, req, res));
app.post("/api/runtime/tasks/update", (req, res) => bungkus(jembatan.tasksUpdate, req, res));
app.post("/api/runtime/tasks/delete", (req, res) => bungkus(jembatan.tasksDelete, req, res));

// ===== Alur publish end-to-end (draft -> approve -> banner -> Doea -> IG) =====
app.get("/api/alur/status", async (req, res) => {
  try {
    if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
    const alur = require("./lib/alur-publish");
    const { daftarSchedule } = require("./lib/publish");
    const menunggu = await alur.draftMenunggu();
    const sched = await daftarSchedule(10);
    res.json({ menunggu: menunggu ? { id: menunggu.id, judul: menunggu.judul, status: menunggu.status } : null, schedule: sched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Buat draft dari riset terbaru (tahap 1-2).
app.post("/api/alur/draft", async (req, res) => {
  if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
  try {
    const alur = require("./lib/alur-publish");
    const { draft, dibuat } = await alur.pastikanDraft({ buatBilaKosong: true });
    res.json({ ok: true, dibuat, draftId: draft?.id, judul: draft?.judul, status: draft?.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Review editorial Kirana atas sebuah draft (tahap 3).
app.post("/api/alur/review", async (req, res) => {
  if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
  try {
    const alur = require("./lib/alur-publish");
    const id = Number(req.body?.draftId) || (await alur.draftMenunggu())?.id;
    if (!id) return res.status(400).json({ error: "tidak ada draft untuk direview" });
    const draft = await alur.draftById(id);
    if (!draft) return res.status(404).json({ error: "draft tidak ditemukan" });
    const hasil = await alur.reviewKirana(draft);
    res.json({ ok: true, draftId: id, ...hasil });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PRE-PUBLISH GATE: checklist 4 prinsip sebelum publish (tidak mempublikasikan apa pun).
app.post("/api/alur/gate", async (req, res) => {
  if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
  try {
    const alur = require("./lib/alur-publish");
    const id = Number(req.body?.draftId) || (await alur.draftMenunggu())?.id;
    if (!id) return res.status(400).json({ error: "tidak ada draft untuk digate" });
    const gate = await alur.gateDraft(id, {
      pakaiLLM: req.body?.pakaiLLM !== false,
      paksa: req.body?.paksa === true,
      maxTokens: req.body?.maxTokens,
    });
    res.json({ ok: true, draftId: id, ...gate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Setujui draft => GATE 4 prinsip => banner + jadwalkan ke Doea (tahap 4).
app.post("/api/alur/setujui", async (req, res) => {
  if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
  try {
    const alur = require("./lib/alur-publish");
    const id = Number(req.body?.draftId) || (await alur.draftMenunggu())?.id;
    if (!id) return res.status(400).json({ error: "tidak ada draft untuk disetujui" });
    const hasil = await alur.setujuiDraft(id, req.body?.oleh || "owner", req.body?.slotIso, {
      paksa: req.body?.paksa === true,
      pakaiLLM: req.body?.pakaiLLM !== false,
      maxTokens: req.body?.maxTokens,
      lewatiGate: req.body?.lewatiGate === true,
    });
    res.json({ ok: true, ...hasil });
  } catch (e) {
    if (e.kode === "GATE_GAGAL") {
      // Kabari owner via WhatsApp bila nomor notifikasi tersedia.
      const nomorWa = String(process.env.WA_NOTIF_NOMOR || process.env.WA_WA_NOTIF || "").trim();
      if (nomorWa) {
        try {
          const wa = require("./lib/whatsapp");
          const g = e.gate || {};
          const teks = [
            "*PRE-PUBLISH GATE — PUBLISH DIBLOKIR*",
            "",
            `Draft: ${g.judul || ("#" + (req.body?.draftId ?? "?"))}`,
            `Skor kepatuhan: *${g.skor ?? "?"}/100*`,
            `Prinsip gagal: ${(g.gagalPrinsip || []).join(", ") || "-"}`,
            g.blokir?.length ? `Blokir: ${g.blokir.join("; ")}` : "",
            "",
            "_Publish tidak dijalankan. Revisi draft atau override dengan status 'paksa'._",
          ].filter(Boolean).join("\n");
          wa.kirimTeks(nomorWa, teks).catch((err) => console.error("[gate] gagal WA:", err.message));
        } catch (err) { console.error("[gate] gagal siapkan WA:", err.message); }
      }
      return res.status(422).json({ ok: false, kode: e.kode, error: e.message, gate: e.gate });
    }
    res.status(500).json({ error: e.message });
  }
});

// Sinkron status dari Doea (tahap 5).
app.post("/api/alur/sinkron", async (req, res) => {
  if (!PUBLISH_OTOMATIS) return res.status(410).json({ ok: false, error: pesanPublishNonaktif() });
  try {
    const alur = require("./lib/alur-publish");
    const hasil = await alur.sinkron();
    res.json({ ok: true, ...hasil });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/alur/draft/:id", async (req, res) => {
  try {
    const alur = require("./lib/alur-publish");
    const s = await alur.statusDraft(Number(req.params.id));
    if (!s) return res.status(404).json({ error: "draft tidak ditemukan" });
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Rapat multi-agent (LLM) =====
let RAPAT_TERAKHIR = null;
let RAPAT_BERJALAN = false;

// Catat hasil rapat sebagai task di board (agar tampil di Kanban UI).
// Memakai catatTask resmi cron-runner agar bentuk field konsisten dengan task lain.
function catatTaskRapat(hasil, { manual = false } = {}) {
  try {
    const { catatTask } = require("./lib/cron-runner");
    const ringkas =
      `RAPAT [${hasil.jenis || "manual"}]: ${hasil.agenda}\n\nDihadiri: ${(hasil.diundang || []).join(", ")}\n\n` +
      `===== NOTULEN =====\n${hasil.notulen || ""}`;
    const job = {
      id: manual ? "rapat-manual" : `pb-rapat-${hasil.jenis || "pagi"}`,
      name: hasil.label || "Rapat Cahaya Project",
      agentId: "kirana",
      sessionKey: "agent:kirana:main",
      payload: {},
    };
    return catatTask({ job, status: "ok", ringkas, durasiMs: hasil.durasiMs || 0 });
  } catch (e) {
    console.error("[rapat] gagal catat task:", e.message);
  }
}
app.post("/api/rapat", async (req, res) => {
  const agenda = req.body?.agenda;
  const konteks = req.body?.konteks;
  const undangan = req.body?.undangan;
  const jenis = String(req.body?.jenis || "").trim().toLowerCase() || undefined;
  const tunggu = req.body?.tunggu === true;
  if (RAPAT_BERJALAN) return res.json({ ok: true, status: "running", note: "Rapat sedang berjalan." });

  const mulai = Date.now();
  const jalankan = async () => {
    RAPAT_BERJALAN = true;
    try {
      const rapat = require("./lib/rapat");
      const hasil = await rapat.jalankanRapat({ jenis, agenda, konteks, undangan });
      RAPAT_TERAKHIR = { ...hasil, durasiMs: Date.now() - mulai, selesai: new Date().toISOString() };
      catatTaskRapat(RAPAT_TERAKHIR, { manual: true });
      console.log(`[rapat] selesai jenis=${hasil.jenis}: ${hasil.diundang.length} agent, ${Math.round((Date.now() - mulai) / 1000)}s`);
      return RAPAT_TERAKHIR;
    } catch (e) {
      RAPAT_TERAKHIR = { error: e.message, selesai: new Date().toISOString() };
      console.error("[rapat] gagal:", e.message);
      return RAPAT_TERAKHIR;
    } finally {
      RAPAT_BERJALAN = false;
    }
  };

  if (tunggu) return res.json(await jalankan());
  jalankan();
  res.json({ ok: true, status: "running", note: "Rapat dijalankan di background. Cek /api/rapat/hasil." });
});

app.get("/api/rapat/hasil", (req, res) => {
  if (RAPAT_TERAKHIR) return res.json({ berjalan: RAPAT_BERJALAN, hasil: RAPAT_TERAKHIR });
  // Rapat mungkin dijalankan runner cron (proses terpisah) — baca dari file.
  try {
    const berkas = require("path").join(__dirname, ".hermes3d", "rapat-terakhir.json");
    if (fs.existsSync(berkas)) {
      return res.json({ berjalan: RAPAT_BERJALAN, hasil: JSON.parse(fs.readFileSync(berkas, "utf8")) });
    }
  } catch (e) { /* abaikan */ }
  res.json({ berjalan: RAPAT_BERJALAN, hasil: null });
});

// Kirim ringkasan hasil rapat (terakhir / dari body) ke WhatsApp.
// body: { nomor?, hasil? } — nomor default dari env WA_NOTIF_NOMOR.
app.post("/api/rapat/wa", async (req, res) => {
  try {
    const wa = require("./lib/whatsapp");
    const nomor = String(req.body?.nomor || process.env.WA_NOTIF_NOMOR || process.env.WA_WA_NOTIF || "").trim();
    if (!nomor) return res.status(400).json({ ok: false, error: "nomor WhatsApp belum diisi (WA_NOTIF_NOMOR)" });
    let hasil = req.body?.hasil;
    if (!hasil) {
      if (RAPAT_TERAKHIR && !RAPAT_TERAKHIR.error) hasil = RAPAT_TERAKHIR;
      else {
        const berkas = path.join(__dirname, ".hermes3d", "rapat-terakhir.json");
        if (fs.existsSync(berkas)) hasil = JSON.parse(fs.readFileSync(berkas, "utf8"));
      }
    }
    if (!hasil) return res.status(400).json({ ok: false, error: "belum ada hasil rapat" });
    if (req.body?.teks) {
      const r = await wa.kirimTeks(nomor, req.body.teks);
      res.json({ ok: true, ...r, panjang: req.body.teks.length });
    } else {
      const r = await wa.kirimRapatWa(nomor, hasil);
      res.json({ ok: true, jumlah: r.jumlah, panjangTotal: r.panjangTotal, id: r.id });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cek status koneksi gateway WhatsApp (WAHA).
app.get("/api/wa/status", async (req, res) => {
  try {
    const wa = require("./lib/whatsapp");
    res.json({ ok: true, ...(await wa.statusSesi()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== Section "Percakapan" — riwayat percakapan Owner ↔ agent =====
// Daftar tanggal yang punya log.
app.get("/api/percakapan/tanggal", (req, res) => {
  try {
    const pc = require("./lib/percakapan");
    res.json({ ok: true, tanggal: pc.daftarTanggal() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Riwayat percakapan. Query: ?tanggal=YYYY-MM-DD&batas=200
app.get("/api/percakapan", (req, res) => {
  try {
    const pc = require("./lib/percakapan");
    const tanggal = String(req.query?.tanggal || "").trim() || undefined;
    const batas = Math.min(2000, Math.max(1, Number(req.query?.batas) || 300));
    res.json({ ok: true, tanggal: tanggal || null, batas, pesan: pc.baca({ tanggal, batas }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Membangun system prompt persona agent dari file agent (.hermes3d/agents/<kode>/*).
function bangunSystemPromptAgent(kode) {
  try {
    const fs = require("fs");
    const agenDir = path.resolve(__dirname, ".hermes3d", "agents", String(kode));
    if (!fs.existsSync(agenDir)) return null;
    const baca = (nama) => {
      const p = path.join(agenDir, nama);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
    };
    const identity = baca("IDENTITY.md");
    const soul = baca("SOUL.md");
    const agents = baca("AGENTS.md");
    const memory = baca("MEMORY.md");
    if (!identity && !soul && !agents) return null;
    return [
      "Kamu adalah agent Cahaya Project. Jalankan peran, persona, nada, dan aturan di bawah ini dengan setia.",
      "Gunakan Bahasa Indonesia yang jelas, hangat, cerdas, santai tapi profesional. Jangan mengarang fakta.",
      identity ? `\n===== IDENTITY =====\n${identity}` : "",
      soul ? `\n===== SOUL =====\n${soul}` : "",
      agents ? `\n===== AGENTS =====\n${agents}` : "",
      memory ? `\n===== MEMORY =====\n${memory}` : "",
    ].filter(Boolean).join("\n");
  } catch (e) {
    console.error("[chat] gagal membangun persona agent:", e.message);
    return null;
  }
}

app.post("/api/runtime/v1/chat/completions", async (req, res) => {  try {
    const { chat } = require("./lib/llm");
    const body = req.body || {};
    const rawConv = String(body.conversation_id || body.session_id || "");
    const m = rawConv.match(/^agent:([^:]+):/);
    const kode = m ? m[1] : "";
    let messages = Array.isArray(body.messages) && body.messages.length
      ? body.messages
      : [{ role: "user", content: "halo" }];
    const systemPrompt = kode ? bangunSystemPromptAgent(kode) : null;
    if (systemPrompt) {
      // Sisipkan persona sebagai system prompt di depan, tanpa menimpa instruksi sistem bawaan.
      messages = [{ role: "system", content: systemPrompt }, ...messages.filter((x) => x && x.role !== "system")];
    }
    const data = await chat({
      agent: "sistem",
      skill: "jembatan",
      messages,
      maxTokens: body.max_tokens || 2048,
    });
    res.json({
      id: "chatcmpl-jembatan",
      object: "chat.completion",
      choices: data.choices || [],
      usage: data.usage || {},
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res) => {
  res.status(404).json({ error: "tidak ditemukan" });
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] dashboard-ai mendengarkan di http://127.0.0.1:${PORT}`);
});

const INTERVAL_DETAK = 2 * 60 * 1000;
const detakTimer = setInterval(() => {
  if (SEDANG_MENUTUP) return;
  putaranDetak().catch((e) => { if (!SEDANG_MENUTUP) console.error("[heartbeat] error putaran:", e.message); });
}, INTERVAL_DETAK);

const tanamHarian = () => {
  if (SEDANG_MENUTUP) return;
  jadwalkanHarian()
    .then((r) => {
      if (r && r.dibuat && r.dibuat.length) {
        console.log("[jadwal-harian] " + r.dibuat.length + " tugas harian disemai untuk " + r.tanggal);
      }
    })
    .catch((e) => { if (!SEDANG_MENUTUP) console.error("[jadwal-harian] error:", e.message); });
};

const jadwalTimer = setInterval(tanamHarian, 5 * 60 * 1000);
setTimeout(tanamHarian, 20 * 1000);
console.log("[jadwal-harian] penjadwal tugas harian aktif (cek tiap 5 menit, WIB)");
console.log("[heartbeat] penjadwal detak aktif setiap 2 menit");

// Runner cron ASLI: mengeksekusi cron-jobs.json (playbook 8 agent) sesuai jadwal.
const cronRunner = require("./lib/cron-runner");
cronRunner.setNextRunCalculator(jembatan.hitungNextRunMs);
const cronTimer = cronRunner.mulai({ intervalMs: 60000 });

function shutdown(sinyal) {
  if (SEDANG_MENUTUP) return;
  SEDANG_MENUTUP = true;
  console.log(`[server] ${sinyal}, menutup...`);
  clearInterval(detakTimer);
  clearInterval(jadwalTimer);
  clearInterval(cronTimer);
  cronRunner.tandaiMenutup();
  db.tandaiMenutup(); // loop/in-flight berhenti menerima pekerjaan DB baru
  server.close(() => {
    db.tutup().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
