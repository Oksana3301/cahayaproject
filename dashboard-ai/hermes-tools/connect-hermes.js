const { chromium } = require("playwright");
const fs = require("fs");

function env() {
  const out = {};
  for (const line of fs.readFileSync("/opt/dashboard-ai/.env", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

(async () => {
  const e = env();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", x => errors.push(x.message));
  page.on("console", x => { if (x.type() === "error") errors.push(x.text()); });

  await page.goto("https://agentsocmed.dirini.space/masuk", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (u) => {
    await fetch("/api/masuk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u) });
    localStorage.setItem("hermes3d:onboarding:completed", "true");
  }, { pengguna: e.DASHBOARD_USER, sandi: e.DASHBOARD_PASS });

  await page.goto("https://agentsocmed.dirini.space/kantor/office", { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3000);

  // pilih renderer 3D
  const r3d = page.getByRole("button", { name: /3D immersive/ });
  if (await r3d.count()) await r3d.first().click().catch(() => {});
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Custom backend" }).click({ timeout: 20000 });
  await page.waitForTimeout(1000);
  const urlInput = page.getByLabel("Upstream URL");
  await urlInput.fill("http://127.0.0.1:4300/api/runtime");
  await page.getByRole("button", { name: "Connect", exact: true }).click({ timeout: 20000 });
  await page.waitForTimeout(25000);

  await page.screenshot({ path: "/opt/dashboard-ai/hermes3d-connected.png", fullPage: false });
  const content = await page.locator("body").innerText();
  console.log(JSON.stringify({ screenshot: "/opt/dashboard-ai/hermes3d-connected.png", text: content.slice(0, 2200), errors }, null, 2));
  await browser.close();
})().catch((x) => { console.error("CONNECT_TEST_ERROR:", x.message); process.exitCode = 1; });
