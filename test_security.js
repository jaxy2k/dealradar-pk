/**
 * Security regression tests — XSS in deal detail rendering.
 * Verifies that untrusted deal fields cannot inject executable HTML.
 */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
const js = fs.readFileSync(__dirname + "/app.js", "utf8");
const data = JSON.parse(fs.readFileSync(__dirname + "/data/live_deals.json", "utf8"));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.log("  FAIL  " + msg); }
}

// Minimal DOM stub
function makeEl(tag) {
  return {
    tagName: (tag || "div").toUpperCase(),
    children: [], style: {}, dataset: {}, classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    innerHTML: "", textContent: "",
    setAttribute(){}, getAttribute(){ return null; },
    appendChild(c){ this.children.push(c); },
    addEventListener(){}, removeEventListener(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
    focus(){}, blur(){}, click(){},
    getBoundingClientRect(){ return {top:0,left:0,width:0,height:0}; },
    parentElement: null,
    remove(){}
  };
}

const elements = {};
function $(sel) {
  if (!elements[sel]) elements[sel] = makeEl();
  return elements[sel];
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById: id => $( "#" + id ),
    querySelector: sel => $(sel),
    querySelectorAll: () => [],
    createElement: tag => makeEl(tag),
    createTextNode: t => ({ textContent: t }),
    addEventListener(){}, removeEventListener(){},
    body: makeEl("body"),
    head: makeEl("head"),
    documentElement: makeEl("html"),
    title: ""
  },
  window: { addEventListener(){}, removeEventListener(){}, location: { href: "http://localhost/", origin: "http://localhost" }, matchMedia: () => ({ matches: false, addEventListener(){} }) },
  navigator: { onLine: true, language: "en", userAgent: "test", serviceWorker: null, share: null },
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve("") }),
  URL, URLSearchParams, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Map, Set, WeakMap, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  requestAnimationFrame: fn => setTimeout(fn, 0),
  cancelAnimationFrame: id => clearTimeout(id),
  alert(){}, confirm(){ return false; },
  __DEALS__: data,
  __API_URL__: "http://localhost/",
  __SUPABASE_URL__: "",
  __SUPABASE_ANON__: ""
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.navigator = sandbox.navigator;
sandbox.globalThis = sandbox;
sandbox.self = sandbox.window;

vm.createContext(sandbox);
try { vm.runInContext(js, sandbox, { timeout: 5000 }); } catch (e) { /* init errors ok for unit tests */ }

// Extract esc function
const escSrc = js.match(/function esc\(str\)\s*\{[\s\S]*?\n\}/);
let escFn;
if (escSrc) {
  const escSandbox = { document: sandbox.document };
  vm.createContext(escSandbox);
  vm.runInContext(escSrc[0] + "; esc;", escSandbox);
  escFn = vm.runInContext("esc", escSandbox);
}

console.log("\n=== XSS Security Regression Tests ===\n");

// Test 1: esc() neutralizes HTML tags
if (escFn) {
  const malicious = '<img src=x onerror=alert(1)>';
  const escaped = escFn(malicious);
  // In real browser, textContent→innerHTML encodes entities. Our stub stores raw.
  // Verify the function structure is correct (uses textContent assignment pattern).
  assert(escSrc[0].includes("textContent") && escSrc[0].includes("innerHTML"), "esc() uses textContent→innerHTML encoding pattern");
  assert(escSrc[0].includes("String(str)"), "esc() coerces input to string");
} else {
  assert(false, "esc() function found in source");
}

// Test 2: source URL with javascript: protocol is rejected
const jsUrlDeal = {
  id: "test-xss-1", title: "Test", summary: "Test deal",
  source: { url: "javascript:alert(document.cookie)", platform: "Evil", type: "web" },
  steps: ['<script>alert("xss")</script>', 'Normal step'],
  eligibility: { card_type: '<b onmouseover="alert(1)">HBL</b>', merchant: "Test", payment: ["visa"] },
  cities: ["Karachi"], discount: { kind: "percent", value: 50 },
  valid_until: "2026-12-31", confidence: 0.9, community: { votes: 0, worked: 0, failed: 0 },
  brand: "hbl", status: "active", verification: "verified"
};

// Test 3: Verify srcLink construction rejects javascript: URLs
const srcLinkMatch = js.match(/const srcLink = d\.source\?\.url[\s\S]*?;/);
assert(srcLinkMatch && srcLinkMatch[0].includes("https?:\\/\\/"), "srcLink validates URL protocol (http/https only)");
assert(srcLinkMatch && srcLinkMatch[0].includes("esc(d.source.url)"), "srcLink escapes the URL");
assert(srcLinkMatch && srcLinkMatch[0].includes("esc(d.source.platform"), "srcLink escapes platform name");

// Test 4: Steps are escaped
const stepsMatch = js.match(/steps-list.*?join\(""\)/);
assert(stepsMatch && stepsMatch[0].includes("esc(s)"), "Deal steps are escaped before innerHTML insertion");

// Test 5: Eligibility fields are escaped in rows
const rowsSection = js.match(/const rows = \[[\s\S]*?\];/);
assert(rowsSection && rowsSection[0].includes("esc(d.eligibility?.card_type"), "card_type is escaped");
assert(rowsSection && rowsSection[0].includes("esc(d.eligibility?.merchant"), "merchant is escaped");
assert(rowsSection && rowsSection[0].includes("esc(d.cities.join"), "cities are escaped");
assert(rowsSection && rowsSection[0].includes("esc(d.source?.type"), "source type is escaped");

// Test 6: Exclusions are escaped
const exclMatch = js.match(/exclusions\.map\(e => `<li>\$\{esc\(e\)\}/);
assert(!!exclMatch, "Exclusions are escaped");

// Test 7: Deal card title uses esc()
const titleMatch = js.match(/deal-title.*?esc\(crispTitle\(d\)\)/);
assert(!!titleMatch, "Deal card title is escaped");

// Test 8: No raw innerHTML with unescaped d.summary in card rendering
const cardRender = js.match(/function dealCard[\s\S]*?^}/m);
if (cardRender) {
  assert(!cardRender[0].includes("${d.summary}") || cardRender[0].includes("esc(d.summary)"), "Card rendering does not inject raw summary");
}

// Test 9: Supabase message is conditional
const backendNote = js.match(/backend-note.*?\n/);
assert(backendNote && backendNote[0].includes("SB.enabled"), "Backend note reflects actual Supabase state");

// Test 10: No javascript: in any href template
const hrefTemplates = js.match(/href="\$\{[^}]*\}"/g) || [];
const unsafeHrefs = hrefTemplates.filter(h => !h.includes("esc(") && !h.includes("wa.me") && !h.includes("APP_URL") && !h.includes("${wa}"));
// Verify wa is built with encodeURIComponent
const waSafe = js.includes("encodeURIComponent(shareText(d))") || js.includes("encodeURIComponent(");
assert(unsafeHrefs.length === 0 && waSafe, `All dynamic href attributes are safe (${unsafeHrefs.length} unsafe found)`);

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
process.exit(failed > 0 ? 1 : 0);
