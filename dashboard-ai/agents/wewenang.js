const db = require("../lib/db");
const roster = require("./roster");

async function bolehPakaiSkill(kode, skill) {
  const agent = roster.ambil(kode);
  if (!agent) {
    throw new Error(`agent ${kode} tidak ditemukan di roster`);
  }
  if (agent.aktif === false) {
    throw new Error(`agent ${kode} sedang nonaktif`);
  }
  if (!agent.skill_diizinkan.includes(skill)) {
    throw new Error(
      `agent ${kode} berjabatan ${agent.jabatan} tidak berwenang memakai skill ${skill}`
    );
  }
  return true;
}

function _ketikJatah(agent, dipakai) {
  return { jatah: agent.jatah_token_harian, dipakai, sisa: Math.max(0, agent.jatah_token_harian - dipakai) };
}

async function pemakaianHariIni(kode) {
  const r = await db.query(
    `SELECT GREATEST(
       COALESCE((SELECT SUM(token_terpakai) FROM agent_pemakaian WHERE agent_kode = $1 AND tanggal = current_date), 0),
       COALESCE((SELECT SUM(prompt_tokens + completion_tokens) FROM runs WHERE agent = $1 AND created_at::date = current_date), 0)
     )::bigint AS dipakai`,
    [kode]
  );
  return Number(r.rows[0].dipakai || 0);
}

async function cekJatah(kode) {
  const agent = roster.ambil(kode);
  if (!agent) throw new Error(`agent ${kode} tidak ditemukan di roster`);
  const dipakai = await pemakaianHariIni(kode);
  const total = await totalTokenHariIni();
  const plafon = Number(process.env.PLAFON_TOKEN_HARIAN) || 250000;
  if (total >= plafon) {
    throw new Error(`rem token harian aktif: total ${total} telah mencapai plafon ${plafon}`);
  }
  const info = _ketikJatah(agent, dipakai);
  if (dipakai >= agent.jatah_token_harian) {
    throw new Error(
      `jatah token harian agent ${kode} (${agent.nama}) habis: terpakai ${dipakai} dari ${agent.jatah_token_harian}, sisa ${info.sisa}. Coba lagi besok.`
    );
  }
  const ambang = Math.floor(agent.jatah_token_harian * 0.8);
  if (dipakai >= ambang) {
    console.warn(
      `[wewenang] agent ${kode} sudah di ${Math.round((dipakai / agent.jatah_token_harian) * 100)}% jatah harian (${dipakai}/${agent.jatah_token_harian})`
    );
  }
  return info;
}

async function totalTokenHariIni() {
  const r = await db.query(
    `SELECT GREATEST(
       COALESCE((SELECT SUM(token_terpakai) FROM agent_pemakaian WHERE tanggal = current_date), 0),
       COALESCE((SELECT SUM(prompt_tokens + completion_tokens) FROM runs WHERE created_at::date = current_date), 0)
     )::bigint AS total`
  );
  return Number(r.rows[0].total || 0);
}

async function catatPemakaian(kode, tokens) {
  const n = Math.max(0, Math.floor(Number(tokens) || 0));
  if (n === 0) return;
  await db.query(
    `INSERT INTO agent_pemakaian (agent_kode, tanggal, token_terpakai)
     VALUES ($1, current_date, $2)
     ON CONFLICT (agent_kode, tanggal)
     DO UPDATE SET token_terpakai = agent_pemakaian.token_terpakai + EXCLUDED.token_terpakai`,
    [kode, n]
  );
}

module.exports = { bolehPakaiSkill, cekJatah, catatPemakaian, pemakaianHariIni, totalTokenHariIni };
