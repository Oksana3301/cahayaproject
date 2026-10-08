// test/sena-publish.test.js
// Unit test kecil untuk konversi waktu WIB -> UTC (scheduleAt).
// Jalankan: node test/sena-publish.test.js
//
// Fokus pada kasus yang paling gampang salah:
//   19:00 WIB harus jadi 12:00:00.000Z di tanggal yang SAMA.

const assert = require("assert");
const { wibKeUtc, utcKeWib } = require("../lib/sena-publish");

function test() {
  // 1. 19:00 WIB -> 12:00:00.000Z (tanggal sama)
  const a = wibKeUtc("19:00", "2026-10-08");
  assert.strictEqual(a, "2026-10-08T12:00:00.000Z", `19:00 WIB harus 12:00:00.000Z, dapat ${a}`);

  // 2. 00:00 WIB -> 17:00:00.000Z HARI SEBELUMNYA (karena kurang 7 jam)
  const b = wibKeUtc("00:00", "2026-10-08");
  assert.strictEqual(b, "2026-10-07T17:00:00.000Z", `00:00 WIB harus 2026-10-07T17:00:00.000Z, dapat ${b}`);

  // 3. 07:00 WIB -> 00:00:00.000Z (tepat tengah malam UTC, tanggal sama)
  const c = wibKeUtc("07:00", "2026-10-08");
  assert.strictEqual(c, "2026-10-08T00:00:00.000Z", `07:00 WIB harus 2026-10-08T00:00:00.000Z, dapat ${c}`);

  // 4. 23:59 WIB -> 16:59:00.000Z (tanggal sama)
  const d = wibKeUtc("23:59", "2026-10-08");
  assert.strictEqual(d, "2026-10-08T16:59:00.000Z", `23:59 WIB harus 2026-10-08T16:59:00.000Z, dapat ${d}`);

  // 5. round-trip: utcKeWib(wibKeUtc(...)) kembali ke jam WIB asli
  const e = utcKeWib(a);
  assert.ok(e.includes("19:00:00.000 WIB"), `round-trip harus tampil 19:00 WIB, dapat ${e}`);

  // 6. jam tidak valid -> throw
  assert.throws(() => wibKeUtc("25:00", "2026-10-08"), /jam tayang tidak valid/);
  assert.throws(() => wibKeUtc("19:60", "2026-10-08"), /jam tayang tidak valid/);

  console.log("✅ SEMUA UNIT TEST LOLOS (6 kasus)");
  console.log("   19:00 WIB ->", wibKeUtc("19:00", "2026-10-08"));
  console.log("   00:00 WIB ->", wibKeUtc("00:00", "2026-10-08"));
}

test();
