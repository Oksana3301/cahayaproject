const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const USER = process.env.DASHBOARD_USER || "owner";
const PASS = process.env.DASHBOARD_PASS;
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sesi = new Map();
const percobaan = new Map();

function buatSesi(user, ip) {
  const id = crypto.randomBytes(32).toString("hex");
  const h = crypto.createHmac("sha256", SECRET).update(id).digest("hex");
  sesi.set(h, { user, ip, dibuat: Date.now() });
  return id + "." + h;
}

function ambilSesi(req) {
  const raw = req.cookies && req.cookies.sesi;
  if (!raw) return null;
  const [id, h] = String(raw).split(".");
  if (!id || !h) return null;
  const ok = crypto.timingSafeEqual(
    crypto.createHmac("sha256", SECRET).update(id).digest(),
    Buffer.from(h, "hex")
  );
  if (!ok) return null;
  const data = sesi.get(h);
  if (!data) return null;
  if (Date.now() - data.dibuat > TTL_MS) {
    sesi.delete(h);
    return null;
  }
  return data;
}

function middleware(req, res, next) {
  if (req.path === "/health") return next();
  if (req.path.startsWith("/api/runtime/")) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const remote = req.socket.remoteAddress || "";
    const loopback = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (loopback(remote) && (!forwarded || loopback(forwarded))) return next();
  }
  const data = ambilSesi(req);
  if (data) {
    req.sesi = data;
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "belum masuk" });
  }
  return res.redirect("/masuk");
}

function rateLimit(ip) {
  const sekarang = Date.now();
  const entry = percobaan.get(ip) || { gagal: [], blokSampai: 0 };
  if (sekarang < entry.blokSampai) return false;
  entry.gagal = entry.gagal.filter((t) => sekarang - t < 10 * 60 * 1000);
  if (entry.gagal.length >= 5) {
    entry.blokSampai = sekarang + 15 * 60 * 1000;
    percobaan.set(ip, entry);
    return false;
  }
  percobaan.set(ip, entry);
  return true;
}

function catatGagal(ip) {
  const sekarang = Date.now();
  const entry = percobaan.get(ip) || { gagal: [], blokSampai: 0 };
  entry.gagal = entry.gagal.filter((t) => sekarang - t < 10 * 60 * 1000);
  entry.gagal.push(sekarang);
  if (entry.gagal.length >= 5) entry.blokSampai = sekarang + 15 * 60 * 1000;
  percobaan.set(ip, entry);
}

function catatSukses(ip) {
  percobaan.delete(ip);
}

module.exports = {
  cookieParser: cookieParser(SECRET),
  buatSesi,
  ambilSesi,
  middleware,
  rateLimit,
  catatGagal,
  catatSukses,
  USER,
  PASS,
};
