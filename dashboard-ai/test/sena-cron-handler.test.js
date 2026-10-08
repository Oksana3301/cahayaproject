// test/sena-cron-handler.test.js
// Unit test handler jenis baru di cron-runner.js (publish-dryrun, laporan,
// email, dashboard). Semua dijalankan dalam mode DRY-RUN agar tidak ada
// efek samping (tidak kirim ke SocialHub/WAHA/Resend).
//
// Jalankan: node test/sena-cron-handler.test.js

require("dotenv").config();

const { eksekusiJob } = require("../lib/cron-runner");

function assert(cond, msg) {
  if (!cond) {
    console.error(`  ✗ GAGAL: ${msg}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ✓ ${msg}`);
  return true;
}

(async () => {
  console.log("=== TEST HANDLER JENIS BARU (semua dry-run) ===\n");

  // 1. publish-dryrun
  console.log("[1] jenis=publish-dryrun");
  {
    const job = {
      id: "test-publish-dryrun",
      name: "test publish dryrun",
      agentId: "sena",
      payload: { jenis: "publish-dryrun", dryRun: true },
    };
    const r = await eksekusiJob(job, { alasan: "test" });
    assert(r.ok === true, "publish-dryrun ok=true");
    assert(/DRY-RUN/.test(r.result || ""), "hasil bertanda DRY-RUN");
    assert(!/TERKIRIM/.test(r.result || ""), "tidak ada kirim beneran");
  }

  // 2. laporan (dry-run)
  console.log("[2] jenis=laporan (dry-run)");
  {
    const job = {
      id: "test-laporan",
      name: "test laporan dryrun",
      agentId: "sena",
      payload: { jenis: "laporan", dryRun: true },
    };
    const r = await eksekusiJob(job, { alasan: "test" });
    assert(r.ok === true, "laporan ok=true");
    assert(/dry-run/.test(r.result || ""), "hasil bertanda dry-run");
  }

  // 3. email (dry-run)
  console.log("[3] jenis=email (dry-run)");
  {
    const job = {
      id: "test-email",
      name: "test email dryrun",
      agentId: "sena",
      payload: { jenis: "email", dryRun: true },
    };
    const r = await eksekusiJob(job, { alasan: "test" });
    assert(r.ok === true, "email ok=true");
    assert(/dry-run/.test(r.result || ""), "hasil bertanda dry-run");
  }

  // 4. dashboard
  console.log("[4] jenis=dashboard");
  {
    const job = {
      id: "test-dashboard",
      name: "test dashboard",
      agentId: "sena",
      payload: { jenis: "dashboard" },
    };
    const r = await eksekusiJob(job, { alasan: "test" });
    assert(r.ok === true, "dashboard ok=true");
    assert(/DASHBOARD di-build/.test(r.result || ""), "hasil memuat ringkasan dashboard");
  }

  // 5. jenis tidak dikenal harus skip (bukan error tak tertangani)
  console.log("[5] jenis tidak dikenal");
  {
    const job = {
      id: "test-unknown",
      name: "test unknown",
      agentId: "sena",
      payload: { jenis: "gatau", message: "halo" },
    };
    const r = await eksekusiJob(job, { alasan: "test" });
    // fallback: diproses sebagai agentTurn (chat LLM). Karena tanpa persona valid,
    // bisa ok atau error — yang penting tidak throw uncaught.
    assert(typeof r === "object" && "ok" in r, "tidak throw, mengembalikan objek hasil");
  }

  console.log("\n=== SELESAI ===");
  if (process.exitCode === 1) {
    console.log("ADA YANG GAGAL");
    process.exit(1);
  } else {
    console.log("SEMUA LOLOS");
    process.exit(0);
  }
})().catch((e) => {
  console.error("ERROR TAK TERTANGANI:", e.message);
  process.exit(1);
});
