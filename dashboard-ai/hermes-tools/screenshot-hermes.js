const { chromium } = require("/opt/dashboard-ai/kantor3d/node_modules/playwright");
const fs = require("fs");

function env() {
  const out = {};
  for (const line of fs.readFileSync("/opt/dashboard-ai/.env", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

async function bukaSesi(page, e) {
  await page.goto("https://agentsocmed.dirini.space/masuk", { waitUntil: "domcontentloaded" });
  const token = await page.evaluate(async (u) => {
    const r = await fetch("/api/masuk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u) });
    return { status: r.status, cookie: document.cookie };
  }, { pengguna: e.DASHBOARD_USER, sandi: e.DASHBOARD_PASS });
  return token;
}

(async () => {
  const e = env();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (x) => errors.push(x.message));

  await page.goto("https://agentsocmed.dirini.space/masuk", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (u) => fetch("/api/masuk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u) }), { pengguna: e.DASHBOARD_USER, sandi: e.DASHBOARD_PASS });
  await page.evaluate(() => localStorage.setItem("hermes3d:onboarding:completed", "true"));

  await page.goto("https://agentsocmed.dirini.space/kantor/office", { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(4000);
  const r3d = page.getByRole("button", { name: /3D immersive/ });
  if (await r3d.count()) await r3d.first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Custom backend" }).click({ timeout: 20000 });
  await page.waitForTimeout(600);

  const current = await page.getByLabel("Upstream URL").inputValue().catch(() => "");
  if (!current.includes("4300/api/runtime")) {
    await page.getByLabel("Upstream URL").fill("http://127.0.0.1:4300/api/runtime");
  }
  await page.getByRole("button", { name: "Connect", exact: true }).click({ timeout: 20000 });
  await page.waitForTimeout(22000);
  await page.screenshot({ path: "/opt/dashboard-ai/hermes3d-connected.png", fullPage: false });

  const teks = await page.locator("body").innerText();
  console.log(JSON.stringify({ screenshot: "/opt/dashboard-ai/hermes3d-connected.png", ringkas: teks.split("\n").slice(0, 12), errors }, null, 2));
  await browser.close();
})().catch((x) => { console.error("SCREENSHOT_ERROR:", x.message); process.exitCode = 1; });
