#!/usr/bin/env node
/**
 * gen-percakapan.js
 * Mengubah arsip rapat (.hermes3d/rapat/*.json) menjadi berkas Markdown yang rapi
 * di percakapan/rapat/ agar seluruh diskusi agent terdokumentasi & mudah dibaca.
 *
 * Penggunaan:
 *   node tools/gen-percakapan.js <dir-sumber-rapat> <dir-keluar>
 */
const fs = require("fs");
const path = require("path");

const sumber = process.argv[2] || path.join(__dirname, "..", "..", "dashboard-ai", ".hermes3d", "rapat");
const keluar = process.argv[3] || path.join(__dirname, "..", "percakapan", "rapat");

function bacaSemua(dir) {
  if (!fs.existsSync(dir)) return [];
  const hasil = [];
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      hasil.push(...bacaSemua(p));
    } else if (nama.endsWith(".json")) {
      try {
        hasil.push({ berkas: nama, data: JSON.parse(fs.readFileSync(p, "utf8")) });
      } catch { /* lewati */ }
    }
  }
  return hasil;
}

function slugAgenda(agenda) {
  return String(agenda || "rapat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function keMarkdown({ berkas, data }) {
  const waktu = data.waktu || data.selesai || new Date().toISOString();
  const tanggal = String(waktu).slice(0, 10);
  const jenis = data.jenis || "manual";
  const diundang = (data.diundang || []).join(", ") || "-";
  const pendapat = (data.pendapat || [])
    .map((p) => `### ${p.nama || p.kode || "?"} — ${p.jabatan || ""}\n\n${p.pendapat || "(kosong)"}`)
    .join("\n\n");
  return [
    `# Rapat [${jenis}] — ${tanggal}`,
    "",
    `- **Waktu:** ${waktu}`,
    `- **Jenis:** ${jenis}`,
    `- **Dihadiri:** ${diundang}`,
    `- **Berkas asal:** \`${berkas}\``,
    "",
    "## Agenda",
    "",
    data.agenda || "(tanpa agenda)",
    "",
    "## Pendapat Peserta",
    "",
    pendapat || "(tidak ada pendapat tercatat)",
    "",
    "## Notulen",
    "",
    data.notulen || "(belum ada notulen)",
    "",
  ].join("\n");
}

function main() {
  const semua = bacaSemua(sumber);
  if (!semua.length) {
    console.log(`Tidak ada arsip rapat di ${sumber}`);
    return;
  }
  semua.sort((a, b) => String(a.data.waktu || "").localeCompare(String(b.data.waktu || "")));
  fs.mkdirSync(keluar, { recursive: true });

  let n = 0;
  for (const item of semua) {
    const waktu = item.data.waktu || item.data.selesai || new Date().toISOString();
    const tanggal = String(waktu).slice(0, 10);
    const jenis = item.data.jenis || "manual";
    const nama = `${tanggal}__${jenis}__${slugAgenda(item.data.agenda)}.md`;
    fs.writeFileSync(path.join(keluar, nama), keMarkdown(item));
    n += 1;
  }
  console.log(`Ditulis ${n} berkas percakapan rapat ke ${keluar}`);
}

main();
