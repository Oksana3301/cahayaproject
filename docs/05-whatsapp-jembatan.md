# 05 — Jembatan WhatsApp

Owner dapat menanyakan progress/berdiskusi dengan agent langsung via WhatsApp.

## Jalur

```
WAHA (session tophillshape) ──webhook──▶ POST /api/wa/inbound?token=<WA_INBOUND_TOKEN>
                                              │
                                              ├─ guard: token, fromMe, grup, whitelist Owner, prefix
                                              ▼
                                        agent (via lib/llm.chat)
                                              │
                                              ▼
                                        balas via lib/whatsapp.kirimTeks
```

## Webhook (2 buah pada session yang sama)

1. `https://n8n.dirini.space/webhook/tophills-waha-inbound-v2` — front desk Top Hills (**tidak diubah**).
2. `https://agentsocmed.dirini.space/api/wa/inbound?token=<WA_INBOUND_TOKEN>` — dashboard-ai.

> Container WAHA **tidak bisa** menjangkau `127.0.0.1:4300` host → webhook WA **wajib** pakai URL publik.
> nginx punya `location = /api/wa/inbound` (tanpa auth sesi; autentikasi lewat token).

## Perintah (prefix WAJIB, agar tidak bentrok bot Top Hills)

| Perintah | Fungsi |
|---|---|
| `/bantuan` | Menu + daftar agent |
| `/status` | Token hari ini, rem tangan, ringkasan jadwal IG (terbit/menunggu/gagal) |
| `/tanya <q>` | Tanya Kirana (Editor-in-Chief) |
| `@<agent> <q>` | Tanya agent tertentu (mis. `@tara ...`) |
| `/rapat <agenda>` | Jalankan rapat 3 agent (nala, laras, tara); balas ringkasan notulen |

## Guard Pesan

Diabaikan dashboard (ditangani workflow n8n front desk): pesan **tanpa prefix**, pesan
`fromMe:true`, dan pesan **grup** (`@g.us`).

**Whitelist Owner (khusus):** dashboard-ai **hanya** melayani nomor Owner
(`WA_OWNER_NOMOR`, fallback ke `WA_NOTIF_NOMOR`/`WA_WA_NOTIF`). Pesan dari nomor
lain — termasuk customer hotel — diabaikan total (tidak diproses **dan** tidak
dibalas), supaya Kirana tidak bentrok dengan bot front-desk Top Hills.

> **Penting:** session WAHA memakai engine **WEBJS** dengan LID, sehingga pengirim
> sering datang sebagai `…@lid`, bukan `…@c.us`. Isi `WA_OWNER_LID` dengan LID
> Owner (mis. `252101779267698`) — jika tidak, pesan Owner sendiri akan ditolak.
> Cek LID via daftar chat WAHA (`/api/<session>/chats`) atau log
> `[wa/inbound] diabaikan — … (jid=…@lid, …)`.

## Konfigurasi (env)

| Variabel | Fungsi |
|---|---|
| `WAHA_BASE_URL` | default `http://127.0.0.1:3000` |
| `WAHA_API_KEY` | header `X-Api-Key` |
| `WAHA_SESSION` | default `tophillshape` |
| `WA_INBOUND_TOKEN` | token webhook inbound |
| `WA_NOTIF_NOMOR` / `WA_WA_NOTIF` | nomor notifikasi Owner |
| `WA_OWNER_NOMOR` | **whitelist** nomor yang boleh memerintah agent (pisah koma) |
| `WA_OWNER_LID` | opsional, LID Owner bila WAHA mengirim `…@lid` |

## Normalisasi Nomor

`08xx` → `628xx@c.us`; `+62…`/`62…` dinormalisasi. Lihat `lib/whatsapp.js` (`normalisasiNomor`).

## Persistensi Percakapan

Mulai section **Percakapan**: pesan masuk & balasan ditulis ke
`percakapan/owner-agent/<YYYY-MM-DD>.jsonl` (lihat [`../percakapan/README.md`](../percakapan/README.md)).
