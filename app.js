/* DealRadar PK v3 — full feature set:
   heat ranking, tabs, wallet personalisation, community actions, WhatsApp share,
   submission flow, how-to-avail steps, savings tracker, merchant grouping,
   live countdowns, notification center, deal comparison, report expired,
   merchant trust scores, referral loop. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// XSS protection: escape all user-provided strings before innerHTML
function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

const store = {
  get(k, fb) { try { return localStorage.getItem(k) ?? fb; } catch (e) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

// Live API configuration — set to your server URL for live data
const API_URL = window.__API_URL__ || "";  // e.g. "https://your-server.com" or "" for same-origin

// i18n: English / Urdu
const I18N = {
  en: {
    tag: "Trending · {n} live offers",
    search: "Search deals, brands, cities…",
    wallet: "My wallets & cards ({n})",
    walletHint: 'Pick what you carry — matching deals get a badge and rise in "For You".',
    flashBanner: "{n} flash deal{s} ending within 48h",
    details: "Details", hot: "Hot", voted: "Voted", worked: "Worked", alert: "Alert", saved: "Saved", share: "Share",
    compare: "Compare", activeDeals: "{n} active deals",
    trending: "Trending", foryou: "For You", ending: "Ending", evergreen: "Always On", spotted: "Spotted",
    verified: "✓ Verified", unverified: "Unverified",
    officialPage: "official page", viaSocial: "via {p}",
    minSpend: "min Rs {n}", capRs: "cap Rs {n}",
    workedRate: "{n}% worked",
    emptyTrending: "No trending deals right now. Check back soon!",
    emptyForYou: "Add your wallets & cards (👛) to see deals matched to you.",
    emptyForYouSet: "No deals match your selected cards yet. Check back soon!",
    emptyEnding: "No deals ending soon. You're all caught up!",
    emptyEvergreen: "No always-on deals right now.",
    emptySpotted: "No community-spotted deals yet. Be the first to spot one!",
    howToAvail: "How to avail", terms: "Terms & exclusions",
    shareOnWhatsApp: "⇪ Share on WhatsApp", reportExpired: "🚫 Report expired",
    obTitle1: "Never Miss a Deal Again",
    obDesc1: "We track limited-time discounts from Easypaisa, JazzCash, HBL, Daraz, Foodpanda & more — across all of Pakistan.",
    obTitle2: "Only What Works for You",
    obDesc2: "Tell us your cards & wallets. We'll surface deals you can actually use — ranked by urgency so you never miss the window.",
    obTitle3: "Powered by the Community",
    obDesc3: "Spotted a deal? Share it. Worked? Confirm it. The community keeps every offer fresh, verified, and trustworthy.",
    skip: "Skip", next: "Next →", getStarted: "Get Started", back: "← Back",
    savings: "You've saved ~Rs {n} with deals you confirmed",
    notifications: "🔔 Notifications",
    langToggle: "اردو",
    allCities: "🌍 All cities", ongoing: "ongoing", expired: "expired",
    dLeft: "{n}d left", hLeft: "{h}h {m}m", anyPayment: "Any payment",
    workedToast: "👍 Worked! Est. saved Rs {n}", alertSet: "🔔 We'll alert you before it expires",
    alertRemoved: "Alert removed", hotToast: "▲ Marked as hot",
    addedSpotted: "✓ Added to Spotted — pending verification",
    all: "All",
    exitTitle: "Leaving so soon?", exitDesc: "There are still deals out there waiting for you. Come back before they expire!", exitStay: "Keep Exploring", exitLeave: "Leave",
    catFood: "Food", catShopping: "Shopping", catEcommerce: "E-commerce", catRetail: "Retail",
    catFuel: "Fuel", catTravel: "Travel", catTelecom: "Telecom", catGrocery: "Grocery",
    catElectronics: "Electronics", catFashion: "Fashion", catUtilities: "Utilities",
    dealHidden: "Deal hidden — 3+ reports",
    reported: "Reported ({n}/3). Will hide after 3.",
    notifAlert: "Alert set for \"{title}\""
  },
  ur: {
    tag: "ٹرینڈنگ · {n} لائیو آفرز",
    search: "ڈیلز، برانڈز، شہر تلاش کریں…",
    wallet: "میرے والٹس اور کارڈز ({n})",
    walletHint: "اپنے کارڈز منتخب کریں — میچنگ ڈیلز 'آپ کے لیے' میں اوپر آئیں گی۔",
    flashBanner: "{n} فلیش ڈیلز 48 گھنٹے میں ختم ہو رہی ہیں",
    details: "تفصیل", hot: "ہاٹ", voted: "ووٹ", worked: "کام کیا", alert: "الرٹ", saved: "سیوڈ", share: "شیئر",
    compare: "موازنہ", activeDeals: "{n} ایکٹو ڈیلز",
    trending: "ٹرینڈنگ", foryou: "آپ کے لیے", ending: "ختم ہو رہی", evergreen: "ہمیشہ", spotted: "اسپاٹڈ",
    verified: "✓ تصدیق شدہ", unverified: "غیر تصدیق شدہ",
    officialPage: "آفیشل پیج", viaSocial: "{p} سے",
    minSpend: "کم از کم Rs {n}", capRs: "کیپ Rs {n}",
    workedRate: "{n}% کام کیا",
    emptyTrending: "ابھی کوئی ٹرینڈنگ ڈیل نہیں۔ جلد واپس آئیں!",
    emptyForYou: "اپنے والٹس اور کارڈز (👛) شامل کریں تاکہ آپ سے میچنگ ڈیلز دکھیں۔",
    emptyForYouSet: "آپ کے منتخب کارڈز سے کوئی ڈیل میچ نہیں ہو رہی۔ جلد واپس آئیں!",
    emptyEnding: "کوئی ڈیل جلد ختم نہیں ہو رہی۔ آپ اپ ٹو ڈیٹ ہیں!",
    emptyEvergreen: "ابھی کوئی ہمیشہ والی ڈیل نہیں۔",
    emptySpotted: "ابھی کوئی کمیونٹی ڈیل نہیں۔ پہلے آپ اسپاٹ کریں!",
    howToAvail: "کیسے حاصل کریں", terms: "شرائط و ضوابط",
    shareOnWhatsApp: "⇪ واٹس ایپ پر شیئر کریں", reportExpired: "🚫 ختم شدہ رپورٹ کریں",
    obTitle1: "کوئی ڈیل مس نہ کریں",
    obDesc1: "ہم ایزی پیسہ، جاز کیش، ایچ بی ایل، داراز، فوڈ پانڈا اور مزید کی محدود وقت کی ڈسکاؤنٹس ٹریک کرتے ہیں — پورے پاکستان میں۔",
    obTitle2: "صرف وہ جو آپ کے کام آئے",
    obDesc2: "اپنے کارڈز اور والٹس بتائیں۔ ہم وہی ڈیلز دکھائیں گے جو آپ استعمال کر سکتے ہیں — ارجنسی کے حساب سے۔",
    obTitle3: "کمیونٹی سے چلنے والا",
    obDesc3: "ڈیل دیکھی؟ شیئر کریں۔ کام کی؟ تصدیق کریں۔ کمیونٹی ہر آفر کو تازہ اور قابل اعتماد رکھتی ہے۔",
    skip: "چھوڑیں", next: "اگلے →", getStarted: "شروع کریں", back: "← واپس",
    savings: "آپ نے تصدیق شدہ ڈیلز سے ~Rs {n} بچائے",
    notifications: "🔔 اطلاعات",
    langToggle: "EN",
    allCities: "🌍 تمام شہر", ongoing: "جاری", expired: "ختم شدہ",
    dLeft: "{n} دن باقی", hLeft: "{h} گھنٹے {m} منٹ", anyPayment: "کوئی بھی ادائیگی",
    workedToast: "👍 کام کیا! تخمینہ بچت Rs {n}", alertSet: "🔔 ختم ہونے سے پہلے ہم آپ کو الرٹ کریں گے",
    alertRemoved: "الرٹ ہٹا دیا گیا", hotToast: "▲ ہاٹ مارک کیا گیا",
    addedSpotted: "✓ اسپاٹڈ میں شامل — تصدیق زیر عمل",
    all: "تمام",
    exitTitle: "اتنی جلدی جا رہے ہیں؟", exitDesc: "ابھی بھی ڈیلز آپ کا انتظار کر رہی ہیں۔ ختم ہونے سے پہلے واپس آئیں!", exitStay: "جاری رکھیں", exitLeave: "جائیں",
    catFood: "کھانا", catShopping: "شاپنگ", catEcommerce: "ای کامرس", catRetail: "ریٹیل",
    catFuel: "فیول", catTravel: "سفر", catTelecom: "ٹیلی کام", catGrocery: "گروسری",
    catElectronics: "الیکٹرانکس", catFashion: "فیشن", catUtilities: "بلز",
    dealHidden: "ڈیل چھپا دی گئی — 3+ رپورٹس",
    reported: "رپورٹ کی گئی ({n}/3)۔ 3 کے بعد چھپ جائے گی۔",
    notifAlert: "الرٹ سیٹ \"{title}\""
  }
};

let LANG = store.get("dr_lang", "en");
function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
function toggleLang() {
  LANG = LANG === "en" ? "ur" : "en";
  store.set("dr_lang", LANG);
  document.documentElement.dir = LANG === "ur" ? "rtl" : "ltr";
  document.documentElement.lang = LANG;
  renderAll(); renderWalletPanel(); renderBanner(); renderSavings();
}

const PAY_OPTIONS = [
  ["easypaisa_wallet", "Easypaisa wallet"], ["easypaisa_debit", "Easypaisa debit"],
  ["jazzcash_app", "JazzCash app"], ["jazzcash_qr", "JazzCash QR"], ["jazzcash_debit", "JazzCash debit"],
  ["hbl_debit", "HBL debit"], ["hbl_credit", "HBL credit"], ["bankalfalah_card", "Bank Alfalah card"],
  ["meezan_debit", "Meezan debit"], ["faysal_debit", "Faysal debit"],
  ["scb_credit", "Standard Chartered credit"], ["visa_card", "Visa card"], ["any", "Any / cash"]
];
const PAY_LABELS = Object.fromEntries(PAY_OPTIONS);
function payLabel(codes) {
  if (!codes || !codes.length) return t("anyPayment");
  return codes.map(c => PAY_LABELS[c] || c.replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase())).join(" · ");
}

const catKey = { all: "all", food: "catFood", shopping: "catShopping", ecommerce: "catEcommerce", retail: "catRetail", fuel: "catFuel", travel: "catTravel", telecom: "catTelecom", grocery: "catGrocery", electronics: "catElectronics", fashion: "catFashion", utilities: "catUtilities" };
const CATS = [["all", "All"], ["food", "Food"], ["shopping", "Shopping"], ["ecommerce", "E-commerce"], ["retail", "Retail"], ["fuel", "Fuel"], ["travel", "Travel"], ["telecom", "Telecom"], ["grocery", "Grocery"], ["electronics", "Electronics"], ["fashion", "Fashion"], ["utilities", "Utilities"]];
const CITIES = ["All", "Karachi", "Lahore", "Islamabad", "Rawalpindi", "Multan", "Faisalabad"];
const TABS = {
  trending: { label: "Trending", hint: "🔥 Ranked by heat — urgency, votes, trust." },
  foryou: { label: "For You", hint: "🎯 Matched to your wallets & cards." },
  ending: { label: "Ending", hint: "⏳ Expiring within 3 days." },
  evergreen: { label: "Always On", hint: "♾️ Long-running offers & standing vouchers." },
  spotted: { label: "Spotted", hint: "👀 Community submissions. Tap ＋ to add." }
};

let NOW = new Date(); // Production: real time. Prototype: overridden by meta.now after data load.
const state = {
  tab: "trending", q: "", city: "All", cat: "all",
  myPay: new Set(JSON.parse(store.get("dr_pay", "[]"))),
  voted: new Set(JSON.parse(store.get("dr_voted", "[]"))),
  saved: new Set(JSON.parse(store.get("dr_saved", "[]"))),
  savings: JSON.parse(store.get("dr_savings", "0")),
  notifications: JSON.parse(store.get("dr_notifs", "[]")),
  onboarded: store.get("dr_onboarded", "false") === "true"
};
let DATA = null;
let tickInterval = null;

// ---- time ----

// ---- navigation stack & back button ----
const navStack = [];
let exitShown = false;

function pushNav(type) { navStack.push(type); updateBackBtn(); }
function popNav() { navStack.pop(); updateBackBtn(); }
function updateBackBtn() {
  const btn = $("#backBtn");
  if (!btn) return;
  btn.classList.toggle("visible", navStack.length > 0 || state.tab !== "trending" || state.q || state.city !== "All" || state.cat !== "all");
}

function goBack() {
  // 0. If exit dialog is showing → close it
  if ($("#exitOverlay") && $("#exitOverlay").classList.contains("show")) {
    hideExitDialog();
    return;
  }
  // 1. If sheet is open (deal detail, compare, notifications, submit) → close it
  if (!$("#sheet").classList.contains("hidden")) {
    closeSheet();
    popNav();
    return;
  }
  // 2. If wallet panel is open → close it
  if (!$("#walletPanel").classList.contains("hidden")) {
    $("#walletPanel").classList.add("hidden");
    popNav();
    return;
  }
  // 3. If search is active → clear search
  if (state.q) {
    state.q = ""; $("#q").value = "";
    renderFeed(); updateBackBtn();
    return;
  }
  // 4. If filters are active → clear filters
  if (state.city !== "All" || state.cat !== "all") {
    state.city = "All"; state.cat = "all";
    renderChips(); renderFeed(); updateBackBtn();
    return;
  }
  // 5. If not on trending tab → go to trending
  if (state.tab !== "trending") {
    state.tab = "trending"; state.feedRendered = false;
    syncTabs(); renderAll(); updateBackBtn();
    return;
  }
  // 6. On trending with no filters → show exit dialog
  showExitDialog();
}

function showExitDialog() {
  const overlay = $("#exitOverlay");
  if (!overlay) return;
  overlay.classList.add("show");
  // i18n
  if (LANG === "ur") {
    $("#exitTitle").textContent = "اتنی جلدی جا رہے ہیں؟";
    $("#exitDesc").textContent = "ابھی بھی ڈیلز آپ کا انتظار کر رہی ہیں۔ ختم ہونے سے پہلے واپس آئیں!";
    $("#exitStay").textContent = "جاری رکھیں";
    $("#exitLeave").textContent = "جائیں";
  } else {
    $("#exitTitle").textContent = "Leaving so soon?";
    $("#exitDesc").textContent = "There are still deals out there waiting for you. Come back before they expire!";
    $("#exitStay").textContent = "Keep Exploring";
    $("#exitLeave").textContent = "Leave";
  }
}

function hideExitDialog() {
  const overlay = $("#exitOverlay");
  if (overlay) overlay.classList.remove("show");
}

// Android WebView bridge: called from native onBackPressed
window.androidBack = function() { goBack(); };

function msLeft(d) { return new Date(d + "T23:59:59+05:00") - NOW; }
function daysUntil(d) { return Math.ceil(msLeft(d) / 86400000); }
function countdown(d) {
  const ms = msLeft(d);
  if (ms <= 0) return { text: t("expired"), cls: "red", ms: 0 };
  const days = Math.floor(ms / 86400000);
  if (days >= 2) return { text: t("dLeft", {n: days}), cls: days <= 3 ? "count" : "", ms };
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return { text: t("hLeft", {h: hrs, m: mins}), cls: "count red", ms };
}
function hoursSince(iso) { return (NOW - new Date(iso)) / 3600000; }

// ---- heat ----
const heatCache = new Map();
function computeHeat(d) {
  if (heatCache.has(d.id)) return heatCache.get(d.id);
  if (d.status === "evergreen") return 0;
  const days = Math.max(0, daysUntil(d.valid_until));
  const urgency = Math.min(1, Math.max(0, 1 - days / 30));
  const c = d.community || {};
  const rawPop = (c.votes || 0) + (c.saves || 0) + (c.worked || 0);
  const popularity = Math.min(1, rawPop / 800);
  const wf = c.worked || 0, ff = c.failed || 0;
  const trust = (wf + ff ? wf / (wf + ff) : 0.5) * (d.confidence || 0.5);
  const recency = Math.min(1, Math.max(0, 1 - hoursSince(d.source?.captured_at || NOW.toISOString()) / 168));
  return Math.round(100 * (0.40 * urgency + 0.25 * popularity + 0.20 * trust + 0.15 * recency));
}

// ---- merchant trust score ----
const trustCache = new Map();
function merchantTrust(brandId) {
  if (trustCache.has(brandId)) return trustCache.get(brandId);
  const deals = DATA.deals.filter(d => d.brand === brandId);
  let worked = 0, failed = 0;
  deals.forEach(d => { worked += d.community?.worked || 0; failed += d.community?.failed || 0; });
  const total = worked + failed;
  return total ? Math.round((worked / total) * 100) : null;
}

// ---- helpers ----
const brandMap = new Map();
function brandOf(id) {
  if (brandMap.has(id)) return brandMap.get(id);
  const found = DATA.brands.find(x => x.id === id) || { name: id, color: "#555", brand_brand_type: "brand" };
  brandMap.set(id, found);
  return found;
}
function discountLabel(disc) {
  if (!disc) return "Offer";
  if (disc.kind === "percent") return disc.value + "% OFF";
  if (disc.kind === "flat") return "Rs " + Number(disc.value).toLocaleString() + " OFF";
  if (disc.kind === "cashback") return "Rs " + disc.value + "/L cashback";
  if (disc.kind === "bogo") return "BUY 1 GET 1";
  if (disc.kind === "free_delivery") return "FREE delivery";
  if (disc.kind === "fixed_price") return "Rs " + Number(disc.value).toLocaleString();
  return "Offer";
}
function cityMatch(d) { return state.city === "All" || d.cities.includes("All Pakistan") || d.cities.includes(state.city); }
function payMatch(d) {
  const elig = d.eligibility?.payment || [];
  if (elig.includes("any")) return true;
  return [...state.myPay].some(p => elig.includes(p));
}
function isMine(d) { return state.myPay.size > 0 && payMatch(d); }
function isHidden(d) { return (d.community?.reports_expired || 0) >= 3; }

function baseFilter(d) {
  if (isHidden(d)) return false;
  if (!cityMatch(d)) return false;
  if (state.cat !== "all" && d.category !== state.cat) return false;
  const q = state.q.trim().toLowerCase();
  if (q) {
    const hay = (d.title + " " + d.summary + " " + brandOf(d.brand).name + " " + d.cities.join(" ") + " " + d.category).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function tabDeals() {
  const all = DATA.deals.filter(baseFilter);
  const byHeat = a => a.sort((x, y) => computeHeat(y) - computeHeat(x));
  switch (state.tab) {
    case "trending": return byHeat(all.filter(d => d.status !== "evergreen" && d.status !== "spotted"));
    case "foryou": return byHeat(all.filter(d => isMine(d) && d.status !== "evergreen"));
    case "ending": return all.filter(d => d.status !== "evergreen" && daysUntil(d.valid_until) >= 0 && daysUntil(d.valid_until) <= 3)
      .sort((a, b) => new Date(a.valid_until) - new Date(b.valid_until));
    case "evergreen": return all.filter(d => d.status === "evergreen").sort((a, b) => (b.community?.worked || 0) - (a.community?.worked || 0));
    case "spotted": return all.filter(d => d.status === "spotted").sort((a, b) => (b.community?.votes || 0) - (a.community?.votes || 0));
  }
  return all;
}

// ---- merchant grouping ----
function groupByMerchant(deals) {
  const groups = {};
  deals.forEach(d => {
    const key = d.brand;
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return groups;
}

// ---- notifications ----
function addNotification(msg) {
  state.notifications.unshift({ msg, time: NOW.toISOString(), read: false });
  if (state.notifications.length > 20) state.notifications.pop();
  store.set("dr_notifs", JSON.stringify(state.notifications));
  renderBell();
}

// ---- deal card ----
function dealCard(d) {
  const b = brandOf(d.brand);
  const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cd = countdown(d.valid_until);
  const heat = computeHeat(d);
  const mine = isMine(d);
  const urgent = daysUntil(d.valid_until) >= 0 && daysUntil(d.valid_until) < 1;
  const cap = d.discount?.cap ? `<span class="disc cap">cap Rs ${Number(d.discount.cap).toLocaleString()}</span>` : "";
  const minSpend = d.eligibility?.min_spend ? `<span class="pill count">${t("minSpend", {n: Number(d.eligibility.min_spend).toLocaleString()})}</span>` : "";
  const v = d.verification === "verified"
    ? `<span class="vbadge">${t("verified")}</span>` : `<span class="vbadge unv">${t("unverified")}</span>`;
  let srcPill;
  if (d.source?.type === "social") srcPill = `<span class="pill src-social">${t("viaSocial", {p: d.source.platform})}</span>`;
  else if (d.source?.type === "community") srcPill = `<span class="pill src-community">👀 ${d.community?.spotted_by || "community"}</span>`;
  else srcPill = `<span class="pill">${t("officialPage")}</span>`;
  const heatEl = heat > 0 ? `<span class="heat">🔥 ${heat}</span>` : "";
  const voted = state.voted.has(d.id);
  const voteCount = (d.community?.votes || 0) + (voted ? 1 : 0);
  const saved = state.saved.has(d.id);
  const trust = merchantTrust(d.brand);
  const trustEl = trust !== null ? `<span class="pill trust">${t("workedRate", {n: trust})}</span>` : "";

  // Logo: real image if available, else initials
  const logoHtml = b.logo
    ? `<div class="logo-badge" style="background:${b.color}"><img src="${b.logo}" alt="${b.name}" class="logo-img" loading="lazy"></div>`
    : `<div class="logo-badge" style="background:${b.color}">${initials}</div>`;

  let urgencyBar = "";
  if (d.status !== "evergreen") {
    const total = new Date(d.valid_until + "T23:59:59+05:00") - new Date(d.valid_from + "T00:00:00+05:00");
    const elapsed = NOW - new Date(d.valid_from + "T00:00:00+05:00");
    const pct = Math.min(100, Math.max(4, Math.round((elapsed / total) * 100)));
    const color = pct > 85 ? "var(--danger)" : pct > 60 ? "var(--warn)" : "var(--accent)";
    urgencyBar = `<div class="urgency-bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div>`;
  }

  const grad = d.visual?.gradient || ["#6b7280", "#d1d5db"];
  return `<article class="deal${mine ? " match" : ""}${urgent ? " urgent" : ""}" data-id="${d.id}">
    <div class="deal-visual" style="background:linear-gradient(135deg,${grad[0]}22,${grad[1]}11);border-bottom:1px solid ${grad[0]}33"></div>
    <div class="deal-top">
      ${logoHtml}
      <div class="deal-body">
        <h3 class="deal-title">${esc(d.title)}</h3>
        <p class="deal-brand">${esc(b.name)}<span class="dot">·</span>${esc(t(catKey[d.category] || "all"))} ${v} ${mine ? '<span class="matchflag">· your card</span>' : ""}</p>
        <div class="disc-row"><span class="disc">${discountLabel(d.discount)}</span>${cap}${heatEl}</div>
        <div class="deal-meta">
          <span class="pill ${cd.cls}" data-countdown="${d.id}">${cd.text}${d.status === "evergreen" ? " · " + t("ongoing") : ""}</span>
          ${minSpend}
          <span class="pill">👍 ${d.community?.worked || 0} · 👎 ${d.community?.failed || 0}</span>
          <span class="pill">▲ ${voteCount}</span>
          ${trustEl}
          ${srcPill}
        </div>
      </div>
    </div>
    ${urgencyBar}
    <div class="deal-actions">
      <button data-act="details">${t("details")}</button>
      <button data-act="vote" class="${voted ? "voted" : ""}">${voted ? "▲ " + t("voted") : "▲ " + t("hot")}</button>
      <button data-act="worked">✓ ${t("worked")}</button>
      <button data-act="save" class="${saved ? "voted" : ""}">${saved ? "🔔 " + t("saved") : "🔔 " + t("alert")}</button>
      <button data-act="share">↗ ${t("share")}</button>
    </div>
  </article>`;
}

function renderFeed() {
  const list = tabDeals();
  if (!list.length) {
    const emptyMsgs = {
      foryou: state.myPay.size ? t("emptyForYouSet") : t("emptyForYou"),
      ending: t("emptyEnding"),
      evergreen: t("emptyEvergreen"),
      spotted: t("emptySpotted"),
      trending: t("emptyTrending")
    };
    const icons = { foryou: "🎯", ending: "⏳", evergreen: "♾️", spotted: "👀", trending: "🔥" };
    $("#feed").innerHTML = `<div class="empty"><div style="font-size:40px;margin-bottom:12px">${icons[state.tab] || "📡"}</div>${emptyMsgs[state.tab] || "No deals match your filters."}</div>`;
    return;
  }
  // Show skeleton briefly for perceived performance
  if (!state.feedRendered) {
    state.feedRendered = true;
    $("#feed").innerHTML = Array(4).fill(`<div class="skeleton" style="height:140px;border-radius:var(--radius)"></div>`).join("");
    setTimeout(() => { renderFeedContent(list); }, 150);
    return;
  }
  renderFeedContent(list);
}

function renderFeedContent(list) {
  try {
  // Group by merchant when 2+ deals from same brand
  const groups = groupByMerchant(list);
  let html = "";
  const rendered = new Set();
  for (const [brandId, deals] of Object.entries(groups)) {
    if (rendered.has(brandId)) continue;
    rendered.add(brandId);
    if (deals.length >= 2 && state.tab !== "evergreen") {
      const b = brandOf(brandId);
      const groupLogo = b.logo
        ? `<div class="logo-badge sm" style="background:${b.color}"><img src="${b.logo}" alt="${b.name}" class="logo-img" loading="lazy"></div>`
        : `<div class="logo-badge sm" style="background:${b.color}">${b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>`;
      html += `<div class="merchant-group" data-brand="${brandId}">
        <div class="merchant-header">
          ${groupLogo}
          <span class="merchant-name">${b.name}</span>
          <span class="merchant-count">${t("activeDeals", {n: deals.length})}</span>
          <button class="merchant-compare" data-compare="${brandId}">${t("compare")}</button>
        </div>
        <div class="merchant-scroll">${deals.map(dealCard).join("")}</div>
      </div>`;
    } else {
      html += deals.map(dealCard).join("");
    }
  }
  $("#feed").innerHTML = html;
  } catch (err) {
    console.error("Feed render error:", err);
    $("#feed").innerHTML = `<div class="empty"><div style="font-size:40px;margin-bottom:12px">⚠️</div>Something went wrong loading deals.<br><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer">Retry</button></div>`;
  }
}

function renderBanner() {
  const tabInfo = TABS[state.tab];
  let inner = "";
  if (state.tab === "trending" || state.tab === "ending") {
    const soon = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && daysUntil(d.valid_until) >= 0 && daysUntil(d.valid_until) <= 2);
    if (soon.length) inner = `<div class="banner-card">⏳ <b>${t("flashBanner", {n: soon.length, s: soon.length > 1 ? "s" : ""})}</b> — ${[...new Set(soon.map(s => brandOf(s.brand).name))].slice(0, 3).join(", ")}${soon.length > 3 ? " +more" : ""}</div>`;
  }
  if (!inner) inner = `<div class="banner-info">${tabInfo.hint}</div>`;
  $("#banner").innerHTML = inner;
  const live = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d)).length;
  $("#headerTag").textContent = t("tag", {n: live});
}

function renderChips() {
  $("#cityChips").innerHTML = CITIES.map(c => `<button class="chip${state.city === c ? " active" : ""}" data-city="${c}">${c === "All" ? t("allCities") : c}</button>`).join("");
  $("#catChips").innerHTML = CATS.map(([v]) => `<button class="chip cat${state.cat === v ? " active" : ""}" data-cat="${v}">${t(catKey[v] || "all")}</button>`).join("");
}

function renderWalletPanel() {
  $("#walletBtn").classList.toggle("on", state.myPay.size > 0);
  $("#walletPanel").innerHTML = `<h4>👛 ${t("wallet", {n: state.myPay.size})}</h4>
    <p class="hint">${t("walletHint")}</p>
    <div class="pay-grid">${PAY_OPTIONS.map(([v, l]) => `<button class="pay-opt${state.myPay.has(v) ? " on" : ""}" data-pay="${v}">${l}</button>`).join("")}</div>`;
}

function renderBell() {
  const unread = state.notifications.filter(n => !n.read).length;
  const soon = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && daysUntil(d.valid_until) >= 0 && daysUntil(d.valid_until) <= 2).length;
  $("#bellCount").textContent = unread + soon;
}

function renderSavings() {
  $("#savingsBar").innerHTML = state.savings > 0
    ? `<div class="savings-strip">💰 ${t("savings", {n: Number(state.savings).toLocaleString()})}</div>` : "";
}

function renderAll() { renderBanner(); renderChips(); renderFeed(); renderBell(); renderSavings(); syncTabs(); $("#q").placeholder = t("search"); }

// ---- live ticking countdown ----
function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (!DATA.meta?.now) NOW = new Date();
    heatCache.clear();
    $$("[data-countdown]").forEach(el => {
      const id = el.dataset.countdown;
      const d = DATA.deals.find(x => x.id === id);
      if (!d || d.status === "evergreen") return;
      const cd = countdown(d.valid_until);
      el.textContent = cd.text;
      el.className = `pill ${cd.cls}`;
    });
  }, 60000); // tick every minute
}

// ---- detail sheet ----
function openDeal(d) {
  pushNav("deal");
  const b = brandOf(d.brand); const heat = computeHeat(d);
  const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cd = countdown(d.valid_until);
  const trust = merchantTrust(d.brand);
  const srcLink = d.source?.url
    ? `<a href="${d.source.url}" target="_blank" rel="noopener">${d.source.platform || "source"}</a>`
    : (d.source?.status === "pending" ? "Pending verification" : (d.source?.platform || "—"));
  const fmtDate = s => { if (!s) return "—"; return new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const fmtTs = s => { if (!s) return "—"; return new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

  const rows = [
    ["Discount", discountLabel(d.discount) + (d.discount?.cap ? ` · cap Rs ${Number(d.discount.cap).toLocaleString()}` : "")],
    ["Valid", `${fmtDate(d.valid_from)} → ${fmtDate(d.valid_until)} (${cd.text})`],
    ["Heat score", heat ? `🔥 ${heat}/100` : "♾️ Always-on"],
    ["Pay with", payLabel(d.eligibility?.payment)],
    ["Merchant", d.eligibility?.merchant === "multiple" ? "Multiple partners" : (d.eligibility?.merchant || "—")],
    ["Min spend", d.eligibility?.min_spend ? "Rs " + Number(d.eligibility?.min_spend).toLocaleString() : "None"],
    ["User", d.eligibility?.user === "new" ? "New users only" : "Everyone"],
    ["Cities", d.cities.join(", ")],
    ["Status", d.verification === "verified" ? "✓ Verified" : "⚠ Unverified — confirm at merchant"],
    ["Source", `${srcLink} · ${d.source?.type || "—"}`],
    ["Captured", fmtTs(d.source?.captured_at)],
    ["Community", `▲ ${d.community?.votes || 0} · 👍 ${d.community?.worked || 0} · 👎 ${d.community?.failed || 0}`],
    ["Brand trust", trust !== null ? `${trust}% worked rate across ${d.community?.worked + d.community?.failed || 0} reports` : "No reports yet"],
    ["Confidence", ((d.confidence * 100) | 0) + "%"]
  ];

  const stepsHtml = d.steps?.length ? `
    <h4 class="steps-title">${t("howToAvail")}</h4>
    <ol class="steps-list">${d.steps.map((s, i) => `<li><span class="step-num">${i + 1}</span>${s}</li>`).join("")}</ol>` : "";

  const wa = `https://wa.me/?text=${encodeURIComponent(`🔥 ${d.title}\n${discountLabel(d.discount)}${d.discount?.cap ? " (cap Rs " + d.discount.cap + ")" : ""}\nValid till ${fmtDate(d.valid_until)}\n${d.summary}\n\nvia DealRadar PK`)}`;

  const logoHero = b.logo
    ? `<div class="logo-badge" style="background:${b.color};width:52px;height:52px"><img src="${b.logo}" alt="${b.name}" class="logo-img"></div>`
    : `<div class="logo-badge" style="background:${b.color};width:52px;height:52px;font-size:16px">${initials}</div>`;

  $("#sheet").innerHTML = `<div class="grab"></div>
    <div class="hero-card" style="background:linear-gradient(135deg,${b.color}22,${b.color}08);border:1px solid ${b.color}44">
      ${logoHero}
      <div class="hero-info">
        <div class="hero-brand">${b.name}</div>
        <div class="hero-type">${b.brand_type} · ${d.category}</div>
      </div>
      <div class="hero-disc">
        <div class="hero-amount">${discountLabel(d.discount)}</div>
        ${d.discount?.cap ? `<div class="hero-cap">cap Rs ${Number(d.discount.cap).toLocaleString()}</div>` : ""}
      </div>
    </div>
    <h3>${esc(d.title)}</h3>
    <p class="sheet-summary">${esc(d.summary)}</p>
    ${stepsHtml}
    ${rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("")}
    ${d.exclusions?.length ? `<h4 class="steps-title">${t("terms")}</h4><ul>${d.exclusions.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="sheet-actions">
      <a class="sharebtn" href="${wa}" target="_blank" rel="noopener">${t("shareOnWhatsApp")}</a>
      <button class="reportbtn" data-report="${d.id}">${t("reportExpired")}</button>
    </div>
    <p class="fine">Always confirm at the merchant. DealRadar aggregates public offers and is not affiliated with ${b.name}.</p>`;
  showSheet();

  // wire report button
  const rb = $("#sheet .reportbtn");
  if (rb) rb.addEventListener("click", () => {
    d.community.reports_expired = (d.community.reports_expired || 0) + 1;
      trustCache.clear();
    if (d.community.reports_expired >= 3) {
      addNotification(`"${d.title}" hidden after 3 expired reports`);
      toast(t("dealHidden"));
      closeSheet(); renderFeed();
    } else {
      toast(t("reported", {n: d.community.reports_expired}));
    }
  });
}

// ---- compare view ----
function openCompare(brandId) {
  pushNav("compare");
  const deals = DATA.deals.filter(d => d.brand === brandId && baseFilter(d));
  const b = brandOf(brandId);
  if (deals.length < 2) return;
  const trust = merchantTrust(brandId);
  $("#sheet").innerHTML = `<div class="grab"></div>
    <h3>Compare ${b.name} deals</h3>
    <p class="sheet-summary">${trust !== null ? `${trust}% worked rate · ${deals.length} active offers` : `${deals.length} active offers`}</p>
    <div class="compare-grid">
      ${deals.map(d => `<div class="compare-card" data-id="${d.id}">
        <div class="compare-disc">${discountLabel(d.discount)}</div>
        <div class="compare-title">${d.title.replace(b.name + " — ", "").replace(b.name + " ", "")}</div>
        <div class="compare-meta">
          <span>${payLabel(d.eligibility?.payment)}</span>
          <span>${countdown(d.valid_until).text}</span>
          <span>👍 ${d.community?.worked || 0} · 👎 ${d.community?.failed || 0}</span>
        </div>
        <button class="compare-view" data-view="${d.id}">View details</button>
      </div>`).join("")}
    </div>`;
  showSheet();
  $$("#sheet .compare-view").forEach(btn => btn.addEventListener("click", () => {
    const d = DATA.deals.find(x => x.id === btn.dataset.view);
    if (d) openDeal(d);
  }));
}

// ---- submit ----
function openSubmit() {
  pushNav("submit");
  $("#sheet").innerHTML = `<div class="grab"></div>
    <h3>👀 I spotted a deal</h3>
    <p class="sheet-summary">Help others not miss it. Submissions go to a verification queue, then appear in Spotted.</p>
    <form class="form" id="submitForm">
      <label>Brand / merchant</label><input name="brand" required placeholder="e.g. KFC, Easypaisa, Daraz">
      <label>Offer (title)</label><input name="title" required placeholder="e.g. 50% off with HBL debit">
      <label>Category</label>
      <select name="category">${CATS.filter(c => c[0] !== "all").map(c => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>
      <label>City</label>
      <select name="city">${CITIES.slice(1).map(c => `<option>${c}</option>`).join("")}<option>All Pakistan</option></select>
      <label>Valid until</label><input name="valid_until" type="date" required>
      <label>Source link (Instagram / website / etc.)</label><input name="url" placeholder="https://…">
      <label>How to avail (steps, one per line)</label><textarea name="steps" placeholder="1. Visit outlet&#10;2. Pay with card&#10;3. Discount applied"></textarea>
      <label>Notes / terms</label><textarea name="summary" placeholder="Discount, cap, eligible cards, exclusions…"></textarea>
      <button class="submit" type="submit">Submit to Spotted</button>
    </form>`;
  showSheet();
  $("#submitForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const brandId = f.get("brand").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20) || "community";
    const id = "u" + Date.now();
    const steps = (f.get("steps") || "").split("\n").map(s => s.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
    DATA.deals.push({
      id, brand: brandId, brand_brand_type: "brand", category: f.get("category"),
      title: "[Spotted] " + f.get("title"), summary: f.get("summary") || "Community-submitted deal.",
      discount: null, eligibility: { payment: [], merchant: f.get("brand"), user: "any", min_spend: null },
      cities: [f.get("city")], valid_from: NOW.toISOString().slice(0, 10), valid_until: f.get("valid_until"),
      exclusions: ["Pending verification by DealRadar"], steps,
      source: { type: "community", platform: "user submission", url: f.get("url") || "", status: "pending", captured_at: NOW.toISOString() },
      status: "spotted", verification: "unverified", confidence: 0.5,
      community: { votes: 1, worked: 0, failed: 0, saves: 0, spotted_by: "@you", reports_expired: 0 }
    });
    if (!DATA.brands.some(b => b.id === brandId)) {
      DATA.brands.push({ id: brandId, name: f.get("brand"), brand_type: "brand", color: "#666" });
    }
    addNotification(`Your submission "${f.get("title")}" is in the queue`);
    brandMap.clear(); closeSheet(); state.tab = "spotted"; syncTabs(); renderAll(); toast(t("addedSpotted"));
  });
}

// ---- notification center ----
function openNotifications() {
  pushNav("notifications");
  const soon = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && daysUntil(d.valid_until) >= 0 && daysUntil(d.valid_until) <= 2);
  const savedDeals = DATA.deals.filter(d => state.saved.has(d.id) && !isHidden(d));
  let html = `<div class="grab"></div><h3>🔔 Notifications</h3>`;

  if (soon.length) {
    html += `<h4 class="steps-title">Expiring soon</h4>`;
    soon.forEach(d => {
      html += `<div class="notif-item" data-notif-deal="${d.id}">
        <span class="notif-icon">⏳</span>
        <span class="notif-text"><b>${brandOf(d.brand).name}</b> — ${countdown(d.valid_until).text} left</span>
      </div>`;
    });
  }
  if (savedDeals.length) {
    html += `<h4 class="steps-title">Your saved deals</h4>`;
    savedDeals.forEach(d => {
      html += `<div class="notif-item" data-notif-deal="${d.id}">
        <span class="notif-icon">🔔</span>
        <span class="notif-text"><b>${brandOf(d.brand).name}</b> — ${countdown(d.valid_until).text}</span>
      </div>`;
    });
  }
  if (state.notifications.length) {
    html += `<h4 class="steps-title">Activity</h4>`;
    state.notifications.slice(0, 10).forEach(n => {
      html += `<div class="notif-item"><span class="notif-icon">📌</span><span class="notif-text">${n.msg}</span></div>`;
    });
  }
  if (!soon.length && !savedDeals.length && !state.notifications.length) {
    html += `<div class="empty">No notifications yet. Save deals with 🔔 to get alerts.</div>`;
  }
  $("#sheet").innerHTML = html;
  showSheet();
  state.notifications.forEach(n => n.read = true);
  store.set("dr_notifs", JSON.stringify(state.notifications));
  renderBell();
  $$("#sheet [data-notif-deal]").forEach(el => el.addEventListener("click", () => {
    const d = DATA.deals.find(x => x.id === el.dataset.notifDeal);
    if (d) openDeal(d);
  }));
}

// ---- onboarding (pro redesign) ----
function showOnboarding() {
  if (state.onboarded) return;
  document.body.classList.add("onboarding");
  const screens = [
    {
      icon: "🛰️",
      title: t("obTitle1"),
      desc: t("obDesc1"),
      visual: "trending"
    },
    {
      icon: "🎯",
      title: t("obTitle2"),
      desc: t("obDesc2"),
      visual: "personal"
    },
    {
      icon: "👥",
      title: t("obTitle3"),
      desc: t("obDesc3"),
      visual: "community"
    }
  ];
  let current = 0;

  function renderScreen() {
    const s = screens[current];
    const dots = screens.map((_, i) => `<span class="ob-dot${i === current ? " active" : ""}"></span>`).join("");
    $("#sheet").innerHTML = `
    <div class="onboard-full">
      <div class="ob-bg"></div>
      <div class="ob-content">
        <div class="ob-visual">${s.icon}</div>
        <h2 class="ob-title">${s.title}</h2>
        <p class="ob-desc">${s.desc}</p>
      </div>
      <div class="ob-footer">
        <div class="ob-dots">${dots}</div>
        <div class="ob-actions">
          ${current > 0 ? `<button class="ob-skip" id="obBack">${t("back")}</button>` : `<button class="ob-skip" id="obSkip">${t("skip")}</button>`}
          <button class="ob-next" id="obNext">${current === screens.length - 1 ? t("getStarted") : t("next")}</button>
        </div>
      </div>
    </div>`;

    // wire
    const next = $("#obNext");
    const back = $("#obBack");
    const skip = $("#obSkip");
    next.addEventListener("click", () => {
      if (current < screens.length - 1) { current++; renderScreen(); }
      else { finishOnboarding(); }
    });
    if (back) back.addEventListener("click", () => { current--; renderScreen(); });
    if (skip) skip.addEventListener("click", finishOnboarding);
  }

  function finishOnboarding() {
    state.onboarded = true;
    store.set("dr_onboarded", "true");
    document.body.classList.remove("onboarding");
    closeSheet();
    $("#walletPanel").classList.remove("hidden");
    renderWalletPanel();
  }

  renderScreen();
  showSheet();
}

// ---- sheet helpers ----
function showSheet() { $("#sheet").classList.remove("hidden"); $("#sheetBackdrop").classList.remove("hidden"); }
function closeSheet() { $("#sheet").classList.add("hidden"); $("#sheetBackdrop").classList.add("hidden"); }

let toastT;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200); }

function shareDeal(d) {
  const txt = `🔥 ${d.title}\n${discountLabel(d.discount)}${d.discount?.cap ? " (cap Rs " + d.discount.cap + ")" : ""}\nValid till ${d.valid_until}\n${d.summary}\n\nvia DealRadar PK`;
  if (navigator.share) {
    navigator.share({ title: d.title, text: txt }).catch(() => {});
  } else {
    window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
  }
}

function syncTabs() {
  const icons = { trending: "🔥", foryou: "🎯", ending: "⏳", evergreen: "♾️", spotted: "👀" };
  $("#tabbar").innerHTML = Object.keys(TABS).map(k =>
    `<button class="tab${state.tab === k ? " active" : ""}" data-tab="${k}"><span>${icons[k]}</span>${t(k)}</button>`
  ).join("");
}

function wire() {
  $("#backBtn").addEventListener("click", goBack);
  $("#exitStay").addEventListener("click", hideExitDialog);
  $("#exitLeave").addEventListener("click", () => {
    hideExitDialog();
    if (window.AndroidBridge) { window.AndroidBridge.exitApp(); }
    else { window.close(); }
  });
  let searchTimeout;
  $("#q").addEventListener("input", e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { state.q = e.target.value; renderFeed(); updateBackBtn(); }, 300);
  });
  $("#cityChips").addEventListener("click", e => { const b = e.target.closest("[data-city]"); if (!b) return; state.city = b.dataset.city; renderChips(); renderFeed(); updateBackBtn(); });
  $("#catChips").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; state.cat = b.dataset.cat; renderChips(); renderFeed(); updateBackBtn(); });
  $("#walletBtn").addEventListener("click", () => {
    const wp = $("#walletPanel");
    if (wp.classList.contains("hidden")) { wp.classList.remove("hidden"); pushNav("wallet"); }
    else { wp.classList.add("hidden"); popNav(); }
  });
  $("#walletPanel").addEventListener("click", e => {
    const b = e.target.closest("[data-pay]"); if (!b) return;
    const v = b.dataset.pay; state.myPay.has(v) ? state.myPay.delete(v) : state.myPay.add(v);
    store.set("dr_pay", JSON.stringify([...state.myPay])); renderWalletPanel(); renderFeed();
  });
  $("#tabbar").addEventListener("click", e => {
    const t = e.target.closest("[data-tab]"); if (!t) return;
    state.tab = t.dataset.tab; state.feedRendered = false; syncTabs(); updateBackBtn();
    const feed = $("#feed");
    feed.style.opacity = "0"; feed.style.transform = "translateY(8px)";
    setTimeout(() => { renderAll(); feed.style.transition = "opacity .25s ease, transform .25s ease"; feed.style.opacity = "1"; feed.style.transform = "none"; }, 120);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#fab").addEventListener("click", openSubmit);
  $("#alertBell").addEventListener("click", openNotifications);
  $("#langBtn").addEventListener("click", () => { toggleLang(); $("#langBtn").textContent = t("langToggle"); });
  $("#feed").addEventListener("click", e => {
    // compare button
    const cmp = e.target.closest("[data-compare]");
    if (cmp) { openCompare(cmp.dataset.compare); return; }
    const card = e.target.closest(".deal"); if (!card) return;
    const d = DATA.deals.find(x => x.id === card.dataset.id); if (!d) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "details" || !act) return openDeal(d);
    if (act === "vote") {
      if (state.voted.has(d.id)) { state.voted.delete(d.id); }
      else { state.voted.add(d.id); toast(t("hotToast")); }
      store.set("dr_voted", JSON.stringify([...state.voted]));
    }
    if (act === "worked") {
      d.community.worked++;
      trustCache.clear();
      // savings tracker: estimate savings from discount
      const est = d.discount?.kind === "percent" ? Math.min(d.discount.value * 20, d.discount.cap || 500) : (d.discount?.value || 100);
      state.savings += est;
      store.set("dr_savings", JSON.stringify(state.savings));
      renderSavings();
      toast(t("workedToast", {n: est}));
    }
    if (act === "save") {
      if (state.saved.has(d.id)) { state.saved.delete(d.id); toast(t("alertRemoved")); }
      else { state.saved.add(d.id); addNotification(t("notifAlert", {title: d.title})); toast(t("alertSet")); }
      store.set("dr_saved", JSON.stringify([...state.saved]));
    }
    if (act === "share") { shareDeal(d); return; }
    renderFeed(); renderBell();
  });
  $("#sheetBackdrop").addEventListener("click", closeSheet);
}

// ---- LIVE DATA REFRESH ----
let lastFetch = null;
let refreshInterval = null;
let isRefreshing = false;

async function fetchLive(silent = false) {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const base = API_URL || "";
    let fresh = null;
    for (const path of [`${base}/api/deals`, `${base}/live_deals.json`]) {
      try {
        const r = await fetch(path);
        if (!r.ok) continue;
        fresh = await r.json();
        break;
      } catch (e) { continue; }
    }
    if (!fresh) throw new Error("No live source");
    if (fresh.deals && fresh.deals.length) {
      // Merge: keep local community state, update deal data
      const localMap = new Map((DATA.deals || []).map(d => [d.id, d]));
      DATA.deals = fresh.deals.map(fd => {
        const local = localMap.get(fd.id);
        if (local) {
          // Preserve community votes from local state
          fd.community = { ...fd.community, ...local.community };
        }
        return fd;
      });
      DATA.brands = fresh.brands || DATA.brands;
      DATA.meta = { ...DATA.meta, ...fresh.meta };
      lastFetch = fresh.meta?.server_time || new Date().toISOString();
      NOW = DATA.meta?.now ? new Date(DATA.meta.now) : new Date();
      heatCache.clear(); trustCache.clear(); brandMap.clear();
      renderAll();
      const newCount = fresh.deals.length - (localMap.size || 0);
      if (!silent) {
        if (newCount > 0) toast(`🆕 ${newCount} new deals just dropped!`);
        else toast("✓ Deals up to date");
      }
    }
  } catch (e) {
    console.warn("Live refresh failed:", e.message);
  }
  isRefreshing = false;
}

function setupLiveRefresh() {
  // Auto-refresh every 5 minutes
  refreshInterval = setInterval(fetchLive, 300000);

  // Pull-to-refresh
  let startY = 0, pulling = false;
  const feed = $("#feed");
  document.addEventListener("touchstart", e => {
    if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 80 && window.scrollY === 0) {
      pulling = false;
      toast("⟳ Refreshing deals…");
      fetchLive();
    }
  }, { passive: true });
  document.addEventListener("touchend", () => { pulling = false; }, { passive: true });
}


(async function init() {
  try {
    // Register service worker for offline + push
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    if (window.__DEALS__) { DATA = window.__DEALS__; }
    else {
      const r = await fetch("deals.json");
      if (!r.ok) throw new Error("Failed to load deals");
      DATA = await r.json();
    }
    NOW = DATA.meta?.now ? new Date(DATA.meta.now) : NOW;
    document.documentElement.dir = LANG === "ur" ? "rtl" : "ltr";
    document.documentElement.lang = LANG;
    $("#langBtn").textContent = t("langToggle");
    renderWalletPanel(); syncTabs(); renderAll(); wire(); startTicking();
    setupLiveRefresh();
    showOnboarding();
  } catch (err) {
    console.error("DealRadar init error:", err);
    $("#feed").innerHTML = `<div class="empty"><div style="font-size:40px;margin-bottom:12px">📡</div>Something went wrong loading deals.<br><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer">Retry</button></div>`;
  }
})();
