# 💬 Percakapan dengan Agent

Section ini mengumpulkan **semua percakapan dengan agent** agar terdokumentasi dan rapih.

## Isi

| Folder | Isi |
|---|---|
| `owner-agent/` | Log percakapan Owner ↔ agent (WhatsApp/UI), dikelompokkan per tanggal (`YYYY-MM-DD.jsonl`). |
| `rapat/` | Ringkasan tiap rapat (pagi/siang/sore) dalam Markdown — pendapat peserta + notulen. |

## Format `owner-agent/<tanggal>.jsonl`

Satu baris = satu pesan (JSON Lines, mudah di-append & di-parse):

```json
{"waktu":"2026-10-05T02:10:00.000Z","arah":"masuk","nomor":"62895610524580","agent":"kirana","perintah":"/tanya","pesan":"bagaimana progress hari ini?","balasan":null,"meta":{"nama":"Owner"}}
{"waktu":"2026-10-05T02:10:05.000Z","arah":"keluar","nomor":"62895610524580","agent":"kirana","perintah":"/tanya","pesan":null,"balasan":"Progress hari ini ..."}
```

Field:
- `arah`: `masuk` (Owner → agent) atau `keluar` (agent → Owner).
- `nomor`: nomor WhatsApp lawan bicara.
- `perintah`: `/bantuan`, `/status`, `/tanya`, `/rapat`, `@agent`, atau `-`.
- `agent`: kode agent yang menangani (mis. `kirana`, `tara`).
- `pesan`: isi pesan masuk (arah `masuk`); `balasan`: isi balasan agent (arah `keluar`).
- `meta`: data tambahan opsional (mis. `nama`, `jenis` rapat, `error`).

## Sumber data

- **Rapat:** `.hermes3d/rapat/*.json` → di-generate ke `rapat/` via `tools/gen-percakapan.js`.
- **Owner↔agent:** endpoint `POST /api/wa/inbound` (dan balasannya) menulis ke
  `percakapan/owner-agent/<tanggal>.jsonl`, lalu ditampilkan di section **Percakapan** pada web `/kantor`.

## Regenerate ringkasan rapat

```bash
node tools/gen-percakapan.js /opt/dashboard-ai/.hermes3d/rapat ./percakapan/rapat
```
