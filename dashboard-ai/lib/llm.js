const db = require("./db");
const wewenang = require("../agents/wewenang");

const BASE = process.env.ATRIA_BASE_URL || "https://api.atria-asi.ai/v1";
const MODEL = process.env.ATRIA_MODEL || "Atria-Dawn-Preview";
const KEY = process.env.ATRIA_API_KEY;
const TIMEOUT_MS = 300000;
const MAX_TOKENS_CAP = 65536;

const BACKOFF = [2000, 4000, 8000, 16000, 32000];
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buatAbort() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { ctrl, timer };
}

async function catatRun({ agent, skill, promptTokens, completionTokens, status, error }) {
  try {
    await db.query(
      `INSERT INTO runs (agent, skill, prompt_tokens, completion_tokens, status, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agent, skill, promptTokens || 0, completionTokens || 0, status, error || null]
    );
  } catch (e) {
    console.error("[llm] gagal mencatat run (tidak membatalkan panggilan):", e.message);
  }
}

async function cekJatahSebelumLLM(agent, skill) {
  if (!agent || agent === "sistem") return null;
  const kode = String(agent);
  if (skill === "publish") await wewenang.bolehPakaiSkill(kode, "publish");
  else if (skill === "riset") await wewenang.bolehPakaiSkill(kode, "riset");
  return wewenang.cekJatah(kode);
}

async function catatTokenAgent(agent, usage) {
  if (!agent || agent === "sistem") return;
  const total = Math.max(0, Number(usage?.prompt_tokens || 0) + Number(usage?.completion_tokens || 0));
  if (total) await wewenang.catatPemakaian(String(agent), total);
}

async function panggilSekali(body, signal) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  return res;
}

async function chat({ agent, skill, messages, tools, maxTokens }) {
  // CEO planner dan rangkum tidak perlu sangat mahal; kita batasi agar perintah owner cepat selesai
  if (!KEY) {
    throw new Error("ATRIA_API_KEY kosong di .env");
  }
  let mt = Math.floor(Number(maxTokens) || 4096);
  if (mt > MAX_TOKENS_CAP) mt = MAX_TOKENS_CAP;
  if (mt < 1) mt = 4096;

  const jatah = await cekJatahSebelumLLM(agent, skill);
  if (jatah) {
    const plafon = Number(process.env.PLAFON_TOKEN_HARIAN) || 250000;
    const pemakaianTotal = await wewenang.totalTokenHariIni();
    const plafonSisa = plafon - pemakaianTotal;
    if (plafonSisa <= 0) throw new Error(`rem token harian aktif: total ${pemakaianTotal} telah mencapai plafon ${plafon}`);
    const sisa = Math.min(jatah.sisa, plafonSisa);
    if (sisa <= 0) throw new Error(`jatah token agent ${agent} habis`);
    mt = Math.min(mt, sisa, MAX_TOKENS_CAP);
  }
  return _chatOnce({ agent, skill, messages, tools, maxTokens: mt });
}

async function _chatOnce({ agent, skill, messages, tools, maxTokens }) {
  let mt = Math.floor(Number(maxTokens) || 4096);
  if (mt > MAX_TOKENS_CAP) mt = MAX_TOKENS_CAP;
  if (mt < 1) mt = 4096;
  const body = { model: MODEL, messages, max_tokens: mt };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  let lastErr = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    const { ctrl, timer } = buatAbort();
    try {
      const res = await panggilSekali(body, ctrl.signal);
      clearTimeout(timer);
      if (RETRYABLE.has(res.status)) {
        if (attempt >= BACKOFF.length) {
          const txt = await res.text().catch(() => "");
          await catatRun({ agent, skill, promptTokens: 0, completionTokens: 0, status: "gagal", error: `HTTP ${res.status} ${txt.slice(0, 200)}` });
          throw new Error(`Atria HTTP ${res.status} setelah semua retry: ${txt.slice(0, 200)}`);
        }
        const txt = await res.text().catch(() => "");
        console.warn(`[llm] HTTP ${res.status}, retry dalam ${BACKOFF[attempt]}ms: ${txt.slice(0, 120)}`);
        await sleep(BACKOFF[attempt]);
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const err = new Error(`Atria HTTP ${res.status}: ${txt.slice(0, 300)}`);
        err.status = res.status;
        await catatRun({ agent, skill, promptTokens: 0, completionTokens: 0, status: "gagal", error: err.message });
        throw err;
      }
      const data = await res.json();
      const usage = data.usage || {};
      await catatRun({
        agent: agent || "sistem",
        skill: skill || "-",
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        status: "sukses",
      });
      try {
        await catatTokenAgent(agent, usage);
      } catch (e) {
        console.error("[llm] gagal mencatat pemakaian agent:", e.message);
      }
      return data;
  } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") {
        const err = new Error(`Atria timeout setelah ${TIMEOUT_MS / 1000} detik`);
        await catatRun({ agent, skill, promptTokens: 0, completionTokens: 0, status: "gagal", error: err.message });
        throw err;
      }
      if (e && typeof e.status === "number" && !RETRYABLE.has(e.status)) throw e;
      if (e && e.message && (/^(jatah|rem token harian)/i.test(e.message))) throw e;
      if (attempt >= BACKOFF.length) {
        await catatRun({ agent, skill, promptTokens: 0, completionTokens: 0, status: "gagal", error: e.message });
        throw e;
      }
      lastErr = e;
      await sleep(BACKOFF[attempt]);
    }
  }
  throw lastErr || new Error("chat gagal tanpa sebab jelas");
}

function buatInstruksiJSON(system) {
  return (
    (system ? system + "\n\n" : "") +
    "KIRIM BALASAN DALAM BENTUK JSON VALID SAHAJA. Tidak ada teks pembuka, tidak ada penjelasan, tidak ada markdown code block. Langsung objek JSON."
  );
}

async function ekstrakJSON(teks) {
  if (!teks) throw new Error("balasan kosong, JSON tidak ditemukan");
  const s = String(teks).trim();
  const mulaiObj = s.indexOf("{");
  const akhirObj = s.lastIndexOf("}");
  const mulaiArray = s.indexOf("[");
  const akhirArray = s.lastIndexOf("]");
  const gunakanArray = mulaiArray >= 0 && (mulaiObj < 0 || mulaiArray < mulaiObj);
  const mulai = gunakanArray ? mulaiArray : mulaiObj;
  const akhir = gunakanArray ? akhirArray : akhirObj;
  if (mulai < 0 || akhir <= mulai) throw new Error("JSON tidak ditemukan dalam balasan");
  return JSON.parse(s.slice(mulai, akhir + 1));
}

async function chatJSON({ agent, skill, messages, tools, maxTokens }) {
  const msg = messages.map((m) => ({ ...m }));
  const sysIdx = msg.findIndex((m) => m.role === "system");
  const instruksi = buatInstruksiJSON(sysIdx >= 0 ? msg[sysIdx].content : "");
  if (sysIdx >= 0) msg[sysIdx].content = instruksi;
  else msg.unshift({ role: "system", content: instruksi });

  let teks = null;
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    const data = await chat({ agent, skill, messages: msg, tools, maxTokens });
    teks = data.choices?.[0]?.message?.content || "";
    try {
      return ekstrakJSON(teks);
    } catch (e) {
      if (percobaan === 0) {
        msg.push({
          role: "user",
          content: "balasan sebelumnya bukan JSON valid, kirim JSON saja tanpa penjelasan",
        });
      } else {
        throw new Error(`chatJSON: gagal parse JSON setelah 2 percobaan. Isi: ${String(teks).slice(0, 200)}`);
      }
    }
  }
  throw new Error("chatJSON: tidak ada balasan");
}

module.exports = { chat, chatJSON, MAX_TOKENS_CAP, MODEL, BASE };
