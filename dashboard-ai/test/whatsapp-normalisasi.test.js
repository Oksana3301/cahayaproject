// test/whatsapp-normalisasi.test.js
// Unit test normalisasi nomor WhatsApp (lib/whatsapp.js).
// Jalankan: node test/whatsapp-normalisasi.test.js
//
// Requirement: "0812-3456-789", "+62 812 3456 789", "628123456789"
// harus jadi sama semua (628123456789@c.us).

const assert = require("assert");
const { normalisasiNomor, normalisasiDigit } = require("../lib/whatsapp");

function test() {
  // 1. Tiga format beda -> digit sama.
  const a = normalisasiDigit("0812-3456-789");
  const b = normalisasiDigit("+62 812 3456 789");
  const c = normalisasiDigit("628123456789");
  assert.strictEqual(a, "628123456789", `0812-3456-789 -> ${a}`);
  assert.strictEqual(b, "628123456789", `+62 812 3456 789 -> ${b}`);
  assert.strictEqual(c, "628123456789", `628123456789 -> ${c}`);
  assert.ok(a === b && b === c, "ketiga format harus identik");

  // 2. normalisasiNomor menambah @c.us.
  assert.strictEqual(normalisasiNomor("0812-3456-789"), "628123456789@c.us");
  assert.strictEqual(normalisasiNomor("+62 812 3456 789"), "628123456789@c.us");
  assert.strictEqual(normalisasiNomor("628123456789"), "628123456789@c.us");

  // 3. Angka 0 di depan -> 62.
  assert.strictEqual(normalisasiDigit("0895610524580"), "62895610524580");

  // 4. Nomor kosong -> error.
  assert.throws(() => normalisasiNomor(""), /kosong/);

  console.log("✅ UNIT TEST NORMALISASI NOMOR LOLOS (4 kasus)");
  console.log('   "0812-3456-789"        ->', normalisasiNomor("0812-3456-789"));
  console.log('   "+62 812 3456 789"     ->', normalisasiNomor("+62 812 3456 789"));
  console.log('   "628123456789"         ->', normalisasiNomor("628123456789"));
}

test();
