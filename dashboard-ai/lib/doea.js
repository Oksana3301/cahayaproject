const BASE = process.env.DOEA_BASE_URL || "https://hub.doea.net/v1";
const ACCESS = process.env.DOEA_ACCESS_KEY;
const SECRET = process.env.DOEA_SECRET_KEY;

function authHeader() {
  if (!ACCESS || !SECRET) {
    throw new Error("kunci Doea belum terpasang di .env");
  }
  const basic = Buffer.from(`${ACCESS}:${SECRET}`).toString("base64");
  return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}

async function doea(metode, jalur, opsi) {
  let url = `${BASE}${jalur.startsWith("/") ? jalur : "/" + jalur}`;
  const init = { method: metode, headers: authHeader() };
  if (opsi && opsi.query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opsi.query)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  if (opsi && opsi.body) {
    init.body = JSON.stringify(opsi.body);
  }
  const res = await fetch(url, init);
  if (res.status === 401) {
    throw new Error("kunci Doea ditolak, periksa DOEA_ACCESS_KEY dan DOEA_SECRET_KEY di .env");
  }
  const teks = await res.text();
  let json = null;
  try { json = JSON.parse(teks); } catch (e) { json = teks; }
  if (!res.ok) {
    const err = new Error(`Doea HTTP ${res.status}: ${typeof json === "string" ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = { doea, BASE };
