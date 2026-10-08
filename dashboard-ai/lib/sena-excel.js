// lib/sena-excel.js
// Menyusun hasil bedah carousel (dari lib/sena.js) menjadi satu file .xlsx.
// Satu baris = satu post. Cover = GAMBAR tertanam (bukan link/formula).
// Kolom persis: No | Cover | Jumlah Like | Jumlah Komentar | Tanggal | Jumlah Slide |
//               Shortcode | Post URL | Slide 1..17 | Caption

const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const sharp = require("sharp");

const MAX_SLIDE = 17;
const TINGGI_BARIS = 210;
const LEBAR_COVER = 20;

function pastikanDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Resize cover agar ringan untuk di-embed (batasi tinggi agar baris 210px terlihat).
async function siapkanCover(buf) {
  try {
    // jpeg kualitas 80, tinggi maks 200px (pas dengan tinggi baris 210).
    const out = await sharp(buf).resize({ height: 200, width: 200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return out;
  } catch {
    return buf; // fallback mentah bila gagal resize
  }
}

// Satu post -> satu baris. Mengembalikan array nilai sel (untuk satu kolom Slide N).
function barisPost(post, no) {
  const tanggal = post.timestamp
    ? new Date(post.timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })
    : "";
  const row = [
    no, // No
    "", // Cover (diisi gambar via addImage)
    post.likesCount, // Jumlah Like
    post.commentsCount, // Jumlah Komentar
    tanggal, // Tanggal
    post.jumlahSlide, // Jumlah Slide
    post.shortcode, // Shortcode
    post.url, // Post URL
  ];
  // Slide 1..17
  for (let i = 0; i < MAX_SLIDE; i++) {
    row.push(post.slideTeks && post.slideTeks[i] ? post.slideTeks[i] : "");
  }
  row.push(post.caption || ""); // Caption
  return row;
}

function headerKolom() {
  const h = ["No", "Cover", "Jumlah Like", "Jumlah Komentar", "Tanggal", "Jumlah Slide", "Shortcode", "Post URL"];
  for (let i = 1; i <= MAX_SLIDE; i++) h.push(`Slide ${i}`);
  h.push("Caption");
  return h;
}

// Gabungkan beberapa akun -> satu file .xlsx. `listPost` = array post (sudah urut like).
async function tulisExcel({ filePath, listPost }) {
  pastikanDir(path.dirname(filePath));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bedah Carousel");

  const header = headerKolom();
  ws.addRow(header);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

  // Ukuran kolom: cover lebar, teks slide lebar, kolom lain secukupnya.
  ws.getColumn(1).width = 5; // No
  ws.getColumn(2).width = LEBAR_COVER; // Cover
  ws.getColumn(3).width = 12; // Like
  ws.getColumn(4).width = 14; // Komentar
  ws.getColumn(5).width = 22; // Tanggal
  ws.getColumn(6).width = 13; // Jumlah Slide
  ws.getColumn(7).width = 14; // Shortcode
  ws.getColumn(8).width = 34; // Post URL
  for (let i = 1; i <= MAX_SLIDE; i++) {
    ws.getColumn(8 + i).width = 38; // Slide N
  }
  ws.getColumn(8 + MAX_SLIDE + 1).width = 50; // Caption

  for (let i = 0; i < listPost.length; i++) {
    const post = listPost[i];
    const values = barisPost(post, i + 1);
    const row = ws.addRow(values);
    row.height = TINGGI_BARIS;
    row.alignment = { vertical: "top", wrapText: true };

    // Tanam cover sebagai gambar.
    if (post.coverUrl) {
      try {
        const { unduhGambar } = require("./sena");
        const buf = await unduhGambar(post.coverUrl, require("./sena").cachePathGambar(post.akun || "x", post.shortcode, 9999));
        const img = await siapkanCover(buf);
        const id = wb.model.media.findIndex((m) => m.buffer && m.buffer.equals(img));
        let imageId;
        if (id >= 0) imageId = id;
        else imageId = wb.addImage({ buffer: img, extension: "jpeg" });
        ws.addImage(imageId, {
          tl: { col: 1, row: i + 1 }, // kolom B (index 1), baris data (i+1 karena header di row 0)
          ext: { width: 200, height: 200 },
        });
      } catch (e) {
        console.warn(`[sena-excel] cover gagal utk ${post.shortcode}: ${e.message}`);
      }
    }
  }

  // Freeze header + kolom No.
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

  await wb.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { tulisExcel, headerKolom, MAX_SLIDE, TINGGI_BARIS, LEBAR_COVER };
