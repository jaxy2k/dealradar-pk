// Node harness: loads the REAL repo app.js in a stubbed DOM and tests the
// Phase 2A initial-live-data fix:
//  - validateLivePayload() contract (real scraper shape; fresh-empty valid, stale-empty rejected)
//  - fetchLive success replaces stale seed; views update; provenance flips to live
//  - network failure / timeout / invalid JSON / bad payload keep the previous dataset
//  - concurrent + repeated calls share one request (no stampede, no double render)
//  - timer-style and pull-to-refresh-style refreshes work after startup
//  - news exclusion + honest expiry states survive dataset replacement
// NOTE (same convention as test_fixes.js): app.js declares NOW/state/DATA with
// let/const -> NOT sandbox properties; read/write via vm.runInContext (ev/set).
const fs = require("fs");
const vm = require("vm");

const FIXED_NOW = Date.UTC(2026, 9, 18, 6, 0, 0); // 2026-10-18T06:00Z

// ---- fake timers so setTimeout/setInterval are controllable and instant-safe ----
const timers = []; // {id, fn, ms, at, interval}
let timerId = 0;
let fakeNow = FIXED_NOW;
function setTimeoutStub(fn, ms) { const t = { id: ++timerId, fn, ms, at: fakeNow + (ms || 0), interval: 0 }; timers.push(t); return t.id; }
function setIntervalStub(fn, ms) { const t = { id: ++timerId, fn, ms, at: fakeNow + ms, interval: ms }; timers.push(t); return t.id; }
function clearStub(id) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); }
function advance(ms) {
  const target = fakeNow + ms;
  for (;;) {
    const due = timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    fakeNow = due.at;
    if (due.interval) due.at = fakeNow + due.interval; else clearStub(due.id);
    due.fn();
  }
  fakeNow = target;
}

function makeEl() {
  return { style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    dataset:{}, value:"", textContent:"", innerHTML:"", addEventListener(){}, removeEventListener(){},
    appendChild(){}, removeChild(){}, setAttribute(){}, getAttribute(){return null;},
    querySelector(){return makeEl();}, querySelectorAll(){return [];}, closest(){return null;},
    focus(){}, blur(){}, scrollIntoView(){}, click(){}, remove(){}, insertAdjacentHTML(){},
    getBoundingClientRect(){return {top:0,left:0,width:0,height:0};}, showPicker(){}, files:[],
    getContext(){return {};} };
}
// stable elements per selector so renderBanner() output can be asserted
const elCache = {};
const getEl = s => (elCache[s] || (elCache[s] = makeEl()));
const storeMap = {};

// ---- controllable fetch stub, routed by URL ----
let fetchCalls = [];           // [{url, opts}]
let liveResponder = null;      // (url) => Promise<{ok,status,json()}> | reject
const sandbox = {
  console: { log(){}, warn(){}, error(){} },
  setTimeout: setTimeoutStub, setInterval: setIntervalStub, clearTimeout: clearStub, clearInterval: clearStub,
  Promise, Map, Set, JSON, Math, Number, String, Array, Object, Error, RegExp, Infinity, NaN, isNaN, parseInt, parseFloat,
  document:{ querySelector:s=>getEl(s), querySelectorAll:()=>[], createElement:()=>makeEl(),
    addEventListener(){}, removeEventListener(){}, body:makeEl(), documentElement:makeEl(),
    head:makeEl(), getElementById:()=>makeEl(), readyState:"complete", visibilityState:"visible", characterSet:"UTF-8" },
  localStorage:{ getItem:k=>(k in storeMap?storeMap[k]:null), setItem:(k,v)=>{storeMap[k]=String(v);}, removeItem:k=>{delete storeMap[k];} },
  navigator:{ serviceWorker:null, onLine:true, language:"en", vibrate:()=>{} },
  location:{ href:"http://localhost/", origin:"http://localhost", hostname:"localhost", protocol:"http:", search:"" },
  fetch: (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    const u = String(url);
    if (u.includes("supabase.co")) {
      // Supabase: sign-in + selects always succeed with "no community rows" so the
      // unit under test (live feed handling) is isolated from SB behaviour.
      if (u.includes("/auth/v1/signup")) return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({access_token:"t",user:{id:"u1"}}) });
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve([]) });
    }
    if (u.includes("live_deals.json") || u.includes("api/deals")) return liveResponder(u);
    return Promise.resolve({ ok:false, status:404, json:()=>Promise.reject(new Error("nope")) });
  },
  URL:{ createObjectURL:()=>"", revokeObjectURL:()=>{} },
  Image:function(){return {setAttribute(){},addEventListener(){}};},
  alert:()=>{}, confirm:()=>false, prompt:()=>"", requestAnimationFrame:()=>0,
  matchMedia:()=>({matches:false,addListener(){}}), addEventListener(){}, removeEventListener(){},
  AbortController: class { constructor(){ this.signal={aborted:false}; this.abort=()=>{this.signal.aborted=true;}; } },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
sandbox.Date = new Proxy(Date, { construct(t,a){ return a.length? new t(...a) : new t(fakeNow); } });
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
try { vm.runInContext(src, sandbox, { filename:"app.js" }); }
catch (e) { console.error("LOAD ERROR:", e.message); process.exit(1); }

const ev = expr => vm.runInContext(expr, sandbox);
let PASS=0, FAIL=0;
function ok(name, cond){ if(cond){PASS++;console.log("  PASS  "+name);} else {FAIL++;console.log("  FAIL  "+name);} }
// flush real microtask + macrotask queues (never the fake timer queue)
const flush = () => new Promise(r=>setImmediate(r)).then(()=>new Promise(r=>setImmediate(r))).then(()=>new Promise(r=>setImmediate(r)));

// ---- payload builders matching the REAL scraper shape (meta/brands/deals) ----
function deal(id, extra){
  return Object.assign({ id, brand:"b"+id, brand_type:"bank", category:"food",
    cities:["All Pakistan"], community:{votes:0,worked:0,failed:0}, confidence:0.7,
    discount:{kind:"percent",value:10}, eligibility:{payment:["any"]},
    exclusions:[], source:{type:"scrape",platform:"p",captured_at:"2026-10-18T05:00:00+00:00"},
    status:"active", steps:[], title:"t"+id, summary:"s", valid_from:"2026-10-01",
    valid_until:"2026-11-15", verification:"verified", visual:{} }, extra||{});
}
function payload(deals, meta){
  return { meta: Object.assign({ generated_at:new Date(FIXED_NOW-36e5).toISOString(),
    server_time:new Date(FIXED_NOW-36e5).toISOString(), now:new Date(FIXED_NOW).toISOString(),
    source:"peekaboo_sdk", total_deals:deals.length }, meta||{}),
    brands:[{id:"b",name:"Brand B",brand_type:"bank",color:"#123",logo:null}], deals };
}
function setLive(responder){ liveResponder = responder; }
const okJson = obj => Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(obj) });

// ---- seed state: simulate what init() leaves behind (51-record seed, no live yet) ----
function resetToSeed() {
  ev(`DATA = normalizeDataset(${JSON.stringify(payload([deal("seed1"),deal("seed2")], {generated_at:"2026-09-18T20:49:00+05:00"}))}); dataProvenance = null; lastFetch = null;`);
}
resetToSeed();

console.log("NOW anchored:", new Date(ev("NOW")).getTime() === FIXED_NOW ? "ok" : "MISALIGNED");

console.log("\nvalidateLivePayload — contract from real payload shape:");
const validate = ev("validateLivePayload");
ok("null rejected", !validate(null).ok);
ok("non-object rejected", !validate("string").ok);
ok("missing deals array rejected", !validate({ meta:{}, brands:[] }).ok);
ok("missing brands array rejected", !validate({ meta:{}, deals:[] }).ok);
ok("record without id rejected", !validate(payload([deal("x"), { title:"no id" }])).ok);
ok("normal populated payload accepted", validate(payload([deal("a"),deal("b")])).ok);
// NOTE: validateLivePayload's empty-dataset freshness check uses the REAL clock
// (Date.now()), so these fixtures must be relative to real time, not FIXED_NOW.
ok("fresh EMPTY dataset accepted (legit zero offers)", validate(payload([], { generated_at:new Date(Date.now()-36e5).toISOString() })).ok);
ok("stale EMPTY dataset rejected (older than 12h)", !validate(payload([], { generated_at:new Date(Date.now()-48*36e5).toISOString() })).ok);
ok("empty dataset without generated_at rejected", !validate({ brands:[], deals:[], meta:{} }).ok);
ok("empty dataset far-future generated_at rejected", !validate(payload([], { generated_at:new Date(Date.now()+72*36e5).toISOString() })).ok);

console.log("\nInitial live load — replaces stale seed:");
(async () => {
  resetToSeed();
  setLive(() => okJson(payload([deal("L1"),deal("L2"),deal("L3")])));
  await ev("fetchLive(true)"); await flush();
  ok("DATA.deals replaced with live records", ev("DATA.deals.map(d=>d.id).join(',')") === "L1,L2,L3");
  ok("provenance flips to live", ev("dataProvenance") === "live");
  ok("lastFetch set from meta.server_time", typeof ev("lastFetch") === "string");
  ok("brands updated from payload", ev("DATA.brands.some(b=>b.id==='b')"));
  ok("seed ids gone", !ev("DATA.deals.some(d=>d.id==='seed1')"));

  console.log("\nFailure modes — previous dataset retained:");
  const before = ev("DATA.deals.map(d=>d.id).join(',')");
  setLive(() => Promise.reject(new Error("network down")));
  await ev("fetchLive(true)"); await flush();
  ok("network error keeps dataset", ev("DATA.deals.map(d=>d.id).join(',')") === before);
  ok("failed fetch does NOT clear provenance data (deals intact)", ev("DATA.deals.length") === 3);

  setLive(() => Promise.resolve({ ok:true, status:200, json:()=>Promise.reject(new Error("invalid json")) }));
  await ev("fetchLive(true)"); await flush();
  ok("invalid JSON keeps dataset", ev("DATA.deals.map(d=>d.id).join(',')") === before);

  setLive(() => Promise.resolve({ ok:false, status:500, json:()=>Promise.resolve({}) }));
  await ev("fetchLive(true)"); await flush();
  ok("HTTP 500 keeps dataset", ev("DATA.deals.map(d=>d.id).join(',')") === before);

  setLive(() => okJson({ meta:{}, deals:[{oops:1}] }));
  await ev("fetchLive(true)"); await flush();
  ok("malformed payload (no brands array) keeps dataset", ev("DATA.deals.map(d=>d.id).join(',')") === before);

  // stale empty payload must not wipe inventory
  setLive(() => okJson(payload([], { generated_at:new Date(FIXED_NOW-30*24*36e5).toISOString() })));
  await ev("fetchLive(true)"); await flush();
  ok("stale EMPTY payload rejected — inventory NOT wiped", ev("DATA.deals.map(d=>d.id).join(',')") === before);

  // timeout: responder never settles; the internal 15s abort timer fires via advance();
  // the loop then tries the second path (also hanging) -> drain-reject until settled.
  resetToSeed();
  const pendings = [];
  setLive(() => new Promise((_res, rej) => pendings.push(rej)));
  const p = ev("fetchLive(true)");
  ok("dataset untouched while request in flight", ev("DATA.deals.map(d=>d.id).join(',')") === "seed1,seed2");
  ok("15s abort timer scheduled", timers.some(t => t.ms === 15000));
  advance(16000); // fires the scheduled abort timers (harmless with fake controller)
  for (let guard = 0; guard < 6 && pendings.length; guard++) {
    const rej = pendings.shift();
    rej(new Error("aborted"));
    await new Promise(r => setImmediate(r)); // let the path loop reach the next fetch
  }
  await p; await flush();
  ok("timed-out request keeps seed", ev("DATA.deals.map(d=>d.id).join(',')") === "seed1,seed2");

  console.log("\nConcurrency — one shared request:");
  resetToSeed();
  let resolves = [];
  setLive(() => new Promise(r => resolves.push(r)));
  const a = ev("fetchLive(true)"), b = ev("fetchLive(true)"), c = ev("fetchLive()");
  ok("3 callers -> 1 live fetch", resolves.length === 1);
  resolves[0](okJson(payload([deal("M1")])));
  await Promise.all([a,b,c]); await flush();
  ok("all callers resolved against same replacement", ev("DATA.deals.map(d=>d.id).join(',')") === "M1");
  const callsBefore = fetchCalls.length;
  setLive(() => okJson(payload([deal("M2")])));
  await ev("fetchLive(true)"); await flush();
  ok("after completion, a new fetch is allowed", fetchCalls.length > callsBefore && ev("DATA.deals.map(d=>d.id).join(',')") === "M2");

  console.log("\nTimer + pull-to-refresh style refreshes after startup:");
  setLive(() => okJson(payload([deal("T1"),deal("T2")])));
  await ev("fetchLive(true)"); await flush(); // 5-min tick handler calls fetchLive()
  ok("timer-style refresh updates data", ev("DATA.deals.map(d=>d.id).join(',')") === "T1,T2");
  setLive(() => okJson(payload([deal("P1")])));
  await ev("fetchLive()"); await flush(); // PTR calls fetchLive() non-silent
  ok("pull-to-refresh style updates data", ev("DATA.deals.map(d=>d.id).join(',')") === "P1");

  console.log("\nFailed refresh preserves previously valid live data:");
  const good = ev("DATA.deals.map(d=>d.id).join(',')");
  setLive(() => Promise.reject(new Error("edge died")));
  await ev("fetchLive(true)"); await flush();
  ok("good live data survives a later failure", ev("DATA.deals.map(d=>d.id).join(',')") === good);

  console.log("\nPreserved behaviours after replacement:");
  setLive(() => okJson(payload([
    deal("keep1", { source:{type:"news",platform:"rss",captured_at:"2026-10-18T05:00:00+00:00"} }),
    deal("keep2", { valid_until:null }),                       // missing expiry
    deal("keep3", { valid_until:"2036-12-31" }),               // placeholder
    deal("keep4", { status:"evergreen", valid_until:null }),   // genuine ongoing
    deal("keep5", { valid_until:new Date(FIXED_NOW+5*864e5).toISOString().slice(0,10) }) // real soon
  ])));
  await ev("fetchLive(true)"); await flush();
  ok("news record excluded by baseFilter", !ev("baseFilter(DATA.deals.find(d=>d.id==='keep1'))"));
  ok("news excluded from live count", ev("DATA.deals.filter(d=>d.status!=='evergreen'&&!isHidden(d)&&!isNews(d)).length") === 3); // 5 - keep1(news) - keep4(evergreen)
  ok("missing expiry -> 'End date unavailable' (not Ongoing)", ev("countdown(DATA.deals.find(d=>d.id==='keep2')).text") === "End date unavailable");
  ok("placeholder expiry -> 'End date unavailable'", ev("countdown(DATA.deals.find(d=>d.id==='keep3')).text") === "End date unavailable");
  ok("evergreen -> Ongoing", ev("countdown(DATA.deals.find(d=>d.id==='keep4')).text") === "Ongoing");
  ok("5d offer -> real countdown with digits", /\d/.test(ev("countdown(DATA.deals.find(d=>d.id==='keep5')).text")));
  ok("Ending tab still routes (mode computed)", ["3d","7d"].includes(ev("endingMode()")));

  console.log("\nBanner provenance:");
  resetToSeed();
  setLive(() => Promise.reject(new Error("offline")));
  await ev("fetchLive(true)"); await flush();
  ev("renderBanner()");
  const bannerHtml = getEl("#banner").innerHTML;
  ok("fallback banner names the sample list", /built-in sample/i.test(bannerHtml));
  ok("fallback banner offers a retry button", /id="retryLive"/.test(bannerHtml));
  ok("provenance still not live after failure", ev("dataProvenance") === null);
  setLive(() => okJson(payload([deal("Z")])));
  await ev("fetchLive(true)"); await flush();
  ev("renderBanner()");
  ok("provenance live after success", ev("dataProvenance") === "live");
  ok("fallback banner gone once live", !/built-in sample/i.test(getEl("#banner").innerHTML));

  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(1); });
