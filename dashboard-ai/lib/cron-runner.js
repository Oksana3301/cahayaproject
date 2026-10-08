// lib/cron-runner.js
// Runner cron ASLI untuk Cahaya Project.
// Membaca .hermes3d/cron-jobs.json dan MENGEKSEKUSI job yang jatuh tempo:
//   - schedule: { kind:"at" | "every" | "cron"(+tz) }
//   - payload : { kind:"agentTurn", message, thinking?, model? }
//     -> dijalankan sebagai giliran agent (persona dari .hermes3d/agents/<kode>/)
//        melalui lib/llm.chat sehingga KUOTA token per-agent & PLAFON harian
//        tetap ditegakkan, dan pemakaian tercatat di tabel runs/agent_pemakaian.
//
// State (lastRunAtMs/lastStatus/nextRunAtMs) dipersist balik ke cron-jobs.json.
// Hasil tiap run dicatat ke .hermes3d/tasks.json (muncul di KANBAN) + log.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_DIR = path.resolve(__dirname, "..", ".hermes3d");
const CRON_PATH = path.join(STATE_DIR, "cron-jobs.json");
const TASKS_PATH = path.join(STATE_DIR, "tasks.json");
const LOG_PATH = path.join(STATE_DIR, "cron-runs.log");

// Fallback salinan kecil dari jembatan (dipakai bila ekspor tidak tersedia).
function hitungNextRunMsFallback(schedule, fromMs) {
  if (!schedule || typeof schedule !== "object") return undefined;
  if (schedule.kind === "at") {
    const at = new Date(schedule.at).getTime();
    return Number.isNaN(at) ? undefined : at;
  }
  if (schedule.kind === "every") {
    const everyMs = Number(schedule.everyMs) || 0;
    if (everyMs <= 0) return undefined;
    const anchor = Number(schedule.anchorMs) || fromMs;
    if (fromMs <= anchor) return anchor;
    const elapsed = fromMs - anchor;
    return anchor + Math.ceil(elapsed / everyMs) * everyMs;
  }
  return undefined;
}

let hitungNextRunMs = hitungNextRunMsFallback;
let triggerRunHook = null; // dipasang oleh server.js (opsional)

function setNextRunCalculator(fn) {
  if (typeof fn === "function") hitungNextRunMs = fn;
}

// Dipakai oleh server.js untuk memberi tahu runner bahwa sebuah job dijalankan
// manual dari UI (RUN NOW) sehingga state bisa ditandai.
function setRunHook(fn) {
  triggerRunHook = fn;
}

function bacaJsonArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function tulisJsonArray(filePath, list) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    console.error("[cron-runner] gagal menulis", filePath, e.message);
  }
}

function appendLog(baris) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${baris}\n`, "utf8");
  } catch {}
}

// Bangun system prompt persona dari file agent (IDENTITY/SOUL/AGENTS/MEMORY).
function bangunPersona(kode) {
  try {
    const dir = path.join(STATE_DIR, "agents", String(kode));
    if (!fs.existsSync(dir)) return null;
    const baca = (nama) => {
      const p = path.join(dir, nama);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
    };
    const identity = baca("IDENTITY.md");
    const soul = baca("SOUL.md");
    const agents = baca("AGENTS.md");
    const memory = baca("MEMORY.md");
    const prinsip = baca("PRINSIP.md");
    if (!identity && !soul && !agents) return null;
    return [
      "Kamu adalah agent Cahaya Project. Jalankan peran, persona, nada, dan aturan di bawah ini dengan setia.",
      "Gunakan Bahasa Indonesia yang jelas, hangat, cerdas, santai tapi profesional. Jangan mengarang fakta.",
      identity ? `\n===== IDENTITY =====\n${identity}` : "",
      soul ? `\n===== SOUL =====\n${soul}` : "",
      agents ? `\n===== AGENTS =====\n${agents}` : "",
      memory ? `\n===== MEMORY =====\n${memory}` : "",
      prinsip ? `\n===== PRINSIP WAJIB PUBLIKASI (EMPAT PRINSIP) =====\n${prinsip}` : "",
    ].filter(Boolean).join("\n");
  } catch (e) {
    console.error(`[cron-runner] gagal membangun persona ${kode}:`, e.message);
    return null;
  }
}

// Tentukan skill yang dipakai job (untuk gerbang wewenang + hemat token).
// Bisa dioverride lewat payload.skill. Default per-agent.
const SKILL_DEFAULT = {
  kirana: "analytics",
  aruna: "riset",
  jati: "riset",
  nala: "analytics",
  bima: "riset",
  laras: "publish",
  raya: "publish",
  tara: "publish",
  sena: "riset",
};

function resolveSkill(job) {
  const dariPayload = job?.payload && typeof job.payload.skill === "string" ? job.payload.skill.trim() : "";
  if (dariPayload) return dariPayload;
  const kode = String(job?.agentId || "").trim();
  return SKILL_DEFAULT[kode] || "riset";
}

// Job yang dijalankan oleh mesin lain (heartbeat + skill riset/draft via
// lib/jadwal-harian.js). Runner melewatinya agar tidak terjadi kerja ganda.
// Ditandai dengan payload.engine === "detak".
function dipegangEngineLain(job) {
  return Boolean(job && job.payload && job.payload.engine === "detak");
}

function catatTask({ job, status, ringkas, durasiMs, error }) {
  const now = new Date().toISOString();
  // Job yang butuh persetujuan Owner (mis. publish) tetap OK tapi berhenti di
  // kolom "needs_attention" agar terlihat sebagai menunggu keputusan manusia.
  const butuhApproval = Boolean(job?.payload?.butuhApproval);
  let statusBoard;
  if (!error && status === "ok") statusBoard = butuhApproval ? "needs_attention" : "done";
  else statusBoard = "needs_attention";
  const task = {
    id: `cronrun:${job.id}:${Date.now()}`,
    title: `${job.name}`,
    description: error ? `GAGAL: ${error}` : String(ringkas || "").slice(0, 8000),
    status: statusBoard,
    source: "playbook",
    sourceEventId: job.id,
    assignedAgentId: job.agentId || null,
    createdAt: now,
    updatedAt: now,
    playbookJobId: job.id,
    runId: `cron-${crypto.randomBytes(4).toString("hex")}`,
    channel: null,
    externalThreadId: job.sessionKey || null,
    lastActivityAt: now,
    notes: [],
    archived: false,
    durationMs: durasiMs,
  };
  const list = bacaJsonArray(TASKS_PATH);
  list.push(task);
  // simpan maksimal 200 entri terbaru
  const trimmed = list.slice(-200);
  tulisJsonArray(TASKS_PATH, trimmed);
  return task;
}

// Eksekusi satu job. Mengembalikan { ok, status, error?, result? }.
async function eksekusiJob(job, { alasan = "terjadwal" } = {}) {
  const mulai = Date.now();
  const agentId = String(job.agentId || "").trim();

  // Job jenis SENA (bedah carousel): jalankan pipeline Apify->OCR->Excel.
  // Ditandai payload.jenis === "sena".
  const jenisJob = String((job.payload && (job.payload.jenis || job.payload.kind)) || "").trim().toLowerCase();
  if (jenisJob === "sena") {
    try {
      const { bedahCarousel } = require("../skills/sena");
      const resultsLimit = Number(job.payload && job.payload.resultsLimit) || 15;
      const r = await bedahCarousel({
        akun: (job.payload && job.payload.akun) || null,
        resultsLimit,
        agentKode: agentId || "sena",
        ocr: true,
        lanjutOtomatis: true,
      });
      const durasiMs = Date.now() - mulai;
      const ringkas =
        `BEDAH CAROUSEL (Sena): ${r.jumlahPost} post carousel dianalisis.\n` +
        `File: ${r.file}\n` +
        `Akun: ${(r.akun || []).join(", ")}\n` +
        `Slide gagal OCR: ${r.slideGagal}`;
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=sena akun=${(r.akun || []).length} post=${r.jumlahPost} slideGagal=${r.slideGagal} file=${r.file}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=sena durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }
  if (jenisJob === "clone") {
    // Job CLONE: ubah carousel kompetitor (xlsx) jadi versi brand (Sena).
    try {
      const { cloneCarousel } = require("./sena-clone");
      const path = require("path");
      const dirOut = path.join(STATE_DIR, "sena", "output");
      let fileXlsx = job.payload && job.payload.fileXlsx;
      if (!fileXlsx) {
        const files = fs.existsSync(dirOut)
          ? fs.readdirSync(dirOut).filter((f) => f.endsWith(".xlsx")).sort().reverse()
          : [];
        if (!files.length) throw new Error("tidak ada file xlsx hasil bedah; jalankan job bedah dulu");
        fileXlsx = path.join(dirOut, files[0]);
      }
      const jenis = String((job.payload && job.payload.jenisClone) || "top").trim().toLowerCase();
      const nilai = Number(job.payload && job.payload.nilai) || 1;
      const ulang = Boolean(job.payload && job.payload.ulang);
      const r = await cloneCarousel({ fileXlsx, jenis, nilai, ulang });
      const durasiMs = Date.now() - mulai;
      const ringkas =
        `CLONE CAROUSEL (Sena): ${r.jumlah} konten dibikin.\n` +
        `Folder: ${r.dirOut}\n` +
        r.hasil.map((h) => `  ${h.post.shortcode} (${h.post.likesCount} like) -> ${h.hasil.slides.length} slide`).join("\n");
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=clone jumlah=${r.jumlah} file=${fileXlsx}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=clone durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }
  if (jenisJob === "publish" || jenisJob === "publish-dryrun") {
    // Job PUBLISH: jadwalkan clone ke SocialHub. Default (dan aman) adalah
    // dry-run; kirim beneran hanya bila payload.dryRun === false secara eksplisit.
    try {
      const pub = require("./sena-publish");
      const dryRun = jenisJob === "publish-dryrun" || !(job.payload && job.payload.dryRun === false);
      const r = await pub.publishClone({
        accountId: (job.payload && job.payload.accountId) || null,
        jamTayang: (job.payload && job.payload.jamTayang) || undefined,
        tanggalMulai: (job.payload && job.payload.tanggalMulai) || null,
        jumlah: (job.payload && job.payload.jumlah) || null,
        ulang: Boolean(job.payload && job.payload.ulang),
        dryRun,
      });
      const durasiMs = Date.now() - mulai;
      const mode = dryRun ? "DRY-RUN (tidak dikirim)" : "KIRIM BENARAN";
      const ringkas =
        `PUBLISH (Sena) ${mode}: ${r.hasil.length} konten, ${r.gagal.length} gagal.\n` +
        r.hasil.map((h) => `  ${h.shortcode} -> ${h.scheduleAtWib}`).join("\n") +
        (r.gagal.length ? `\nGAGAL:\n` + r.gagal.map((g) => `  ${g.shortcode}: ${g.error}`).join("\n") : "");
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=${jenisJob} dryRun=${dryRun} hasil=${r.hasil.length} gagal=${r.gagal.length}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=${jenisJob} durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }
  if (jenisJob === "laporan") {
    // Job LAPORAN: kirim rekap harian ke WhatsApp via WAHA.
    try {
      const { kirimLaporanHarian } = require("./laporan-harian");
      const dryRun = Boolean(job.payload && job.payload.dryRun);
      const r = await kirimLaporanHarian({
        dryRun,
        nomor: (job.payload && job.payload.nomor) || null,
        retry: !(job.payload && job.payload.tanpaRetry),
      });
      const durasiMs = Date.now() - mulai;
      const ringkas = dryRun
        ? `LAPORAN (dry-run) ke ${r.nomorTujuan}:\n${r.teks}`
        : `LAPORAN terkirim ke ${r.nomorTujuan} (id ${r.terkirim && r.terkirim.id})`;
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=laporan dryRun=${dryRun} tujuan=${r.nomorTujuan}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=laporan durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }
  if (jenisJob === "email") {
    // Job EMAIL: kirim laporan via Resend ke EMAIL_TES (default).
    try {
      const R = require("./resend");
      const tujuan = (job.payload && job.payload.to) || (R.CONFIG.EMAIL_TES ? [R.CONFIG.EMAIL_TES] : []);
      if (!tujuan.length) throw new Error("tidak ada tujuan email (isi EMAIL_TES di CONFIG)");
      const subject = (job.payload && job.payload.subject) || "Cahaya Project — Laporan Otomatis";
      const html = (job.payload && job.payload.html) || "<p>Laporan otomatis pipeline Sena.</p>";
      const text = (job.payload && job.payload.text) || "Laporan otomatis pipeline Sena.";
      const dryRun = Boolean(job.payload && job.payload.dryRun);
      const durasiMs = Date.now() - mulai;
      if (dryRun) {
        const ringkas = `EMAIL (dry-run) ke ${tujuan.join(", ")}:\n${subject}\n${text}`;
        catatTask({ job, status: "ok", ringkas, durasiMs });
        appendLog(`OK job=${job.id} jenis=email dryRun=true tujuan=${tujuan.length}`);
        return { ok: true, status: "ok", result: ringkas, durasiMs };
      }
      const hasil = await R.kirimBanyak({ tujuan, subject, html, text });
      const ringkas = `EMAIL terkirim ke ${tujuan.join(", ")} (${hasil.map((h) => h.resp && (h.resp.id || h.resp.data && h.resp.data.id) || "-").join(", ")})`;
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=email tujuan=${tujuan.length}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=email durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }
  if (jenisJob === "dashboard") {
    // Job DASHBOARD: rebuild dashboard.html (hapus cache supaya selalu segar).
    try {
      const path = require("path");
      const buildPath = path.resolve(__dirname, "..", "build-dashboard.js");
      delete require.cache[require.resolve(buildPath)];
      const { build } = require(buildPath);
      const hasilBuild = build();
      const durasiMs = Date.now() - mulai;
      const ringkas =
        `DASHBOARD di-build: bedah=${hasilBuild.bedahTotal}, clone=${hasilBuild.cloneTotal}, ` +
        `antre=${hasilBuild.antre}, gagal=${hasilBuild.gagal}, WA=${hasilBuild.waSukses}, email=${hasilBuild.emailSukses}`;
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=dashboard bedah=${hasilBuild.bedahTotal} clone=${hasilBuild.cloneTotal} antre=${hasilBuild.antre}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=dashboard durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }
  if (jenisJob === "rapat") {
    try {
      const rapat = require("./rapat");
      // Agenda rapat: payload.rapatJenis menentukan preset (pagi/siang/sore).
      const rapatJenis = String((job.payload && (job.payload.rapatJenis || job.payload.jenisRapat)) || "").trim().toLowerCase();
      const hasil = await rapat.jalankanRapat({
        jenis: rapatJenis || undefined,
        agenda: (job.payload && job.payload.message) || undefined,
        konteks: job.payload && job.payload.konteks,
        undangan: job.payload && job.payload.undangan,
      });
      const durasiMs = Date.now() - mulai;
      const ringkas =
        `RAPAT [${hasil.jenis}]: ${hasil.agenda}\n\n` +
        `Dihadiri: ${hasil.diundang.join(", ")}\n\n` +
        `===== NOTULEN =====\n${hasil.notulen}`;
      catatTask({ job, status: "ok", ringkas, durasiMs });
      appendLog(`OK job=${job.id} jenis=rapat rapatJenis=${hasil.jenis} alasan=${alasan} durasi=${durasiMs}ms peserta=${hasil.diundang.length} wa=${hasil.waTerkirim ? "ya" : (hasil.waError || "tidak")}`);
      return { ok: true, status: "ok", result: ringkas, durasiMs };
    } catch (e) {
      const durasiMs = Date.now() - mulai;
      catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
      appendLog(`ERROR job=${job.id} jenis=rapat alasan=${alasan} durasi=${durasiMs}ms err=${e.message}`);
      return { ok: false, status: "error", error: e.message, durasiMs };
    }
  }

  const skill = resolveSkill(job);
  const pesan = String((job.payload && job.payload.message) || job.name || "").trim();
  const thinking = (job.payload && job.payload.thinking) || "medium";

  if (!agentId) {
    return { ok: false, status: "skipped", error: "job tanpa agentId" };
  }
  if (!pesan) {
    return { ok: false, status: "skipped", error: "job tanpa pesan payload" };
  }

  const persona = bangunPersona(agentId);
  const systemParts = [persona || "Kamu adalah agent Cahaya Project."].filter(Boolean);
  const messages = [
    { role: "system", content: systemParts.join("\n") },
    { role: "user", content: pesan },
  ];

  // Batas token keluaran: bisa dioverride per-job. Job yang butuh approval
  // (paket publish + checklist + ringkasan) default lebih panjang.
  const butuhApproval = Boolean(job?.payload?.butuhApproval);
  const maxTokens = Number(job?.payload?.maxTokens) || (butuhApproval ? 3500 : 2048);

  try {
    const { chat } = require("./llm");
    const data = await chat({
      agent: agentId,
      skill,
      messages,
      maxTokens,
    });
    const text = data?.choices?.[0]?.message?.content || "";
    const durasiMs = Date.now() - mulai;
    const usage = data?.usage || {};
    catatTask({ job, status: "ok", ringkas: text, durasiMs });
    appendLog(`OK job=${job.id} agent=${agentId} skill=${skill} alasan=${alasan} durasi=${durasiMs}ms token=${(usage.prompt_tokens || 0) + (usage.completion_tokens || 0)}`);
    return { ok: true, status: "ok", result: text, durasiMs, usage };
  } catch (e) {
    const durasiMs = Date.now() - mulai;
    catatTask({ job, status: "error", ringkas: "", durasiMs, error: e.message });
    appendLog(`ERROR job=${job.id} agent=${agentId} skill=${skill} alasan=${alasan} durasi=${durasiMs}ms err=${e.message}`);
    return { ok: false, status: "error", error: e.message, durasiMs };
  }
}

// Satu putaran: cari job yang jatuh tempo dan jalankan berurutan (hemat resource).
async function putaranCron() {
  const list = bacaJsonArray(CRON_PATH);
  if (!list.length) return { dijalankan: 0 };
  const now = Date.now();
  let dijalankan = 0;
  const dihapus = [];
  // Batas waktu anggap sebuah job masih "berjalan" (2 jam) — mencegah job macet selamanya.
  const BATAS_BERJALAN_MS = 2 * 60 * 60 * 1000;

  for (let i = 0; i < list.length; i += 1) {
    const job = list[i];
    if (!job || job.enabled === false) continue;

    // KUNCI ANTI-BERULANG: lewati job yang sedang berjalan.
    // Sebelumnya, putaran tiap 60s membaca job yang belum selesai (nextRunAtMs
    // masih di masa lalu) lalu menjalankannya LAGI -> rapat/chat berulang.
    const sedangJalan =
      job.state && Number.isFinite(job.state.runningAtMs) &&
      now - Number(job.state.runningAtMs) < BATAS_BERJALAN_MS;
    if (sedangJalan) continue;

    let due = false;
    if (job.state && Number.isFinite(job.state.nextRunAtMs)) {
      due = now >= Number(job.state.nextRunAtMs);
    } else {
      // belum punya jadwal berikutnya -> hitung & simpan, jangan langsung jalan
      job.state = { ...(job.state || {}), nextRunAtMs: hitungNextRunMs(job.schedule, now) };
      list[i] = job;
      continue;
    }
    if (!due) continue;

    // Job yang dipegang seeder/skill (riset & draft) tidak dieksekusi runner;
    // cukup majukan jadwal berikutnya.
    if (dipegangEngineLain(job)) {
      job.state = {
        ...(job.state || {}),
        lastStatus: "skipped",
        lastError: "ditangani seeder skill (riset/draft)",
        nextRunAtMs: hitungNextRunMs(job.schedule, now),
      };
      job.updatedAtMs = now;
      list[i] = job;
      tulisJsonArray(CRON_PATH, list);
      continue;
    }

    // Tandai berjalan + MAJUKAN jadwal berikutnya SEBELUM eksekusi, agar putaran
    // berikutnya tidak menganggap job ini masih due. Persist agar lintas-proses aman.
    job.state = {
      ...(job.state || {}),
      runningAtMs: now,
      nextRunAtMs: hitungNextRunMs(job.schedule, now),
    };
    job.updatedAtMs = now;
    list[i] = job;
    tulisJsonArray(CRON_PATH, list);

    const hasil = await eksekusiJob(job, { alasan: "terjadwal" });
    dijalankan += 1;

    // Muat ulang dari disk (bisa berubah selama eksekusi), lalu bersihkan runningAtMs.
    const list2 = bacaJsonArray(CRON_PATH);
    const i2 = list2.findIndex((j) => j.id === job.id);
    if (i2 >= 0) {
      const j2 = list2[i2];
      j2.state = {
        ...(j2.state || {}),
        runningAtMs: undefined,
        lastRunAtMs: now,
        lastStatus: hasil.status,
        lastError: hasil.ok ? undefined : hasil.error,
        lastDurationMs: hasil.durasiMs || 0,
        nextRunAtMs: hitungNextRunMs(j2.schedule, now),
      };
      j2.updatedAtMs = now;
      list2[i2] = j2;
      tulisJsonArray(CRON_PATH, list2);
    }

    if (job.deleteAfterRun === true) dihapus.push(job.id);
  }

  let final = bacaJsonArray(CRON_PATH).filter((j) => !dihapus.includes(j.id));
  tulisJsonArray(CRON_PATH, final);

  return { dijalankan, dihapus: dihapus.length };
}

// Entry point manual (dipicu endpoint RUN NOW). Menjalankan job id tertentu.
async function jalankanJobSekarang(id, opts = {}) {
  const list = bacaJsonArray(CRON_PATH);
  const idx = list.findIndex((j) => j.id === id);
  if (idx < 0) return { ok: false, error: "job tidak ditemukan" };
  const job = list[idx];
  if (dipegangEngineLain(job)) {
    return {
      ok: false,
      status: "skipped",
      error: "Job ini ditangani seeder skill (riset/draft) oleh heartbeat, bukan runner cron.",
    };
  }
  const now = Date.now();
  // Tolak bila job sedang berjalan (cegah dobel via RUN NOW + cron bersamaan).
  const BATAS_BERJALAN_MS = 2 * 60 * 60 * 1000;
  if (job.state && Number.isFinite(job.state.runningAtMs) && now - Number(job.state.runningAtMs) < BATAS_BERJALAN_MS) {
    return { ok: false, status: "running", error: "Job sedang berjalan, tunggu sampai selesai." };
  }
  job.state = { ...(job.state || {}), runningAtMs: now, nextRunAtMs: hitungNextRunMs(job.schedule, now) };
  list[idx] = job;
  tulisJsonArray(CRON_PATH, list);

  const hasil = await eksekusiJob(job, { alasan: opts.alasan || "manual" });

  const list2 = bacaJsonArray(CRON_PATH);
  const idx2 = list2.findIndex((j) => j.id === id);
  if (idx2 >= 0) {
    const j2 = list2[idx2];
    j2.state = {
      ...(j2.state || {}),
      runningAtMs: undefined,
      lastRunAtMs: Date.now(),
      lastStatus: hasil.status,
      lastError: hasil.ok ? undefined : hasil.error,
      lastDurationMs: hasil.durasiMs || 0,
      nextRunAtMs: hitungNextRunMs(j2.schedule, Date.now()),
    };
    j2.updatedAtMs = Date.now();
    list2[idx2] = j2;
    tulisJsonArray(CRON_PATH, list2);
  }
  return hasil;
}

let SEDANG_MENUTUP = false;
function tandaiMenutup() { SEDANG_MENUTUP = true; }

// Kunci dalam-proses: cegah dua putaran cron tumpang tindih.
// Rapat/panggilan LLM bisa berjalan belasan menit, jauh lebih lama dari interval.
let PUTARAN_BERJALAN = false;
async function putaranCronAman() {
  if (PUTARAN_BERJALAN) return { dijalankan: 0, dilewati: "putaran sebelumnya masih berjalan" };
  PUTARAN_BERJALAN = true;
  try {
    return await putaranCron();
  } finally {
    PUTARAN_BERJALAN = false;
  }
}

function mulai({ intervalMs = 60000 } = {}) {
  const timer = setInterval(() => {
    if (SEDANG_MENUTUP) return;
    putaranCronAman().catch((e) => { if (!SEDANG_MENUTUP) console.error("[cron-runner] error putaran:", e.message); });
  }, intervalMs);
  // putaran awal setelah 15 detik
  const awal = setTimeout(() => {
    if (SEDANG_MENUTUP) return;
    putaranCronAman().catch((e) => { if (!SEDANG_MENUTUP) console.error("[cron-runner] error putaran awal:", e.message); });
  }, 15000);
  if (awal.unref) awal.unref();
  console.log(`[cron-runner] aktif, cek tiap ${Math.round(intervalMs / 1000)}s`);
  return timer;
}

module.exports = {
  mulai,
  putaranCron,
  putaranCronAman,
  jalankanJobSekarang,
  eksekusiJob,
  setNextRunCalculator,
  setRunHook,
  bangunPersona,
  resolveSkill,
  SKILL_DEFAULT,
  catatTask,
  tandaiMenutup,
};
