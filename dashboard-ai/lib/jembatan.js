const db = require("./db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const SKILL_DIRS = [path.resolve(__dirname, "..", "skills")];
const MANAGED_SKILL_DIR = path.resolve(__dirname, "..", "skills");
const STATE_DIR = path.resolve(__dirname, "..", ".hermes3d");
const CONFIG_PATH = path.join(STATE_DIR, "gateway-config.json");

async function ambilAgents() {
  const rows = await db.ambilBanyak("SELECT * FROM agents ORDER BY id");
  const tugasAktif = await db.ambilBanyak(
    `SELECT agent_pemilik, judul, diambil_pada, dibuat_oleh FROM tugas WHERE status = 'dikerjakan'`
  );
  const pemilikKeTugas = new Map();
  for (const t of tugasAktif) {
    if (t.agent_pemilik) pemilikKeTugas.set(t.agent_pemilik, t);
  }
  const sekarang = Date.now();
  const perintahCounts = new Map();
  for (const t of tugasAktif) {
    const k = t.dibuat_oleh || "owner";
    perintahCounts.set(k, (perintahCounts.get(k) || 0) + 1);
  }
  return rows.map((a, idx) => {
    const t = pemilikKeTugas.get(a.kode);
    let keadaan = "idle";
    let tugasSekarang = null;
    if (t) {
      tugasSekarang = t.judul;
      const diambil = t.diambil_pada ? new Date(t.diambil_pada).getTime() : 0;
      if (sekarang - diambil < 25000) keadaan = "jalan";
      else if ((perintahCounts.get(t.dibuat_oleh || "owner") || 0) >= 2) keadaan = "rapat";
      else keadaan = "kerja";
    }
    return {
      kode: a.kode,
      nama: a.nama,
      emoji: a.emoji,
      jabatan: a.jabatan,
      warna: a.emoji,
      keadaan,
      tugas_sekarang: tugasSekarang,
      meja: idx,
    };
  });
}

async function health() {
  return { ok: true, status: "ok" };
}

async function state() {
  const agents = await ambilAgents();
  const active = {};
  for (const a of agents) active[a.kode] = "Atria-Dawn-Preview";
  return {
    profile: "custom",
    profileName: "Cahaya Project",
    registry_profile: "cahaya-project",
    identity: {
      name: "Cahaya Project",
      role: "orchestrator",
      lane: "cahaya-project",
      model_id: "Atria-Dawn-Preview",
    },
    runtime: {
      name: "Cahaya Project Dashboard AI",
      version: "1.0.0",
      vendor: "Cahaya Project",
      status: "ok",
      active_model: "Atria-Dawn-Preview",
    },
    active,
    agents,
    timestamp: new Date().toISOString(),
  };
}

async function registry() {
  const agents = await ambilAgents();
  return {
    models: {
      "Atria-Dawn-Preview": {
        name: "Atria Dawn Preview",
        provider: "atria",
      },
    },
    agents: agents.map((a) => ({
      id: a.kode,
      name: a.nama,
      role: a.jabatan,
      status: a.keadaan,
    })),
  };
}

// ===== RPC gateway bridge: skills / config / agents / usage =====

const KOSONG = { bins: [], anyBins: [], env: [], config: [], os: [] };

function bacaConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { config: {}, exists: false, hash: "", path: CONFIG_PATH };
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const config = JSON.parse(raw);
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    return { config, exists: true, hash, path: CONFIG_PATH };
  } catch (e) {
    return { config: {}, exists: false, hash: "", path: CONFIG_PATH };
  }
}

function tulisConfig(config) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const raw = JSON.stringify(config, null, 2);
  fs.writeFileSync(CONFIG_PATH, raw, "utf8");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function bacaAgentConfigList(config) {
  const agents = config && typeof config === "object" ? config.agents : null;
  const list = agents && Array.isArray(agents.list) ? agents.list : [];
  return list.filter((e) => e && typeof e === "object" && typeof e.id === "string" && e.id.trim());
}

function tulisAgentConfigList(config, list) {
  const base = config && typeof config === "object" ? config : {};
  return { ...base, agents: { ...(base.agents || {}), list } };
}

async function daftarFileSkill() {
  const out = [];
  for (const dir of SKILL_DIRS) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const md = path.join(full, "SKILL.md");
        if (!fs.existsSync(md)) continue;
        out.push({ baseDir: dir, leaf: ent.name, filePath: md });
      } else if (ent.isFile() && ent.name.endsWith(".js")) {
        out.push({ baseDir: dir, leaf: ent.name, filePath: full });
      }
    }
  }
  return out;
}

function parseFrontmatter(teks) {
  const meta = {};
  const m = /^---\n([\s\S]*?)\n---/.exec(teks);
  if (!m) return meta;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (k) meta[k] = v;
  }
  return meta;
}

async function skillsStatus(agentId) {
  const files = await daftarFileSkill();
  const snapshot = bacaConfig();
  const list = bacaAgentConfigList(snapshot.config);
  const entry = agentId ? list.find((e) => e.id === agentId) : null;
  const allowlist = entry && Array.isArray(entry.skills) ? entry.skills : null;

  const skills = files.map((f) => {
    let nama = f.leaf.replace(/\.js$/, "");
    let deskripsi = "";
    try {
      const raw = fs.readFileSync(f.filePath, "utf8");
      const fm = parseFrontmatter(raw);
      if (fm.name) nama = fm.name;
      deskripsi = fm.description || "";
    } catch {}
    const skillKey = f.leaf.replace(/\.js$/, "");
    return {
      name: nama,
      description: deskripsi,
      source: "hermes-workspace",
      bundled: false,
      filePath: f.filePath,
      baseDir: f.baseDir,
      skillKey,
      always: false,
      disabled: false,
      blockedByAllowlist: Boolean(allowlist && !allowlist.includes(nama)),
      eligible: true,
      requirements: { ...KOSONG },
      missing: { ...KOSONG },
      configChecks: [],
      install: [],
    };
  });

  return {
    workspaceDir: path.resolve(__dirname, ".."),
    managedSkillsDir: MANAGED_SKILL_DIR,
    skills,
  };
}

function jalankanInstall(perintah, argumen, timeoutMs) {
  return new Promise((resolve) => {
    execFile(perintah, argumen, { timeout: timeoutMs || 120000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, message: err.message, stdout: stdout || "", stderr: stderr || "", code: err.code ?? 1 });
      } else {
        resolve({ ok: true, message: "Install selesai", stdout: stdout || "", stderr: stderr || "", code: 0 });
      }
    });
  });
}

async function skillsInstall(params) {
  const nama = String(params?.name || "").trim();
  const installId = String(params?.installId || "").trim();
  if (!nama || !installId) throw new Error("name dan installId wajib diisi");
  const timeoutMs = Number(params?.timeoutMs) || 120000;
  const perintah = installId === "brew" ? "brew" : installId === "uv" ? "uv" : installId === "go" ? "go" : installId === "download" ? "curl" : "npm";
  const argumen = installId === "npm" ? ["install", "-g", nama] : installId === "brew" ? ["install", nama] : installId === "uv" ? ["tool", "install", nama] : installId === "go" ? ["install", nama] : ["-fsSL", nama];
  const hasil = await jalankanInstall(perintah, argumen, timeoutMs);
  return { ...hasil, warnings: [] };
}

async function skillsInstallPackaged(params) {
  const skillKey = String(params?.skillKey || "").trim();
  const workspaceDir = String(params?.workspaceDir || "").trim();
  const rawFiles = Array.isArray(params?.files) ? params.files : [];
  if (!skillKey) throw new Error("skillKey wajib diisi");
  if (!workspaceDir) throw new Error("workspaceDir wajib diisi");
  if (rawFiles.length === 0) throw new Error("files wajib diisi");
  const root = path.resolve(workspaceDir);
  const target = path.join(root, "skills", skillKey);
  if (!target.startsWith(root + path.sep)) throw new Error("Menolak menulis skill di luar workspace");
  const safeFiles = [];
  for (const file of rawFiles) {
    const relativePath = String(file?.relativePath || "").trim();
    const content = typeof file?.content === "string" ? file.content : "";
    if (!relativePath || relativePath.includes("..") || path.isAbsolute(relativePath)) {
      throw new Error(`relativePath tidak valid: ${relativePath}`);
    }
    safeFiles.push({ relativePath, content });
  }
  if (!safeFiles.some((f) => f.relativePath === "SKILL.md")) {
    throw new Error("Paket skill wajib menyertakan SKILL.md");
  }
  fs.mkdirSync(target, { recursive: true });
  for (const file of safeFiles) {
    const dest = path.join(target, file.relativePath);
    if (!dest.startsWith(target + path.sep)) throw new Error("Menolak path keluar dari folder skill");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.content, "utf8");
  }
  return { installed: true, installedPath: target, skillKey, source: "hermes-workspace" };
}

async function skillsUpdate(params) {
  const skillKey = String(params?.skillKey || "").trim();
  if (!skillKey) throw new Error("skillKey wajib diisi");
  const enabled = params?.enabled !== false;
  const snapshot = bacaConfig();
  const list = bacaAgentConfigList(snapshot.config);
  const next = list.map((e) => (e.id === "main" ? { ...e, disabled: !enabled } : e));
  if (!next.some((e) => e.id === "main")) next.push({ id: "main", disabled: !enabled });
  const config = tulisAgentConfigList(snapshot.config, next);
  tulisConfig(config);
  return { ok: true, skillKey, config: { disabled: !enabled } };
}

async function skillsRemove(params) {
  const skillKey = String(params?.skillKey || "").trim();
  const source = params?.source === "hermes-managed" ? "hermes-managed" : "hermes-workspace";
  if (!skillKey) throw new Error("skillKey wajib diisi");
  const target = path.join(source === "hermes-managed" ? MANAGED_SKILL_DIR : path.resolve(__dirname, "..", "skills"), skillKey);
  const allowedRoot = source === "hermes-managed" ? MANAGED_SKILL_DIR : path.resolve(__dirname, "..", "skills");
  if (!target.startsWith(allowedRoot)) throw new Error("Menolak menghapus skill di luar root yang diizinkan");
  let removedPath = target;
  try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
  return { removed: fs.existsSync(target) === false, removedPath, source };
}

async function configGet() {
  return bacaConfig();
}

async function configSet(params) {
  const raw = typeof params?.raw === "string" ? params.raw : null;
  if (!raw) throw new Error("raw wajib diisi");
  let config;
  try { config = JSON.parse(raw); } catch (e) { throw new Error("config JSON tidak valid"); }
  const hash = tulisConfig(config);
  return { ok: true, hash };
}

async function configPatch(params) {
  const raw = typeof params?.raw === "string" ? params.raw : null;
  if (!raw) throw new Error("raw wajib diisi");
  let patch;
  try { patch = JSON.parse(raw); } catch (e) { throw new Error("patch JSON tidak valid"); }
  const snapshot = bacaConfig();
  const base = snapshot.config && typeof snapshot.config === "object" ? snapshot.config : {};
  const next = { ...base, ...patch, agents: { ...(base.agents || {}), ...(patch.agents || {}), list: patch.agents?.list ?? base.agents?.list ?? [] } };
  const hash = tulisConfig(next);
  return { ok: true, hash };
}

async function agentsCreate(params) {
  const nama = String(params?.name || "").trim();
  if (!nama) throw new Error("name wajib diisi");
  const slug = nama.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const agentId = `${slug || "agent"}-${crypto.randomBytes(4).toString("hex")}`;
  const workspace = typeof params?.workspace === "string" ? params.workspace : path.resolve(__dirname, "..", `workspace-${agentId}`);
  const snapshot = bacaConfig();
  const list = bacaAgentConfigList(snapshot.config);
  if (!list.some((e) => e.id === agentId)) list.push({ id: agentId, name: nama, workspace });
  const config = tulisAgentConfigList(snapshot.config, list);
  tulisConfig(config);
  return { ok: true, agentId, name: nama, workspace };
}

async function agentsUpdate(params) {
  const agentId = String(params?.agentId || "").trim();
  const nama = String(params?.name || "").trim();
  if (!agentId || !nama) throw new Error("agentId dan name wajib diisi");
  const snapshot = bacaConfig();
  const list = bacaAgentConfigList(snapshot.config);
  const next = list.map((e) => (e.id === agentId ? { ...e, name: nama } : e));
  const config = tulisAgentConfigList(snapshot.config, next);
  tulisConfig(config);
  return { ok: true, agentId, name: nama };
}

async function agentsDelete(params) {
  const agentId = String(params?.agentId || "").trim();
  if (!agentId) throw new Error("agentId wajib diisi");
  const snapshot = bacaConfig();
  const list = bacaAgentConfigList(snapshot.config);
  const next = list.filter((e) => e.id !== agentId);
  const removedBindings = list.length - next.length;
  if (removedBindings > 0) {
    const config = tulisAgentConfigList(snapshot.config, next);
    tulisConfig(config);
  }
  return { ok: true, removedBindings };
}

const AGENTS_DIR = path.join(STATE_DIR, "agents");
const NAMA_FILE_AGENT_VALID = new Set([
  "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "MEMORY.md", "PRINSIP.md",
]);

function resolveAgentFilePath(agentId, name) {
  const id = String(agentId || "").trim();
  const file = String(name || "").trim();
  if (!id) throw new Error("agentId wajib diisi");
  if (!NAMA_FILE_AGENT_VALID.has(file)) throw new Error(`nama file agent tidak valid: ${file}`);
  const dir = path.join(AGENTS_DIR, id);
  return { dir, filePath: path.join(dir, file) };
}

async function agentsFilesGet(params) {
  const { dir, filePath } = resolveAgentFilePath(params?.agentId, params?.name);
  if (!fs.existsSync(filePath)) {
    return { workspace: dir, file: { missing: true, path: filePath } };
  }
  const content = fs.readFileSync(filePath, "utf8");
  return { workspace: dir, file: { missing: false, content, path: filePath } };
}

async function agentsFilesSet(params) {
  const { dir, filePath } = resolveAgentFilePath(params?.agentId, params?.name);
  const content = typeof params?.content === "string" ? params.content : "";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return { ok: true, workspace: dir, path: filePath };
}

const EXEC_APPROVALS_PATH = path.join(STATE_DIR, "exec-approvals.json");

function execApprovalsSnapshot() {
  let file = { version: 1, agents: {} };
  let hash = "";
  let exists = false;
  try {
    if (fs.existsSync(EXEC_APPROVALS_PATH)) {
      const raw = fs.readFileSync(EXEC_APPROVALS_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        file = parsed;
        exists = true;
      }
      hash = crypto.createHash("sha256").update(raw).digest("hex");
    }
  } catch (e) {
    file = { version: 1, agents: {} };
    exists = false;
    hash = "";
  }
  return { path: EXEC_APPROVALS_PATH, exists, hash, file };
}

async function execApprovalsGet() {
  return execApprovalsSnapshot();
}

async function execApprovalsSet(params) {
  const file = params?.file && typeof params.file === "object" ? params.file : null;
  if (!file) throw new Error("file wajib diisi");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const raw = JSON.stringify(file, null, 2);
  fs.writeFileSync(EXEC_APPROVALS_PATH, raw, "utf8");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { ok: true, hash };
}

async function execApprovalResolve() {
  return { ok: true, resolved: true };
}

async function runtimeStatus() {
  const snapshot = bacaConfig();
  const list = bacaAgentConfigList(snapshot.config);
  return {
    config: { exists: snapshot.exists, hash: snapshot.hash },
    heartbeat: {
      agents: list.map((e) => ({
        agentId: e.id,
        enabled: true,
        every: "30m",
        everyMs: 30 * 60 * 1000,
      })),
    },
  };
}

async function listAgentsRpc() {
  const agents = await ambilAgents();
  return {
    defaultId: agents[0]?.kode ?? "main",
    mainKey: "main",
    scope: "custom",
    agents: agents.map((a) => ({ id: a.kode, name: a.nama, role: a.jabatan })),
  };
}

async function sessionsUsage(params) {
  const start = String(params?.startDate || "");
  const end = String(params?.endDate || "");
  const rows = await db.ambilBanyak(
    `SELECT agent, skill, prompt_tokens, completion_tokens, status, created_at FROM runs
     WHERE ($1 = '' OR created_at >= $1::timestamptz)
       AND ($2 = '' OR created_at <= ($2::timestamptz + interval '1 day'))
     ORDER BY created_at ASC`,
    [start, end]
  );
  const byKey = new Map();
  let totalInput = 0, totalOutput = 0, totalTokens = 0, totalMessages = 0, errors = 0;
  for (const r of rows) {
    const key = `agent:${r.agent || "main"}:main`;
    let sesi = byKey.get(key);
    if (!sesi) {
      sesi = {
        key,
        label: r.agent || "main",
        agentId: r.agent || null,
        channel: null,
        model: "Atria-Dawn-Preview",
        provider: "atria",
        updatedAt: r.created_at ? new Date(r.created_at).getTime() : null,
        usage: {
          totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, durationMs: 0 },
          messageCounts: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
          toolUsage: { totalCalls: 0, tools: [] },
          modelUsage: [],
          dailyBreakdown: [],
          dailyMessageCounts: [],
        },
      };
      byKey.set(key, sesi);
    }
    const t = sesi.usage.totals;
    t.input += r.prompt_tokens || 0;
    t.output += r.completion_tokens || 0;
    t.totalTokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
    sesi.usage.messageCounts.total += 1;
    if (r.status && r.status !== "sukses") {
      sesi.usage.messageCounts.errors += 1;
      errors += 1;
    }
    const tanggal = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : null;
    if (tanggal) {
      let harian = sesi.usage.dailyBreakdown.find((d) => d.date === tanggal);
      if (!harian) {
        harian = { date: tanggal, tokens: 0, cost: 0 };
        sesi.usage.dailyBreakdown.push(harian);
      }
      harian.tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
      let harianMsg = sesi.usage.dailyMessageCounts.find((d) => d.date === tanggal);
      if (!harianMsg) {
        harianMsg = { date: tanggal, total: 0, toolCalls: 0, errors: 0 };
        sesi.usage.dailyMessageCounts.push(harianMsg);
      }
      harianMsg.total += 1;
      if (r.status && r.status !== "sukses") harianMsg.errors += 1;
    }
    totalInput += r.prompt_tokens || 0;
    totalOutput += r.completion_tokens || 0;
    totalTokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
    totalMessages += 1;
    if (r.skill && !sesi.usage.modelUsage.some((m) => m.model === r.skill)) {
      sesi.usage.modelUsage.push({ provider: "atria", model: r.skill, count: 0, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, durationMs: 0 } });
    }
    const mu = sesi.usage.modelUsage.find((m) => m.model === r.skill);
    if (mu) {
      mu.count += 1;
      mu.totals.input += r.prompt_tokens || 0;
      mu.totals.output += r.completion_tokens || 0;
      mu.totals.totalTokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
    }
  }
  return {
    sessions: [...byKey.values()],
    totals: {
      input: totalInput,
      output: totalOutput,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      durationMs: 0,
      messageCounts: { total: totalMessages, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors },
    },
  };
}

async function usageCost(params) {
  const start = String(params?.startDate || "");
  const end = String(params?.endDate || "");
  const rows = await db.ambilBanyak(
    `SELECT tanggal, COALESCE(SUM(token_terpakai), 0)::bigint AS token
     FROM agent_pemakaian
     WHERE ($1 = '' OR tanggal >= $1::date)
       AND ($2 = '' OR tanggal <= $2::date)
     GROUP BY tanggal ORDER BY tanggal ASC`,
    [start, end]
  );
  return {
    daily: rows.map((r) => ({
      date: r.tanggal instanceof Date ? r.tanggal.toISOString().slice(0, 10) : String(r.tanggal).slice(0, 10),
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: Number(r.token) || 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: 0,
    })),
  };
}

// ===== RPC gateway bridge: cron (playbooks) & tasks (kanban) =====

const CRON_PATH = path.join(STATE_DIR, "cron-jobs.json");
const TASKS_PATH = path.join(STATE_DIR, "tasks.json");

function bacaJsonArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function tulisJsonArray(filePath, list) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf8");
}

function _cocokField(field, value, min, max) {
  // field: "5", "5,10", "5-10", "*/5", "*"
  if (field === "*" || field === "") return true;
  for (const part of String(field).split(",")) {
    if (part.includes("/")) {
      const [rangeRaw, stepRaw] = part.split("/");
      const step = Math.max(1, parseInt(stepRaw, 10) || 1);
      let lo = min, hi = max;
      if (rangeRaw && rangeRaw !== "*") {
        const [a, b] = rangeRaw.split("-").map((x) => parseInt(x, 10));
        if (Number.isFinite(a)) lo = a;
        if (Number.isFinite(b)) hi = b;
      }
      for (let v = lo; v <= hi; v += step) if (v === value) return true;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x, 10));
      if (Number.isFinite(a) && Number.isFinite(b) && value >= a && value <= b) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}

// Hitung waktu berikutnya (ms) untuk ekspresi cron 5-field, dalam zona tz (jam offset).
function _nextCronMs(expr, fromMs, tzOffsetMinutes) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minF, hourF, domF, monF, dowF] = fields;
  const offsetMs = tzOffsetMinutes * 60000;
  // mulai dari menit berikutnya, waktu lokal
  let t = Math.floor((fromMs + offsetMs) / 60000) * 60000 + 60000;
  const limit = t + 366 * 24 * 60 * 60000;
  for (; t <= limit; t += 60000) {
    const d = new Date(t);
    const mi = d.getUTCMinutes();
    const ho = d.getUTCHours();
    const dom = d.getUTCDate();
    const mo = d.getUTCMonth() + 1;
    const dow = d.getUTCDay();
    if (!_cocokField(minF, mi, 0, 59)) continue;
    if (!_cocokField(hourF, ho, 0, 23)) continue;
    if (!_cocokField(domF, dom, 1, 31)) continue;
    if (!_cocokField(monF, mo, 1, 12)) continue;
    if (!_cocokField(dowF, dow, 0, 6)) continue;
    return t - offsetMs;
  }
  return undefined;
}

function _tzOffsetMinutes(tz) {
  if (!tz || tz === "Asia/Jakarta") return 420; // WIB = UTC+7
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const part = fmt.formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    const m = part && part.value.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) * (m[1].startsWith("-") ? -1 : 1) : 0);
  } catch {}
  return 420;
}

function hitungNextRunMs(schedule, fromMs) {
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
    const periods = Math.ceil(elapsed / everyMs);
    return anchor + periods * everyMs;
  }
  if (schedule.kind === "cron") {
    const expr = String(schedule.expr || "").trim();
    if (!expr) return undefined;
    return _nextCronMs(expr, fromMs, _tzOffsetMinutes(schedule.tz));
  }
  return undefined;
}

async function cronList(params) {
  const includeDisabled = params?.includeDisabled !== false;
  const now = Date.now();
  const jobs = bacaJsonArray(CRON_PATH)
    .filter((job) => (includeDisabled ? true : job.enabled !== false))
    .map((job) => {
      const nextRunAtMs =
        job && job.enabled !== false ? hitungNextRunMs(job.schedule, now) : undefined;
      return { ...job, state: { ...(job.state || {}), nextRunAtMs } };
    })
    .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
  return { jobs };
}

async function cronAdd(params) {
  const name = String(params?.name || "").trim();
  if (!name) throw new Error("name wajib diisi");
  const agentId = String(params?.agentId || "").trim();
  if (!agentId) throw new Error("agentId wajib diisi");
  const now = Date.now();
  const id = typeof params?.id === "string" && params.id.trim() ? params.id.trim() : `cron-${crypto.randomBytes(6).toString("hex")}`;
  const schedule = params?.schedule && typeof params.schedule === "object" ? params.schedule : { kind: "every", everyMs: 3600000 };
  const job = {
    id,
    name,
    agentId,
    sessionKey: typeof params?.sessionKey === "string" ? params.sessionKey : undefined,
    description: typeof params?.description === "string" ? params.description : undefined,
    enabled: params?.enabled !== false,
    deleteAfterRun: params?.deleteAfterRun === true,
    updatedAtMs: now,
    schedule,
    sessionTarget: params?.sessionTarget === "isolated" ? "isolated" : "main",
    wakeMode: params?.wakeMode === "next-heartbeat" ? "next-heartbeat" : "now",
    payload: params?.payload && typeof params.payload === "object" ? params.payload : { kind: "agentTurn", message: name },
    state: { nextRunAtMs: hitungNextRunMs(schedule, now) },
    delivery: params?.delivery && typeof params.delivery === "object" ? params.delivery : { mode: "none" },
  };
  const list = bacaJsonArray(CRON_PATH).filter((j) => j.id !== id);
  list.push(job);
  tulisJsonArray(CRON_PATH, list);
  return job;
}

async function cronRemove(params) {
  const id = String(params?.id || "").trim();
  if (!id) throw new Error("id wajib diisi");
  const list = bacaJsonArray(CRON_PATH);
  const next = list.filter((j) => j.id !== id);
  const removed = next.length !== list.length;
  tulisJsonArray(CRON_PATH, next);
  return { ok: true, removed };
}

async function cronRun(params) {
  const id = String(params?.id || "").trim();
  if (!id) throw new Error("id wajib diisi");
  const list = bacaJsonArray(CRON_PATH);
  const idx = list.findIndex((j) => j.id === id);
  if (idx < 0) return { ok: false };
  const now = Date.now();
  const job = list[idx];
  job.state = {
    ...(job.state || {}),
    runningAtMs: now,
    lastRunAtMs: now,
    lastStatus: "ok",
    lastDurationMs: 0,
    nextRunAtMs: hitungNextRunMs(job.schedule, now),
  };
  job.updatedAtMs = now;
  list[idx] = job;
  tulisJsonArray(CRON_PATH, list);
  return { ok: true, ran: true };
}

async function tasksList(params) {
  const includeArchived = params?.includeArchived !== false;
  const tasks = bacaJsonArray(TASKS_PATH)
    .filter((task) => (includeArchived ? true : task.archived !== true))
    .sort((a, b) => (Number(new Date(b.updatedAt)) || 0) - (Number(new Date(a.updatedAt)) || 0));
  return { tasks };
}

async function tasksCreate(params) {
  const title = String(params?.title || "").trim();
  if (!title) throw new Error("Judul task wajib diisi");
  const now = new Date().toISOString();
  const id = typeof params?.id === "string" && params.id.trim() ? params.id.trim() : `task-${crypto.randomBytes(6).toString("hex")}`;
  const task = {
    id,
    title,
    description: params?.description ?? null,
    status: params?.status || "todo",
    source: params?.source || "local",
    sourceEventId: params?.sourceEventId ?? null,
    assignedAgentId: params?.assignedAgentId ?? null,
    createdAt: now,
    updatedAt: now,
    playbookJobId: params?.playbookJobId ?? null,
    runId: params?.runId ?? null,
    channel: params?.channel ?? null,
    externalThreadId: params?.externalThreadId ?? null,
    lastActivityAt: now,
    notes: Array.isArray(params?.notes) ? params.notes : [],
    archived: false,
  };
  const list = bacaJsonArray(TASKS_PATH).filter((t) => t.id !== id);
  list.push(task);
  tulisJsonArray(TASKS_PATH, list);
  return task;
}

async function tasksUpdate(params) {
  const id = String(params?.id || "").trim();
  if (!id) throw new Error("id wajib diisi");
  const list = bacaJsonArray(TASKS_PATH);
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error("task tidak ditemukan");
  const allowed = [
    "title", "description", "status", "assignedAgentId", "playbookJobId",
    "runId", "channel", "externalThreadId", "notes", "archived",
  ];
  const task = { ...list[idx] };
  for (const key of allowed) {
    if (params && Object.prototype.hasOwnProperty.call(params, key)) task[key] = params[key];
  }
  task.updatedAt = new Date().toISOString();
  task.lastActivityAt = task.updatedAt;
  list[idx] = task;
  tulisJsonArray(TASKS_PATH, list);
  return task;
}

async function tasksDelete(params) {
  const id = String(params?.id || "").trim();
  if (!id) throw new Error("id wajib diisi");
  const list = bacaJsonArray(TASKS_PATH);
  const next = list.filter((t) => t.id !== id);
  const removed = next.length !== list.length;
  tulisJsonArray(TASKS_PATH, next);
  return { ok: true, removed };
}

module.exports = { health, state, registry, ambilAgents, skillsStatus, skillsInstall, skillsInstallPackaged, skillsUpdate, skillsRemove, configGet, configSet, configPatch, agentsCreate, agentsUpdate, agentsDelete, runtimeStatus, sessionsUsage, usageCost, listAgentsRpc, cronList, cronAdd, cronRemove, cronRun, tasksList, tasksCreate, tasksUpdate, tasksDelete, agentsFilesGet, agentsFilesSet, execApprovalsGet, execApprovalsSet, execApprovalResolve, hitungNextRunMs, CRON_PATH };
