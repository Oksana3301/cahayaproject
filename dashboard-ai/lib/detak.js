const { ambilAtomik, simpanHasil, simpanHasilPerluPersetujuan, simpanGagal } = require("./tugas");
const { bolehPakaiSkill, cekJatah } = require("../agents/wewenang");
const { jalankanRiset, rangkumSudut, simpanHasil: simpanRiset } = require("../skills/riset");
const { susunDraft } = require("../skills/publish");
const db = require("./db");

async function kerjakan(tugas, kode) {
  const isi = (tugas.isi || "").toLowerCase();
  const judul = (tugas.judul || "").toLowerCase();
  const gabung = judul + " " + isi;

  // draft lebih spesifik daripada riset: cek dulu
  if (/draft|tulis|caption/.test(judul)) {
    const jumlah = parseInt((gabung.match(/(\d+)\s*draft/i) || [])[1] || "1", 10);
    await bolehPakaiSkill(kode, "riset");
    await cekJatah(kode);
    const ringkasan = await db.ambilSatu(
      "SELECT * FROM riset_ringkasan ORDER BY dibuat_pada DESC LIMIT 1"
    );
    if (!ringkasan) {
      throw new Error("tidak ada hasil riset untuk disusun draft");
    }
    const sudutArr = ringkasan.sudut || [];
    const dibuat = [];
    const sudahAda = await db.ambilBanyak(
      `SELECT sudut FROM draft_konten WHERE ringkasan_id = $1 AND status NOT IN ('ditolak','gagal')`,
      [ringkasan.id]
    );
    const terpakai = new Set(sudahAda.map((x) => Number(x.sudut)));
    let sudutIndex = 0;
    while (dibuat.length < Math.min(jumlah, sudutArr.length) && sudutIndex < sudutArr.length) {
      if (terpakai.has(sudutIndex)) {
        sudutIndex++;
        continue;
      }
      const draft = await susunDraft({
        ringkasanId: ringkasan.id,
        sudutIndex,
        agentKode: kode,
      });
      dibuat.push({ id: draft.id, judul: draft.judul });
      terpakai.add(sudutIndex);
      sudutIndex++;
    }
    if (!dibuat.length) throw new Error("semua sudut ringkasan terbaru sudah memiliki draft aktif");
    return { jenis: "draft", ringkasanId: ringkasan.id, draft: dibuat };
  }

  if (/riset|cari|baca|analisis|telusur|telaah/.test(judul)) {
    const keyword = (isi.match(/topik\s+["']?([^"'\n,]{3,60})["']?/i) || [])[1] ||
      (judul.match(/(?:riset|telaah)\s+["']?([^"'\n,]{3,60})["']?/i) || [])[1] ||
      "sustainability";
    await bolehPakaiSkill(kode, "riset");
    await cekJatah(kode);
    const { laporan, items } = await jalankanRiset({ keyword, limit: 25 });
    const { ringkasanId, sudut } = await rangkumSudut(keyword, items);
    return {
      jenis: "riset",
      keyword,
      totalItem: laporan.total,
      ringkasanId,
      jumlahSudut: sudut.length,
      sudut: sudut.map((s) => s.judul),
    };
  }

  throw new Error(`jenis tugas tidak dikenali: ${tugas.judul}`);
}

async function detak(kode) {
  const tugas = await ambilAtomik(kode);
  if (!tugas) return null;
  try {
    const hasil = await kerjakan(tugas, kode);
    // tugas yang menghasilkan draft -> perlu persetujuan
    if (hasil && hasil.jenis === "draft") {
      await simpanHasilPerluPersetujuan(tugas.id, hasil);
      return { tugasId: tugas.id, status: "perlu_persetujuan", hasil };
    }
    await simpanHasil(tugas.id, hasil);
    return { tugasId: tugas.id, status: "selesai", hasil };
  } catch (e) {
    await simpanGagal(tugas.id, e.message);
    return { tugasId: tugas.id, status: "gagal", error: e.message };
  }
}

module.exports = { detak, kerjakan };
