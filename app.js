/* DealRadar PK v4 — Redesigned feed:
   Sectioned layout (Hot Now → Bank Offers → Wallet Apps → Brands → Government),
   merchant-first grouping, compact cards, tap-to-open details. */
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
    trending: "Trending", foryou: "For You", ending: "Ending", evergreen: "Always On", spotted: "Spotted", calendar: "Calendar",
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
    trending: "ٹرینڈنگ", foryou: "آپ کے لیے", ending: "ختم ہو رہی", evergreen: "ہمیشہ", spotted: "اسپاٹڈ", calendar: "کیلنڈر",
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
  spotted: { label: "Spotted", hint: "👀 Community submissions. Tap ＋ to add." },
  calendar: { label: "Calendar", hint: "📅 Deals by expiry date — never miss a deadline." }
};

let NOW = new Date(); // Production: real time. Prototype: overridden by meta.now after data load.
const state = {
  tab: "trending", q: "", city: "All", cat: "all",
  myPay: new Set(JSON.parse(store.get("dr_pay", "[]"))),
  voted: new Set(JSON.parse(store.get("dr_voted", "[]"))),
  saved: new Set(JSON.parse(store.get("dr_saved", "[]"))),
  hiddenBrands: new Set(JSON.parse(store.get("dr_hidden", "[]"))),
  pinnedBrands: new Set(JSON.parse(store.get("dr_pinned", "[]"))),
  savings: JSON.parse(store.get("dr_savings", "0")),
  notifications: JSON.parse(store.get("dr_notifs", "[]")),
  onboarded: store.get("dr_onboarded", "false") === "true"
};
let DATA = null;
let tickInterval = null;

// ---- AI ENGINE ----
const AI = {
  // User preference profile (learned from behavior)
  profile: JSON.parse(store.get("dr_ai_profile", "null")) || {
    categories: {},    // {food: 5, shopping: 2, ...}
    brands: {},        // {hbl: 3, ubl: 1, ...}
    cities: {},        // {Karachi: 4, ...}
    payments: {},      // {hbl_credit: 2, ...}
    discountPref: 0,   // avg discount % user engages with
    timeOfDay: {},     // {morning: 2, evening: 5, ...}
    totalInteractions: 0,
    lastUpdated: null
  },

  // Record a user interaction (view, tap, save, worked)
  learn(action, deal) {
    const p = this.profile;
    p.totalInteractions++;
    const weight = action === "worked" ? 3 : action === "save" ? 2 : action === "view" ? 1 : 0.5;
    if (deal.category) p.categories[deal.category] = (p.categories[deal.category] || 0) + weight;
    if (deal.brand) p.brands[deal.brand] = (p.brands[deal.brand] || 0) + weight;
    if (deal.cities) deal.cities.forEach(c => { p.cities[c] = (p.cities[c] || 0) + weight; });
    if (deal.eligibility?.payment) deal.eligibility.payment.forEach(pm => { p.payments[pm] = (p.payments[pm] || 0) + weight; });
    if (deal.discount?.value) p.discountPref = (p.discountPref * 0.9) + (deal.discount.value * 0.1);
    const hour = new Date().getHours();
    const tod = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    p.timeOfDay[tod] = (p.timeOfDay[tod] || 0) + 1;
    p.lastUpdated = new Date().toISOString();
    store.set("dr_ai_profile", JSON.stringify(p));
  },

  // Score a deal for personal relevance (0-100)
  relevanceScore(deal) {
    const p = this.profile;
    if (p.totalInteractions < 3) return 0; // Not enough data yet
    let score = 0;
    const catW = p.categories[deal.category] || 0;
    const brandW = p.brands[deal.brand] || 0;
    const cityW = deal.cities ? Math.max(...deal.cities.map(c => p.cities[c] || 0)) : 0;
    const payW = deal.eligibility?.payment ? Math.max(...deal.eligibility.payment.map(pm => p.payments[pm] || 0)) : 0;
    const maxW = Math.max(...Object.values(p.categories), 1);
    score += (catW / maxW) * 30;
    score += (brandW / Math.max(...Object.values(p.brands), 1)) * 25;
    score += (cityW / Math.max(...Object.values(p.cities), 1)) * 25;
    score += (payW / Math.max(...Object.values(p.payments), 1)) * 20;
    return Math.round(score);
  },

  // Get AI insights for the dashboard
  insights() {
    const p = this.profile;
    const deals = DATA?.deals || [];
    const insights = [];

    if (p.totalInteractions < 5) {
      insights.push({ icon: "🧠", text: "I'm learning your preferences. Tap, save, and confirm deals to make me smarter.", type: "learning" });
      return insights;
    }

    // Top category
    const topCat = Object.entries(p.categories).sort((a, b) => b[1] - a[1])[0];
    if (topCat) {
      const catDeals = deals.filter(d => d.category === topCat[0] && d.status !== "evergreen");
      if (catDeals.length) insights.push({ icon: "🎯", text: `You love ${topCat[0]} deals — ${catDeals.length} active right now.`, type: "category" });
    }

    // Best bank for user
    const topBank = Object.entries(p.brands).sort((a, b) => b[1] - a[1])[0];
    if (topBank) {
      const bankDeals = deals.filter(d => d.brand === topBank[0]);
      const bestDeal = bankDeals.sort((a, b) => (b.discount?.value || 0) - (a.discount?.value || 0))[0];
      if (bestDeal) insights.push({ icon: "💳", text: `Your best card: ${brandOf(topBank[0]).name} — up to ${bestDeal.discount?.value || 0}% off at ${bestDeal.eligibility?.merchant || "merchants"}.`, type: "bank" });
    }

    // Spending optimizer
    const userCity = Object.entries(p.cities).sort((a, b) => b[1] - a[1])[0]?.[0] || "Karachi";
    const cityDeals = deals.filter(d => d.cities?.includes(userCity) && d.status !== "evergreen");
    if (cityDeals.length > 3) {
      const avgDisc = Math.round(cityDeals.reduce((s, d) => s + (d.discount?.value || 0), 0) / cityDeals.length);
      insights.push({ icon: "💰", text: `${cityDeals.length} deals in ${userCity} — avg ${avgDisc}% off. Switch cards to save more.`, type: "city" });
    }

    // Time-based insight
    const hour = new Date().getHours();
    const eveningDeals = deals.filter(d => d.category === "food" && d.status !== "evergreen");
    if (hour >= 17 && eveningDeals.length) {
      insights.push({ icon: "🍽️", text: `Dinner time! ${eveningDeals.length} food deals active tonight.`, type: "time" });
    }

    return insights;
  },

  // Smart spending optimizer — which card saves most
  optimizeSpending() {
    const deals = DATA?.deals || [];
    // Only use bank deals with realistic discounts (1-60%)
    const active = deals.filter(d =>
      d.status !== "evergreen" &&
      d.discount?.kind === "percent" &&
      d.discount?.value >= 1 && d.discount?.value <= 60 &&
      d.brand_type === "bank"
    );
    const byBank = {};
    active.forEach(d => {
      const bank = d.brand;
      if (!byBank[bank]) byBank[bank] = { total: 0, count: 0, best: 0, merchant: "" };
      byBank[bank].total += d.discount.value;
      byBank[bank].count++;
      if (d.discount.value > byBank[bank].best) {
        byBank[bank].best = d.discount.value;
        byBank[bank].merchant = d.eligibility?.merchant || "";
      }
    });
    return Object.entries(byBank)
      .map(([bank, v]) => ({ bank, avg: Math.round(v.total / v.count), best: v.best, merchant: v.merchant, count: v.count }))
      .sort((a, b) => b.avg - a.avg);
  },

  // AI Chat — natural language deal finder (English + Urdu + Roman Urdu)
  chat(query) {
    const q = " " + query.toLowerCase().replace(/[?!.،]/g, " ") + " ";
    const deals = DATA?.deals || [];
    const active = deals.filter(d => d.status !== "evergreen" && !isHidden(d));

    // Roman Urdu / Urdu normalizer → canonical tokens
    const has = re => re.test(q);

    // Extract city (English + Roman Urdu + Urdu)
    const cityMap = [
      [/(karachi|کراچی)/, "Karachi"], [/(lahore|لاہور)/, "Lahore"],
      [/(islamabad|اسلام ?آباد)/, "Islamabad"], [/(rawalpindi|pindi|راولپنڈی)/, "Rawalpindi"],
      [/(multan|ملتان)/, "Multan"], [/(faisalabad|فیصل آباد)/, "Faisalabad"],
      [/(peshawar|پشاور)/, "Peshawar"], [/(quetta|کوئٹہ)/, "Quetta"],
      [/(hyderabad|حیدرآباد)/, "Hyderabad"], [/(sialkot|سیالکوٹ)/, "Sialkot"],
      [/(gujranwala|گوجرانوالہ)/, "Gujranwala"], [/(sargodha|سرگودھا)/, "Sargodha"],
      [/(sukkur|سکھر)/, "Sukkur"], [/(bahawalpur|بہاولپور)/, "Bahawalpur"],
      [/(abbottabad|ایبٹ آباد)/, "Abbottabad"]
    ];
    let city = null;
    for (const [re, name] of cityMap) if (has(re)) { city = name; break; }

    // Extract bank
    const bankMap = [
      [/\b(hbl|habib)\b|ایچ بی ایل/, "hbl"], [/\b(ubl|united)\b/, "ubl"],
      [/(meezan|میزان)/, "meezan"], [/(alfalah|الفلح)/, "alfalah"],
      [/\b(mcb)\b/, "mcb"], [/(askari|عسکری)/, "askari"], [/(allied)/, "allied"],
      [/(easypaisa|easypesa|ایزی پیسا)/, "easypaisa"], [/(jazzcash|jazz cash)/, "jazzcash"],
      [/(govt|government|sarkari|sarkar|subsidy|subsidised|solar|bijli|wheat|flour|atta|sehat|benazir|bisp|hec|scholarship|fuel|petrol|fuel relief|حکومت|سرکاری|سبسڈی|سولر|بجلی|آٹا|صحت|بینظیر|تعلیم|پیٹرول|ایندھن)/, "govt_pk"]
    ];
    let bankId = null;
    for (const [re, id] of bankMap) if (has(re)) { bankId = id; break; }

    // Extract category — English + Roman Urdu + Urdu
    const catMap = [
      [/(food|khana|khane|khaana|eat|dinner|lunch|breakfast|restaurant|pizza|burger|bbq|biryan|کھانا|کھانے|ریسٹورنٹ)/, "food"],
      [/(shop|kharid|shopping|buy|store|mall|brand|cloth|kapre|kapde|fashion|خرید|خریداری|شاپنگ|کپڑے)/, "shopping"],
      [/(fuel|petrol|diesel|pump|پیٹرول|ایندھن)/, "fuel"],
      [/(grocery|groceries|rashan|saman|kirana|راشن|سامان)/, "grocery"],
      [/(travel|flight|hotel|trip|ticket|safar|سفر|ہوٹل)/, "travel"],
      [/(mobile|phone|load|recharge|topup|top ?up|paket|package|mb |جی بی|لوڈ)/, "mobile"],
      [/(beauty|salon|parlour|parlor|spa|makeup|سیلون)/, "beauty"],
      [/(electronic|electronics|appliance|fridge|ac\b|tv\b|الیکٹرانک)/, "electronics"]
    ];
    let category = null;
    for (const [re, id] of catMap) if (has(re)) { category = id; break; }

    // Filter deals
    let results = active;
    if (city) results = results.filter(d => (d.cities || []).some(c => c.toLowerCase().includes(city.toLowerCase())));
    if (bankId) results = results.filter(d => (d.brand || "").toLowerCase().includes(bankId));
    if (category) {
      const direct = results.filter(d => d.category === category);
      if (direct.length) results = direct;
      else {
        const kw = results.filter(d => ((d.title || "") + " " + (d.summary || "")).toLowerCase().match(catMap.find(c => c[1] === category)[0]));
        if (kw.length) results = kw;
      }
    }

    // Discount amount extraction: "50 percent", "50%", "1000 off"
    const pctMatch = q.match(/(\d{1,3})\s*(%|percent|فیصد)/);
    const amtMatch = q.match(/(\d{3,6})\s*(rs|rupees|rupay|روپے)/);

    // Sort by relevance + discount
    results = results.slice().sort((a, b) => {
      const relA = this.relevanceScore(a), relB = this.relevanceScore(b);
      const discA = a.discount?.kind === "percent" ? a.discount.value : 0;
      const discB = b.discount?.kind === "percent" ? b.discount.value : 0;
      return (relB * 0.4 + discB * 0.6) - (relA * 0.4 + discA * 0.6);
    });

    if (pctMatch) results = results.filter(d => d.discount?.kind === "percent" && d.discount.value >= Number(pctMatch[1]));
    if (amtMatch) results = results.filter(d => (d.discount?.kind === "flat" && d.discount.value >= Number(amtMatch[1])) || (d.discount?.kind === "percent" && d.discount.value >= 10));

    let top = results.slice(0, 5);

    // Greetings / help
    if (!query.trim() || /^(hi|hello|salam|assalam|السلام|hey|kya hal|kaise ho|کیسے ہو)/.test(query.toLowerCase().trim())) {
      return { text: "Walaikum assalam! 👋 I'm your deal radar. Ask me things like:\n• \"best food deals in Karachi\"\n• \"lahore mein 50% discount\"\n• \"hbl ki deals\"\n• \"govt subsidies kya hain?\"\n• \"solar subsidy\"\n• \"aaj kya deals hain?\"", deals: [] };
    }

    if (!top.length) {
      const bits = [category, city, bankId].filter(Boolean);
      return {
        text: bits.length
          ? `Hmm, no ${bits.join(" + ")} deals found right now. Try broader words or check back soon — I scan every 2 hours!`
          : "No matching deals right now. Check back soon!",
        deals: []
      };
    }

    // Ending-soon intent
    if (has(/(ending|expire|khatam|aakhri|last day|ختم|جلد)/)) {
      const soon = results.filter(d => daysUntil(d.valid_until) <= 3);
      if (soon.length) {
        top = soon.slice(0, 5);
        return { text: `⏳ Ending soon${city ? " in " + city : ""} — grab these fast:`, deals: top };
      }
    }

    // Build response
    let text;
    if (pctMatch) text = `🎯 Deals ${pctMatch[1]}% or more${city ? " in " + city : ""}:`;
    else if (bankId) {
      const bankLabel = bankId === "govt_pk" ? "🏛️ Government schemes & subsidies" : `💳 ${bankId.toUpperCase()} deals`;
      text = `${bankLabel}${city ? " in " + city : ""}:`;
    }
    else if (category) text = `Here are the best ${category} deals${city ? " in " + city : ""}:`;
    else text = `Here's what's hot${city ? " in " + city : ""} right now:`;

    return { text, deals: top };
  }
};

// ---- time ----

// ---- navigation stack & back button ----
const navStack = [];
let exitShown = false;

function pushNav(type) { navStack.push(type); updateBackBtn(); }
function popNav() { navStack.pop(); updateBackBtn(); }
function updateBackBtn() {
  const btn = $("#backBtn");
  if (!btn) return;
  btn.classList.toggle("visible", navStack.length > 0);
}

function goBack() {
  // 0. If exit dialog is showing → close it
  if ($("#exitOverlay") && $("#exitOverlay").classList.contains("show")) {
    hideExitDialog();
    return;
  }
  // 0.5 If AI chat is open → close it
  if (!$("#aiChat").classList.contains("hidden")) {
    $("#aiChat").classList.add("hidden");
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
  if (state.hiddenBrands.has(d.brand)) return false;
  if (!cityMatch(d)) return false;
  if (state.cat !== "all" && d.category !== state.cat) return false;
  const q = state.q.trim().toLowerCase();
  if (q) {
    const hay = (d.title + " " + d.summary + " " + brandOf(d.brand).name + " " + (d.eligibility?.merchant || "") + " " + d.cities.join(" ") + " " + d.category).toLowerCase();
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
    case "calendar": return all.filter(d => d.status !== "evergreen" && d.status !== "spotted" && daysUntil(d.valid_until) >= 0)
      .sort((a, b) => new Date(a.valid_until) - new Date(b.valid_until));
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

// ---- system push-style notifications (local) ----
const Notif = {
  supported: typeof window !== "undefined" && "Notification" in window,
  ensurePermission() {
    if (!this.supported) return;
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
  },
  fire(title, body) {
    if (!this.supported || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, { body, icon: "icon-192.png", tag: title });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* Android WebView may need SW registration; fall back silently */ }
  },
  // Alert on saved deals expiring within 24h — once per deal per day
  checkExpiring() {
    if (!DATA || !this.supported || Notification.permission !== "granted") return;
    const seen = JSON.parse(store.get("dr_notif_seen", "{}"));
    const todayKey = new Date().toDateString();
    let changed = false;
    DATA.deals.forEach(d => {
      if (!state.saved.has(d.id) || isHidden(d) || d.status === "evergreen") return;
      const hrs = (new Date(d.valid_until + "T23:59:59+05:00") - NOW) / 36e5;
      if (hrs >= 0 && hrs <= 24 && seen[d.id] !== todayKey) {
        seen[d.id] = todayKey; changed = true;
        this.fire("⏳ Deal ending soon!", `"${d.title}" expires in ${hrs < 1 ? "under an hour" : Math.round(hrs) + "h"}. Grab it now!`);
      }
    });
    if (changed) store.set("dr_notif_seen", JSON.stringify(seen));
  }
};

// ---- deal card ----
function dealCard(d, opts = {}) {
  const b = brandOf(d.brand);
  const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cd = countdown(d.valid_until);
  const mine = isMine(d);
  const mi = d.merchant_info || {};

  const logoHtml = mi.logo
    ? `<div class="logo-badge" style="background:#fff"><img src="${esc(mi.logo)}" alt="${esc(b.name)}" class="logo-img" loading="lazy" onerror="this.parentElement.innerHTML='${initials}';this.parentElement.style.background='${b.color}'"></div>`
    : b.logo
    ? `<div class="logo-badge" style="background:${b.color}"><img src="${b.logo}" alt="${esc(b.name)}" class="logo-img" loading="lazy" onerror="this.parentElement.innerHTML='${initials}'"></div>`
    : `<div class="logo-badge" style="background:${b.color}">${initials}</div>`;

  const discLabel = discountLabel(d.discount);
  const capLabel = d.discount?.cap ? ` <span class="cap-txt">cap Rs ${Number(d.discount.cap).toLocaleString()}</span>` : "";
  const cardType = d.eligibility?.card_type ? `<span class="card-type">${esc(d.eligibility.card_type)}</span>` : "";

  return `<article class="deal${mine ? " match" : ""}" data-id="${d.id}">
    ${logoHtml}
    <div class="deal-body">
      <h3 class="deal-title">${esc(crispTitle(d))}</h3>
      <div class="deal-sub">
        <span class="disc">${discLabel}</span>${capLabel}
        ${cardType}
        <span class="pill ${cd.cls}" data-countdown="${d.id}">${cd.text}</span>
        ${mine ? '<span class="matchflag">your card</span>' : ""}
      </div>
    </div>
    <div class="deal-arrow">›</div>
  </article>`;
}

function similarGroup(deals) {
  // Best deal shown, rest collapsed in dropdown
  const sorted = [...deals].sort((a, b) => {
    const va = a.discount?.kind === "percent" ? a.discount.value : a.discount?.value || 0;
    const vb = b.discount?.kind === "percent" ? b.discount.value : b.discount?.value || 0;
    return vb - va;
  });
  const best = sorted[0];
  const rest = sorted.slice(1);
  if (!rest.length) return dealCard(best);

  const groupId = `sg-${best.id}`;
  return `<div class="similar-group">
    ${dealCard(best)}
    <button class="similar-toggle" data-sg="${groupId}">${rest.length} more offer${rest.length > 1 ? "s" : ""} ▾</button>
    <div class="similar-list hidden" id="${groupId}">
      ${rest.map(d => dealCard(d)).join("")}
    </div>
  </div>`;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderFeed();
  });
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
    const icons = { foryou: "🎯", ending: "⏳", evergreen: "♾️", spotted: "👀", trending: "🔥", calendar: "📅" };
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
  if (state.tab === "calendar") { $("#feed").innerHTML = renderCalendar(list); return; }

  // ---- each tab has its own unique layout ----
  if (state.tab === "ending") { $("#feed").innerHTML = renderEndingTab(list); return; }
  if (state.tab === "foryou") { $("#feed").innerHTML = renderForYouTab(list); return; }
  if (state.tab === "evergreen") { $("#feed").innerHTML = renderEvergreenTab(list); return; }
  if (state.tab === "spotted") { $("#feed").innerHTML = renderSpottedTab(list); return; }

  // ---- TRENDING: Dashboard layout ----
  const active = list.filter(d => d.status !== "evergreen" && d.status !== "spotted" && !state.hiddenBrands.has(d.brand));

  // Filter out news/govt deals with no real discount (Rs 0 OFF noise)
  const realDeals = active.filter(d => {
    if (d.brand === "news" || brandOf(d.brand).brand_type === "news") return false;
    const v = d.discount?.kind === "percent" ? d.discount.value : d.discount?.value || 0;
    return v > 0;
  });
  const govtDeals = active.filter(d => (d.brand.startsWith("govt") || brandOf(d.brand).brand_type === "news") && d.title.length < 80);

  // Hero picks: top 3 most achievable (any card, highest discount)
  const anyCard = realDeals.filter(d => (d.eligibility?.payment || []).includes("visa_card") || !(d.eligibility?.payment || []).length);
  const heroPicks = anyCard.sort((a, b) => {
    const va = a.discount?.kind === "percent" ? a.discount.value : a.discount?.value || 0;
    const vb = b.discount?.kind === "percent" ? b.discount.value : b.discount?.value || 0;
    return vb - va;
  }).slice(0, 3);
  const heroIds = new Set(heroPicks.map(d => d.id));

  // Category counts
  const catCounts = {};
  realDeals.forEach(d => { catCounts[d.category] = (catCounts[d.category] || 0) + 1; });

  let html = "";

  // Hero dashboard
  if (heroPicks.length) {
    html += `<div class="hero-section"><div class="hero-grid">`;
    heroPicks.forEach((d, i) => {
      const b = brandOf(d.brand);
      const disc = discountLabel(d.discount);
      const merchant = d.eligibility?.merchant || b.name;
      if (i === 0) {
        html += `<div class="hero-card-big" data-id="${d.id}">
          <span class="hero-badge">🔥 HOT</span>
          <div class="hero-disc">${disc}</div>
          <div class="hero-title">${esc(crispTitle(d))}</div>
          <div class="hero-meta"><span>${esc(merchant)}</span> · <span class="pill ${countdown(d.valid_until).cls}" data-countdown="${d.id}">${countdown(d.valid_until).text}</span></div>
        </div>`;
      } else {
        html += `<div class="hero-card-sm" data-id="${d.id}">
          <div class="sm-disc">${disc}</div>
          <div class="sm-title">${esc(crispTitle(d))}</div>
          <div class="sm-meta">${esc(merchant)}</div>
        </div>`;
      }
    });
    html += `</div></div>`;
  }

  // Category tiles
  const catIcons = {food:"🍔",shopping:"🛍️",ecommerce:"📦",retail:"🏬",fuel:"⛽",travel:"✈️",telecom:"📱",grocery:"🛒",electronics:"🔌",fashion:"👗",utilities:"💡",mobile:"📲",beauty:"💄"};
  const topCats = Object.entries(catCounts).sort((a,b) => b[1]-a[1]).slice(0, 8);
  if (topCats.length) {
    html += `<div class="cat-grid">`;
    topCats.forEach(([cat, count]) => {
      html += `<div class="cat-tile" data-cat="${cat}">
        <span class="cat-icon">${catIcons[cat] || "🏷️"}</span>
        <span class="cat-label">${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
        <span class="cat-count">${count}</span>
      </div>`;
    });
    html += `</div>`;
  }

  // Pinned brands
  const pinned = realDeals.filter(d => state.pinnedBrands.has(d.brand) && !heroIds.has(d.id))
    .sort((a, b) => computeHeat(b) - computeHeat(a));
  const pinnedIds = new Set(pinned.map(d => d.id));
  if (pinned.length) {
    html += `<div class="section-head"><span class="section-icon">★</span> Your Pinned</div>`;
    html += pinned.slice(0, 5).map(dealCard).join("");
  }

  // Bank Offers (grouped by merchant, collapsible)
  const banks = realDeals.filter(d => !heroIds.has(d.id) && !pinnedIds.has(d.id) && brandOf(d.brand).brand_type === "bank")
    .sort((a, b) => computeHeat(b) - computeHeat(a)).slice(0, 25);
  if (banks.length) {
    html += `<div class="section-head"><span class="section-icon">🏦</span> Bank Offers</div>`;
    html += renderMerchantGroups(banks);
  }

  // Wallet Apps
  const wallets = realDeals.filter(d => !heroIds.has(d.id) && !pinnedIds.has(d.id) && ["easypaisa", "jazzcash", "keenu"].includes(d.brand))
    .sort((a, b) => computeHeat(b) - computeHeat(a)).slice(0, 10);
  if (wallets.length) {
    html += `<div class="section-head"><span class="section-icon">👛</span> Wallet Apps</div>`;
    html += wallets.map(dealCard).join("");
  }

  // Brands & Stores
  const brands = realDeals.filter(d => !heroIds.has(d.id) && !pinnedIds.has(d.id) && !["easypaisa", "jazzcash", "keenu"].includes(d.brand)
    && brandOf(d.brand).brand_type !== "bank" && !d.brand.startsWith("govt") && brandOf(d.brand).brand_type !== "news")
    .sort((a, b) => computeHeat(b) - computeHeat(a)).slice(0, 25);
  if (brands.length) {
    html += `<div class="section-head"><span class="section-icon">🛍️</span> Brands & Stores</div>`;
    html += renderMerchantGroups(brands);
  }

  // Government
  if (govtDeals.length) {
    html += `<div class="section-head"><span class="section-icon">🏛️</span> Government</div>`;
    html += govtDeals.slice(0, 5).map(dealCard).join("");
  }

  $("#feed").innerHTML = html || `<div class="empty"><div style="font-size:40px;margin-bottom:12px">🔥</div>${t("emptyTrending")}</div>`;
  } catch (err) {
    console.error("Feed render error:", err);
    $("#feed").innerHTML = `<div class="empty"><div style="font-size:40px;margin-bottom:12px">⚠️</div>Something went wrong loading deals.<br><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer">Retry</button></div>`;
  }
}

// ---- ENDING tab: grouped by urgency bucket, countdown-first ----
function renderEndingTab(list) {
  const buckets = [
    { key: "today", label: "Ends Today", test: d => daysUntil(d.valid_until) <= 0 },
    { key: "tomorrow", label: "Ends Tomorrow", test: d => daysUntil(d.valid_until) === 1 },
    { key: "soon", label: "Next 3 Days", test: d => daysUntil(d.valid_until) >= 2 }
  ];
  let html = "";
  for (const b of buckets) {
    const items = list.filter(b.test).sort((x, y) => new Date(x.valid_until) - new Date(y.valid_until)).slice(0, 20);
    if (!items.length) continue;
    html += `<div class="section-head${b.key === "today" ? " urgent" : ""}"><span class="section-icon">${b.key === "today" ? "🚨" : b.key === "tomorrow" ? "⏰" : "⏳"}</span> ${b.label} <span class="section-count">${items.length}</span></div>`;
    html += items.map(dealCard).join("");
  }
  return html || `<div class="empty"><div style="font-size:40px;margin-bottom:12px">⏳</div>${t("emptyEnding")}</div>`;
}

// ---- FOR YOU tab: grouped by wallet/card the user selected ----
function renderForYouTab(list) {
  if (!list.length) {
    return `<div class="empty"><div style="font-size:40px;margin-bottom:12px">🎯</div>${state.myPay.size ? t("emptyForYouSet") : t("emptyForYou")}
      <button class="ss-tile" id="openWalletFromEmpty" style="margin:16px auto;display:inline-block">👛 Set up my wallets</button></div>`;
  }
  let html = "";
  const grouped = {};
  for (const d of list) {
    for (const p of (d.eligibility?.payment || [])) {
      if (state.myPay.has(p)) (grouped[p] = grouped[p] || []).push(d);
    }
  }
  const payLabel = v => (PAY_OPTIONS.find(([k]) => k === v) || [v, v])[1];
  for (const [pay, deals] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
    html += `<div class="section-head"><span class="section-icon">👛</span> ${esc(payLabel(pay))} <span class="section-count">${deals.length}</span></div>`;
    html += deals.slice(0, 15).map(dealCard).join("");
  }
  // Saved deals
  const savedDeals = list.filter(d => state.saved.has(d.id));
  if (savedDeals.length) {
    html += `<div class="section-head"><span class="section-icon">🔖</span> Your Saved <span class="section-count">${savedDeals.length}</span></div>`;
    html += savedDeals.slice(0, 10).map(dealCard).join("");
  }
  return html;
}

// ---- ALWAYS ON tab: grouped by category, "works anytime" framing ----
function renderEvergreenTab(list) {
  const byCat = {};
  for (const d of list) (byCat[d.category] = byCat[d.category] || []).push(d);
  const catIcons = {food:"🍔",shopping:"🛍️",ecommerce:"📦",retail:"🏬",fuel:"⛽",travel:"✈️",telecom:"📱",grocery:"🛒",electronics:"🔌",fashion:"👗",utilities:"💡",mobile:"📲",beauty:"💄"};
  let html = "";
  const entries = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  for (const [cat, deals] of entries) {
    html += `<div class="section-head"><span class="section-icon">${catIcons[cat] || "🏷️"}</span> ${cat.charAt(0).toUpperCase() + cat.slice(1)} <span class="section-count">${deals.length}</span></div>`;
    html += deals.slice(0, 12).map(dealCard).join("");
  }
  return html || `<div class="empty"><div style="font-size:40px;margin-bottom:12px">♾️</div>${t("emptyEvergreen")}</div>`;
}

// ---- SPOTTED tab: community feed, votes-first ----
function renderSpottedTab(list) {
  if (!list.length) return `<div class="empty"><div style="font-size:40px;margin-bottom:12px">👀</div>${t("emptySpotted")}</div>`;
  let html = `<div class="banner-info">👀 Deals spotted by the community — vote on what works.</div>`;
  html += list.slice(0, 40).map(dealCard).join("");
  return html;
}

function renderMerchantGroups(deals) {
  // Group by merchant name, show merchant once with collapsible offers
  const byMerchant = {};
  for (const d of deals) {
    const m = d.eligibility?.merchant || d.brand;
    (byMerchant[m] = byMerchant[m] || []).push(d);
  }
  let html = "";
  for (const [merchant, mDeals] of Object.entries(byMerchant)) {
    if (mDeals.length >= 2) {
      const b = brandOf(mDeals[0].brand);
      const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
      const mi = mDeals[0].merchant_info || {};
      const logoHtml = mi.logo
        ? `<div class="logo-badge sm" style="background:#fff"><img src="${esc(mi.logo)}" alt="${esc(merchant)}" class="logo-img" loading="lazy" onerror="this.parentElement.innerHTML='${initials}';this.parentElement.style.background='${b.color}'"></div>`
        : b.logo
        ? `<div class="logo-badge sm" style="background:${b.color}"><img src="${b.logo}" alt="${esc(merchant)}" class="logo-img" loading="lazy" onerror="this.parentElement.innerHTML='${initials}'"></div>`
        : `<div class="logo-badge sm" style="background:${b.color}">${initials}</div>`;
      html += `<div class="merchant-group">
        <div class="merchant-header">
          ${logoHtml}
          <span class="merchant-name">${esc(merchant)}</span>
          <span class="merchant-count">${mDeals.length} offers</span>
        </div>
        ${similarGroup(mDeals)}
      </div>`;
    } else {
      html += mDeals.map(dealCard).join("");
    }
  }
  return html;
}

// ---- deal calendar ----
function renderCalendar(list) {
  if (!list.length) return `<div class="empty"><div style="font-size:40px;margin-bottom:12px">📅</div>No upcoming deadlines.</div>`;
  const dayKey = s => s;
  const groups = {};
  list.forEach(d => { (groups[dayKey(d.valid_until)] = groups[dayKey(d.valid_until)] || []).push(d); });
  const keys = Object.keys(groups).sort();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fmt = s => {
    const dt = new Date(s + "T00:00:00");
    const diff = Math.round((dt - today) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };
  const chips = keys.slice(0, 14).map(k => {
    const dt = new Date(k + "T00:00:00");
    const diff = Math.round((dt - today) / 864e5);
    const cls = diff <= 1 ? "cal-chip hot" : "cal-chip";
    return `<button class="${cls}" data-calday="${k}">${dt.getDate()} ${dt.toLocaleDateString("en-GB", { month: "short" })}<span>${groups[k].length}</span></button>`;
  }).join("");
  const days = keys.map(k => {
    const diff = Math.round((new Date(k + "T00:00:00") - today) / 864e5);
    const cls = diff <= 1 ? " urgent" : "";
    return `<div class="cal-day${cls}" id="cal-${k}">
      <div class="cal-head"><span class="cal-date">${fmt(k)}</span><span class="cal-count">${groups[k].length} deal${groups[k].length > 1 ? "s" : ""} expire</span></div>
      ${groups[k].map(dealCard).join("")}
    </div>`;
  }).join("");
  return `<div class="cal-strip">${chips}</div>${days}`;
}

function renderBanner() {
  const tabInfo = TABS[state.tab];
  let inner = "";
  // Stale data warning
  if (DATA.meta?.generated_at) {
    const ageH = (NOW - new Date(DATA.meta.generated_at)) / 36e5;
    if (ageH > 12) {
      inner = `<div class="banner-card" style="border-color:var(--warn);color:var(--warn)">⚠️ Data is ${Math.round(ageH)}h old — deals may have changed. Pull to refresh or check back later.</div>`;
    }
  }
  if (!inner && (state.tab === "trending" || state.tab === "ending")) {
    const soon = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && daysUntil(d.valid_until) >= 0 && daysUntil(d.valid_until) <= 2);
    if (soon.length) inner = `<div class="banner-card">⏳ <b>${t("flashBanner", {n: soon.length, s: soon.length > 1 ? "s" : ""})}</b> — ${[...new Set(soon.map(s => brandOf(s.brand).name))].slice(0, 3).join(", ")}${soon.length > 3 ? " +more" : ""}</div>`;
  }
  if (!inner) inner = `<div class="banner-info">${tabInfo.hint}</div>`;
  $("#banner").innerHTML = inner;
  const live = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d)).length;
  // Freshness indicator
  let freshTag = "";
  if (DATA.meta?.generated_at) {
    const ageH = (NOW - new Date(DATA.meta.generated_at)) / 36e5;
    if (ageH < 1) freshTag = " · fresh";
    else if (ageH < 6) freshTag = ` · ${Math.round(ageH)}h ago`;
    else if (ageH < 24) freshTag = ` · ${Math.round(ageH)}h ago ⚠️`;
    else freshTag = " · stale ⚠️";
  }
}

function renderChips() {
  $("#cityChips").innerHTML = CITIES.map(c => `<button class="chip${state.city === c ? " active" : ""}" data-city="${c}">${c === "All" ? t("allCities") : c}</button>`).join("");
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

function renderSavings() {}

function renderAIInsights() {}

function renderSpendOptimizer() {}

function renderAll() { renderBanner(); renderChips(); renderFeed(); renderBell(); syncTabs(); $("#q").placeholder = t("search"); renderSearchSuggestions(); }

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
    Notif.checkExpiring();
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
    ["Card type", d.eligibility?.card_type || "Any card"],
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

  const mi2 = d.merchant_info || {};
  const logoHero = mi2.logo
    ? `<div class="logo-badge" style="background:#fff;width:52px;height:52px"><img src="${esc(mi2.logo)}" alt="${esc(b.name)}" class="logo-img" onerror="this.parentElement.innerHTML='${initials}';this.parentElement.style.background='${b.color}'"></div>`
    : b.logo
    ? `<div class="logo-badge" style="background:${b.color};width:52px;height:52px"><img src="${b.logo}" alt="${esc(b.name)}" class="logo-img" onerror="this.parentElement.innerHTML='${initials}'"></div>`
    : `<div class="logo-badge" style="background:${b.color};width:52px;height:52px;font-size:16px">${initials}</div>`;
  const coverHero = mi2.cover ? `<div class="sheet-cover"><img src="${esc(mi2.cover)}" alt="${esc(b.name)}" loading="lazy"></div>` : "";
  const heroSub = `<div class="hero-type">${b.brand_type} · ${d.category}${mi2.rating ? ` · ★ ${Number(mi2.rating).toFixed(1)}` : ""}</div>`;
  const allRows = rows.concat(mi2.contact ? [["Contact", mi2.contact]] : []);

  $("#sheet").innerHTML = `<div class="grab"></div>
    ${coverHero}
    <div class="hero-card" style="background:linear-gradient(135deg,${b.color}22,${b.color}08);border:1px solid ${b.color}44">
      ${logoHero}
      <div class="hero-info">
        <div class="hero-brand">${b.name}</div>
        ${heroSub}
      </div>
      <div class="hero-disc">
        <div class="hero-amount">${discountLabel(d.discount)}</div>
        ${d.discount?.cap ? `<div class="hero-cap">cap Rs ${Number(d.discount.cap).toLocaleString()}</div>` : ""}
      </div>
    </div>
    <h3>${esc(d.title)}</h3>
    <p class="sheet-summary">${esc(d.summary)}</p>
    ${stepsHtml}
    ${allRows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("")}
    ${d.exclusions?.length ? `<h4 class="steps-title">${t("terms")}</h4><ul>${d.exclusions.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="sheet-actions">
      <div class="sheet-quick">
        <button class="qbtn ${state.voted.has(d.id) ? 'active' : ''}" data-act="vote">▲ Hot</button>
        <button class="qbtn" data-act="worked">✓ Worked</button>
        <button class="qbtn ${state.saved.has(d.id) ? 'active' : ''}" data-act="save">🔔 Alert</button>
      </div>
      <div class="sheet-curate">
        <button class="cbtn" data-curate="pin">${state.pinnedBrands.has(d.brand) ? "★ Unpin" : "☆ Pin"} ${b.name}</button>
        <button class="cbtn hide" data-curate="hide">${state.hiddenBrands.has(d.brand) ? "Show" : "Hide"} ${b.name} deals</button>
      </div>
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

  // wire curation buttons
  $$("#sheet [data-curate]").forEach(btn => btn.addEventListener("click", () => {
    const action = btn.dataset.curate;
    if (action === "pin") {
      if (state.pinnedBrands.has(d.brand)) { state.pinnedBrands.delete(d.brand); toast(`Unpinned ${b.name}`); }
      else { state.pinnedBrands.add(d.brand); toast(`★ ${b.name} pinned to top`); }
      store.set("dr_pinned", JSON.stringify([...state.pinnedBrands]));
    }
    if (action === "hide") {
      if (state.hiddenBrands.has(d.brand)) { state.hiddenBrands.delete(d.brand); toast(`Showing ${b.name} deals`); }
      else { state.hiddenBrands.add(d.brand); toast(`${b.name} deals hidden`); }
      store.set("dr_hidden", JSON.stringify([...state.hiddenBrands]));
    }
    closeSheet(); renderFeed();
  }));

  // wire quick action buttons in sheet
  $$("#sheet [data-act]").forEach(btn => btn.addEventListener("click", () => {
    const act = btn.dataset.act;
    if (act === "vote") {
      if (state.voted.has(d.id)) state.voted.delete(d.id);
      else { state.voted.add(d.id); toast(t("hotToast")); }
      store.set("dr_voted", JSON.stringify([...state.voted]));
      btn.classList.toggle("active");
    }
    if (act === "worked") {
      d.community.worked++;
      trustCache.clear();
      const est = d.discount?.kind === "percent" ? Math.min(d.discount.value * 20, d.discount.cap || 500) : (d.discount?.value || 100);
      state.savings += est;
      store.set("dr_savings", JSON.stringify(state.savings));
      renderSavings();
      toast(t("workedToast", {n: est}));
      btn.classList.add("active");
    }
    if (act === "save") {
      if (state.saved.has(d.id)) { state.saved.delete(d.id); toast(t("alertRemoved")); }
      else { state.saved.add(d.id); Notif.ensurePermission(); addNotification(t("notifAlert", {title: d.title})); toast(t("alertSet")); }
      store.set("dr_saved", JSON.stringify([...state.saved]));
      btn.classList.toggle("active");
    }
  }));
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
// ---- daily deal popup: one random trending deal per day (date-seeded) ----
function showDailyDealPopup() {
  if (!state.onboarded) return; // onboarding is showing
  const today = new Date().toISOString().slice(0, 10);
  if (store.get("dr_daily_popup", "") === today) return;
  const pool = DATA.deals.filter(d =>
    d.status !== "evergreen" && !isHidden(d) && daysUntil(d.valid_until) >= 0 &&
    (d.discount?.value || 0) > 0 && !d.brand.startsWith("news"));
  if (!pool.length) return;
  // Date-seeded pick so it rotates daily and is stable within a day
  let seed = 0;
  for (const ch of today) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const d = pool[seed % pool.length];
  const b = brandOf(d.brand);
  const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const logo = d.merchant_info?.logo || b.logo;
  const overlay = document.createElement("div");
  overlay.className = "daily-popup-overlay";
  overlay.innerHTML = `
    <div class="daily-popup">
      <button class="daily-close" aria-label="Close">✕</button>
      <div class="daily-tag">⭐ Deal of the Day</div>
      <div class="daily-logo">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.replaceWith(document.createTextNode('${initials}'))">` : initials}</div>
      <div class="daily-disc">${discountLabel(d.discount)}</div>
      <div class="daily-title">${esc(crispTitle(d))}</div>
      <div class="daily-meta">${esc(b.name)} · <span class="pill ${countdown(d.valid_until).cls}">${countdown(d.valid_until).text}</span></div>
      <button class="daily-cta">View Deal</button>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
  const close = () => {
    store.set("dr_daily_popup", today);
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 250);
  };
  overlay.querySelector(".daily-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector(".daily-cta").addEventListener("click", () => { close(); AI.learn("view", d); openDeal(d); });
  overlay.querySelector(".daily-popup").addEventListener("click", e => {
    if (e.target.closest(".daily-logo, .daily-title")) { close(); openDeal(d); }
  });
}

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

function openExternal(url) {
  if (!url) return;
  if (window.AndroidBridge?.openExternal) {
    window.AndroidBridge.openExternal(url);
  } else {
    window.open(url, "_blank");
  }
}

// Crisp title: remove brand name repetition, trim to key info
function crispTitle(d) {
  let title = d.title || "";
  const b = brandOf(d.brand);
  // Remove "with BankName" suffix (already shown in brand line)
  title = title.replace(new RegExp(`\\s+with\\s+${b.name}$`, "i"), "");
  // Remove "at Merchant with Bank" → keep "at Merchant"
  title = title.replace(new RegExp(`\\s+with\\s+${b.name}`, "gi"), "");
  // Trim to 60 chars max
  if (title.length > 60) title = title.slice(0, 57).trimEnd() + "…";
  return title;
}

// Search suggestions based on trending data + user preferences
function searchSuggestions() {
  if (!DATA?.deals) return [];
  const active = DATA.deals.filter(d => d.status !== "evergreen" && d.status !== "spotted");
  const suggestions = new Set();

  // Top brands by deal count
  const brandCounts = {};
  active.forEach(d => { brandCounts[d.brand] = (brandCounts[d.brand] || 0) + 1; });
  Object.entries(brandCounts).sort((a,b) => b[1]-a[1]).slice(0, 4).forEach(([bid]) => {
    suggestions.add(brandOf(bid).name);
  });

  // Top categories
  const catCounts = {};
  active.forEach(d => { catCounts[d.category] = (catCounts[d.category] || 0) + 1; });
  Object.entries(catCounts).sort((a,b) => b[1]-a[1]).slice(0, 2).forEach(([cat]) => {
    suggestions.add(cat.charAt(0).toUpperCase() + cat.slice(1));
  });

  // User preference brands (from AI profile)
  if (AI.profile?.brands) {
    Object.entries(AI.profile.brands).sort((a,b) => b[1]-a[1]).slice(0, 2).forEach(([bid]) => {
      suggestions.add(brandOf(bid).name);
    });
  }

  return [...suggestions].slice(0, 6);
}

function renderSearchSuggestions() {
  const el = $("#searchSuggest");
  if (!el) return;
  const sugg = searchSuggestions();
  if (!sugg.length) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = `<div class="ss-title">Trending</div><div class="ss-tiles">${sugg.map(s => `<span class="ss-tile" data-ss="${esc(s)}">${esc(s)}</span>`).join("")}</div>`;
}

function shareDeal(d) {
  const txt = `🔥 ${d.title}\n${discountLabel(d.discount)}${d.discount?.cap ? " (cap Rs " + d.discount.cap + ")" : ""}\nValid till ${d.valid_until}\n${d.summary}\n\nvia DealRadar PK`;
  if (navigator.share) {
    navigator.share({ title: d.title, text: txt }).catch(() => {});
  } else {
    openExternal("https://wa.me/?text=" + encodeURIComponent(txt));
  }
}

function syncTabs() {
  const icons = { trending: "🔥", foryou: "🎯", ending: "⏳", evergreen: "♾️", spotted: "👀", calendar: "📅" };
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
    searchTimeout = setTimeout(() => {
      state.q = e.target.value;
      const el = $("#searchSuggest");
      if (state.q.trim()) el.classList.add("hidden");
      else renderSearchSuggestions();
      scheduleRender(); updateBackBtn();
    }, 250);
  });
  $("#cityChips").addEventListener("click", e => { const b = e.target.closest("[data-city]"); if (!b) return; state.city = b.dataset.city; renderChips(); scheduleRender(); updateBackBtn(); });
  $("#feed").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; state.cat = b.dataset.cat; scheduleRender(); updateBackBtn(); });

  // Search suggestion tiles
  $("#searchSuggest").addEventListener("click", e => {
    const tile = e.target.closest("[data-ss]"); if (!tile) return;
    const val = tile.dataset.ss;
    $("#q").value = val; state.q = val;
    renderSearchSuggestions(); scheduleRender(); updateBackBtn();
  });

  // Category tiles on dashboard
  $("#feed").addEventListener("click", e => {
    const catTile = e.target.closest(".cat-tile");
    if (catTile) { state.cat = catTile.dataset.cat; pushNav("cat"); scheduleRender(); return; }
    const heroCard = e.target.closest(".hero-card-big, .hero-card-sm");
    if (heroCard) {
      const d = DATA.deals.find(x => x.id === heroCard.dataset.id);
      if (d) { AI.learn("view", d); openDeal(d); }
      return;
    }
  });
  $("#feed").addEventListener("click", e => {
    if (e.target.closest("#openWalletFromEmpty")) { $("#walletBtn").click(); }
  });
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

  // AI Chat
  $("#aiFab").addEventListener("click", () => {
    $("#aiChat").classList.remove("hidden");
    $("#aiInput").focus();
  });
  $("#aiChatClose").addEventListener("click", () => $("#aiChat").classList.add("hidden"));
  const sendAI = () => {
    const input = $("#aiInput");
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    const body = $("#aiChatBody");
    body.insertAdjacentHTML("beforeend", `<div class="ai-msg ai-user">${esc(q)}</div>`);
    setTimeout(() => {
      const result = AI.chat(q);
      body.insertAdjacentHTML("beforeend", `<div class="ai-msg ai-bot">${esc(result.text)}</div>`);
      result.deals.forEach(d => {
        body.insertAdjacentHTML("beforeend", `<div class="ai-msg ai-deal" data-ai-deal="${d.id}">
          <div class="ai-deal-title">${esc(d.title)}</div>
          <div class="ai-deal-meta">${esc(d.cities?.join(", ") || "")} · ${countdown(d.valid_until).text}</div>
          <span class="ai-deal-disc">${discountLabel(d.discount)}</span>
        </div>`);
      });
      body.scrollTop = body.scrollHeight;
    }, 400);
    body.scrollTop = body.scrollHeight;
  };
  $("#aiSend").addEventListener("click", sendAI);
  $("#aiInput").addEventListener("keydown", e => { if (e.key === "Enter") sendAI(); });
  $("#aiChatBody").addEventListener("click", e => {
    const el = e.target.closest("[data-ai-deal]");
    if (!el) return;
    const d = DATA.deals.find(x => x.id === el.dataset.aiDeal);
    if (d) { $("#aiChat").classList.add("hidden"); AI.learn("view", d); openDeal(d); }
  });
  $("#feed").addEventListener("click", e => {
    // calendar chip jump
    const chip = e.target.closest("[data-calday]");
    if (chip) {
      const sec = document.getElementById("cal-" + chip.dataset.calday);
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // compare button
    const cmp = e.target.closest("[data-compare]");
    if (cmp) { openCompare(cmp.dataset.compare); return; }
    // similar deals dropdown toggle
    const sgToggle = e.target.closest("[data-sg]");
    if (sgToggle) {
      const list = document.getElementById(sgToggle.dataset.sg);
      if (list) {
        list.classList.toggle("hidden");
        sgToggle.textContent = list.classList.contains("hidden")
          ? sgToggle.textContent.replace("▴", "▾")
          : sgToggle.textContent.replace("▾", "▴");
      }
      return;
    }
    const card = e.target.closest(".deal"); if (!card) return;
    const d = DATA.deals.find(x => x.id === card.dataset.id); if (!d) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "details" || !act) { AI.learn("view", d); return openDeal(d); }
    if (act === "vote") {
      if (state.voted.has(d.id)) { state.voted.delete(d.id); }
      else { state.voted.add(d.id); toast(t("hotToast")); AI.learn("vote", d); }
      store.set("dr_voted", JSON.stringify([...state.voted]));
    }
    if (act === "worked") {
      d.community.worked++;
      trustCache.clear();
      AI.learn("worked", d);
      // savings tracker: estimate savings from discount
      const est = d.discount?.kind === "percent" ? Math.min(d.discount.value * 20, d.discount.cap || 500) : (d.discount?.value || 100);
      state.savings += est;
      store.set("dr_savings", JSON.stringify(state.savings));
      renderSavings();
      toast(t("workedToast", {n: est}));
    }
    if (act === "save") {
      if (state.saved.has(d.id)) { state.saved.delete(d.id); toast(t("alertRemoved")); }
      else { state.saved.add(d.id); Notif.ensurePermission(); addNotification(t("notifAlert", {title: d.title})); toast(t("alertSet")); AI.learn("save", d); }
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
    if (!silent) toast("📴 Offline — showing cached deals");
  }
  isRefreshing = false;
}

function setupLiveRefresh() {
  // Auto-refresh every 5 minutes
  refreshInterval = setInterval(fetchLive, 300000);

  // Pull-to-refresh
  let startY = 0, pulling = false;
  const ptr = $("#ptr");
  document.addEventListener("touchstart", e => {
    if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 80 && window.scrollY === 0) {
      pulling = false;
      if (ptr) { ptr.classList.add("show"); setTimeout(() => ptr.classList.remove("show"), 1200); }
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
    renderWalletPanel(); syncTabs(); renderAll(); wire(); startTicking(); setTimeout(() => Notif.checkExpiring(), 3000);
    setupLiveRefresh();
    // dismiss splash once first paint is ready
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sp = $("#splash");
      if (sp) { setTimeout(() => sp.classList.add("gone"), 350); }
    }));
    showOnboarding();
    setTimeout(showDailyDealPopup, 900);
  } catch (err) {
    console.error("DealRadar init error:", err);
    const sp = $("#splash"); if (sp) sp.classList.add("gone");
    $("#feed").innerHTML = `<div class="empty"><div style="font-size:40px;margin-bottom:12px">📡</div>Something went wrong loading deals.<br><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer">Retry</button></div>`;
  }
})();
