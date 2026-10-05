const fs = require("fs");
const ENV_PATH = "/opt/dashboard-ai/.env";

function muatEnv() {
  if (process.env.__ENV_DIMUAT === "1") {
    console.error("[env] sudah dimuat sebelumnya, skip");
    return;
  }
  process.env.__ENV_DIMUAT = "1";
  try {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    console.error("[env] membaca", ENV_PATH, "len", raw.length);
    let jumlah = 0;
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!k) continue;
      if (process.env[k] === undefined) {
        process.env[k] = v;
        jumlah++;
      } else {
        console.error("[env] key sudah ada, skip:", k, "len", (process.env[k] || "").length);
      }
    }
    console.error("[env] selesai, mengisi", jumlah, "key");
  } catch (e) {
    console.error("[env] gagal memuat", ENV_PATH, ":", e.message);
  }
}

muatEnv();

module.exports = { muatEnv, ENV_PATH };
