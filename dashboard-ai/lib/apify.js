const TOKEN = process.env.APIFY_TOKEN;
const BASE = "https://api.apify.com/v2";

function normalisasiActorId(actorId) {
  return String(actorId).replace(/\//g, "~");
}

async function cekToken() {
  if (!TOKEN) throw new Error("APIFY_TOKEN kosong di .env");
}

async function ambilInputSchema(actorId) {
  await cekToken();
  const id = normalisasiActorId(actorId);
  const res = await fetch(`${BASE}/acts/${id}/input-schema?token=${TOKEN}`);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`input-schema HTTP ${res.status} untuk ${id}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const field = Object.keys(data.properties || {});
  return field;
}

async function jalankanActor(actorId, input, maxItems) {
  await cekToken();
  const id = normalisasiActorId(actorId);
  const inputFinal = Object.assign({}, input);
  if (maxItems && typeof inputFinal === "object") {
    const limitKey = ["resultsPerPage", "resultsLimit", "maxItems"].find((key) => key in inputFinal);
    if (!limitKey) {
      inputFinal.resultsLimit = maxItems;
    } else {
      const requested = Number(inputFinal[limitKey]);
      inputFinal[limitKey] = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, maxItems)
        : maxItems;
    }
  }
  const url = `${BASE}/acts/${id}/run-sync-get-dataset-items?token=${TOKEN}&timeout=120`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inputFinal),
  });
  const teks = await res.text();
  if (res.status === 402 || /usage limit/i.test(teks)) {
    const err = new Error(`Apify kredit habis (HTTP ${res.status}): sumber ini mati`);
    err.status = 402;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Apify HTTP ${res.status}: ${teks.slice(0, 200)}`);
    err.status = res.status;
    err.body = teks;
    throw err;
  }
  let json = null;
  try { json = JSON.parse(teks); } catch (e) { json = []; }
  if (Array.isArray(json) && maxItems) json = json.slice(0, maxItems);
  return json;
}

module.exports = { jalankanActor, ambilInputSchema, normalisasiActorId };
