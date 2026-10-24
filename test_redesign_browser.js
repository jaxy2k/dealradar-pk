#!/usr/bin/env node
/* Mobile browser regression: layout, six destinations, wallet, filters, RTL,
 * dialog controls, empty/error states. Read-only against production services.
 * Usage: serve the repo on port 8765, then run with puppeteer-core installed.
 * Optional: BASE_URL, CHROME_PATH, SCREENSHOT_DIR environment variables. */
const fs = require("fs");
let puppeteer;
try { puppeteer = require("puppeteer-core"); }
catch { try { puppeteer = require("puppeteer"); } catch { console.log("SKIP: puppeteer not installed"); process.exit(0); } }
const chrome = process.env.CHROME_PATH || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(fs.existsSync);
if (!chrome) { console.log("SKIP: Chromium not installed"); process.exit(0); }
const base = process.env.BASE_URL || "http://127.0.0.1:8765/";
const shots = process.env.SCREENSHOT_DIR || "/tmp/dr-screens";
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const checks = [], errors = [], failed = [];
  const ok = (name, value) => { checks.push({ name, pass: !!value }); if (!value) throw Error("FAIL: " + name); };
  const wait = (ms = 350) => new Promise(r => setTimeout(r, ms));

  for (const width of [360, 390, 411, 768]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: 900 });
    page.on("pageerror", e => errors.push(`${width}: ${e.message}`));
    await page.goto(base, { waitUntil: "networkidle2", timeout: 60000 }); await wait();
    const layout = await page.evaluate(() => ({
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      cards: document.querySelectorAll(".deal").length,
      firstTop: Math.round(document.querySelector(".deal")?.getBoundingClientRect().top || 0),
      filterHeight: Math.round(document.querySelector("#filterDisclosure").getBoundingClientRect().height),
      icons: document.querySelectorAll("svg.ic").length
    }));
    ok(`${width}px has no horizontal overflow`, layout.pageWidth === width);
    ok(`${width}px renders offers above 430px`, layout.cards > 0 && layout.firstTop < 430);
    ok(`${width}px secondary filters start collapsed`, layout.filterHeight < 50);
    ok(`${width}px renders SVG iconography`, layout.icons > 20);
    if (width !== 390) await page.screenshot({ path: `${shots}/home-${width}.png` });
    await context.close();
  }

  const context = await browser.createBrowserContext();
  const p = await context.newPage(); await p.setViewport({ width: 390, height: 900 });
  p.on("pageerror", e => errors.push(e.message));
  p.on("response", r => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
  async function click(sel) {
    await p.waitForSelector(sel, { visible: true });
    await p.$eval(sel, e => e.scrollIntoView({ block: "center" })); await wait(100);
    const r = await p.$eval(sel, e => e.getBoundingClientRect().toJSON());
    if (r.x < 0 || r.y < 0 || r.x + r.width > 390 || r.y + r.height > 900) throw Error("out of viewport: " + sel);
    await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await wait();
  }
  await p.goto(base, { waitUntil: "networkidle2", timeout: 60000 }); await wait();
  await p.screenshot({ path: `${shots}/01-home.png` });
  if (await p.$(".pwa-x")) await click(".pwa-x");
  for (const tab of ["foryou", "ending", "evergreen", "spotted", "calendar", "trending"]) {
    await click(`[data-tab="${tab}"]`);
    ok(`tab ${tab} renders`, await p.$eval("#feed", e => e.children.length > 0));
    if (["foryou", "ending", "spotted", "calendar"].includes(tab)) await p.screenshot({ path: `${shots}/tab-${tab}.png` });
  }
  await click(".deal"); ok("dialog has close control", await p.$("#sheetClose") !== null);
  await p.screenshot({ path: `${shots}/02-details.png` });
  await click("#sheetClose"); ok("dialog closes", await p.$eval("#sheet", e => e.classList.contains("hidden")));
  await click("#walletBtn"); await click('[data-pay="hbl_credit"]');
  ok("wallet selected visually", await p.$eval('[data-pay="hbl_credit"]', e => e.getAttribute("aria-pressed") === "true"));
  await p.screenshot({ path: `${shots}/03-wallet.png` }); await click("#walletDone");
  ok("wallet persists locally", await p.evaluate(() => JSON.parse(localStorage.getItem("dr_pay")).includes("hbl_credit")));
  await click('[data-tab="foryou"]'); ok("For You has selected-method matches", await p.$eval("#feed", e => e.querySelectorAll(".deal").length > 0));
  await click("#walletBtn"); await click('[data-pay="hbl_credit"]'); await click("#walletDone"); await click('[data-tab="trending"]');
  await click("#filterSummary"); await click('[data-otype="WALLET_OFFER"]');
  ok("type filter changes cards", await p.$eval("#feed", e => e.querySelectorAll(".deal").length > 0 && e.querySelectorAll('.deal:not([data-offer="WALLET_OFFER"])').length === 0));
  await click("#resetFilters"); ok("filter reset clears type", await p.$eval("#filterSummary", e => !e.textContent.includes("•")));
  await p.type("#q", "no-such-deal-9472"); await wait(500);
  ok("empty search has recovery action", await p.$("#clearSearch") !== null);
  await p.screenshot({ path: `${shots}/04-empty.png` }); await click("#clearSearch");
  ok("clear search empties input", await p.$eval("#q", e => e.value === ""));
  ok("cards return after clearing", await p.$eval("#feed", e => e.querySelectorAll(".deal").length > 0));
  await click("#langBtn"); ok("RTL applied", await p.evaluate(() => document.documentElement.dir === "rtl"));
  ok("RTL has no overflow", await p.evaluate(() => document.documentElement.scrollWidth === 390));
  await p.screenshot({ path: `${shots}/05-urdu.png` }); await click(".deal");
  await p.screenshot({ path: `${shots}/06-urdu-detail.png` }); await click("#sheetClose"); await click("#langBtn");
  await p.evaluate(() => document.querySelector("#nudgeDismiss")?.click()); await wait();
  ok("wallet prompt dismissal persists", await p.evaluate(() => localStorage.getItem("dr_wallet_nudge_dismissed") === "true"));

  // Local state fixtures exercise empty/loading paths without changing real data.
  const states = await p.evaluate(async () => {
    state.feedRendered = false; renderFeed();
    const loading = document.querySelectorAll("#feed .skeleton").length;
    await new Promise(r => setTimeout(r, 250));
    const original = DATA.deals;
    DATA.deals = original.map(d => ({ ...d, valid_until: null, expires_at: null }));
    state.tab = "ending"; renderAll();
    const noExpiry = document.querySelectorAll("#feed .deal").length === 0 && document.querySelector("#feed").innerText.length > 10;
    DATA.deals = original; state.tab = "trending"; renderAll();
    return { loading, noExpiry };
  });
  ok("loading skeleton is real", states.loading > 0);
  ok("no-expiry data gives honest empty Ending state", states.noExpiry);

  const nc = await browser.createBrowserContext(); const n = await nc.newPage();
  await n.setViewport({ width: 390, height: 900 }); await n.setRequestInterception(true);
  n.on("request", r => { if (r.url().includes("live_deals.json") || r.url().includes("deals.json")) r.abort(); else r.continue(); });
  await n.goto(base, { waitUntil: "networkidle2", timeout: 30000 }); await wait();
  const net = await n.evaluate(() => ({ retry: !!document.querySelector("#retryLive, #feed .btn-primary"), message: document.querySelector("#feed").innerText }));
  ok("network failure is honest and retryable", net.retry && net.message.length > 0);
  await n.screenshot({ path: `${shots}/07-network-error.png` });
  ok("no JavaScript page errors", errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, errors, httpErrors: failed.filter(x => !x.includes("/api/deals")), screenshots: shots }, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
