#!/usr/bin/env node
/* DealRadar PK — REAL-BROWSER PWA verification (headless Chromium).
 *
 * Self-contained: stages this repo's entry files into a GitHub-Pages-style
 * subpath (/dealradar-pk/), serves them over HTTP on a random port, drives
 * Chromium, and asserts the PWA contract:
 *   - service worker registers and ACTIVATES with the correct subpath scope
 *   - manifest is valid, relative start_url/scope, 192+512 icons (install criteria)
 *   - network-first: editing live_deals.json on disk is visible through the SW
 *   - offline: navigation + data requests fall back to cache
 *   - update: a changed sw.js installs as a NEW worker; SKIP_WAITING completes it
 *   - no same-origin 404s and no JS crashes
 *
 * The strict "new worker stays WAITING until user taps Update" contract is proven
 * deterministically by test_sw_runtime.js (stubbed SW scope, no browser flakiness).
 *
 * Needs chromium + puppeteer-core on PATH/require; skips gracefully otherwise.
 * Run:  node test_pwa_browser.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const cp = require("child_process");

const ROOT = __dirname;
const ENTRY = ["index.html", "app.js", "styles.css", "sw.js", "manifest.json",
               "live_deals.json", "deals.json", "health.json", "icon-192.png", "icon-512.png"]
               .filter((f) => fs.existsSync(path.join(ROOT, f)));
// brand PNGs referenced by seed deals.json (repo-root files)
for (const f of fs.readdirSync(ROOT)) if (/^[a-z0-9_]+\.png$/i.test(f) && !ENTRY.includes(f) && f !== "icon-192.png" && f !== "icon-512.png") ENTRY.push(f);

let puppeteer;
try { puppeteer = require("puppeteer-core"); }
catch (e) { try { puppeteer = require("puppeteer"); } catch { console.log("SKIP: puppeteer-core/puppeteer not installed"); process.exit(0); } }
const CHROME = process.env.CHROME_PATH || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((x) => fs.existsSync(x));
if (!CHROME) { console.log("SKIP: no chromium binary found"); process.exit(0); }

// --- stage sim directory ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dr-pwa-sim-"));
const sub = path.join(tmp, "dealradar-pk");
fs.mkdirSync(sub, { recursive: true });
for (const f of ENTRY) fs.copyFileSync(path.join(ROOT, f), path.join(sub, f));

// --- minimal static server with correct MIME + no-cache (Pages-like) ---
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(tmp, u);
  if (u.endsWith("/")) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const PORT = server.address().port;
  const BASE = `http://127.0.0.1:${PORT}/dealradar-pk/`;
  const results = [];
  const ok = (n, c, extra) => results.push({ n, pass: !!c, extra: extra || "" });

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=${path.join(tmp, "profile")}`],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (res) => { if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 30000 });

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? { active: !!r.active, waiting: !!r.waiting, scope: r.scope } : null;
  });
  ok("service worker registered + ACTIVE", !!(reg && reg.active));
  ok("SW scope is the Pages subpath", !!(reg && reg.scope === BASE), reg && reg.scope);

  await new Promise((r) => setTimeout(r, 900)); // let precache run

  const manifest = await page.evaluate(async () => {
    const el = document.querySelector('link[rel="manifest"]'); if (!el) return null;
    try { return await (await fetch(el.href)).json(); } catch { return null; }
  });
  ok("manifest valid + start_url/scope relative", !!manifest && manifest.start_url === "./" && manifest.scope === "./");
  ok("icons 192+512 declared + display standalone", !!manifest && manifest.display === "standalone" && manifest.icons.some((i) => /192/.test(i.sizes)) && manifest.icons.some((i) => /512/.test(i.sizes)));

  const iconLoad = await page.evaluate(async () => {
    const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(1); im.onerror = () => res(0); im.src = u; });
    return { a: await load("icon-192.png"), b: await load("icon-512.png") };
  });
  ok("app icons load in browser", iconLoad.a === 1 && iconLoad.b === 1);

  // network-first proof: edit the file on disk, read it back through the page
  const dataPath = path.join(sub, "live_deals.json");
  const before = fs.readFileSync(dataPath, "utf8");
  const marker = new Date().toISOString();
  const mutated = JSON.parse(before); mutated.meta = { ...mutated.meta, generated_at: marker };
  fs.writeFileSync(dataPath, JSON.stringify(mutated));
  const through = await page.evaluate(async () => (await (await fetch("live_deals.json")).json()).meta.generated_at);
  ok("network-first: on-disk edit visible through SW immediately", through === marker, through);
  fs.writeFileSync(dataPath, before);

  // offline behavior
  await page.setOfflineMode(true);
  const off = await page.evaluate(async () => {
    try { const r = await fetch("./"); const t = await r.text(); return { shell: r.ok && t.includes("DealRadar") }; } catch { return { shell: false }; }
  });
  ok("offline navigation served from SW cache", off.shell === true);
  const offData = await page.evaluate(async () => { try { return { ok: (await fetch("live_deals.json")).ok }; } catch { return { ok: false }; } });
  ok("offline data falls back to cached copy", offData.ok === true);
  await page.setOfflineMode(false);

  // update flow: change sw.js bytes -> a new worker must eventually take over on SKIP_WAITING
  await page.reload({ waitUntil: "networkidle2" });
  // This test owns its staged cache lifecycle. Use a unique cache per run so
  // real source-cache names can advance without invalidating the fixture.
  const initialCache = "dr-test-v1", updatedCache = "dr-test-v2";
  const swPath = path.join(sub, "sw.js");
  let swSrc = fs.readFileSync(swPath, "utf8");
  fs.writeFileSync(swPath, swSrc.replace(/const CACHE_NAME = ['"][^'"]+['"]/, `const CACHE_NAME = '${initialCache}'`));
  await page.evaluate(async (name) => { const r = await navigator.serviceWorker.getRegistration(); await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready; }, initialCache);
  await page.reload({ waitUntil: "networkidle2" });
  swSrc = fs.readFileSync(swPath, "utf8");
  fs.writeFileSync(swPath, swSrc.replace(initialCache, updatedCache));
  const state = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.update();
    for (let i = 0; i < 120; i++) { if (r.waiting || r.installing) break; await new Promise((x) => setTimeout(x, 100)); }
    return { waiting: !!r.waiting, installing: !!r.installing, active: !!r.active };
  });
  console.log(`INFO  update state seen: ${JSON.stringify(state)} (strict WAITING contract proven by test_sw_runtime.js)`);
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    if (r.waiting) r.waiting.postMessage({ type: "SKIP_WAITING" });
    else if (r.installing) r.installing.postMessage({ type: "SKIP_WAITING" });
  });
  await new Promise((r) => setTimeout(r, 1200));
  const keys = await page.evaluate(async () => await caches.keys());
  ok("SKIP_WAITING completes update (new cache present, old purged)", keys.includes(updatedCache) && !keys.includes(initialCache), JSON.stringify(keys));
  fs.writeFileSync(swPath, swSrc);

  // /api/deals is optional; its 404 triggers the documented static JSON fallback.
  const sameOrigin404 = errors.filter((e) => e.includes(`127.0.0.1:${PORT}`) && /HTTP 404/.test(e) && !/\/api\/deals(?:\s|$)/.test(e));
  const crashes = errors.filter((e) => e.startsWith("pageerror"));
  ok("no unexpected same-origin 404s (optional api/deals fallback excluded)", sameOrigin404.length === 0, sameOrigin404.slice(0, 3).join(" | ").slice(0, 200));
  ok("no JS page errors / crashes", crashes.length === 0, crashes.slice(0, 2).join(" | ").slice(0, 200));

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  let P = 0, F = 0;
  console.log("\n=== BROWSER PWA VERIFICATION ===");
  for (const r of results) { console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.n}${r.extra ? "  [" + r.extra + "]" : ""}`); r.pass ? P++ : F++; }
  console.log(`\nBROWSER CHECKS: PASS ${P} / FAIL ${F}`);
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e.message); try { server.close(); } catch {} process.exit(2); });
