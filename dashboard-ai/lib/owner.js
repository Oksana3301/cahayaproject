const { chatJSON } = require("./llm");
const db = require("./db");
const roster = require("../agents/roster");

function kategori(teks) {
  const x = String(teks || "").toLowerCase();
  if (/jadwal|publish|terbit|posting/.test(x)) return "publish";
  if (/draft|caption|tulis|konten/.test(x)) return "draft";
  if (/riset|cari|analisis|telusur|telaah|tren|berita/.test(x)) return "riset";
  return "lain";
}

const RISET_KODE = ["aruna", "nala", "jati"];
const DRAFT_KODE = ["laras"];
const PUBLISH_KODE = ["tara", "raya"];

function tugasDeterministik(perintahOwner) {
  const teks = String(perintahOwner || "").trim();
  const lower = teks.toLowerCase();
  const match = teks.match(/(?:topik|tentang|mengenai)\s+["“]?([^"”.,\n]+?)(?:["”]|\s+lalu|\s+dan|$)/i);
  const keyword = match ? match[1].trim() : "sustainability";
  const hasil = [];
  const jumlahDraft = Math.min(3, Math.max(1, Number((lower.match(/(\d+)\s*draft/) || [])[1] || 1)));

  if (/riset|cari|analisis|telusur|telaah|tren|topik/.test(lower)) {
    hasil.push({
      judul: `Riset topik ${keyword}`,
      isi: `Riset topik ${keyword}; kumpulkan sumber kredibel dan rangkum tepat tiga sudut pandang.`,
      agent_yang_boleh: ["aruna", "nala", "jati"],
    });
  }
  if (/draft|susun|tulis|caption|konten/.test(lower)) {
    hasil.push({
      judul: `Susun ${jumlahDraft} draft konten`,
      isi: `Susun ${jumlahDraft} draft dari hasil riset terbaru dan hentikan semuanya untuk persetujuan Owner.`,
      agent_yang_boleh: ["laras"],
    });
  }
  if (/jadwalkan|publish|terbitkan/.test(lower)) {
    hasil.push({
      judul: "Siapkan jadwal setelah persetujuan",
      isi: "Periksa kesiapan draft; jangan membuat schedule atau publish sebelum Owner menyetujui draft.",
      agent_yang_boleh: ["tara"],
    });
  }
  if (!hasil.length) {
    hasil.push(
      { judul: `Riset topik ${keyword}`, isi: `Riset ${keyword} dan rangkum tiga sudut pandang.`, agent_yang_boleh: ["aruna", "nala", "jati"] },
      { judul: "Susun satu draft", isi: "Susun satu draft dari riset terbaru; tunggu persetujuan Owner.", agent_yang_boleh: ["laras"] }
    );
  }
  return hasil;
}

function agentValid(kode, jenis) {
  const a = roster.ambil(kode);
  if (!a || !a.skill_diizinkan.length) return false;
  if (jenis === "riset") return RISET_KODE.includes(kode) && a.skill_diizinkan.includes("riset");
  if (jenis === "draft") return DRAFT_KODE.includes(kode) && a.skill_diizinkan.includes("publish") && a.skill_diizinkan.includes("riset");
  if (jenis === "publish") return PUBLISH_KODE.includes(kode) && a.skill_diizinkan.includes("publish");
  return true;
}

async function bagiTugas(perintahOwner) {
  const daftar = roster.ROSTER.map(
    (a) => `${a.kode} (${a.nama}, ${a.jabatan}): [${a.skill_diizinkan.join(", ") || "tanpa skill"}]`
  ).join("\n");
  const system =
    "Kamu Kirana, Editor-in-Chief & Orchestrator Cahaya Project. Pecah perintah Owner menjadi urutan tugas kecil, maksimal 5. " +
    "Roster/skill yang tersedia:\n" + daftar + "\n" +
    "Riset: kode aruna, nala, atau jati saja. Draft: kode laras saja. Jadwal/publish: kode tara saja. " +
    "Jangan assign Kirana sendiri. Jangan membuat tugas publish yang melakukan aksi eksternal; tara hanya menunggu persetujuan Owner. " +
    "Balas JSON saja: {\"tugas\":[{\"judul\":\"...\",\"isi\":\"...\",\"agent_yang_boleh\":[\"kode\"]}]}";
  let tugasArr;
  let sumber = "atria";
  try {
    const j = await chatJSON({
      agent: "kirana", skill: "bagi",
      messages: [{ role: "system", content: system }, { role: "user", content: `Perintah Owner: ${String(perintahOwner).slice(0, 800)}` }],
      maxTokens: 2048,
    });
    tugasArr = Array.isArray(j && j.tugas) ? j.tugas.slice(0, 5) : [];
    if (!tugasArr.length) throw new Error("CEO tidak menghasilkan tugas yang valid");
  } catch (e) {
    console.error("[owner] planner LLM gagal; gunakan guardrail deterministik:", e.message);
    tugasArr = tugasDeterministik(perintahOwner);
    sumber = "fallback";
  }

  const valid = [];
  const ditolak = [];
  for (const t of tugasArr) {
    const judul = String(t.judul || "").trim();
    const isi = String(t.isi || "").trim();
    if (!judul || !isi) {
      ditolak.push({ judul: judul || "(kosong)", alasan: "judul atau isi kosong" });
      continue;
    }
    const jenis = kategori(judul) !== "lain" ? kategori(judul) : kategori(isi);
    let kodeBoleh = Array.isArray(t.agent_yang_boleh) ? t.agent_yang_boleh.filter((k) => agentValid(k, jenis)) : [];
    if (!kodeBoleh.length) {
      if (jenis === "riset") kodeBoleh = ["aruna", "nala", "jati"];
      else if (jenis === "draft") kodeBoleh = ["laras"];
      else if (jenis === "publish") kodeBoleh = ["tara"];
      else {
        ditolak.push({ judul, alasan: "tidak ditemukan agent berwenang" });
        continue;
      }
      if (sumber === "atria") sumber = "guardrail";
    }
    valid.push({ judul, isi, agentYangBoleh: [...new Set(kodeBoleh)] });
  }
  if (!valid.length) {
    for (const t of tugasDeterministik(perintahOwner)) {
      valid.push({ judul: t.judul, isi: t.isi, agentYangBoleh: t.agent_yang_boleh });
    }
    sumber = "fallback";
  }

  const dibuat = [];
  for (const t of valid) {
    const r = await db.query(
      `INSERT INTO tugas (judul, isi, status, agent_yang_boleh, dibuat_oleh, dibuat_pada)
       VALUES ($1,$2,'menunggu',$3,'owner',now()) RETURNING *`,
      [t.judul, t.isi, t.agentYangBoleh]
    );
    dibuat.push(r.rows[0]);
  }
  return { dibuat, ditolak, sumber };
}

module.exports = { bagiTugas, tugasDeterministik };
