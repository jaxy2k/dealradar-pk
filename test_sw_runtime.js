#!/usr/bin/env node
/* DealRadar PK — service-worker runtime tests (stubbed SW scope, no browser).
 * Loads the REAL sw.js and drives install/activate/fetch/message handlers to
 * prove the safe-update + network-first + offline-fallback behaviour.
 * Run: node test_sw_runtime.js
 */
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(__dirname + "/sw.js", "utf8");
const SW_ORIGIN = "https://jaxy2k.github.io";
const SW_DIR = SW_ORIGIN + "/dealradar-pk/";         // Pages project subpath
const SWloc = SW_DIR + "sw.js";

let PASS = 0, FAIL = 0;
const ok = (n, c) => { c ? PASS++ : (FAIL++, console.log("FAIL:", n)); };

function makeScope(hasActiveWorker) {
  const handlers = {}, cacheStore = new Map();
  const resolveKey = (k) => { try { return new URL(typeof k === "string" ? k : k.url, SWloc).href; } catch { return k; } };
  const fakeCache = {
    put: async (req, res) => cacheStore.set(resolveKey(req), res),
    match: async (req) => cacheStore.get(resolveKey(req)),
    add: async (u) => {
      // simulate a missing/unfetchable asset (e.g. health.json not yet committed)
      if (String(u).includes("health.json")) throw new Error("simulated 404");
      cacheStore.set(resolveKey(u), { precached: 1 });
    },
  };
  const scope = {
    location: { origin: SW_ORIGIN, href: SWloc },
    registration: { active: hasActiveWorker ? {} : null },
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    skipWaiting: () => { scope.__skipped = true; return Promise.resolve(); },
    clients: { claim: () => { scope.__claimed = true; } },
    caches: { open: async () => fakeCache, keys: async () => ["dealradar-v3"], delete: async () => true,
              match: async (r) => cacheStore.get(resolveKey(r)) },
    fetch: () => Promise.resolve({ ok: true, clone: () => ({}) }),
    Response: { error: () => ({ errored: true }) },
    URL, Promise, console,
    __handlers: handlers, __cache: cacheStore, __resolveKey: resolveKey, __skipped: false, __claimed: false,
  };
  scope.self = scope;
  vm.createContext(scope);
  vm.runInContext(src, scope);
  return scope;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  // --- Install (existing worker => this is an UPDATE) ---
  const s = makeScope(true);
  let w; s.__handlers.install({ waitUntil: (p) => { w = p; } }); await w; await tick();
  ok("install precaches shell even when health.json 404s (allSettled)", [...s.__cache.keys()].some(k => k.includes("index.html")));
  ok("failed asset does NOT block other precache entries", [...s.__cache.keys()].some(k => k.includes("app.js")));
  ok("failed asset itself stays uncached (no poisoned entry)", ![...s.__cache.keys()].some(k => k.includes("health.json")));
  ok("UPDATE auto-skipWaiting (users always get latest UI immediately)", s.__skipped === true);
  s.__handlers.message({ data: { type: "SKIP_WAITING" } }); await tick();
  ok("SKIP_WAITING message still honoured (idempotent)", s.__skipped === true);

  // --- Install (no existing worker => FIRST install) ---
  const s1 = makeScope(false);
  let w1; s1.__handlers.install({ waitUntil: (p) => { w1 = p; } }); await w1; await tick();
  ok("FIRST install takes control immediately (offline works day one)", s1.__skipped === true);

  // --- Activate ---
  let aw; s.__handlers.activate({ waitUntil: (p) => { aw = p; } }); await aw;
  ok("activate claims clients", s.__claimed === true);

  // --- Fetch: cross-origin (Supabase) must NOT be intercepted ---
  let touched = false;
  s.__handlers.fetch({ request: { method: "GET", url: "https://ygcwdwlwxcjqlxdshvup.supabase.co/rest/v1/deals", mode: "cors", headers: { get: () => "" } }, respondWith: () => { touched = true; } });
  ok("cross-origin Supabase request NOT intercepted (always live)", touched === false);

  // --- Fetch: online => LIVE response wins (network-first), clone re-cached ---
  const live = { ok: true, live: 1, clone: () => ({ cloned: 1 }) };
  s.fetch = () => Promise.resolve(live);
  const dataUrl = SW_DIR + "live_deals.json";
  let p; s.__handlers.fetch({ request: { method: "GET", url: dataUrl, mode: "cors", headers: { get: () => "" } }, respondWith: (x) => { p = x; } });
  ok("online data fetch returns LIVE response, not cache", (await p) === live);
  await tick();
  ok("live response re-cached for later offline use", s.__cache.get(dataUrl) && s.__cache.get(dataUrl).cloned === 1);

  // --- Fetch: offline => cached data fallback ---
  s.fetch = () => Promise.reject(new Error("offline"));
  let p2; s.__handlers.fetch({ request: { method: "GET", url: dataUrl, mode: "cors", headers: { get: () => "" } }, respondWith: (x) => { p2 = x; } });
  ok("offline data fetch falls back to cached copy", (await p2) && (await p2).cloned === 1);

  // --- Fetch: offline navigation => cached root OR shell fallback ---
  // 8a: the site root itself is precached ('./' => .../dealradar-pk/), so an
  //     offline navigation to the root returns that cached document directly.
  let p3; s.__handlers.fetch({ request: { method: "GET", url: SW_DIR, mode: "navigate", headers: { get: () => "text/html" } }, respondWith: (x) => { p3 = x; } });
  ok("offline navigation to root returns cached root doc", !!(await p3) && !(await p3).errored);
  // 8b: an offline navigation to a NON-precached URL (deep link) falls back to
  //     the cached index.html shell — that is the recovery path for SPA routes.
  s.__cache.set(SW_DIR + "index.html", { shell: 1 });
  let p4; s.__handlers.fetch({ request: { method: "GET", url: SW_DIR + "some/deep/route", mode: "navigate", headers: { get: () => "text/html" } }, respondWith: (x) => { p4 = x; } });
  ok("offline deep-route navigation falls back to cached shell", (await p4) && (await p4).shell === 1);
  // 8c: offline miss for a non-navigation subresource -> graceful Response.error()
  let p5; s.__handlers.fetch({ request: { method: "GET", url: SW_DIR + "images/never-cached.png", mode: "no-cors", headers: { get: () => "" } }, respondWith: (x) => { p5 = x; } });
  ok("uncached offline subresource degrades gracefully (Response.error)", (await p5) && (await p5).errored === true);

  console.log(`\nSW RUNTIME TESTS: PASS ${PASS} / FAIL ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})();
