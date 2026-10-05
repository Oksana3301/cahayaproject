# Rapat [manual] — 2026-10-04

- **Waktu:** 2026-10-04T14:26:09.631Z
- **Jenis:** manual
- **Dihadiri:** nala
- **Berkas asal:** `rapat-2026-10-04T14-26-09-631Z.json`

## Agenda

Konfirmasi: task rapat tampil di board tanpa error UI.

## Pendapat Peserta

### Nala — Strategy & Systems Analyst

1. Verifikasi tidak boleh berhenti di "kelihatan bagus di laptop saya." Uji minimal pada tiga kondisi: peran berbeda (penanggung jawab tugas, peserta rapat biasa, admin), perangkat seluler, dan kasus tepi seperti nama tugas panjang atau daftar peserti banyak. Prinsip Literasi Digital berlaku di sini: verifikasi sebelum menyatakan aman — error UI paling sering muncul hanya pada peran atau perangkat tertentu, jadi "sudah dilihat" belum sama dengan "sudah benar."

2. "Tampil" harus punya kriteria jelas: judul, penanggung jawab, tenggat, dan asal rapat (link ke notulen). Kalau hanya judul yang muncul, board kehilangan konteks. Prinsip Storytelling: satu aset satu pesan — tugas tanpa konteks tidak akan dieksekusi dengan benar. Busur naratifnya utuh: keputusan rapat → tugas di board → eksekusi; kalau putus di tengah, ceritanya buyar.

3. Titik buta terbesar bukan error UI, melainkan error data yang *tampilnya* rapi: tugas muncul tapi salah rapat, dobel, atau status tidak ter-update. Cek lapisan datanya, bukan cuma tampilan visual. Perbaikan UI yang menutupi data salah justru berbahaya karena semua orang melihatnya terlihat normal — resiko palsu.

4. Kontrol aksesibilitas dasar: kontras teks, ukuran font, dan label pada ikon. Visual bermakna artinya bisa dibaca semua orang, termasuk pengguna screen reader. Ini sering diakhirkan, padahal murah diperbaiki di tahap ini.

Satu mekanisme pendamping: kalau besok ditemukan error yang luput hari ini, laporkan dan perbaiki secara terbuka — jangan ditutupi. Lebih cepat terlihat, lebih cepat dipercaya.

## Notulen

# NOTULEN RAPAT — KONFIRMASI TASK RAPAT TAMPIL DI BOARD

**Tanggal:** _(diisi saat rilis)_ · **Agenda:** Konfirmasi task rapat tampil di board tanpa error UI · **Pemateri:** Nala (Strategy & Systems Analyst)

---

## 1) RINGKASAN

Rapat membahas konfirmasi tampilnya task rapat di board. Nala menolak persetujuan cepat: "kelihatan bagus di laptop saya" bukan bukti aman. Verifikasi harus mencakup tiga kondisi — peran berbeda, perangkat seluler, dan kasus tepi — serta memeriksa lapisan data, bukan hanya tampilan visual. Kriteria "tampil" juga harus didefinisikan: judul, penanggung jawab, tenggat, dan asal rapat. Tanpa konteks ini, board hanya menjadi daftar judul yang tidak akan dieksekusi dengan benar. Rapat menyepakati: status **DITAHAN** hingga checklist verifikasi lengkap dijalankan.

---

## 2) POIN PENTING

- **Verifikasi minimal pada tiga kondisi:** peran berbeda (penanggung jawab tugas, peserta rapat biasa, admin), perangkat seluler, dan kasus tepi (nama tugas panjang, daftar peserta banyak). Error UI paling sering muncul hanya pada peran atau perangkat tertentu.
- **Kriteria "tampil" harus lengkap:** judul, penanggung jawab, tenggat, dan asal rapat (link ke notulen). Jika hanya judul yang muncul, board kehilangan konteks dan eksekusi berisiko salah.
- **Busur naratif harus utuh:** keputusan rapat → task di board → eksekusi. Jika putus di tengah, ceritanya buyar dan task tidak dieksekusi sebagaimana mestinya.
- **Titik buta utama adalah error data yang tampak rapi:** task muncul tapi salah rapat, dobel, atau status tidak ter-update. Perbaikan UI yang menutupi data salah justru berbahaya karena semua orang melihatnya terlihat normal.
- **Aksesibilitas dasar wajib dicek sekarang:** kontras teks, ukuran font, label pada ikon. Murah diperbaiki di tahap ini, mahal jika ditunda.
- **Mekanisme pelaporan terbuka:** jika besok ditemukan error yang luput hari ini, laporkan dan perbaiki secara terbuka. Lebih cepat terlihat, lebih cepat dipercaya.

---

## 3) RISIKO & PERHATIAN

- **Risiko tertinggi: "resiko palsu."** Tampilan visual rapi menutupi data salah (salah rapat, dobel, status tidak ter-update). Semua orang melihat board normal dan tidak curiga — error ini bisa berlangsung lama tanpa diketahui.
- **Verifikasi terbatas pada satu perangkat/peran** akan melewatkan error yang hanya muncul di kondisi lain — terutama perangkat seluler dan peran admin.
- **Task tanpa konteks** (hanya judul) menyebabkan eksekusi salah atau tertunda — penanggung jawab tidak tahu prioritas, tenggat, atau asal keputusannya.
- **Aksesibilitas diakhirkan** akan menyulitkan pengguna screen reader dan menambah utang teknis yang mahal diperbaiki belakangan.
- **Potensi error yang luput hari ini** tetap mungkin terjadi. Mekanisme pelaporan terbuka adalah jaring pengaman — menutupi justru mengikis kepercayaan tim.

---

## 4) KEPUTUSAN

**TAHAN konfirmasi "task tampil di board tanpa error UI."**

**Alasan:** Bukti yang disampaikan baru berupa tampilan visual pada satu kondisi. Nala menunjukkan bahwa verifikasi seperti ini berhenti terlalu cepat — error UI paling sering muncul hanya pada peran atau perangkat tertentu, dan error data yang tampak rapi justru lebih berbahaya daripada error UI yang terlihat. Konfirmasi hanya akan diberikan setelah checklist verifikasi lengkap dijalankan pada tiga kondisi (peran, perangkat, kasus tepi), kriteria "tampil" terpenuhi (judul, penanggung jawab, tenggat, asal rapat), dan lapisan data diverifikasi — bukan hanya tampilan visual. Aksesibilitas dasar juga harus lolos sebelum konfirmasi.

---

## 5) AKSI & PENANGGUNG JAWAB

| # | Aksi | Penanggung Jawab |
|---|------|------------------|
| 1 | Uji tampil board pada tiga peran: penanggung jawab tugas, peserta rapat biasa, admin | Tim Produk/Dev |
| 2 | Uji tampil board pada perangkat seluler | Tim Produk/Dev |
| 3 | Uji kasus tepi: nama tugas panjang, daftar peserta banyak | Tim Produk/Dev |
| 4 | Verifikasi kriteria "tampil" lengkap: judul, penanggung jawab, tenggat, asal rapat (link ke notulen) | Tim Produk/Dev |
| 5 | Cek lapisan data: tidak ada task salah rapat, tidak ada dobel, status ter-update | Tim Produk/Dev |
| 6 | Cek aksesibilitas dasar: kontras teks, ukuran font, label pada ikon | Tim Produk/Dev |
| 7 | Jika ditemukan error yang luput setelah konfirmasi: laporkan dan perbaiki secara terbuka | Seluruh tim |

*Estimasi penyelesaian checklist di atas sebelum konfirmasi ulang dilakukan.*

---

## 6) CATATAN TERHADAP 4 PRINSIP

**Prinsip paling relevan: Digital Literacy.**
Inti pembahasan adalah verifikasi sebelum menyatakan aman. "Sudah dilihat" belum sama dengan "sudah benar" — klakson utama Nala. Error UI dan error data sering tidak terlihat dari satu titik observasi, sehingga verifikasi multi-kondisi adalah penerapan langsung prinsip ini: cek sebelum klaim, akui ketidakpastian, jangan terburu menyatakan "aman."

**Prinsip kedua yang relevan: Storytelling & Content Creation.**
"Satu aset satu pesan" diterapkan pada task di board: judul, penanggung jawab, tenggat, dan asal rapat adalah pesan minimum agar satu task dapat dieksekusi dengan benar. Busur naratifnya utuh: keputusan rapat → task di board → eksekusi. Jika konteks putus di tengah, ceritanya buyar.

**Prinsip ketiga: Responsible Communication.**
Mekanisme pelaporan terbuka untuk error yang luput — jangan ditutupi — adalah penerapan koreksi terbuka. Menutupi error demi kesan "sudah beres" justru mengikis kepercayaan tim dan pengguna.

**Prinsip keempat: Strategic Storytelling.**
Tujuan konfirmasi adalah memastikan keputusan rapat sampai pada eksekusi yang benar. Task di board adalah jembatan naratif antara keputusan dan eksekusi. Jika jembatan ini cacat, tujuannya gagal tercapai — tidak peduli seberapa rapi tampilannya.
