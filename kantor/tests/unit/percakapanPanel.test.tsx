import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PercakapanPanel } from "@/features/office/components/panels/PercakapanPanel";

const PESAN = [
  {
    waktu: "2026-10-06T02:10:00.000Z",
    arah: "masuk",
    nomor: "62895610524580",
    agent: "kirana",
    perintah: "/tanya",
    pesan: "bagaimana progress hari ini?",
    balasan: null,
  },
  {
    waktu: "2026-10-06T02:10:05.000Z",
    arah: "keluar",
    nomor: "62895610524580",
    agent: "kirana",
    perintah: "/tanya",
    pesan: null,
    balasan: "Progress hari ini: 6 draft terjadwal.",
  },
];

const mockFetch = () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/percakapan/tanggal")) {
      return { ok: true, json: async () => ({ ok: true, tanggal: ["2026-10-06", "2026-10-05"] }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ ok: true, pesan: PESAN }) } as unknown as Response;
  }));
};

describe("PercakapanPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("merender judul dan riwayat Owner↔agent dari API", async () => {
    mockFetch();
    render(<PercakapanPanel />);

    expect(screen.getByText("Percakapan")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/bagaimana progress hari ini\?/)).toBeTruthy();
    });
    expect(screen.getByText(/Progress hari ini: 6 draft terjadwal\./)).toBeTruthy();
    // arah terlihat
    expect(screen.getByText(/◀ Owner/)).toBeTruthy();
    expect(screen.getByText(/▶ Agent/)).toBeTruthy();
  });

  it("mengisi pilihan tanggal dari endpoint /tanggal", async () => {
    mockFetch();
    render(<PercakapanPanel />);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "2026-10-06" })).toBeTruthy();
    });
    expect(screen.getByRole("option", { name: "2026-10-05" })).toBeTruthy();
  });

  it("menampilkan pesan kosong bila tidak ada data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, pesan: [], tanggal: [] }) } as unknown as Response)));
    render(<PercakapanPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Belum ada percakapan/i)).toBeTruthy();
    });
  });
});
