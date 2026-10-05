# 06 — Gate 4 Prinsip (Pre-Publish)

Gerbang wajib sebelum publikasi. Menerjemahkan **4 prinsip wajib** menjadi checklist yang
dievaluasi otomatis, dengan **dua lapis**.

Kode: `dashboard-ai/lib/pre-publish-gate.js`. Dipakai di `skills/publish.js` dan endpoint
`/api/alur/gate`, `/api/alur/setujui`, `/api/persetujuan/:id/ya`.

## Lapis 1 — Deterministik (selalu jalan, tanpa LLM)

- Panjang caption & struktur (hook / konteks / insight / CTA).
- Kata terlarang & pantangan (dari `skills/publish.js`: `KATA_TERLARANG`, `PANTANGAN`).
- Tagar: 3–5, wajib `#CahayaProject`.
- Klaim absolut/risiko: medis, finansial, sustainability absolut (`POLA_RISIKO`).

## Lapis 2 — LLM (default aktif; bisa dimatikan untuk uji/offline)

- **Strategic Storytelling** — 1 aset 1 pesan, sudut & manfaat jelas.
- **Digital Literacy** — tidak menyajikan opini/prediksi sebagai fakta.
- **Storytelling & Content Creation** — busur naratif utuh, layak dibagikan.
- **Responsible Communication** — tidak menyesatkan/menuduh/menakut-nakuti.

## Hasil

```
{
  lulus, dipaksa, lulusSejati,
  skor,                       // = round((jumlahPrinsipLulus / 4) * 100)
  prinsip: { strategi, literasi, narasi, tanggungJawab } -> { nama, lulus, deteksi, llmCatatan, llmDiperiksa },
  blokir: [...], gagalPrinsip: [...], catatan: [...]
}
```

- Bila gagal → publikasi **DIBLOKIR** (HTTP 422, `kode:"GATE_GAGAL"`).
- Override Owner: `{ paksa: true }` (tetap dicatat sebagai pelanggaran jejak).
- Variabel lingkungan `SKIP_PRE_PUBLISH_GATE=1` menonaktifkan gate (untuk uji).

## Catatan Non-Determinisme

Karena ada lapis LLM, hasil bisa bervariasi antar pemanggilan. Lapis deterministik selalu
konsisten. Notifikasi WhatsApp dikirim saat gate memblokir.
