// Node harness: Phase 2B (Rozana Slice 1) regression tests.
// Loads the REAL repo app.js in a stubbed DOM and asserts the design contract:
//  (A) offer-type derivation mirrors scraper.classify_offer_type (R1-R8)
//  (B) type chips render only from real, classified data — never guessed
//  (C) expiry pills keep the Phase 2A truth model, now icon + inner .pill-tx
//  (D) card hierarchy renders no fake benefit ("Offer" / "0% OFF")
//  (E) baseFilter honours the new offer-type filter
//  (F) wallet onboarding nudges but never blocks discovery
//  (G) home filter row + 60s ticker contract
// NOTE: app.js declares NOW/state/DATA with let/const, which are NOT exposed as
// sandbox properties in a vm context; read/write them via runInContext (ev/set).
const fs = require("fs");
const vm = require("vm");

// Emoji guard: Extended_Pictographic covers the pictographs we removed from chrome
// (nav, cards, empty states, banners). Text nodes we deliberately leave alone
// (AI chat replies, detail-sheet copy) are not exercised by these assertions.
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u;

function makeEl() {
  const el = {
    style: {}, dataset: {}, value: "", innerHTML: "", className: "", id: "",
    _tc: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, blur() {}, scrollIntoView() {},
    click() {}, remove() {}, insertAdjacentHTML() {}, showPicker() {}, files: [],
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    getContext() { return {}; },
  };
  // esc() round-trips through textContent -> innerHTML on a detached <div>, so the
  // stub must mirror that or every escaped string reads back as "".
  Object.defineProperty(el, "textContent", {
    get() { return el._tc; },
    set(v) { el._tc = String(v); el.innerHTML = el._tc; },
  });
  return el;
}

// Selector- and id-cached elements so tests can read back what a renderer wrote
// (e.g. $("#tabbar").innerHTML after syncTabs()).
const bySel = {};
const elFor = key => (bySel[key] || (bySel[key] = makeEl()));

const FIXED_NOW = Date.UTC(2026, 9, 18, 6, 0, 0); // 2026-10-18T06:00Z
const storeMap = {};
const intervals = [];
const tickTargets = [];
const sandbox = {
  console,
  setTimeout: () => 0, setInterval: (fn) => { intervals.push(fn); return 0; },
  clearTimeout: () => {}, clearInterval: () => {},
  document: {
    querySelector: sel => elFor(sel), querySelectorAll: sel => (sel === "[data-countdown]" ? tickTargets : []),
    createElement: () => makeEl(), addEventListener() {}, removeEventListener() {},
    body: makeEl(), documentElement: makeEl(), head: makeEl(),
    getElementById: id => elFor("#" + id), readyState: "complete",
    visibilityState: "visible", characterSet: "UTF-8",
  },
  localStorage: {
    getItem: k => (k in storeMap ? storeMap[k] : null),
    setItem: (k, v) => { storeMap[k] = String(v); }, removeItem: k => { delete storeMap[k]; },
  },
  navigator: { serviceWorker: null, onLine: true, language: "en", vibrate: () => {} },
  location: { href: "http://localhost/", origin: "http://localhost", hostname: "localhost", protocol: "http:", search: "" },
  fetch: () => Promise.reject(new Error("offline")),
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  Image: function () { return { setAttribute() {}, addEventListener() {} }; },
  alert: () => {}, confirm: () => false, prompt: () => "", requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addListener() {} }),
  addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
sandbox.Date = new Proxy(Date, { construct(t, a) { return a.length ? new t(...a) : new t(FIXED_NOW); } });
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
try { vm.runInContext(src, sandbox, { filename: "app.js" }); }
catch (e) { console.error("LOAD ERROR:", e.message); process.exit(1); }

const ev = expr => vm.runInContext(expr, sandbox);
const set = (name, val) => vm.runInContext(`${name} = ${JSON.stringify(val)}`, sandbox);
if (new Date(ev("NOW")).getTime() !== FIXED_NOW) ev(`NOW = new Date(${FIXED_NOW})`);

let PASS = 0, FAIL = 0;
function ok(name, cond) { if (cond) { PASS++; console.log("  PASS  " + name); } else { FAIL++; console.log("  FAIL  " + name); } }

function dPlus(days, extra) {
  const dt = new Date(FIXED_NOW + days * 86400000);
  const iso = dt.toISOString().slice(0, 10);
  return Object.assign({ id: "x", status: "active", discount: { kind: "percent", value: 10 },
    eligibility: { payment: ["any"] }, cities: ["All Pakistan"], category: "food", brand: "b",
    title: "t", summary: "s", valid_until: iso }, extra || {});
}
function resetState(o) {
  ev(`state.city=${JSON.stringify((o && o.city) || "All")}; state.cat="all"; state.q=""; state.otype="all";`);
  ev(`state.hiddenBrands=new Set(); state.myPay=new Set(${JSON.stringify((o && o.myPay) || [])});`);
  ev(`state.saved=new Set(${JSON.stringify((o && o.saved) || [])});`);
  ev(`state.walletNudgeDismissed=${JSON.stringify(!!(o && o.dismissed))}; state.onboarded=true;`);
  ev(`state.tab="home"; state.feedRendered=true;`);
}
set("DATA", { deals: [], brands: [{ id: "b", name: "B Bank", color: "#123", brand_type: "bank" }], meta: {} });
ev("brandMap.clear()");

const deriveOfferType = ev("deriveOfferType"), offerTypeChip = ev("offerTypeChip"),
      expiryPillInner = ev("expiryPillInner"), dealCard = ev("dealCard"),
      baseFilter = ev("baseFilter"), countdown = ev("countdown"), expiryState = ev("expiryState"),
      renderWalletNudge = ev("renderWalletNudge"), typeFilterRow = ev("typeFilterRow"),
      ic = ev("ic"), t = ev("t"), esc = ev("esc");

// ------------------------------------------------------------------ A
console.log("\nA — offer-type derivation mirrors scraper.classify_offer_type:");
ok("R1 upstream offer_type wins", deriveOfferType(dPlus(5, { offer_type: "PRODUCT_DEAL" })) === "PRODUCT_DEAL");
ok("R1 upstream honoured over payment", deriveOfferType(dPlus(5, { offer_type: "WALLET_OFFER", eligibility: { payment: ["visa"] } })) === "WALLET_OFFER");
ok("R2 news source never typed", deriveOfferType(dPlus(5, { source: { type: "news" }, eligibility: { payment: ["easypaisa"] } })) === null);
ok("R2 brand_type=news never typed", deriveOfferType(dPlus(5, { brand_type: "news" })) === null);
ok("R3 wallet+card conflict -> null", deriveOfferType(dPlus(5, { eligibility: { payment: ["jazzcash", "visa"] } })) === null);
ok("R4 easypaisa -> WALLET_OFFER", deriveOfferType(dPlus(5, { eligibility: { payment: ["easypaisa"] } })) === "WALLET_OFFER");
// parity trap: "jazzcash_debit" contains the CARD marker "debit" but is a wallet token.
ok("R4 wallet token beats card marker", deriveOfferType(dPlus(5, { eligibility: { payment: ["jazzcash_debit"] } })) === "WALLET_OFFER");
ok("R4 easypaisa_debit -> WALLET_OFFER", deriveOfferType(dPlus(5, { eligibility: { payment: ["easypaisa_debit"] } })) === "WALLET_OFFER");
ok("R5 credit -> BANK_CARD_OFFER", deriveOfferType(dPlus(5, { eligibility: { payment: ["credit"] } })) === "BANK_CARD_OFFER");
ok("R5 visa+any -> BANK_CARD_OFFER", deriveOfferType(dPlus(5, { eligibility: { payment: ["any", "visa"] } })) === "BANK_CARD_OFFER");
ok("R5 mastercard -> BANK_CARD_OFFER", deriveOfferType(dPlus(5, { eligibility: { payment: ["master"] } })) === "BANK_CARD_OFFER");
// R6: a bank-brand offer with no payment data is NOT a card offer.
ok("R6 bank brand w/o payment -> null", deriveOfferType(dPlus(5, { brand_type: "bank", eligibility: { payment: [] } })) === null);
ok("R6 bank brand + 'any' -> null", deriveOfferType(dPlus(5, { brand_type: "bank", eligibility: { payment: ["any"] } })) === null);
ok("R7 food + no payment -> FOOD_PROMOTION", deriveOfferType(dPlus(5, { category: "food", eligibility: { payment: [] } })) === "FOOD_PROMOTION");
ok("R7 food + 'any' -> FOOD_PROMOTION", deriveOfferType(dPlus(5, { category: "food", eligibility: { payment: ["any"] } })) === "FOOD_PROMOTION");
ok("R5 beats R7 (food + credit)", deriveOfferType(dPlus(5, { category: "food", eligibility: { payment: ["credit"] } })) === "BANK_CARD_OFFER");
ok("R8 unclassifiable -> null (never guess)", deriveOfferType(dPlus(5, { category: "shopping", eligibility: { payment: ["any"] } })) === null);
ok("R8 non-food + no payment -> null", deriveOfferType(dPlus(5, { category: "fuel", eligibility: { payment: [] } })) === null);

// ------------------------------------------------------------------ B
console.log("\nB — type chips render only from classified data:");
const bankChip = offerTypeChip(dPlus(5, { eligibility: { payment: ["visa"] } }));
ok("chip carries real label text", bankChip.includes(esc(t("otBank"))));
ok("chip is a line icon, not emoji", !EMOJI.test(bankChip) && /<svg class="ic"/.test(bankChip) && /use href="#ic-/.test(bankChip));
ok("chip class is type-specific", /ot-chip ot-bank/.test(bankChip));
ok("wallet chip uses wallet class", /ot-chip ot-wallet/.test(offerTypeChip(dPlus(5, { eligibility: { payment: ["jazzcash"] } }))));
ok("no chip when unclassified", offerTypeChip(dPlus(5, { eligibility: { payment: ["any"] }, category: "shopping" })) === "");
ok("no chip for news", offerTypeChip(dPlus(5, { brand_type: "news", eligibility: { payment: ["easypaisa"] } })) === "");

// ------------------------------------------------------------------ C
console.log("\nC — expiry pill keeps the Phase 2A truth model:");
const pillSoon = expiryPillInner(dPlus(2));
ok("soon -> clock icon", pillSoon.includes('#ic-clock') && pillSoon.includes(esc(countdown(dPlus(2)).text)));
ok("expired -> clock icon", expiryPillInner(dPlus(-2)).includes('#ic-clock'));
ok("longdated -> calendar icon", expiryPillInner(dPlus(120)).includes('#ic-calendar'));
ok("evergreen -> check icon", expiryPillInner(dPlus(0, { status: "evergreen" })).includes('#ic-check'));
ok("missing expiry -> info icon", expiryPillInner(dPlus(0, { valid_until: null })).includes('#ic-info'));
ok("placeholder date -> info icon", expiryPillInner(dPlus(400)).includes('#ic-info'));
ok("pill text is always wrapped in .pill-tx",
   [dPlus(2), dPlus(-2), dPlus(120), dPlus(0, { status: "evergreen" }), dPlus(0, { valid_until: null }), dPlus(400)]
     .every(d => /<span class="pill-tx">/.test(expiryPillInner(d))));
ok("states unchanged by redesign (soon/longdated/placeholder/missing/ongoing)",
   expiryState(dPlus(2)) === "soon" && expiryState(dPlus(120)) === "longdated" &&
   expiryState(dPlus(400)) === "placeholder" && expiryState(dPlus(0, { valid_until: null })) === "missing" &&
   expiryState(dPlus(0, { status: "evergreen" })) === "ongoing");

// ------------------------------------------------------------------ D
console.log("\nD — card hierarchy never invents value:");
resetState();
const noDisc = dealCard(dPlus(5, { discount: null }));
ok("missing discount renders no .disc", !/<span class="disc">/.test(noDisc));
ok("missing discount never says 'Offer'", !/\bOffer\b/.test(noDisc));
const zeroDisc = dealCard(dPlus(5, { discount: { kind: "percent", value: 0 } }));
ok("0% discount renders no fake number", !/<span class="disc">/.test(zeroDisc) && !/0% OFF/.test(zeroDisc));
ok("real 20% renders benefit", /<span class="disc">/.test(dealCard(dPlus(5, { discount: { kind: "percent", value: 20 } }))));
ok("free_delivery renders (a real benefit)", /<span class="disc">/.test(dealCard(dPlus(5, { discount: { kind: "free_delivery", value: 0 } }))));
ok("bogo renders", /<span class="disc">/.test(dealCard(dPlus(5, { discount: { kind: "bogo", value: 0 } }))));
ok("cap shown as muted caption", /class="cap-txt"/.test(dealCard(dPlus(5, { discount: { kind: "percent", value: 20, cap: 500 } }))));
const card = dealCard(dPlus(5, { eligibility: { payment: ["easypaisa"] }, merchant_info: { name: "Karachi Grill" } }));
ok("brand line + title + pill order kept", /class="deal-brand"/.test(card) && /<h3 class="deal-title">/.test(card) && /class="pill /.test(card));
ok("merchant rendered separately from brand", /class="mn">/.test(card));
ok("benefit badge embedded in card brand row", /disc-badge/.test(dealCard(dPlus(5, { discount: { kind: "percent", value: 20 } }))));
ok("card exposes .pill-tx for the 60s ticker", /<span class="pill-tx">/.test(card));
ok("affordance is an icon, not emoji", /class="deal-arrow"/.test(card) && !EMOJI.test(card));
resetState({ myPay: ["easypaisa"] });
ok("your-card match flag on eligible deal", /class="deal match"/.test(dealCard(dPlus(5, { eligibility: { payment: ["easypaisa"] } }))));
resetState();
ok("no match flag without wallet selection", !/class="deal match"/.test(dealCard(dPlus(5, { eligibility: { payment: ["easypaisa"] } }))));

// ------------------------------------------------------------------ E
console.log("\nE — offer-type filter feeds baseFilter:");
const walletD = dPlus(5, { id: "w", eligibility: { payment: ["easypaisa"] } });
const bankD = dPlus(5, { id: "k", eligibility: { payment: ["visa"] } });
const plainD = dPlus(5, { id: "p", category: "shopping", eligibility: { payment: ["any"] } });
resetState();
ok("otype=all keeps everything real", baseFilter(walletD) && baseFilter(bankD) && baseFilter(plainD));
ev('state.otype="WALLET_OFFER"');
ok("wallet filter keeps wallet", baseFilter(walletD) === true);
ok("wallet filter drops bank", baseFilter(bankD) === false);
ok("wallet filter drops unclassified", baseFilter(plainD) === false);
ev('state.otype="BANK_CARD_OFFER"');
ok("bank filter keeps bank only", baseFilter(bankD) === true && baseFilter(walletD) === false);
ev('state.otype="FOOD_PROMOTION"');
ok("food filter excludes payment-typed offers", baseFilter(walletD) === false && baseFilter(bankD) === false);
resetState();

// ------------------------------------------------------------------ F
console.log("\nF — wallet onboarding nudges, never blocks:");
resetState();
const nudge = renderWalletNudge();
ok("nudge shown for un-set-up user", /class="wallet-nudge"/.test(nudge) && nudge.includes(esc(t("nudgeText"))));
ok("nudge has set-up + dismiss actions", /id="nudgeSetup"/.test(nudge) && /id="nudgeDismiss"/.test(nudge));
ok("nudge uses an icon, not emoji", !EMOJI.test(nudge));
resetState({ myPay: ["jazzcash"] });
ok("nudge hidden once wallets/cards set", renderWalletNudge() === "");
resetState({ dismissed: true });
ok("nudge hidden after dismiss", renderWalletNudge() === "");
resetState();

// ------------------------------------------------------------------ G
console.log("\nG — home filter row + ticker contract:");
ok("filter row hidden when nothing classified", typeFilterRow([plainD]) === "");
const row = typeFilterRow([walletD, bankD, plainD]);
ok("filter row lists only present types", /data-otype="WALLET_OFFER"/.test(row) && /data-otype="BANK_CARD_OFFER"/.test(row) && !/data-otype="FOOD_PROMOTION"/.test(row));
ok("filter row keeps an explicit all-types reset", /data-otype="all"/.test(row));
ok("filter row count is real", />2<|>1</.test(row));
ev('state.otype="WALLET_OFFER"');
ok("active pill reflects state", /ot-pill active" aria-pressed="true" data-otype="WALLET_OFFER"/.test(typeFilterRow([walletD, bankD])));
resetState();

// The 60s ticker must rewrite only the inner text so the pill icon survives.
set("DATA", { deals: [dPlus(2, { id: "tick1" })], brands: [{ id: "b", name: "B Bank", color: "#123" }], meta: {} });
ev("startTicking()");
const txEl = makeEl();
const pillEl = makeEl();
pillEl.dataset.countdown = "tick1";
pillEl.querySelector = sel => (sel === ".pill-tx" ? txEl : null);
tickTargets.length = 0; tickTargets.push(pillEl);
intervals.forEach(fn => { try { fn(); } catch (e) { /* other timers */ } });
ok("ticker updates pill text via .pill-tx", txEl.textContent === countdown(dPlus(2, { id: "tick1" })).text);
ok("ticker does not clobber the icon markup", pillEl._tc === "");
const legacy = makeEl();
legacy.dataset.countdown = "tick1";
legacy.querySelector = () => null;          // no .pill-tx -> guarded fallback
tickTargets.length = 0; tickTargets.push(legacy);
intervals.forEach(fn => { try { fn(); } catch (e) {} });
ok("ticker falls back to textContent when no .pill-tx", legacy._tc.length > 0);

// ------------------------------------------------------------------ H
console.log("\nH — icon helper + tabbar chrome:");
const svg = ic("clock");
ok("ic() emits a sprite reference with no label",
   /^<svg class="ic" aria-hidden="true"><use href="#ic-clock"\/?><\/svg>$/.test(svg));
ok("ic() passes extra classes", /class="ic urgent"/.test(ic("clock", "urgent")));
ev('syncTabs()');
const bar = elFor("#tabbar").innerHTML;
ok("tabbar is JS-populated with line icons", /<svg class="ic"/.test(bar) && /class="tab-lbl">/.test(bar));
ok("tabbar has no emoji", !EMOJI.test(bar));
ok("active tab is aria-current", /aria-current="page"/.test(bar));
ev('state.tab="explore"; syncTabs();');
const bar2 = elFor("#tabbar").innerHTML;
ok("aria-current only on the active tab",
   (bar2.match(/aria-current/g) || []).length === 1 && /data-tab="explore" aria-current="page"/.test(bar2));
ev('state.tab="home"; syncTabs();');

// index.html must still contain every sprite id the JS references.
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const used = [...src.matchAll(/ic\("([a-z-]+)"/g)].map(m => m[1]);
const ids = [...html.matchAll(/<symbol id="ic-([a-z-]+)"/g)].map(m => m[1]);
ok("every ic() name has a sprite symbol", used.every(u => ids.includes(u)));
ok("sprite has no duplicate symbol ids", new Set(ids).size === ids.length);
ok("index.html tabbar ships empty (JS owns it)", /<nav class="tabbar"[^>]*id="tabbar"[^>]*><\/nav>/.test(html));
ok("meta theme-colour is the ink masthead", /theme-color" content="#15252C"/.test(html));
const man = JSON.parse(fs.readFileSync(__dirname + "/manifest.json", "utf8"));
ok("manifest colours match the meta theme",
   man.theme_color === "#15252C" && man.background_color === "#15252C");

// ------------------------------------------------------------------ I
console.log("\nI — Everyday Savings Edit progressive disclosure + card semantics:");
resetState();
const cssNow = fs.readFileSync(__dirname + "/styles.css", "utf8");
ok("discovery editorial area exists", /<section id="discovery"/.test(html) && typeof ev("renderDiscovery") === "function");
ev('state.tab="explore"; renderDiscovery();');
ok("community limitation is explicit", !/Spotted/.test(elFor("#tabbar").innerHTML) && typeof ev("renderSpottedTab") === "function");
ev('state.tab="home"; state.city="Lahore"; renderChips();');
ok("city select is a visible compact control", /id="citySelect"/.test(elFor("#filterRow").innerHTML) && /<nav class="cat-tabs scroll" id="catTabs"/.test(html));
ok("category tabs rendered on home tab", /id="catTabs"/.test(html) && /renderCatTabs|catTabs/.test(src));
ok("filter selects are live controls", /e\.target\.id === "citySelect"/.test(src) && /e\.target\.id === "otypeSelect"/.test(src));
ev('state.otype="WALLET_OFFER"');
ok("type pills expose pressed state", /aria-pressed="true"/.test(typeFilterRow([walletD])));
const semanticCard = dealCard(dPlus(5, { eligibility: { payment: ["visa"], card_type: "Very Long Specific Premium Card Name" } }));
ok("card is keyboard-operable", /tabindex="0"/.test(semanticCard) && /role="button"/.test(semanticCard) && /aria-label="t"/.test(semanticCard));
ok("card carries truthful offer class", /data-offer="BANK_CARD_OFFER"/.test(semanticCard));
ok("full eligibility survives visual truncation", /title="Very Long Specific Premium Card Name"/.test(semanticCard));
ok("benefit cap lives in the deal-sub row", /deal-sub[\s\S]*cap-txt/.test(dealCard(dPlus(5, { discount: { kind: "percent", value: 20, cap: 500 } }))));
ok("feature only uses a supplied HTTPS cover", dealCard(dPlus(5, { merchant_info: { cover: "https://example.com/real.jpg" } }), { featured: true }).includes("ticket-cover"));
ok("no cover is invented for missing imagery", !dealCard(dPlus(5), { featured: true }).includes("ticket-cover"));
ok("insecure image URL cannot become a cover", !dealCard(dPlus(5, { merchant_info: { cover: "javascript:alert(1)" } }), { featured: true }).includes("ticket-cover"));
ok("wallet panel explains local-only setup", /No card numbers or bank login/.test(ev("renderWalletPanel()") || elFor("#walletPanel").innerHTML));
ok("community feedback has an honest sync note", /Community sharing is not connected/.test(src) && /Saved on this device/.test(src));
ok("reduced motion is supported", /prefers-reduced-motion:reduce/.test(cssNow));
ok("RTL uses logical borders and text flow", /\[dir="rtl"\] \.deal\{border-radius/.test(cssNow) && /border-inline-start:3px/.test(cssNow));

console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL ? 1 : 0);
