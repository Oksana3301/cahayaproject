"use client";

// PercakapanPanel — section "Percakapan" di HQ.
// Menampilkan riwayat percakapan Owner ↔ agent (WhatsApp/UI) dan ringkasan rapat.
// Sumber data: GET /api/percakapan (dashboard-ai, lewat reverse proxy nginx).

import { useCallback, useEffect, useMemo, useState } from "react";

type PesanPercakapan = {
  waktu: string;
  arah: "masuk" | "keluar";
  nomor?: string | null;
  agent?: string | null;
  perintah?: string;
  pesan?: string | null;
  balasan?: string | null;
  meta?: Record<string, unknown>;
};

const formatWaktu = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export function PercakapanPanel() {
  const [pesan, setPesan] = useState<PesanPercakapan[]>([]);
  const [tanggal, setTanggal] = useState<string[]>([]);
  const [pilihTanggal, setPilihTanggal] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [cari, setCari] = useState<string>("");
  const [memuat, setMemuat] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const muat = useCallback(async (tgl?: string) => {
    setMemuat(true);
    setError(null);
    try {
      const q = tgl ? `?tanggal=${encodeURIComponent(tgl)}&batas=500` : "?batas=500";
      const res = await fetch(`/api/percakapan${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPesan(Array.isArray(data?.pesan) ? data.pesan : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "gagal memuat");
    } finally {
      setMemuat(false);
    }
  }, []);

  const muatTanggal = useCallback(async () => {
    try {
      const res = await fetch(`/api/percakapan/tanggal`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setTanggal(Array.isArray(data?.tanggal) ? data.tanggal : []);
    } catch {
      /* abaikan */
    }
  }, []);

  useEffect(() => {
    void muatTanggal();
    void muat();
    const id = window.setInterval(() => void muat(pilihTanggal || undefined), 20000);
    return () => window.clearInterval(id);
  }, [muat, muatTanggal, pilihTanggal]);

  const daftarAgent = useMemo(() => {
    const set = new Set<string>();
    pesan.forEach((p) => {
      if (p.agent) set.add(p.agent);
    });
    return Array.from(set).sort();
  }, [pesan]);

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return pesan.filter((p) => {
      if (agentFilter !== "all" && p.agent !== agentFilter) return false;
      if (q) {
        const teks = `${p.pesan ?? ""} ${p.balasan ?? ""} ${p.perintah ?? ""}`.toLowerCase();
        if (!teks.includes(q)) return false;
      }
      return true;
    });
  }, [pesan, agentFilter, cari]);

  return (
    <div className="flex h-full flex-col overflow-hidden text-white/90">
      <div className="flex flex-wrap items-center gap-2 border-b border-cyan-500/15 px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-200">
          Percakapan
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={pilihTanggal}
            onChange={(e) => {
              const v = e.target.value;
              setPilihTanggal(v);
              void muat(v || undefined);
            }}
            className="rounded border border-cyan-500/20 bg-black/40 px-2 py-1 font-mono text-[11px] text-cyan-100"
            aria-label="Pilih tanggal"
          >
            <option value="">Semua tanggal</option>
            {tanggal.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded border border-cyan-500/20 bg-black/40 px-2 py-1 font-mono text-[11px] text-cyan-100"
            aria-label="Filter agent"
          >
            <option value="all">Semua agent</option>
            {daftarAgent.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="cari…"
            className="w-40 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 font-mono text-[11px] text-cyan-100 placeholder:text-white/30"
            aria-label="Cari percakapan"
          />
          <button
            type="button"
            onClick={() => {
              void muatTanggal();
              void muat(pilihTanggal || undefined);
            }}
            className="rounded border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200 hover:border-cyan-400/45"
          >
            Muat ulang
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {memuat && pesan.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/40">Memuat percakapan…</div>
        ) : error ? (
          <div className="py-10 text-center font-mono text-[11px] text-rose-300">
            Gagal memuat: {error}
          </div>
        ) : tersaring.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/40">
            Belum ada percakapan. Kirim perintah via WhatsApp (mis. <span className="text-cyan-300">/tanya halo</span>).
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {tersaring.map((p, idx) => {
              const masuk = p.arah === "masuk";
              return (
                <li
                  key={`${p.waktu}-${idx}`}
                  className={`flex flex-col gap-1 rounded border px-3 py-2 ${
                    masuk
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-cyan-500/20 bg-cyan-500/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                    <span className={masuk ? "text-emerald-300" : "text-cyan-300"}>
                      {masuk ? "◀ Owner" : "▶ Agent"}
                    </span>
                    {p.agent ? <span className="text-white/60">@{p.agent}</span> : null}
                    {p.perintah && p.perintah !== "-" ? (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">{p.perintah}</span>
                    ) : null}
                    <span className="ml-auto">{formatWaktu(p.waktu)}</span>
                  </div>
                  {p.pesan ? (
                    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85">
                      {p.pesan}
                    </div>
                  ) : null}
                  {p.balasan ? (
                    <div className="whitespace-pre-wrap break-words rounded bg-black/30 px-2 py-1 text-[13px] leading-relaxed text-white/80">
                      {p.balasan}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
