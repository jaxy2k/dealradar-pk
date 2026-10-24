// Node harness: Supabase client regression tests (DealRadar PK).
//
// Guards the fix for the chained query-builder defect: SB.from(table) must return
// the builder object SYNCHRONOUSLY, because every call site uses
// `SB.from(t).select/insert/update(...)`. When `from` was declared `async` the
// builder was wrapped in a Promise, `.select` was undefined, and every community
// push, vote and shared-deal pull died with a TypeError.
//
// SAFETY: fetch is stubbed for the whole file. Nothing here touches the network,
// the real Supabase project, RLS, auth providers or stored data.
const fs = require("fs");
const vm = require("vm");

function makeEl() {
  const el = { style: {}, dataset: {}, value: "", innerHTML: "", className: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {},
    getAttribute() { return null; }, querySelector() { return makeEl(); },
    querySelectorAll() { return []; }, closest() { return null; }, focus() {}, blur() {},
    scrollIntoView() {}, click() {}, remove() {}, insertAdjacentHTML() {}, showPicker() {},
    files: [], getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    getContext() { return {}; } };
  Object.defineProperty(el, "textContent", {
    get() { return el._tc || ""; }, set(v) { el._tc = String(v); el.innerHTML = el._tc; },
  });
  return el;
}

const calls = [];            // every fetch this test makes: {url, method, headers, body}
// Default responder: PostgREST reads return no rows; app-shell data files return
// a well-formed empty dataset so boot completes the same way it does in a browser.
let responder = (u) => ({ ok: true, status: 200,
  json: async () => (/\/rest\/v1\//.test(u) ? [] : { deals: [], brands: [], meta: {} }),
  text: async () => "" });

const sandbox = {
  console,
  setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
  document: { querySelector: () => makeEl(), querySelectorAll: () => [], createElement: () => makeEl(),
    addEventListener() {}, removeEventListener() {}, body: makeEl(), documentElement: makeEl(),
    head: makeEl(), getElementById: () => makeEl(), readyState: "complete",
    visibilityState: "visible", characterSet: "UTF-8" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { serviceWorker: null, onLine: true, language: "en", vibrate: () => {} },
  location: { href: "http://localhost/", origin: "http://localhost", hostname: "localhost",
    protocol: "http:", search: "" },
  fetch: async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET",
      headers: opts.headers || {}, body: opts.body });
    return responder(String(url), opts);
  },
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  Image: function () { return { setAttribute() {}, addEventListener() {} }; },
  alert: () => {}, confirm: () => false, prompt: () => "", requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addListener() {} }),
  addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
try { vm.runInContext(src, sandbox, { filename: "app.js" }); }
catch (e) { console.error("LOAD ERROR:", e.message); process.exit(1); }

const ev = expr => vm.runInContext(expr, sandbox);
const set = (name, val) => vm.runInContext(`${name} = ${JSON.stringify(val)}`, sandbox);

let PASS = 0, FAIL = 0;
function ok(name, cond) { if (cond) { PASS++; console.log("  PASS  " + name); } else { FAIL++; console.log("  FAIL  " + name); } }
const deal = (o) => Object.assign({ id: "d1", brand: "hbl", category: "shopping",
  title: "20% off", summary: "", cities: ["All Pakistan"], status: "active",
  discount: { kind: "percent", value: 20 }, eligibility: { payment: ["visa"] },
  community: { votes: 1, worked: 0, failed: 0, saves: 0, reports_expired: 0 } }, o || {});

console.log("A — builder shape (the defect itself):");
const b = ev('SB.from("deals")');
ok("SB.from() does not return a Promise", b && typeof b.then !== "function");
ok('SB.from("deals").select is a function', typeof ev('SB.from("deals").select') === "function");
ok('SB.from("deals").insert is a function', typeof ev('SB.from("deals").insert') === "function");
ok('SB.from("deals").update is a function', typeof ev('SB.from("deals").update') === "function");
ok("client is enabled against the configured project", ev("SB.enabled") === true);
ok("from() body has no top-level await",
   !/\basync\s+from\s*\(/.test(src) && /from\(table\)\s*\{\s*\n\s*return \{/.test(src));

console.log("\nB — chained select/insert/update actually reach PostgREST (stubbed fetch):");
(async () => {
  const url = ev("SUPABASE.url");
  const anon = ev("SUPABASE.anonKey");

  // Only look at requests this section issued: the app's own boot fetches may still
  // be settling in the background, so match on the endpoint rather than call order.
  const seen = re => calls.filter(c => re.test(c.url));
  const rest = re => seen(re).pop();

  calls.length = 0;
  responder = () => ({ ok: true, status: 200, json: async () => [{ id: "r1" }], text: async () => "" });
  const rows = await ev('SB.from("deals").select("*", "&limit=3")');
  ok("select resolves the parsed rows", Array.isArray(rows) && rows[0] && rows[0].id === "r1");
  const sel = rest(/\/rest\/v1\/deals\?select=\*&limit=3$/);
  ok("select hits /rest/v1/deals with the query string", !!sel && sel.url === url + "/rest/v1/deals?select=*&limit=3");
  ok("select sends apikey + bearer + Accept json",
     !!sel && sel.headers.apikey === anon && String(sel.headers.Authorization).startsWith("Bearer ")
     && sel.headers.Accept === "application/json");
  ok("select issued exactly one request", seen(/\/rest\/v1\//).length === 1);

  calls.length = 0;
  await ev('SB.from("merchants").insert([{ id: "m1", name: "M" }])');
  const ins = rest(/\/rest\/v1\/merchants$/);
  ok("insert uses POST to the table endpoint", !!ins && ins.method === "POST" && ins.url === url + "/rest/v1/merchants");
  ok("insert asks for merge-duplicates + representation",
     !!ins && /merge-duplicates/.test(ins.headers.Prefer) && /return=representation/.test(ins.headers.Prefer));
  ok("insert body is the JSON rows", !!ins && JSON.parse(ins.body)[0].id === "m1");

  calls.length = 0;
  await ev('SB.from("deals").update({ last_seen_at: "x" }, "id=eq.d1")');
  const upd = rest(/\/rest\/v1\/deals\?id=eq\.d1$/);
  ok("update uses PATCH with the filter", !!upd && upd.method === "PATCH" && upd.url === url + "/rest/v1/deals?id=eq.d1");

  calls.length = 0;
  responder = () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "denied by RLS" });
  let threw = null;
  try { await ev('SB.from("deals").select("*", "")'); } catch (e) { threw = e; }
  ok("a 401/RLS rejection still surfaces as an error (not swallowed)",
     threw && /401/.test(threw.message));
  threw = null;
  try { await ev('SB.from("deals").insert([{}])'); } catch (e) { threw = e; }
  ok("insert error message carries the response body", threw && /denied by RLS/.test(threw.message));

  console.log("\nC — the previously broken user-facing paths now work (stubbed fetch):");
  calls.length = 0;
  responder = (u) => ({ ok: true, status: 200,
    json: async () => (u.includes("/merchants") ? [] : [{ id: "sb_1", title: "Shared deal",
      merchant_id: "hbl", category: "shopping", status: "active",
      discount: { kind: "percent", value: 15 }, cities: ["Karachi"],
      created_at: "2026-10-24T00:00:00Z" }]),
    text: async () => "" });
  set("DATA", { deals: [deal({ id: "local1" })], brands: [{ id: "hbl", name: "HBL", color: "#123" }], meta: {} });
  ev("brandMap.clear()");
  const added = await ev("Sync.pullDeals()");
  ok("pullDeals merges shared deals instead of returning 0", added === 1);
  ok("merged deal is present and normalized",
     ev("DATA.deals.some(d => d.id === 'sb_1')") === true);
  ok("pullDeals issued both merchant and deal selects",
     calls.some(c => /\/merchants/.test(c.url)) && calls.some(c => /\/deals/.test(c.url)));

  calls.length = 0;
  responder = () => ({ ok: true, status: 201, json: async () => [{ id: "d1" }], text: async () => "" });
  ok("_pushDeal returns true (was always false)",
     await ev("Sync._pushDeal(" + JSON.stringify(deal({})) + ", null, true)") === true);
  ok("_pushDeal POSTed to /rest/v1/deals",
     calls.some(c => c.method === "POST" && /\/rest\/v1\/deals$/.test(c.url)));

  calls.length = 0;
  const voteArg = "Sync._pushVote(" + JSON.stringify(deal({ community: { votes: 1, worked: 1, failed: 0, saves: 0, reports_expired: 0 } })) + ", \"working\", true)";
  const voteOk = await ev(voteArg);
  ok("_pushVote returns true and writes verifications + the deal patch",
     voteOk === true
     && calls.some(c => /\/verifications$/.test(c.url) && c.method === "POST")
     && calls.some(c => /\/deals\?id=eq\.d1$/.test(c.url) && c.method === "PATCH"));

  calls.length = 0;
  ev("reinforceDeal(" + JSON.stringify(deal({})) + ")");
  ok("reinforceDeal no longer throws and patches last_seen_at",
     calls.some(c => c.method === "PATCH" && /last_seen_at/.test(String(c.body))));

  console.log("\nD — call-site discipline (guards the other direction):");
  const sites = [...src.matchAll(/SB\.from\(\s*["']([a-z_]+)["']\s*\)\s*\.(\w+)/g)];
  const quoted = (src.match(/SB\.from\(\s*["']/g) || []).length;
  ok("every SB.from() call site uses the chained form",
     sites.length >= 8 && quoted === sites.length);
  const doubleWrap = src.match(/\(\s*await\s+SB\.from\(/g) || [];
  ok("no call site awaits from() before chaining (correct form is await from(t).select())",
     doubleWrap.length === 0);
  ok("only expected tables are addressed",
     sites.map(m => m[1]).every(t => ["deals", "merchants", "submissions", "verifications"].includes(t)));
  ok("no service_role key referenced in client code", !/service_role/.test(src));

  console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error("TEST ERROR:", e && e.stack || e); process.exit(1); });
