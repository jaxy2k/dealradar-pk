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

// ---- Supabase config (safe: anon key is a public client key) ----
const SUPABASE = {
  url: window.__SUPABASE_URL__ || "https://ygcwdwlwxcjqlxdshvup.supabase.co",
  anonKey: window.__SUPABASE_ANON__ || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlnY3dkd2x3eGNqcWx4ZHNodnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1MTY3NTUsImV4cCI6MjEwNjA5Mjc1NX0.ijAhLsZc1PpucE3an58wvvGfw1EA59CRexrVpf9uf28"
};

// ---- Supabase client (PostgREST + GoTrue anon auth, plain fetch — no SDK) ----
const SB = {
  enabled: !!(SUPABASE.url && SUPABASE.anonKey),
  userId: null,
  accessToken: null,
  _headers(extra) {
    const h = {
      "apikey": SUPABASE.anonKey,
      "Content-Type": "application/json",
      ...(extra || {})
    };
    if (this.accessToken) h["Authorization"] = "Bearer " + this.accessToken;
    else h["Authorization"] = "Bearer " + SUPABASE.anonKey;
    return h;
  },
  // Anonymous sign-in: silent device identity, no login wall (per "minimal effort" spec)
  async signInAnon() {
    if (!this.enabled) return null;
    try {
      const r = await fetch(SUPABASE.url + "/auth/v1/signup", {
        method: "POST",
        headers: { "apikey": SUPABASE.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!r.ok) throw new Error("anon signup " + r.status);
      const j = await r.json();
      this.accessToken = j.access_token; this.userId = j.user?.id;
      store.set("dr_sb_token", this.accessToken || "");
      store.set("dr_sb_uid", this.userId || "");
      return this.userId;
    } catch (e) { console.warn("SB anon signin failed:", e.message); return null; }
  },
  restoreSession() {
    this.accessToken = store.get("dr_sb_token", "") || null;
    this.userId = store.get("dr_sb_uid", "") || null;
  },
  // MUST stay synchronous: callers use the chained query-builder form
  // `SB.from(table).select(...)` / `.insert(...)` / `.update(...)`. Declaring this
  // `async` wrapped the builder in a Promise, so `.select` was undefined and every
  // community push, vote and shared-deal pull failed with a TypeError. The builder's
  // own methods are async, so chaining and `.catch()` still behave as intended.
  from(table) {
    return {
      select: async (cols = "*", qs = "") => {
        const r = await fetch(`${SUPABASE.url}/rest/v1/${table}?select=${cols}${qs}`, { headers: this._headers({ "Accept": "application/json" }) });
        if (!r.ok) throw new Error(`${table} select ${r.status}`);
        return r.json();
      },
      insert: async (rows) => {
        const r = await fetch(`${SUPABASE.url}/rest/v1/${table}`, {
          method: "POST",
          headers: this._headers({ "Prefer": "return=representation, resolution=merge-duplicates" }),
          body: JSON.stringify(rows)
        });
        if (!r.ok) throw new Error(`${table} insert ${r.status}: ${await r.text()}`);
        return r.json();
      },
      update: async (patch, qs) => {
        const r = await fetch(`${SUPABASE.url}/rest/v1/${table}?${qs}`, {
          method: "PATCH",
          headers: this._headers({ "Prefer": "return=representation" }),
          body: JSON.stringify(patch)
        });
        if (!r.ok) throw new Error(`${table} update ${r.status}`);
        return r.json();
      }
    };
  }
};

// Map a DB deal row → the app's deal object shape (reverse of normalizeDeal)
function dbDealToApp(row) {
  return {
    id: row.id, brand: row.merchant_id || row.brand || "community",
    brand_brand_type: "brand", category: row.category || "all",
    title: row.title, summary: row.summary || "",
    discount: row.discount || null,
    code: row.code || null,
    eligibility: { payment: [], merchant: row.brand || "", user: "any", min_spend: null },
    cities: row.cities || ["All Pakistan"],
    valid_from: row.starts_at ? row.starts_at.slice(0, 10) : (row.created_at || "").slice(0, 10),
    valid_until: row.expires_at ? row.expires_at.slice(0, 10) : null,
    steps: row.steps || [], exclusions: row.exclusions || [],
    campaign_type: row.campaign_type || null,
    collect_required: !!row.collect_required, app_only: !!row.app_only, restrictions: row.restrictions || null,
    created_at: row.created_at, starts_at: row.starts_at, expires_at: row.expires_at,
    last_verified_at: row.last_verified_at, first_seen_at: row.first_seen_at, last_seen_at: row.last_seen_at,
    source: { type: row.source_type, platform: row.source_name || row.source_type, url: row.source_url || "", status: row.verification, captured_at: row.created_at },
    source_type: row.source_type, source_name: row.source_name,
    status: row.status, verification: row.verification, confidence: row.confidence ?? 0.5,
    founder_verified: !!row.founder_verified, extraction_confidence: row.extraction_confidence,
    verification_count: row.verification_count || 0, failure_count: row.failure_count || 0,
    merchant_info: { name: row.brand },
    community: { votes: 0, worked: row.verification_count || 0, failed: row.failure_count || 0, saves: 0, reports_expired: row.reports_expired || 0, spotted_by: row.source_type }
  };
}
// Map an app deal object → a DB row (for founder/screenshot/community submissions)
function appDealToDb(d) {
  return {
    id: d.id, merchant_id: d.brand, brand: d.merchant_info?.name || d.brand,
    title: d.title, summary: d.summary, category: d.category, cities: d.cities || [],
    discount: d.discount, code: d.code, steps: d.steps || [], exclusions: d.exclusions || [],
    campaign_type: d.campaign_type, collect_required: !!d.collect_required, app_only: !!d.app_only,
    restrictions: d.restrictions,
    starts_at: d.starts_at, expires_at: d.expires_at, first_seen_at: d.first_seen_at, last_seen_at: d.last_seen_at,
    source_type: d.source?.type || "community", source_name: d.source?.platform || null, source_url: d.source?.url || null,
    status: d.status || "reviewing", verification: d.verification || "pending",
    confidence: d.confidence ?? 0.5, founder_verified: !!d.founder_verified,
    extraction_confidence: d.extraction_confidence ?? null,
    verification_count: d.verification_count || 0, failure_count: d.failure_count || 0,
    reports_expired: d.community?.reports_expired || 0,
    submitted_by: SB.userId, created_at_client: new Date().toISOString()
  };
}

// ---- Supabase sync layer (writes go live; reads merge into the feed) ----
// Failed pushes are queued in localStorage and replayed on boot/online/fetch.
function syncQueue() { try { return JSON.parse(store.get("dr_sync_queue", "[]")); } catch { return []; } }
function syncQueuePush(item) {
  const q = syncQueue();
  if (item.deal && q.some(x => x.kind === item.kind && x.deal && x.deal.id === item.deal.id)) return;
  q.push(item);
  try { store.set("dr_sync_queue", JSON.stringify(q.slice(-50))); } catch (e) {}
}
async function flushSyncQueue() {
  if (!SB.enabled) return;
  const q = syncQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      if (item.kind === "deal") await Sync._pushDeal(item.deal, item.profile, true);
      else if (item.kind === "vote") await Sync._pushVote(item.deal, item.voteType, true);
    } catch (e) { remaining.push(item); }
  }
  try { store.set("dr_sync_queue", JSON.stringify(remaining)); } catch (e) {}
}
const Sync = {
  // Push a locally-created deal (founder/screenshot/community) to Supabase.
  // On failure the payload is queued for replay — user data is never dropped.
  async pushDeal(d, merchantProfile) {
    if (!SB.enabled) { syncQueuePush({ kind: "deal", deal: d, profile: merchantProfile || null }); return false; }
    const ok = await this._pushDeal(d, merchantProfile, false);
    if (!ok) syncQueuePush({ kind: "deal", deal: d, profile: merchantProfile || null });
    return ok;
  },
  async _pushDeal(d, merchantProfile, rethrow) {
    try {
      // Merchant insert is best-effort: a duplicate (brand already exists
      // server-side) must NOT block the deal insert.
      if (merchantProfile) {
        try {
          await SB.from("merchants").insert([{
            id: merchantProfile.id, name: merchantProfile.name, brand_type: merchantProfile.brand_type,
            color: merchantProfile.color, logo: merchantProfile.logo, created_by: d.source?.type === "founder" ? "founder" : "community"
          }]);
        } catch (me) {
          if (!/23505|duplicate|unique/i.test(me.message)) console.warn("merchant upsert skipped:", me.message);
        }
      }
      await SB.from("deals").insert([appDealToDb(d)]);
      return true;
    } catch (e) {
      if (rethrow) throw e;
      console.warn("pushDeal failed (queued for retry):", e.message);
      return false;
    }
  },
  // Record a verification vote; failures are queued for replay too
  async pushVote(d, voteType) {
    if (!SB.enabled) { syncQueuePush({ kind: "vote", deal: { id: d.id }, voteType }); return false; }
    const ok = await this._pushVote(d, voteType, false);
    if (!ok) syncQueuePush({ kind: "vote", deal: { id: d.id }, voteType });
    return ok;
  },
  async _pushVote(d, voteType, rethrow) {
    try {
      await SB.from("verifications").insert([{ deal_id: d.id, vote_type: voteType, user_id: SB.userId }]);
      const patch = { last_verified_at: new Date().toISOString() };
      if (voteType === "working") patch.verification_count = (d.verification_count || 0) + 1;
      if (voteType === "expired") { patch.failure_count = (d.failure_count || 0) + 1; patch.reports_expired = (d.community?.reports_expired || 0); }
      if (voteType === "wrong_price" || voteType === "wrong_code") patch.failure_count = (d.failure_count || 0) + 1;
      await SB.from("deals").update(patch, `id=eq.${encodeURIComponent(d.id)}`);
      return true;
    } catch (e) {
      if (rethrow) throw e;
      console.warn("pushVote failed (queued for retry):", e.message);
      return false;
    }
  },
  // Pull shared deals from Supabase and merge into the local feed
  async pullDeals() {
    if (!SB.enabled) return 0;
    try {
      // pull community merchant profiles first so names resolve
      try {
        const merchants = await SB.from("merchants").select("*", "&limit=200");
        const bIds = new Set(DATA.brands.map(b => b.id));
        merchants.forEach(m => {
          if (m.id && !bIds.has(m.id)) {
            DATA.brands.push({ id: m.id, name: m.name, brand_type: m.brand_type || "merchant", color: m.color || "#7c5cff", logo: m.logo || null, merchant_profile: { created_at: m.created_at, created_by: m.created_by || "community", deal_count: m.deal_count || 0 } });
            bIds.add(m.id);
          }
        });
      } catch (e) { /* merchants optional */ }
      const rows = await SB.from("deals").select("*", "&order=created_at.desc&limit=200");
      if (!rows.length) return 0;
      const ids = new Set(DATA.deals.map(d => d.id));
      let added = 0;
      rows.forEach(r => {
        if (r.status === "flagged") return;
        if (!ids.has(r.id)) { DATA.deals.push(normalizeDeal(dbDealToApp(r))); added++; }
      });
      return added;
    } catch (e) { console.warn("pullDeals failed:", e.message); return 0; }
  }
};
window.__SB = SB; window.__Sync = Sync; // exposed for debugging / Android bridge

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
    home: "Home", explore: "Explore", cards: "My Cards",
    // Rozana: offer-type chips + home sections (text labels, never colour alone)
    otBank: "Bank card", otWallet: "Wallet", otFood: "Food", otDeal: "Deal",
    filterAllTypes: "All types", yourCard: "Your card", endingSoon: "Ending soon",
    tab_trending_head: "Top offers", walletSetup: "Set up wallets & cards", savedHead: "Your saved deals",
    nudgeText: "Add the cards & wallets you carry to see only offers you can use.",
    nudgeSetup: "Add my cards", nudgeDismiss: "Dismiss wallet prompt",
    verified: "✓ Verified", unverified: "Unverified",
    officialPage: "official page", viaSocial: "via {p}",
    minSpend: "min Rs {n}", capRs: "cap Rs {n}",
    workedRate: "{n}% worked",
    emptyTrending: "No trending deals right now. Check back soon!",
    fallbackBanner: "Couldn't load live offers — showing the built-in sample list. Offers may be out of date.",
    retry: "Retry",
    emptyForYou: "Add your wallets & cards to see deals matched to you.",
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
    ongoingLabel: "Ongoing", endDateNA: "End date unavailable",
    endsOn: "Ends {date}",
    expiringThisWeek: "Expiring this week", ending3d: "Expiring within 3 days.",
    endingWeek: "Expiring within 7 days.", endingEmpty: "No deals ending soon.",
    backToTrending: "See trending deals",
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
    home: "ہوم", explore: "ایکسپلور", cards: "میرے کارڈز",
    otBank: "بینک کارڈ", otWallet: "والٹ", otFood: "کھانا", otDeal: "ڈیل",
    filterAllTypes: "تمام اقسام", yourCard: "آپ کا کارڈ", endingSoon: "جلد ختم",
    tab_trending_head: "بہترین آفرز", walletSetup: "والٹس اور کارڈز مرتب کریں", savedHead: "آپ کی محفوظ ڈیلز",
    nudgeText: "وہ کارڈز اور والٹس شامل کریں جو آپ ساتھ رکھتے ہیں تاکہ صرف قابلِ استعمال آفرز دکھائی دیں۔",
    nudgeSetup: "میرے کارڈز شامل کریں", nudgeDismiss: "یاد دہانی بند کریں",
    verified: "✓ تصدیق شدہ", unverified: "غیر تصدیق شدہ",
    officialPage: "آفیشل پیج", viaSocial: "{p} سے",
    minSpend: "کم از کم Rs {n}", capRs: "کیپ Rs {n}",
    workedRate: "{n}% کام کیا",
    emptyTrending: "ابھی کوئی ٹرینڈنگ ڈیل نہیں۔ جلد واپس آئیں!",
    fallbackBanner: "لائیو آفرز لوڈ نہیں ہو سکیں — بلک ان نمونہ فہرست دکھائی جا رہی ہے۔ آفرز پرانی ہو سکتی ہیں۔",
    retry: "دوبارہ کوشش",
    emptyForYou: "اپنے والٹس اور کارڈز شامل کریں تاکہ آپ سے میچنگ ڈیلز دکھیں۔",
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
    ongoingLabel: "جاری ہے", endDateNA: "تاریخ اختتام دستیاب نہیں",
    endsOn: "{date} تک",
    expiringThisWeek: "اس ہفتے ختم", ending3d: "تین دن میں ختم۔",
    endingWeek: "سات دن میں ختم۔", endingEmpty: "کوئی ڈیل جلد ختم نہیں ہو رہی۔",
    backToTrending: "ٹرینڈنگ ڈیلز دیکھیں",
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
  home: { label: "Home", hint: "Curated deals ranked by relevance and urgency." },
  explore: { label: "Explore", hint: "Categories, collections, and deadlines." },
  saved: { label: "Saved", hint: "Offers you bookmarked for later." },
  cards: { label: "My Cards", hint: "Payment methods and matched offers." }
};

let NOW = new Date(); // Production: real time. Prototype: overridden by meta.now after data load.
const state = {
  tab: "home", q: "", city: "All", cat: "all", otype: "all",
  myPay: new Set(JSON.parse(store.get("dr_pay", "[]"))),
  voted: new Set(JSON.parse(store.get("dr_voted", "[]"))),
  saved: new Set(JSON.parse(store.get("dr_saved", "[]"))),
  hiddenBrands: new Set(JSON.parse(store.get("dr_hidden", "[]"))),
  pinnedBrands: new Set(JSON.parse(store.get("dr_pinned", "[]"))),
  savings: JSON.parse(store.get("dr_savings", "0")),
  notifications: JSON.parse(store.get("dr_notifs", "[]")),
  onboarded: store.get("dr_onboarded", "false") === "true",
  walletNudgeDismissed: store.get("dr_wallet_nudge_dismissed", "false") === "true"
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
    const active = deals.filter(d => d.status !== "evergreen" && !isHidden(d) && !isNews(d));

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
      [/(food|khana|khane|khaana|\beat\b|\beats\b|eating|dinner|lunch|breakfast|restaurant|pizza|burger|bbq|biryan|کھانا|کھانے|ریسٹورنٹ)/, "food"],
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

    // FAQ — keyword clusters (app how-to questions, not deal queries)
    const FAQ = [
      [/(how (do|does|to)|kaise|howto).*(submit|post|add|share|spot)|deal (kaise|how).*(add|post|submit|share)|screenshot.*(submit|post|kaise)/,
        "📸 Easiest way: tap the big **+ Submit** button, drop a screenshot of the deal. Our AI reads it and fills everything in — you just verify the details. No screenshot? Tap \"✏️ Type it yourself\" for the quick form."],
      [/(verify|vote|worked|didn.?t work|issue with|galat|correct ya)/,
        "🛡️ Every deal shows a trust badge. Open a deal and tap **✅ Worked** or **❌ Expired/Issue** — your votes keep the community honest. Deals with bad reports sink automatically."],
      [/(notif|alert|remind|yad dahan|cancel.*notif|band.*kar)/,
        "🔔 Tap the bell 🔔 to see alerts. To control them: Settings → Notifications. Expired-deal alerts for deals you saved appear automatically."],
      [/(offline|internet|nahi chal|\bhang\b|\bhung\b|\bcrash|\bcrashed\b|problem with app|app (na|not|doesnt|doesn.t|won.t|wont) work)/,
        "📴 Works offline too — deals you've already seen stay cached. If something looks stuck, pull down to refresh. Your pending submits are queued and sent as soon as you're back online."],
      [/(change|switch|convert).{0,20}(language|urdu|english)|language.{0,20}(change|switch|karo|kaise)|(urdu|english) (mein|me |main|into|karo|kar)/,
        "🌐 Switch anytime: the **اُ / EN** toggle in the header flips the whole app between Urdu and English."],
      [/(saved|wallet|bookmark|my deal|kahan.*mile|where.*see.*deal)/,
        "💛 Saved deals live in your **Wallet** tab (bottom bar). Spotted deals — yours and the community's — are under the **Spotted** tab."],
      [/(safe|privacy|data|password|account|login|signup|sign in|register|mera data)/,
        "🔐 No account needed. Your saves live only on your device. What you submit goes to the community feed — never share personal info in a screenshot."],
      [/(who (made|created)|founder|about (app|us)|kis ne banaya|team|dealradar)/,
        "👑 DealRadar PK is a community-powered deal radar for Pakistan — founder-seeded deals wear the 👑 badge, and every user can spot, verify and vote."],
    ];
    for (const [re, ans] of FAQ) {
      if (re.test(q)) return { text: ans, deals: [] };
    }

    // Deal-detail lookup — "tell me about <brand> deal", "<brand> ki deal kya hai"
    const detailMatch = q.match(/\b(foodpanda|daraz|careem|bykea|gloredeals?|easypaisa|jazzcash|hbl|ubl|meezan|alfalah|mcb|askari|kibla|nesto|karachi wala|burger ?labz|domino|kfc|mcdonald|pizza hut|sapphire|generate|shinny|barbeque ?nation)\b/);
    if (detailMatch && /(deal|offer|discount|code|kya|batao|detail|condition|kitne|terms|expiry|valid)/.test(q)) {
      const name = detailMatch[1].replace(/\s/g, "");
      const hit = active.find(d => ((d.brand || "") + " " + (d.title || "") + " " + (d.id || "")).toLowerCase().replace(/\s/g, "").includes(name));
      if (hit) {
        const disc = hit.discount?.kind === "percent" ? `${hit.discount.value}% off` : `Rs ${hit.discount.value} off`;
        const code = hit.code ? ` | Code: ${hit.code}` : "";
        const until = hit.valid_until ? ` | Valid till ${hit.valid_until}` : "";
        const cond = hit.eligibility?.min_spend ? `\nMinimum spend: Rs ${hit.eligibility.min_spend}.` : "";
        return { text: `📌 ${hit.title} (${hit.brand}) — ${disc}${code}${until}\nCities: ${(hit.cities || []).join(", ")}\n${hit.summary || ""}${cond}`, deals: [hit] };
      }
    }

    // Honesty guard — off-topic question with no deal signal at all
    const DEAL_WORDS = /(deal|offer|discount|sale|coupon|code|save|cheap|sasta|kharid|khana|food|shop|bank|card|subsidy|govt|sarkar|load|recharge|pizza|burger|grocery|travel|flight|hotel|percent|%|rs|rupee|karachi|lahore|islamabad|pindi|multan|faisal|peshawar|quetta|khaana|khareed|free)/;
    if (!city && !bankId && !category && !pctMatch && !amtMatch && !DEAL_WORDS.test(q) && !/[0-9]/.test(q)) {
      return { text: "🤖 I'm DealRadar's deal bot — I only know about deals, discounts and savings in Pakistan. Things like \"best food deals in Lahore\" or \"solar subsidy\" work great; anything else I honestly don't!", deals: [] };
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
      const soon = results.filter(d => daysUntil(d) <= 3);
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
  if (state.city !== "All" || state.cat !== "all" || state.otype !== "all") {
    state.city = "All"; state.cat = "all"; state.otype = "all";
    renderChips(); renderFeed(); updateBackBtn();
    return;
  }
  // 5. If not on trending tab → go to trending
  if (state.tab !== "trending") {
    state.tab = "home"; state.feedRendered = false;
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

function expiryDate(value) {
  if (value && typeof value === "object") {
    if (value.expires_at) return new Date(value.expires_at);
    value = value.valid_until;
  }
  if (!value) return null;
  return new Date(String(value).includes("T") ? value : value + "T23:59:59+05:00");
}
function msLeft(value) {
  const end = expiryDate(value);
  return end && !Number.isNaN(end.getTime()) ? end - NOW : Infinity;
}
function daysUntil(value) { return Math.ceil(msLeft(value) / 86400000); }
// Expiry trust model. msLeft() returns Infinity for missing/unparseable dates,
// so we must never feed that into a day count. Each offer's expiry resolves to
// exactly one explicit, honest state:
//   expired     -> a real date already in the past
//   ongoing     -> ONLY status==="evergreen": the offer is *semantically*
//                  long-running. Never inferred from a missing date.
//   soon        -> a trustworthy near-term date (< SOON_MAX_DAYS) -> real countdown
//   longdated   -> a real, far-but-plausible date (SOON_MAX_DAYS..PLACEHOLDER_MIN_DAYS)
//                  -> show the actual end date, no fake urgency, no absurd number
//   placeholder -> a date that exists but is implausibly far (>= PLACEHOLDER_MIN_DAYS),
//                  e.g. Allied 2036 ("3727d") or a 439d standing voucher -> untrusted
//   missing     -> no expiry date at all -> we do NOT know an end date
// "Ongoing" is reserved for evergreen only; missing and placeholder are shown as
// "End date unavailable" so the UI never claims an offer is ongoing just because
// its expiry is absent or untrustworthy.
const SOON_MAX_DAYS = 90;        // countdown shown when days < 90
const PLACEHOLDER_MIN_DAYS = 365; // >= 365 days treated as placeholder/untrusted
function expiryISO(value) {
  let v = value;
  if (v && typeof v === "object") v = v.expires_at || v.valid_until;
  return v ? String(v).slice(0, 10) : null;
}
function expiryState(d) {
  const ms = msLeft(d);
  if (ms <= 0) return "expired";
  if (d.status === "evergreen") return "ongoing";   // semantic, data-supported
  if (!isFinite(ms)) return "missing";              // no expiry date at all
  const days = Math.floor(ms / 86400000);
  if (days < SOON_MAX_DAYS) return "soon";
  if (days < PLACEHOLDER_MIN_DAYS) return "longdated";
  return "placeholder";
}
function countdown(value) {
  // Recurring deals: show day pattern instead of countdown
  if (value && value.valid_days && value.valid_days.length > 0) {
    const dayNames = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
    const days = value.valid_days.map(d => dayNames[d] || d);
    const label = days.length === 7 ? "Daily" : "Every " + days.join("–");
    return { text: label, cls: "ongoing", ms: Infinity };
  }
  const state = expiryState(value);
  if (state === "expired") return { text: t("expired"), cls: "red", ms: 0 };
  if (state === "ongoing") return { text: t("ongoingLabel"), cls: "ongoing", ms: Infinity };
  if (state === "missing" || state === "placeholder")
    return { text: t("endDateNA"), cls: "muted", ms: Infinity };
  if (state === "longdated") return { text: expiryDateLabel(value), cls: "muted", ms: msLeft(value) };
  const ms = msLeft(value);
  const days = Math.floor(ms / 86400000);
  if (days >= 2) return { text: t("dLeft", {n: days}), cls: days <= 3 ? "count" : "", ms };
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs === 0) return { text: `${Math.max(1, mins)}m left`, cls: "count red", ms };
  return { text: t("hLeft", {h: hrs, m: mins}), cls: "count red", ms };
}
const _MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function expiryDateLabel(value) {
  const iso = expiryISO(value); if (!iso) return t("endDateNA");
  const p = iso.split("-"); if (p.length !== 3) return t("endDateNA");
  return t("endsOn", { date: `${_MON[(+p[1]) - 1]} ${+p[2]}, ${p[0]}` });
}
// Ending tab selection. Preserve the 3-day definition when trustworthy offers
// exist; otherwise fall back to genuine 7-day offers, labelled "this week".
// Only offers with a RELIABLE near-term expiry (state "soon") qualify — never
// imply urgency for a placeholder/untrustworthy date. Computed from data so the
// banner, list and empty-state always agree regardless of render order.
function endingCandidates(all) {
  return all.filter(d => d.status !== "evergreen" && (d.discount?.value || 0) > 0 &&
    expiryState(d) === "soon" && daysUntil(d) >= 0 && daysUntil(d) <= 7);
}
function endingMode(all) {
  const list = all || DATA.deals.filter(baseFilter);
  const soon = endingCandidates(list).filter(d => daysUntil(d) <= 3);
  return soon.length ? "3d" : "7d";
}
function endingDeals(all) {
  const mode = endingMode(all);
  const max = mode === "3d" ? 3 : 7;
  return endingCandidates(all).filter(d => daysUntil(d) <= max)
    .sort((a, b) => new Date(a.valid_until) - new Date(b.valid_until));
}
function calendarDeals(all) {
  return all.filter(d => d.status !== "evergreen" && d.status !== "spotted" && (d.discount?.value || 0) > 0 &&
    (expiryState(d) === "soon" || expiryState(d) === "longdated"))
    .sort((a, b) => new Date(a.valid_until) - new Date(b.valid_until));
}
function hoursSince(iso) { return iso ? (NOW - new Date(iso)) / 3600000 : Infinity; }

function normalizeDeal(d) {
  const created = d.created_at || d.first_seen_at || d.source?.captured_at || null;
  d.created_at = created;
  d.starts_at = d.starts_at || (d.valid_from ? `${d.valid_from}T00:00:00+05:00` : created);
  d.expires_at = d.expires_at || (d.valid_until ? `${d.valid_until}T23:59:59+05:00` : null);
  d.last_verified_at = d.last_verified_at || null;
  d.source_type = d.source_type || d.source?.type || "unknown";
  d.source_name = d.source_name || d.source?.platform || d.brand || "unknown";
  d.verification_count = Number(d.verification_count ?? d.community?.worked ?? 0);
  d.failure_count = Number(d.failure_count ?? d.community?.failed ?? 0) + Number(d.community?.reports_expired ?? 0);
  return d;
}
function normalizeDataset(data) {
  (data?.deals || []).forEach(normalizeDeal);
  return data;
}
// ---- local persistence for user-added deals (founder / screenshot / community) ----
// Bridges the gap until Supabase. Stored deals are merged back in on load.
const LOCAL_DEAL_PREFIX = /^(f|s|u)\d+$/;
function isLocalDeal(d) { return LOCAL_DEAL_PREFIX.test(String(d.id)); }
function loadLocalDeals() { try { return JSON.parse(store.get("dr_local_deals", "[]")); } catch { return []; } }
function persistLocalDeals() {
  try { store.set("dr_local_deals", JSON.stringify(DATA.deals.filter(isLocalDeal))); } catch (e) {}
}
function restoreLocalDeals() {
  const bIds = new Set(DATA.brands.map(b => b.id));
  deviceBrands().forEach(b => { if (!bIds.has(b.id)) { DATA.brands.push(b); bIds.add(b.id); } });
  const locals = loadLocalDeals();
  if (!locals.length) return;
  const ids = new Set(DATA.deals.map(d => d.id));
  locals.forEach(d => { if (!ids.has(d.id)) DATA.deals.push(d); });
  DATA.deals.forEach(normalizeDeal);
  locals.forEach(d => {
    const mp = d.__brand_profile;
    if (mp && !bIds.has(mp.id)) { DATA.brands.push(mp); bIds.add(mp.id); }
  });
}
// Stamp a newly-created merchant profile onto its deal, then persist all local deals.
function saveLocalDeal(deal, resolution) {
  if (resolution?.isNew && resolution.profile) deal.__brand_profile = resolution.profile;
  persistLocalDeals();
}
function lifecycleOf(d) {
  const left = msLeft(d);
  if (left <= 0) return "expired";
  if (d.status === "reported" || d.failure_count >= 3) return "reported";
  if (d.status === "flagged") return "flagged";
  if (d.status === "reviewing" || d.verification === "pending") return "reviewing";
  if (d.starts_at && new Date(d.starts_at) > NOW) return "new";
  if (left <= 24 * 36e5) return "expiring_soon";
  if (d.created_at && hoursSince(d.created_at) <= 24) return "new";
  return "active";
}
function isFlashDeal(d) {
  const duration = d.starts_at && d.expires_at ? new Date(d.expires_at) - new Date(d.starts_at) : Infinity;
  return !!(d.campaign_type || d.first_seen_at || (Number.isFinite(duration) && duration <= 7 * 864e5));
}
function expiryMs(d) { return msLeft(d); }
function flashScore(d) {
  const hours = Math.max(0, expiryMs(d) / 36e5);
  const age = Math.max(0, hoursSince(d.first_seen_at || d.source?.captured_at || NOW.toISOString()));
  const urgency = hours <= 6 ? 100 : hours <= 24 ? 85 : hours <= 72 ? 65 : 30;
  const freshness = age <= 3 ? 100 : age <= 12 ? 80 : age <= 48 ? 55 : 20;
  const scarcity = d.limited_quantity ? 100 : d.collect_required ? 70 : 30;
  const value = Math.min(100, Number(d.discount?.value || 0));
  const trust = Math.round(100 * Number(d.confidence || 0.5));
  return urgency * .35 + freshness * .25 + scarcity * .15 + value * .15 + trust * .10;
}

// ---- heat ----
const heatCache = new Map();
function computeHeat(d) {
  if (heatCache.has(d.id)) return heatCache.get(d.id);
  if (d.status === "evergreen") return 0;
  if (isFlashDeal(d)) {
    const score = Math.round(flashScore(d));
    heatCache.set(d.id, score);
    return score;
  }
  const days = Math.max(0, daysUntil(d));
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

// ---- Rozana line-icon helper ----
// Every nav/control glyph in the app comes from the SVG sprite in index.html.
// Emoji may appear inside offer *content* but never as the primary icon system.
function ic(id, cls) { return `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#ic-${id}"/></svg>`; }

// ---- offer type: derived from REAL fields only. Mirrors scraper.classify_offer_type
// (same tokens, same rule order) so the UI never invents a category the data doesn't
// support. Unresolved stays null -> no chip (we never guess).
const WALLET_TOKENS = ["easypaisa", "easypaisa_wallet", "easypaisa_debit", "jazzcash", "jazzcash_app", "jazzcash_qr", "jazzcash_debit"];
const CARD_MARKERS = ["credit", "debit", "card", "visa", "master"];
function deriveOfferType(d) {
  if (d.offer_type) return d.offer_type;                                   // R1: tagged upstream wins
  if (d.source?.type === "news" || d.brand_type === "news") return null;   // R2: news is not an offer
  const pay = (d.eligibility?.payment || []).map(p => String(p).toLowerCase());
  const walletHits = pay.filter(p => WALLET_TOKENS.includes(p));
  const cardHits = pay.filter(p => p !== "any" && !WALLET_TOKENS.includes(p) && CARD_MARKERS.some(m => p.includes(m)));
  if (walletHits.length && cardHits.length) return null;                   // R3: mixed = ambiguous
  if (walletHits.length) return "WALLET_OFFER";                            // R4
  if (cardHits.length) return "BANK_CARD_OFFER";                           // R5
  if (d.brand_type === "bank") return null;                                // R6: bank w/o instrument = ambiguous
  if (d.category === "food" && (!pay.length || pay.every(p => p === "any"))) return "FOOD_PROMOTION"; // R7
  return null;                                                             // R8: untagged
}
// PRODUCT_DEAL comes only from the upstream tag (the scraper's product branch);
// the UI must not synthesise it from category alone.
const OFFER_TYPES = {
  BANK_CARD_OFFER: { cls: "ot-bank", icon: "card", label: "otBank" },
  WALLET_OFFER:    { cls: "ot-wallet", icon: "wallet", label: "otWallet" },
  FOOD_PROMOTION:  { cls: "ot-food", icon: "food", label: "otFood" },
  PRODUCT_DEAL:    { cls: "ot-deal", icon: "bag", label: "otDeal" }
};
function offerTypeChip(d) {
  const k = deriveOfferType(d);
  const ot = k && OFFER_TYPES[k];
  if (!ot) return "";
  return `<span class="ot-chip ${ot.cls}">${ic(ot.icon)}${t(ot.label)}</span>`;
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
// News/editorial headlines are NOT offers. Exclude them from every offer surface
// (tabs, search, recommendations) using the actual source schema. Records are
// kept in the underlying dataset — only the offer feeds filter them out.
function isNews(d) {
  return d?.source?.type === "news" || d?.brand_type === "news" ||
         /^rss_/i.test(String(d?.id || ""));
}

function baseFilter(d) {
  if (isNews(d)) return false;
  if (isHidden(d)) return false;
  if (d.status !== "evergreen" && msLeft(d) <= 0) return false;
  if (state.hiddenBrands.has(d.brand)) return false;
  if (!cityMatch(d)) return false;
  if (state.cat !== "all" && d.category !== state.cat) return false;
  if (state.otype !== "all" && deriveOfferType(d) !== state.otype) return false;
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
    case "home": return byHeat(all.filter(d => d.status !== "evergreen" && d.status !== "spotted"));
    case "explore": return all;
    case "saved": {
      // Saved tab: only search applies, not city/category/otype filters
      const q = state.q.trim().toLowerCase();
      return DATA.deals.filter(d => {
        if (!state.saved.has(d.id)) return false;
        if (d.status === "evergreen") return false;
        if (q) {
          const hay = (d.title + " " + d.summary + " " + brandOf(d.brand).name + " " + (d.eligibility?.merchant || "") + " " + d.cities.join(" ") + " " + d.category).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }
    case "cards": return byHeat(all.filter(d => isMine(d) && d.status !== "evergreen"));
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
      const hrs = (expiryDate(d) - NOW) / 36e5;
      if (hrs >= 0 && hrs <= 24 && seen[d.id] !== todayKey) {
        seen[d.id] = todayKey; changed = true;
        this.fire("⏳ Deal ending soon!", `"${d.title}" expires in ${hrs < 1 ? "under an hour" : Math.round(hrs) + "h"}. Grab it now!`);
      }
    });
    if (changed) store.set("dr_notif_seen", JSON.stringify(seen));
  },
  // Saved deal just expired — tell the user so they don't act on a dead deal.
  checkExpiredSaved() {
    if (!DATA) return;
    const seen = JSON.parse(store.get("dr_notif_expired_seen", "{}"));
    let changed = false;
    DATA.deals.forEach(d => {
      if (!state.saved.has(d.id) || seen[d.id] || d.status === "evergreen") return;
      if (msLeft(d) <= 0) {
        seen[d.id] = 1; changed = true;
        addNotification(`⌛ "${d.title}" has expired.`);
        this.fire("⌛ Saved deal expired", `"${d.title}" is no longer valid.`);
      }
    });
    if (changed) store.set("dr_notif_expired_seen", JSON.stringify(seen));
  }
};

// ---- deal card ----
// Expiry pill body: an icon that matches the TRUST STATE, plus the honest text.
// missing/placeholder both read "End date unavailable" (info icon) — never a
// fake countdown, never silently "Ongoing".
function expiryPillInner(d) {
  const s = expiryState(d);
  const glyph = s === "soon" || s === "expired" ? ic("clock")
    : s === "longdated" ? ic("calendar")
    : s === "ongoing" ? ic("check")
    : ic("info"); // missing / placeholder -> visibly unknown
  return `${glyph}<span class="pill-tx">${countdown(d).text}</span>`;
}

function dealCard(d, opts = {}) {
  const b = brandOf(d.brand);
  const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cd = countdown(d);
  const mine = isMine(d);
  const mi = d.merchant_info || {};
  const monoStyle = mi.logo ? 'background:#fff' : `background:${b.color}`;

  // Real logo when we have one; monogram fallback when we don't (or if it 404s).
  const logoHtml = mi.logo
    ? `<div class="logo-badge" style="${monoStyle}"><img src="${esc(mi.logo)}" alt="${esc(b.name)}" class="logo-img" loading="lazy" onerror="var pp=this.parentElement;pp.innerHTML='${initials}';pp.style.background='${b.color}'"></div>`
    : b.logo
    ? `<div class="logo-badge" style="${monoStyle}"><img src="${b.logo}" alt="${esc(b.name)}" class="logo-img" loading="lazy" onerror="var pp=this.parentElement;pp.innerHTML='${initials}';pp.style.background='${b.color}'"></div>`
    : `<div class="logo-badge mono" style="${b.color ? `background:${b.color}` : ""}">${initials}</div>`;

  // Benefit only when a structured discount supports it. discountLabel()'s "Offer"
  // fallback is not a benefit and would read as fake value, so it stays hidden.
  const disc = d.discount;
  const hasValue = !!disc && (disc.kind === "free_delivery" || disc.kind === "bogo" || Number(disc.value) > 0);
  const discHtml = hasValue ? `<span class="disc">${esc(discountLabel(disc))}</span>` : "";
  const capLabel = disc?.cap ? `<span class="cap-txt">${t("capRs", { n: Number(disc.cap).toLocaleString() })}</span>` : "";
  const payment = d.eligibility?.card_type || (d.eligibility?.payment?.length ? payLabel(d.eligibility.payment) : "");
  const cardType = payment ? `<span class="card-type" title="${esc(payment)}">${ic("card")}${esc(payment)}</span>` : "";
  const flashTag = d.collect_required ? "Collect Now" : d.app_only ? "App Only" : d.code ? "Code Required" : d.limited_quantity ? "Limited Quantity" : isFlashDeal(d) ? "Limited Time" : "";
  const merchant = mi.name || d.eligibility?.merchant;
  const merchantLine = merchant && merchant.toLowerCase() !== b.name.toLowerCase() ? ` · <span class="mn">${esc(merchant)}</span>` : "";
  const founderBadge = d.founder_verified ? `<span class="founder-badge" title="Founder-verified">${ic("crown")}</span>` : "";

  return `<article class="deal${mine ? " match" : ""}" data-id="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.title)}" data-offer="${deriveOfferType(d) || "unknown"}">
    ${/^https:\/\//.test(mi.cover || "") ? `<div class="ticket-cover${opts.featured ? "" : " compact"}"><img src="${esc(mi.cover)}" alt="${esc(merchant || b.name)}" loading="lazy" onerror="this.parentElement.remove()"></div>` : ""}
    ${logoHtml}
    <div class="deal-body">
      <div class="deal-brand">${founderBadge}<span class="bn">${esc(b.name)}</span>${merchantLine}${discHtml ? `<span class="disc-badge">${discHtml}</span>` : ""}</div>
      <h3 class="deal-title">${esc(crispTitle(d))}</h3>
      <div class="deal-sub">
        ${cardType}
        ${capLabel}
        ${flashTag ? `<span class="card-type">${flashTag}</span>` : ""}
        <span class="pill ${cd.cls}" data-countdown="${d.id}">${expiryPillInner(d)}</span>
        ${mine ? `<span class="matchflag">${ic("check")}${t("yourCard")}</span>` : ""}
      </div>
    </div>
    <div class="deal-arrow">${ic("chev-r")}</div>
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

let cityFallbackActive = false;
// Paint sequence guard: the skeleton path defers its paint by 150ms. If a fresher
// render (e.g. live JSON landing mid-skeleton) happens first, the stale timer must
// not overwrite it with the list captured before the update.
let feedSeq = 0;
function cityFallbackBanner() {
  if (!cityFallbackActive) return "";
  return `<div class="city-fallback">${ic("pin")}<span>Nothing live in <b>${esc(state.city)}</b> right now — showing deals that work across Pakistan. Spotted something local? Use the + button and be the first to share it!</span></div>`;
}
function renderFeed() {
  const seq = ++feedSeq;
  let list = tabDeals();
  let cityFallback = false;
  if (!list.length && state.city !== "All") {
    const savedCity = state.city;
    state.city = "All";
    list = tabDeals().filter(d => d.cities.includes("All Pakistan"));
    state.city = savedCity;
    cityFallback = list.length > 0;
  }
  cityFallbackActive = cityFallback;
  if (!list.length) {
    if (state.q.trim() || state.cat !== "all" || state.otype !== "all") {
      $("#feed").innerHTML = `<div class="empty">${ic("search")}<h3>${LANG === "ur" ? "کوئی آفر نہیں ملی" : "Nothing here. Yet."}</h3><p>${LANG === "ur" ? "دوسرا نام تلاش کریں یا فلٹرز ہٹائیں۔" : "Try another merchant or clear your search and offer filters."}</p><button id="clearSearch" class="btn-primary">${LANG === "ur" ? "تلاش صاف کریں" : "Clear search & filters"}</button></div>`;
      return;
    }
    if (state.tab === "cards") { $("#feed").innerHTML = renderCardsTab([]); return; }
    if (state.tab === "saved") { $("#feed").innerHTML = renderSavedTab([]); return; }
    const emptyMsgs = {
      home: t("emptyTrending"),
      explore: LANG === "ur" ? "کوئی آفر دستیاب نہیں۔" : "No offers available right now.",
      cards: state.myPay.size ? t("emptyForYouSet") : t("emptyForYou")
    };
    const glyph = { home: "trend", explore: "search", saved: "check", cards: "wallet" };
    $("#feed").innerHTML = `<div class="empty">${ic(glyph[state.tab] || "info")}<p>${emptyMsgs[state.tab] || "No deals match your filters."}</p></div>`;
    return;
  }
  // Show skeleton briefly for perceived performance
  if (!state.feedRendered) {
    state.feedRendered = true;
    $("#feed").innerHTML = Array(4).fill(`<div class="skeleton" style="height:140px;border-radius:var(--radius)"></div>`).join("");
    setTimeout(() => { if (seq === feedSeq) renderFeedContent(list); }, 150);
    return;
  }
  renderFeedContent(list);
}

function renderFeedContent(list) {
  try {
  // ---- each tab has its own unique layout ----
  if (state.tab === "explore") { $("#feed").innerHTML = renderExploreTab(list); return; }
  if (state.tab === "saved") { $("#feed").innerHTML = renderSavedTab(list); return; }
  if (state.tab === "cards") { $("#feed").innerHTML = renderCardsTab(list); return; }

  // Search and category browsing use a focused results list instead of the dashboard.
  if (state.q.trim() || state.cat !== "all") {
    const label = state.q.trim() ? `Results for “${esc(state.q.trim())}”` : `${state.cat.charAt(0).toUpperCase() + state.cat.slice(1)} deals`;
    $("#feed").innerHTML = `<div class="results-head"><strong>${label}</strong><span>${list.length} found</span></div>${renderMerchantGroups(list.slice(0, 80))}`;
    return;
  }

  // ---- HOME: integrated discovery experience ----
  $("#feed").innerHTML = renderHomeTab(list);
  } catch (err) {
    console.error("Feed render error:", err);
    $("#feed").innerHTML = `<div class="empty">${ic("info")}<p>Something went wrong loading deals.</p><button class="btn-primary" onclick="location.reload()">Retry</button></div>`;
  }
}

// ---- HOME tab: integrated discovery — Ending Soon + For You + Trending ----
function renderHomeTab(list) {
  const active = list.filter(d => d.status !== "evergreen" && d.status !== "spotted" && !state.hiddenBrands.has(d.brand));
  const realDeals = active.filter(d => {
    if (d.brand === "news" || brandOf(d.brand).brand_type === "news") return false;
    return true;
  });

  let html = cityFallbackBanner();

  // "Ending soon" strip — real urgency only
  const endingSoon = realDeals
    .filter(d => expiryState(d) === "soon" && daysUntil(d) <= 3 && (d.discount?.value || 0) > 0)
    .sort((a, b) => msLeft(a) - msLeft(b)).slice(0, 4);
  if (endingSoon.length) {
    html += `<div class="section-head urgent">${ic("clock")} ${t("endingSoon")} <span class="section-count">${endingSoon.length}</span></div>`;
    html += endingSoon.map((d, i) => dealCard(d, { featured: i === 0 })).join("");
  }

  // "For You" section — only when the user has payment methods selected
  const stripIds = new Set(endingSoon.map(d => d.id));
  const forYou = realDeals.filter(d => !stripIds.has(d.id) && isMine(d)).slice(0, 6);
  if (forYou.length) {
    html += `<div class="section-head">${ic("target")} ${t("foryou")} <span class="section-count">${forYou.length}</span></div>`;
    html += forYou.map(dealCard).join("");
  }

  // Primary feed: heat-ranked, merchants collapsed
  const forYouIds = new Set(forYou.map(d => d.id));
  const ranked = realDeals.filter(d => !stripIds.has(d.id) && !forYouIds.has(d.id)).sort((a, b) => computeHeat(b) - computeHeat(a));
  html += `<div class="section-head">${ic("trend")} ${t("tab_trending_head")} <span class="section-count">${ranked.length}</span></div>`;
  html += renderMerchantGroups(ranked.slice(0, 4));
  html += renderWalletNudge();
  html += renderMerchantGroups(ranked.slice(4, 80));

  return html || `<div class="empty">${ic("radar")}<p>${t("emptyTrending")}</p></div>`;
}

// ---- EXPLORE tab: categories + collections (Ending Soon, Always On, Calendar) ----
function renderExploreTab(list) {
  // Sub-view: render a specific collection
  if (state.exploreView) {
    const view = state.exploreView;
    let html = `<button class="explore-back" id="exploreBack" type="button">${ic("chev-l")} ${LANG === "ur" ? "واپس" : "Back to Explore"}</button>`;
    if (view === "ending") {
      const ending = endingDeals(list);
      html += `<div class="section-head">${ic("clock")} ${t("endingSoon")} <span class="section-count">${ending.length}</span></div>`;
      html += ending.length ? ending.slice(0, 40).map(dealCard).join("") : `<div class="empty">${ic("clock")}<p>${t("emptyEnding")}</p></div>`;
    } else if (view === "evergreen") {
      const evergreen = list.filter(d => d.status === "evergreen").sort((a, b) => (b.community?.worked || 0) - (a.community?.worked || 0));
      html += `<div class="section-head">${ic("infinity")} ${LANG === "ur" ? "ہمیشہ" : "Always On"} <span class="section-count">${evergreen.length}</span></div>`;
      html += evergreen.length ? renderEvergreenContent(evergreen) : `<div class="empty">${ic("infinity")}<p>${t("emptyEvergreen")}</p></div>`;
    } else if (view === "calendar") {
      const calDeals = calendarDeals(list);
      html += `<div class="section-head">${ic("calendar")} ${LANG === "ur" ? "کیلنڈر" : "Calendar"} <span class="section-count">${calDeals.length}</span></div>`;
      html += calDeals.length ? renderCalendar(calDeals) : `<div class="empty">${ic("calendar")}<p>No dated offers right now.</p></div>`;
    }
    return html;
  }

  let html = "";

  // Collection cards — tap to enter sub-views
  html += `<div class="explore-collections">
    <button class="explore-card" data-explore="ending" type="button">
      <span class="explore-icon">${ic("clock")}</span>
      <span class="explore-title">${LANG === "ur" ? "جلد ختم" : "Ending Soon"}</span>
      <span class="explore-sub">${LANG === "ur" ? "3 دن میں ختم ہونے والی آفرز" : "Offers expiring within 3 days"}</span>
    </button>
    <button class="explore-card" data-explore="evergreen" type="button">
      <span class="explore-icon">${ic("infinity")}</span>
      <span class="explore-title">${LANG === "ur" ? "ہمیشہ" : "Always On"}</span>
      <span class="explore-sub">${LANG === "ur" ? "مستقل آفرز" : "Standing offers & vouchers"}</span>
    </button>
    <button class="explore-card" data-explore="calendar" type="button">
      <span class="explore-icon">${ic("calendar")}</span>
      <span class="explore-title">${LANG === "ur" ? "کیلنڈر" : "Calendar"}</span>
      <span class="explore-sub">${LANG === "ur" ? "آخری تاریخیں" : "Deals by expiry date"}</span>
    </button>
  </div>`;

  // Categories from full dataset (not affected by active filters)
  const cats = {};
  DATA.deals.filter(d => !isNews(d) && d.status !== "spotted" && !isHidden(d)).forEach(d => {
    const c = d.category || "other";
    cats[c] = (cats[c] || 0) + 1;
  });
  const catGlyph = { food: "food", grocery: "food", beauty: "bag", fashion: "bag", shopping: "bag", ecommerce: "bag", retail: "store", electronics: "store", utilities: "card", telecom: "card", mobile: "card", fuel: "pin", travel: "pin" };
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (entries.length) {
    html += `<div class="section-head">${ic("search")} ${LANG === "ur" ? "زمرہ جات" : "Categories"}</div>`;
    html += `<div class="explore-grid">${entries.map(([cat, count]) =>
      `<button class="explore-cat" data-cat="${esc(cat)}" type="button">
        <span class="explore-cat-icon">${ic(catGlyph[cat] || "bag")}</span>
        <span class="explore-cat-name">${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
        <span class="explore-cat-count">${count}</span>
      </button>`
    ).join("")}</div>`;
  }

  return html;
}

// Evergreen content grouped by category (used in explore sub-view)
function renderEvergreenContent(list) {
  const byCat = {};
  for (const d of list) (byCat[d.category] = byCat[d.category] || []).push(d);
  const catGlyph = { food: "food", grocery: "food", beauty: "bag", fashion: "bag", shopping: "bag", ecommerce: "bag", retail: "store", electronics: "store", utilities: "card", telecom: "card", mobile: "card", fuel: "pin", travel: "pin" };
  let html = "";
  const entries = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  for (const [cat, deals] of entries) {
    html += `<div class="section-head">${ic(catGlyph[cat] || "bag")} ${cat.charAt(0).toUpperCase() + cat.slice(1)} <span class="section-count">${deals.length}</span></div>`;
    html += deals.slice(0, 12).map(dealCard).join("");
  }
  return html;
}

// ---- SAVED tab: bookmarked offers with empty state ----
function renderSavedTab(list) {
  if (!list.length) {
    return `<div class="empty">${ic("check")}
      <h3>${LANG === "ur" ? "ابھی کچھ محفوظ نہیں" : "Nothing saved yet"}</h3>
      <p>${LANG === "ur" ? "کسی بھی ڈیل پر ٹیپ کریں اور الرٹ بٹن دبائیں۔" : "Tap any deal and hit the alert button to save it for later."}</p>
      <button class="btn-primary" id="savedToHome" type="button" style="margin-top:16px">${ic("trend")}${LANG === "ur" ? "ڈیلز دیکھیں" : "Browse deals"}</button>
    </div>`;
  }
  let html = `<div class="section-head">${ic("check")} ${t("savedHead")} <span class="section-count">${list.length}</span></div>`;
  html += list.map(dealCard).join("");
  return html;
}

// ---- CARDS tab: searchable payment setup + matched offers ----
function renderCardsTab(list) {
  let html = "";

  // Searchable payment method setup
  html += `<div class="cards-setup">
    <div class="cards-setup-head">${ic("wallet")} <strong>${t("walletSetup")}</strong></div>
    <p class="hint">${LANG === "ur" ? "صرف نام منتخب کریں۔ کارڈ نمبر یا بینک لاگ اِن درکار نہیں۔ انتخاب اسی ڈیوائس پر محفوظ ہے۔" : "Names only. No card numbers or bank login. Stays on this device."}</p>
    <div class="card-search-wrap">
      <svg class="ic" aria-hidden="true"><use href="#ic-search"/></svg>
      <input type="search" id="cardSearch" class="card-search" placeholder="${LANG === "ur" ? "کارڈ یا والٹ تلاش کریں…" : "Search cards & wallets…"}" aria-label="Search payment methods" autocomplete="off">
    </div>
    <div class="card-results" id="cardResults"></div>
    ${state.myPay.size ? `<div class="card-selected"><div class="section-head" style="margin:12px 0 6px">${ic("check")} ${LANG === "ur" ? "منتخب" : "Selected"} <span class="section-count">${state.myPay.size}</span></div>
      <div class="card-chips">${[...state.myPay].map(v => {
        const label = (PAY_OPTIONS.find(([k]) => k === v) || [v, v])[1];
        return `<span class="card-chip on" data-pay="${esc(v)}">${esc(label)} <button class="chip-x" data-pay="${esc(v)}" aria-label="Remove ${esc(label)}">&times;</button></span>`;
      }).join("")}</div></div>` : ""}
  </div>`;

  // Matched offers
  if (list.length) {
    html += `<div class="section-head">${ic("target")} ${t("foryou")} <span class="section-count">${list.length}</span></div>`;
    html += list.slice(0, 30).map(dealCard).join("");
  } else if (state.myPay.size) {
    html += `<div class="empty">${ic("target")}<p>${t("emptyForYouSet")}</p></div>`;
  }

  return html;
}

// Fuzzy match for card search — Levenshtein distance <= 2 or substring match
function fuzzyMatch(query, label) {
  const q = query.toLowerCase().trim();
  const l = label.toLowerCase();
  if (!q) return true;
  if (l.includes(q)) return true;
  // Simple Levenshtein for typo tolerance
  if (Math.abs(q.length - l.length) > 3) return false;
  const dp = Array.from({length: q.length + 1}, (_, i) => [i, ...Array(l.length).fill(0)]);
  for (let j = 0; j <= l.length; j++) dp[0][j] = j;
  for (let i = 1; i <= q.length; i++)
    for (let j = 1; j <= l.length; j++)
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (q[i-1] !== l[j-1] ? 1 : 0));
  return dp[q.length][l.length] <= 2;
}

function renderCardResults(query) {
  const el = $("#cardResults");
  if (!el) return;
  const matches = PAY_OPTIONS.filter(([, label]) => fuzzyMatch(query, label));
  if (!query.trim()) {
    el.innerHTML = `<p class="card-hint">${LANG === "ur" ? "اوپر تلاش کریں یا نیچے سے منتخب کریں" : "Type to search, or pick from popular options"}</p>
      <div class="card-quick">${PAY_OPTIONS.slice(0, 6).map(([v, l]) =>
        `<button class="pay-opt${state.myPay.has(v) ? " on" : ""}" aria-pressed="${state.myPay.has(v)}" data-pay="${v}">${l}</button>`
      ).join("")}</div>`;
    return;
  }
  if (!matches.length) {
    el.innerHTML = `<p class="card-hint">${LANG === "ur" ? "کوئی میچ نہیں ملا" : "No match — try a different spelling"}</p>`;
    return;
  }
  el.innerHTML = matches.map(([v, l]) =>
    `<button class="pay-opt${state.myPay.has(v) ? " on" : ""}" aria-pressed="${state.myPay.has(v)}" data-pay="${v}">${l}</button>`
  ).join("");
}

// Offer-type filter row — only the types actually present in the current list.
// Text labels + line icons, never colour alone. Hidden entirely when the feed
// has no classified offers, so we never render a filter that does nothing.
function typeFilterRow(pool) {
  const counts = {};
  pool.forEach(d => { const k = deriveOfferType(d); if (k) counts[k] = (counts[k] || 0) + 1; });
  const present = Object.keys(OFFER_TYPES).filter(k => counts[k]);
  if (!present.length) return "";
  const pill = (key, label, icon) =>
    `<button class="ot-pill${state.otype === key ? " active" : ""}" aria-pressed="${state.otype === key}" data-otype="${key}">${icon}${label}${counts[key] ? ` <span class="ot-sub">${counts[key]}</span>` : ""}</button>`;
  return `<div class="ot-filter-row" role="group" aria-label="Filter by offer type">
    ${pill("all", t("filterAllTypes"), ic("radar"))}
    ${present.map(k => pill(k, t(OFFER_TYPES[k].label), ic(OFFER_TYPES[k].icon))).join("")}
  </div>`;
}

// ---- ENDING tab: grouped by urgency bucket, countdown-first ----
function renderEndingTab(list) {
  const mode = endingMode();
  const soonLabel = mode === "3d" ? "Next 3 Days" : "Later this week";
  const headLabel = mode === "3d" ? t("ending3d") : t("expiringThisWeek");
  const buckets = [
    { key: "today", label: "Ends Today", test: d => daysUntil(d) <= 0 },
    { key: "tomorrow", label: "Ends Tomorrow", test: d => daysUntil(d) === 1 },
    { key: "soon", label: soonLabel, test: d => daysUntil(d) >= 2 }
  ];
  let html = `<div class="section-head">${ic("clock")} ${headLabel.replace(/[.]$/, "")} <span class="section-count">${list.length}</span></div>`;
  for (const b of buckets) {
    const items = list.filter(b.test).sort((x, y) => new Date(x.valid_until) - new Date(y.valid_until)).slice(0, 20);
    if (!items.length) continue;
    html += `<div class="section-head${b.key === "today" ? " urgent" : ""}">${ic(b.key === "today" ? "bell" : b.key === "tomorrow" ? "clock" : "calendar")} ${b.label} <span class="section-count">${items.length}</span></div>`;
    html += items.map(dealCard).join("");
  }
  return html;
}

// ---- FOR YOU tab: grouped by wallet/card the user selected ----
function renderForYouTab(list) {
  if (!list.length) {
    return `<div class="empty">${ic("target")}<p>${state.myPay.size ? t("emptyForYouSet") : t("emptyForYou")}</p>
      <button class="btn-primary" id="openWalletFromEmpty" type="button" style="margin-top:16px">${ic("wallet")}${t("walletSetup")}</button></div>`;
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
    html += `<div class="section-head">${ic("wallet")} ${esc(payLabel(pay))} <span class="section-count">${deals.length}</span></div>`;
    html += deals.slice(0, 15).map(dealCard).join("");
  }
  // Saved deals
  const savedDeals = list.filter(d => state.saved.has(d.id));
  if (savedDeals.length) {
    html += `<div class="section-head">${ic("check")} ${t("savedHead")} <span class="section-count">${savedDeals.length}</span></div>`;
    html += savedDeals.slice(0, 10).map(dealCard).join("");
  }
  return html;
}

// ---- ALWAYS ON tab: grouped by category, "works anytime" framing ----
function renderEvergreenTab(list) {
  const byCat = {};
  for (const d of list) (byCat[d.category] = byCat[d.category] || []).push(d);
  const catGlyph = { food: "food", grocery: "food", beauty: "bag", fashion: "bag", shopping: "bag", ecommerce: "bag", retail: "store", electronics: "store", utilities: "card", telecom: "card", mobile: "card", fuel: "pin", travel: "pin" };
  let html = "";
  const entries = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  for (const [cat, deals] of entries) {
    html += `<div class="section-head">${ic(catGlyph[cat] || "bag")} ${cat.charAt(0).toUpperCase() + cat.slice(1)} <span class="section-count">${deals.length}</span></div>`;
    html += deals.slice(0, 12).map(dealCard).join("");
  }
  return html || `<div class="empty">${ic("infinity")}<p>${t("emptyEvergreen")}</p></div>`;
}

// ---- SPOTTED tab: community feed, votes-first ----
function renderSpottedTab(list) {
  if (!list.length) return `<div class="empty">${ic("eye")}<p>${t("emptySpotted")}</p></div>`;
  let html = `<div class="banner-info">${ic("eye")}<span>Deals spotted by the community — vote on what works.</span></div>`;
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
        ? `<div class="logo-badge sm" style="background:#fff"><img src="${esc(mi.logo)}" alt="${esc(merchant)}" class="logo-img" loading="lazy" onerror="var pp=this.parentElement;pp.innerHTML='${initials}';pp.style.background='${b.color}'"></div>`
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
  // Only offers with a real, trustworthy expiry date belong on a deadline
  // calendar. Guard against missing/invalid dates so we never render
  // "NaN Invalid Date" or count no-expiry deals as expiring.
  const hasRealDate = d => {
    if (!d.valid_until) return false;
    const dt = new Date(String(d.valid_until) + "T00:00:00");
    return !Number.isNaN(dt.getTime());
  };
  list = (list || []).filter(hasRealDate);
  if (!list.length) return `<div class="empty">${ic("calendar")}<p>No dated deadlines coming up. Browse Trending for ongoing deals.</p></div>`;
  const dayKey = s => s;
  const groups = {};
  list.forEach(d => { (groups[dayKey(d.valid_until)] = groups[dayKey(d.valid_until)] || []).push(d); });
  const keys = Object.keys(groups).sort();
  const visibleKeys = keys.slice(0, 14);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fmt = s => {
    const dt = new Date(s + "T00:00:00");
    const diff = Math.round((dt - today) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };
  const chips = visibleKeys.map(k => {
    const dt = new Date(k + "T00:00:00");
    const diff = Math.round((dt - today) / 864e5);
    const cls = diff <= 1 ? "cal-chip hot" : "cal-chip";
    return `<button class="${cls}" data-calday="${k}">${dt.getDate()} ${dt.toLocaleDateString("en-GB", { month: "short" })}<span>${groups[k].length}</span></button>`;
  }).join("");
  const days = visibleKeys.map(k => {
    const diff = Math.round((new Date(k + "T00:00:00") - today) / 864e5);
    const cls = diff <= 1 ? " urgent" : "";
    return `<div class="cal-day${cls}" id="cal-${k}">
      <div class="cal-head"><span class="cal-date">${fmt(k)}</span><span class="cal-count">${groups[k].length} deal${groups[k].length > 1 ? "s" : ""} expire</span></div>
      ${groups[k].slice(0, 20).map(dealCard).join("")}
      ${groups[k].length > 20 ? `<div class="calendar-more">+${groups[k].length - 20} more deals on this date — use Search to narrow results</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="cal-strip">${chips}</div>${days}`;
}

function renderBanner() {
  const tabInfo = TABS[state.tab];
  let inner = "";
  // Provenance: live feed vs built-in fallback. A failed live load must never look
  // like "the inventory is empty" — it says so explicitly and offers retry.
  // Only once an attempt has actually failed (liveAttempted) — never during a normal boot.
  if (liveAttempted && dataProvenance !== "live") {
    inner = `<div class="banner-card warn">${ic("info")}<span>${t("fallbackBanner")}</span> <button class="banner-retry" id="retryLive" type="button">${t("retry")}</button></div>`;
  }
  // Stale data warning (live feed itself has gone stale)
  if (!inner && DATA.meta?.generated_at) {
    const ageH = (NOW - new Date(DATA.meta.generated_at)) / 36e5;
    if (ageH > 12) {
      inner = `<div class="banner-card warn">${ic("info")}<span>Data is ${Math.round(ageH)}h old — deals may have changed. Pull to refresh or check back later.</span></div>`;
    }
  }
  renderDiscovery();
  $("#banner").innerHTML = inner;
  const live = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && !isNews(d)).length;
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

function renderDiscovery() {
  const copy = LANG === "ur" ? {
    home: ["خرچ کم۔ زندگی بھرپور۔", "آپ کے شہر اور کارڈز کے مطابق بہترین آفرز۔"],
    explore: ["تلاش کریں۔ موازنہ کریں۔", "زمرہ جات، کلیکشنز اور آخری تاریخیں — سب ایک جگہ۔"],
    saved: ["آپ کی محفوظ آفرز۔", "بعد کے لیے محفوظ کی گئی ڈیلز — ختم ہونے سے پہلے دیکھیں۔"],
    cards: ["آپ کا کارڈ۔ آپ کی آفرز۔", "منتخب طریقۂ ادائیگی کے مطابق — مکمل شرائط ضرور دیکھیں۔"]
  } : {
    home: ["Good finds. Less spend.", "Best offers for your city & cards."],
    explore: ["Browse. Compare. Save.", "Categories, collections, and real deadlines — all in one place."],
    saved: ["Your saved offers.", "Deals you bookmarked — check them before they expire."],
    cards: ["Your cards. More possibilities.", "Matched payment methods, not guaranteed eligibility. Check the terms."]
  };
  const [title, sub] = copy[state.tab] || copy.home;
  $("#discovery").innerHTML = `<div class="edition">${ic("radar")} ${LANG === "ur" ? "پاکستان کا ڈیل ریڈار" : "THE EVERYDAY SAVINGS EDIT"}</div><h2>${title}</h2><p>${sub}</p>`;
}

function renderChips() {
  // Only Home shows the category tabs + filter row; other tabs have their own UI
  const showFilters = state.tab === "home";
  $("#catTabs").classList.toggle("hidden", !showFilters);
  $("#filterRow").classList.toggle("hidden", !showFilters);
  if (!showFilters) return;

  const catIcons = { all: "🔥", food: "🍔", shopping: "🛍️", ecommerce: "📦", retail: "🏪", fuel: "", travel: "️", telecom: "📱", grocery: "🛒", electronics: "🔌", fashion: "👗", utilities: "💡" };
  $("#catTabs").innerHTML = CATS.map(([k, l]) =>
    `<button class="cat-tab${state.cat === k ? " active" : ""}" data-cat="${k}" aria-pressed="${state.cat === k}">` +
    `<span class="cat-ic">${catIcons[k] || "📁"}</span><span class="cat-lbl">${esc(catKey[k] ? t(catKey[k]) : l)}</span></button>`
  ).join("");
  const cityOpts = CITIES.map(c => `<option value="${c}" ${state.city === c ? "selected" : ""}>${c === "All" ? t("allCities") : c}</option>`).join("");
  const typeOpts = [["all", LANG === "ur" ? "تمام آفرز" : "All offers"], ["percent", "% Off"], ["flat", "Rs Off"], ["cashback", "Cashback"], ["bogo", "BOGO"], ["free_delivery", "Free Delivery"]].map(([k, l]) => `<option value="${k}" ${state.otype === k ? "selected" : ""}>${l}</option>`).join("");
  $("#filterRow").innerHTML = `<select class="fr-select" id="citySelect" aria-label="City">${cityOpts}</select>
    <select class="fr-select" id="otypeSelect" aria-label="Offer type">${typeOpts}</select>
    <button class="fr-reset" id="resetFilters" type="button">${LANG === "ur" ? "ری سیٹ" : "Reset"}</button>`;
}

function renderWalletPanel() {
  $("#walletBtn").classList.toggle("on", state.myPay.size > 0);
  $("#walletPanel").innerHTML = `<div class="wallet-heading"><h4>${ic("wallet")} ${t("wallet", {n: state.myPay.size})}</h4><button id="walletDone" class="btn-secondary">${LANG === "ur" ? "ہو گیا" : "Done"}</button></div>
    <p class="hint">${t("walletHint")} ${LANG === "ur" ? "صرف نام منتخب کریں۔ کارڈ نمبر یا بینک لاگ اِن درکار نہیں۔ انتخاب اسی ڈیوائس پر محفوظ ہے۔" : "Names only. No card numbers or bank login. Your selection stays on this device; exact card tiers still matter."}</p>
    <div class="pay-grid">${PAY_OPTIONS.map(([v, l]) => `<button class="pay-opt${state.myPay.has(v) ? " on" : ""}" aria-pressed="${state.myPay.has(v)}" data-pay="${v}">${l}</button>`).join("")}</div>`;
}

function renderBell() {
  const unread = state.notifications.filter(n => !n.read).length;
  const soon = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && !isNews(d) && daysUntil(d) >= 0 && daysUntil(d) <= 2).length;
  $("#bellCount").textContent = unread + soon;
}

function renderSavings() {}

function renderAIInsights() {}

function renderSpendOptimizer() {}

function renderAll() { renderBanner(); renderChips(); renderFeed(); renderBell(); syncTabs(); $("#q").placeholder = t("search"); renderSearchSuggestions(); if (state.tab === "cards") setTimeout(() => renderCardResults($("#cardSearch")?.value || ""), 50); }

// ---- live ticking countdown ----
let lastStatusFingerprint = "";
function statusFingerprint() {
  let fp = "";
  for (const d of DATA.deals) {
    if (d.status === "evergreen" || isHidden(d)) continue;
    fp += d.id + (msLeft(d) <= 0 ? "E" : d.status === "spotted" || d.status === "reviewing" ? "R" : "A") + ";";
  }
  return fp;
}
function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    NOW = new Date();
    heatCache.clear();
    $$("[data-countdown]").forEach(el => {
      const id = el.dataset.countdown;
      const d = DATA.deals.find(x => x.id === id);
      if (!d || d.status === "evergreen") return;
      const cd = countdown(d);
      // Phase 2B: the pill contains an icon + inner .pill-tx span. Rewrite only the
      // text so the glyph survives the 60s tick.
      const tx = el.querySelector(".pill-tx");
      if (tx) tx.textContent = cd.text; else el.textContent = cd.text;
      el.className = `pill ${cd.cls}`;
    });
    const fp = statusFingerprint();
    if (fp !== lastStatusFingerprint) {
      if (lastStatusFingerprint) { state.feedRendered = false; renderAll(); Notif.checkExpiredSaved(); }
      lastStatusFingerprint = fp;
    }
    Notif.checkExpiring();
  }, 60000); // tick every minute
}

// ---- detail sheet ----
function openDeal(d) {
  pushNav("deal");
  const b = brandOf(d.brand); const heat = computeHeat(d);
  const initials = b.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cd = countdown(d);
  const trust = merchantTrust(d.brand);
  const srcLink = d.source?.url && /^https?:\/\//i.test(d.source.url)
    ? `<a href="${esc(d.source.url)}" target="_blank" rel="noopener noreferrer">${esc(d.source.platform || "source")}</a>`
    : (d.source?.status === "pending" ? "Pending verification" : esc(d.source?.platform || "—"));
  const fmtDate = s => { if (!s) return "—"; return new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const fmtTs = s => { if (!s) return "—"; return new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

  const rows = [
    ["Discount", discountLabel(d.discount) + (d.discount?.cap ? ` · cap Rs ${Number(d.discount.cap).toLocaleString()}` : "")],
    ["Card type", esc(d.eligibility?.card_type || "Any card")],
    ["Valid", `${fmtDate(d.valid_from)} → ${fmtDate(d.valid_until)} (${cd.text})`],
    ["Heat score", heat ? `🔥 ${heat}/100` : "♾️ Always-on"],
    ["Pay with", esc(payLabel(d.eligibility?.payment))],
    ["Merchant", d.eligibility?.merchant === "multiple" ? "Multiple partners" : esc(d.eligibility?.merchant || "—")],
    ["Min spend", d.eligibility?.min_spend ? "Rs " + Number(d.eligibility?.min_spend).toLocaleString() : "None"],
    ["User", d.eligibility?.user === "new" ? "New users only" : "Everyone"],
    ["Cities", esc(d.cities.join(", "))],
    ["Status", d.verification === "verified" ? "✓ Verified" : "⚠ Unverified — confirm at merchant"],
    ["Source", `${srcLink} · ${esc(d.source?.type || "—")}`],
    ["Captured", fmtTs(d.source?.captured_at)],
    ["Community", `▲ ${d.community?.votes || 0} · 👍 ${d.community?.worked || 0} · 👎 ${d.community?.failed || 0}`],
    ["Brand trust", trust !== null ? `${trust}% worked rate across ${d.community?.worked + d.community?.failed || 0} reports` : "No reports yet"],
    ["Confidence", ((d.confidence * 100) | 0) + "%"]
  ];

  const stepsHtml = d.steps?.length ? `
    <h4 class="steps-title">${t("howToAvail")}</h4>
    <ol class="steps-list">${d.steps.map((s, i) => `<li><span class="step-num">${i + 1}</span>${esc(s)}</li>`).join("")}</ol>` : "";

  const wa = `https://wa.me/?text=${encodeURIComponent(shareText(d))}`;

  const mi2 = d.merchant_info || {};
  const logoHero = mi2.logo
    ? `<div class="logo-badge" style="background:#fff;width:52px;height:52px"><img src="${esc(mi2.logo)}" alt="${esc(b.name)}" class="logo-img" onerror="var pp=this.parentElement;pp.innerHTML='${initials}';pp.style.background='${b.color}'"></div>`
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
    ${d.source?.url && /^https?:\/\//i.test(d.source.url) ? `<a class="btn-primary redeem-link" href="${esc(d.source.url)}" target="_blank" rel="noopener noreferrer">Check the offer source ${ic("chev-r")}</a>` : ""}
    ${stepsHtml}
    ${allRows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("")}
    ${d.exclusions?.length ? `<h4 class="steps-title">${t("terms")}</h4><ul>${d.exclusions.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    <div class="sheet-actions">
      <div class="verify-block">
        <p class="backend-note">${ic("info")}${SB.enabled ? "Feedback is saved on this device and syncs when online." : "Community sharing is not connected. Feedback is saved on this device only."}</p>
        <div class="verify-head">Did this deal work? <span class="vtier vt-${verificationTier(d).cls}">${verificationTier(d).label}</span></div>
        <div class="verify-btns">
          ${VERIFY_TYPES.map(v => `<button class="vbtn v-${v.key}${myVote(d.id) === v.key ? " active" : ""}" data-verify="${v.key}">${v.label}</button>`).join("")}
        </div>
        <div class="verify-foot">👍 ${d.community?.worked || 0} worked · 👎 ${d.community?.failed || 0} didn't</div>
      </div>
      <div class="sheet-quick">
        <button class="qbtn ${state.voted.has(d.id) ? 'active' : ''}" data-act="vote">▲ Hot</button>
        <button class="qbtn ${state.saved.has(d.id) ? 'active' : ''}" data-act="save">🔔 Alert</button>
      </div>
      <div class="sheet-curate">
        <button class="cbtn" data-curate="pin">${state.pinnedBrands.has(d.brand) ? "★ Unpin" : "☆ Pin"} ${b.name}</button>
        <button class="cbtn hide" data-curate="hide">${state.hiddenBrands.has(d.brand) ? "Show" : "Hide"} ${b.name} deals</button>
      </div>
      <a class="sharebtn" href="${wa}" target="_blank" rel="noopener">${t("shareOnWhatsApp")}</a>
    </div>
    <p class="fine">Always confirm at the merchant. DealRadar aggregates public offers and is not affiliated with ${b.name}.</p>`;
  showSheet();

  // wire verification buttons (Phase 4)
  $$("#sheet [data-verify]").forEach(btn => btn.addEventListener("click", () => {
    const key = btn.dataset.verify;
    applyVerification(d, key);
    if (key === "working") {
      const est = d.discount?.kind === "percent" ? Math.min((d.discount.value || 0) * 20, d.discount.cap || 500) : (d.discount?.value || 100);
      state.savings += est; store.set("dr_savings", JSON.stringify(state.savings)); renderSavings();
    }
    if (key === "expired" && (d.community.reports_expired || 0) >= 3) {
      addNotification(`"${d.title}" hidden after ${d.community.reports_expired} expired reports`);
      toast(t("dealHidden")); closeSheet(); renderFeed(); return;
    }
    toast(SB.enabled ? "Saved. Syncing to community…" : "Saved on this device. Community sync is not connected.");
    closeSheet(); setTimeout(() => openDeal(d), 240); // reopen to refresh counts/tier
  }));

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
          <span>${countdown(d).text}</span>
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

// ---- merchant entity resolution: match a typed merchant name to an existing brand,
// a known alias, or create a community merchant profile organized brand-wise ----
const MERCHANT_ALIASES = {
  kfc: "kfc", mcdonalds: "mcdonalds", mcd: "mcdonalds", pizzahut: "pizzahut",
  dominos: "dominos", subway: "subway", nandos: "nandos", hardees: "hardees",
  burgerking: "burgerking", bk: "burgerking", starbucks: "starbucks",
  daraz: "daraz", foodpanda: "foodpanda", easypaisa: "easypaisa", jazzcash: "jazzcash",
  hbl: "hbl", mcb: "mcb", ufone: "ufone", jazz: "jazz", telenor: "telenor", zong: "zong"
};
function normMerchant(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function userAliases() {
  try { return JSON.parse(store.get("dr_merchant_aliases", "{}")); } catch { return {}; }
}
// Same offer within 72h = reinforce the existing card, don't fork community signal.
function findDuplicateDeal(brandId, discount, code) {
  const cutoff = NOW.getTime() - 72 * 36e5;
  return DATA.deals.find(d =>
    d.brand === brandId && msLeft(d) > 0 &&
    new Date(d.first_seen_at || d.source?.captured_at || 0).getTime() >= cutoff &&
    (code ? d.code === code : true) &&
    (discount ? d.discount?.kind === discount.kind && d.discount?.value === discount.value : !d.discount)
  ) || null;
}
function reinforceDeal(d) {
  d.community.votes = (d.community.votes || 0) + 1;
  d.last_seen_at = NOW.toISOString();
  normalizeDeal(d);
  persistLocalDeals();
  if (SB.enabled) SB.from("deals").update({ last_seen_at: d.last_seen_at }, `id=eq.${encodeURIComponent(d.id)}`).catch(() => {});
}
function resolveMerchant(rawName, category, aiPlatformId) {
  const key = normMerchant(rawName);
  if (!key && !aiPlatformId) return { brandId: "community", isNew: false, matched: null };
  // 1. Exact brand id or name match
  let b = DATA.brands.find(x => x.id === key || normMerchant(x.name) === key);
  // 2. Built-in or user-taught alias
  const alias = MERCHANT_ALIASES[key] || userAliases()[key];
  if (!b && alias) b = DATA.brands.find(x => x.id === alias || normMerchant(x.name) === alias);
  // 3. Token containment (e.g. "KFC Gulberg" → kfc) — merchant outlet names carry the brand
  if (!b) {
    b = DATA.brands.find(x => x.name && (key.includes(normMerchant(x.name)) || normMerchant(x.name).includes(key)) && normMerchant(x.name).length >= 3);
  }
  if (b) return { brandId: b.id, isNew: false, matched: b.name };
  // 4. Recognized platform not yet in DATA.brands — promote with REAL color/type
  const pl = (aiPlatformId && findPlatformById(aiPlatformId)) || findPlatformByName(rawName);
  if (pl) {
    const promoted = brandFromPlatform(pl);
    if (!DATA.brands.find(x => x.id === promoted.id)) { DATA.brands.push(promoted); brandMap.clear(); }
    rememberDeviceBrand(promoted);
    return { brandId: promoted.id, isNew: true, matched: promoted.name, profile: promoted, ai_recognized: true };
  }
  // 5. Genuinely unknown merchant — clean community profile, stable color
  const brandId = key.slice(0, 20);
  const isRestaurant = ["food", "restaurant", "dining", "fastfood"].includes(category);
  const profile = {
    id: brandId, name: rawName.trim(), brand_type: isRestaurant ? "restaurant" : "merchant",
    color: stableColor(key), logo: null,
    merchant_profile: { created_at: NOW.toISOString(), created_by: "community", source: "user_submission", deal_count: 0 }
  };
  DATA.brands.push(profile);
  rememberDeviceBrand(profile);
  brandMap.clear();
  return { brandId, isNew: true, matched: null, profile };
}

// ---- submit (screenshot-first: AI reads, human confirms) ----
function openSubmit() {
  pushNav("submit");
  $("#sheet").innerHTML = `<div class="grab"></div>
    <h3>📸 Got a deal screenshot?</h3>
    <p class="sheet-summary">I'll read the brand, offer & expiry automatically. No auto-read? Just type it.</p>
    <div class="drop-zone ss-drop ss-hero" id="ssQuick">
      <div class="ss-preview hidden" id="ssPreview"><img id="ssPreviewImg" alt="Selected screenshot"><button type="button" class="ss-change" id="ssChange">Change</button></div>
      <div class="ss-empty" id="ssEmpty"><div class="icon">🖼️</div><p><b>Tap to choose a screenshot</b><br><span class="ss-sub">Foodpanda, Daraz, bank offers… any deal image</span></p></div>
    </div>
    <input type="file" id="ssQuickInput" accept="image/*" hidden>
    <button class="ss-process hidden" id="ssProcess" type="button">→ Read this image</button>
    <div class="ss-or"><span>or</span></div>
    <button class="ss-manual-toggle" id="manualToggle" type="button">✏️ Type it yourself</button>
    <form class="form hidden" id="submitForm">
      <label>Brand / merchant</label><input name="brand" id="merchantInput" required placeholder="e.g. KFC, Easypaisa, Daraz" autocomplete="off">
      <div class="merchant-hint" id="merchantHint"></div>
      <label>Offer (title)</label><input name="title" required placeholder="e.g. 50% off with HBL debit">
      <label>Category</label>
      <select name="category">${CATS.filter(c => c[0] !== "all").map(c => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>
      <label>City</label>
      <select name="city">${CITIES.slice(1).map(c => `<option>${c}</option>`).join("")}<option>All Pakistan</option></select>
      <label>Valid until <span class="opt">(optional — defaults to 24h)</span></label><input name="valid_until" type="date" readonly id="vuDate">
      <button class="submit" type="submit">Submit to Spotted</button>
    </form>`;
  showSheet();
  // Screenshot is the primary path — pick image right here, no extra navigation
  const quick = $("#ssQuick"), quickInput = $("#ssQuickInput");
  let selectedDataUrl = null;
  quick.addEventListener("click", e => {
    if (e.target.closest(".ss-change")) return; // "Change" button handles its own click
    quickInput.click();
  });
  $("#ssChange").addEventListener("click", e => { e.stopPropagation(); quickInput.value = ""; quickInput.click(); });
  quickInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      selectedDataUrl = ev.target.result;
      $("#ssPreviewImg").src = selectedDataUrl;
      $("#ssPreview").classList.remove("hidden");
      $("#ssEmpty").classList.add("hidden");
      $("#ssProcess").classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });
  $("#ssProcess").addEventListener("click", () => {
    if (!selectedDataUrl) return;
    closeSheet();
    setTimeout(() => openScreenshotSubmit(selectedDataUrl, null), 260);
  });
  // Date field must not open keyboard/calendar while scrolling — only on explicit tap
  const vu = $("#vuDate");
  vu.addEventListener("focus", () => { if (!vu.dataset.open) { vu.blur(); } });
  vu.addEventListener("click", () => { vu.dataset.open = "1"; try { vu.showPicker(); } catch (e) {} });
  $("#manualToggle").addEventListener("click", () => {
    $("#submitForm").classList.toggle("hidden");
    $("#manualToggle").classList.toggle("open");
    if (!$("#submitForm").classList.contains("hidden")) $("#merchantInput").focus();
  });
  const hintEl = $("#merchantHint");
  const updateHint = () => {
    const val = $("#merchantInput").value.trim();
    if (val.length < 2) { hintEl.textContent = ""; return; }
    const cat = $("#submitForm [name=category]").value;
    const key = normMerchant(val);
    const alias = MERCHANT_ALIASES[key] || userAliases()[key];
    const matched = DATA.brands.find(x => x.id === key || normMerchant(x.name) === key || (alias && (x.id === alias || normMerchant(x.name) === alias)));
    if (matched) hintEl.textContent = `✓ Will attach to existing brand: ${matched.name}`;
    else hintEl.textContent = `+ New merchant profile will be created for "${val}" (${cat === "food" ? "restaurant" : "merchant"})`;
  };
  $("#merchantInput").addEventListener("input", updateHint);
  $("#submitForm [name=category]").addEventListener("change", updateHint);
  $("#submitForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const category = f.get("category");
    const resolution = resolveMerchant(f.get("brand"), category);
    const brandId = resolution.brandId;
    const id = "u" + Date.now();
    const existing = DATA.brands.find(b => b.id === brandId);
    if (existing?.merchant_profile) existing.merchant_profile.deal_count = (existing.merchant_profile.deal_count || 0) + 1;
    DATA.deals.push({
      id, brand: brandId, brand_brand_type: existing?.brand_type || "brand", category,
      title: (resolution.isNew ? "[Spotted] " : "") + f.get("title"), summary: "Community-submitted deal.",
      discount: null, eligibility: { payment: [], merchant: f.get("brand"), user: "any", min_spend: null },
      cities: [f.get("city")], valid_from: NOW.toISOString().slice(0, 10),
      valid_until: f.get("valid_until") || new Date(NOW.getTime() + 24 * 36e5).toISOString().slice(0, 10),
      exclusions: ["Pending verification by DealRadar"], steps: [],
      merchant_info: { name: f.get("brand"), resolved_brand: resolution.matched || null, new_profile: resolution.isNew },
      source: { type: "community", platform: "user submission", url: "", status: "pending", captured_at: NOW.toISOString() },
      status: "spotted", verification: "unverified", confidence: 0.5,
      community: { votes: 1, worked: 0, failed: 0, saves: 0, spotted_by: "@you", reports_expired: 0 }
    });
    normalizeDeal(DATA.deals[DATA.deals.length - 1]);
    saveLocalDeal(DATA.deals[DATA.deals.length - 1], resolution);
    Sync.pushDeal(DATA.deals[DATA.deals.length - 1], resolution.profile); // live to Supabase (fire-and-forget)
    // FounderProfile memory: learn brand preference
    const brandName = (f.get("brand") || "").trim().toLowerCase();
    const plat = PK_PLATFORMS.find(x => x.name.toLowerCase() === brandName || x.keywords.some(k => k.length > 2 && brandName.includes(k)));
    if (plat) FounderProfile.recordSubmission(plat.id, plat.segment, 0.7);
    const msg = resolution.isNew
      ? `Created merchant profile "${f.get("brand")}" and queued your deal`
      : `Attached to ${resolution.matched} — "${f.get("title")}" is in the queue`;
    addNotification(msg);
    brandMap.clear(); closeSheet(); state.tab = "home"; state.city = "All"; state.cat = "all"; state.q = ""; $("#q").value = ""; syncTabs(); renderAll(); toast(t("addedSpotted"));
  });
}

// ---- verification feedback loop (Phase 4) ----
// Options: Working / Expired / Wrong price / Wrong code / Not applicable.
// Votes are persisted locally (per device) until Supabase makes them shared.
// Repeated "expired" reports demote a deal's prominence; corroboration promotes it.
const VERIFY_TYPES = [
  { key: "working", label: "✓ Working", delta: d => { d.community.worked = (d.community.worked || 0) + 1; d.verification_count = (d.verification_count || 0) + 1; } },
  { key: "expired", label: "✕ Expired", delta: d => { d.community.failed = (d.community.failed || 0) + 1; d.failure_count = (d.failure_count || 0) + 1; d.community.reports_expired = (d.community.reports_expired || 0) + 1; } },
  { key: "wrong_price", label: "₨ Wrong price", delta: d => { d.failure_count = (d.failure_count || 0) + 1; d.flags = (d.flags || []).concat("wrong_price"); } },
  { key: "wrong_code", label: "🔑 Wrong code", delta: d => { d.failure_count = (d.failure_count || 0) + 1; d.flags = (d.flags || []).concat("wrong_code"); } },
  { key: "not_applicable", label: "∅ Not applicable", delta: d => { d.flags = (d.flags || []).concat("not_applicable"); } }
];
function verifyLog() { try { return JSON.parse(store.get("dr_verify_log", "{}")); } catch { return {}; } }
function saveVerifyLog(log) { store.set("dr_verify_log", JSON.stringify(log)); }
function myVote(id) { return verifyLog()[id] || null; }
// Promote/demote: verification tier computed from net community signal
function verificationTier(d) {
  const worked = d.community?.worked || 0, failed = d.community?.failed || 0;
  const expiredReports = d.community?.reports_expired || 0;
  if (d.founder_verified) {
    if ((expiredReports >= 5 || failed >= 5) && worked === 0)
      return { label: "👑⚠ Founder deal — users report issues", cls: "warn" };
    return { label: "👑 Founder-verified", cls: "founder" };
  }
  if (expiredReports >= 3 || failed >= 3) return { label: "⚠ Likely expired", cls: "bad" };
  if (worked >= 3 && failed === 0) return { label: "✓ Community confirmed", cls: "good" };
  if (worked >= 1) return { label: "✓ Recently verified", cls: "good" };
  if (failed >= 1) return { label: "⚠ Disputed", cls: "warn" };
  return { label: "○ Unverified", cls: "neutral" };
}
function applyVerification(d, typeKey) {
  const vt = VERIFY_TYPES.find(x => x.key === typeKey);
  if (!vt) return;
  const log = verifyLog();
  if (log[d.id] === typeKey) return; // already cast this exact vote on this device
  vt.delta(d);
  d.last_verified_at = new Date().toISOString();
  log[d.id] = typeKey; saveVerifyLog(log);
  trustCache.clear();
  // Promote a low-confidence spotted deal once corroborated by real users
  if ((d.community.worked || 0) >= 2 && d.verification === "pending") {
    d.verification = "corroborated"; d.status = "active"; d.confidence = Math.min(0.9, (d.confidence || 0.5) + 0.2);
    addNotification(`"${d.title}" was confirmed working by the community`);
  }
  if (isLocalDeal(d)) persistLocalDeals();
  Sync.pushVote(d, typeKey); // live to Supabase (fire-and-forget)
}

// ---- AI Brand Recognition Engine v2 (100+ Pakistani platforms) ----
// 3-tier cascade: header OCR → header color → full-page keywords → format inference.
// Handles: full app screenshots, cropped vouchers, SMS texts, promo images, stories.
// Speed: header crop OCR (~200ms) + color analysis (~50ms) + keyword scan (~5ms).

// Pakistan eligibility: platforms without operatesIn default to PK.
// Non-PK platforms are excluded from matching unless explicitly confirmed by text.
function pkPlatforms() {
  return PK_PLATFORMS.filter(p => !p.operatesIn || p.operatesIn.includes("PK"));
}

const PK_PLATFORMS = [
  // ===== Q-COMMERCE / FOOD DELIVERY =====
  { id:"foodpanda", name:"Foodpanda", segment:"qcommerce", colors:["#d70f64","#e91e8c","#c2185b","#f06292"], keywords:["pandamart","panda pro","dmart","search for restaurants","popular restaurants","carts","pick-up","order now","t&cs apply","save 25%","flash deals","limited time offers","grocery","health & beauty","cakes & bakery","midnight cravings"], headerText:["foodpanda","panda","pandamart"], format:"app" },
  { id:"careem", name:"Careem", segment:"qcommerce", colors:["#00a94f","#00b359","#009944"], keywords:["careem","quik","careem quik","grocery","delivery","order food","restaurants"], headerText:["careem","quik"], format:"app" },
  { id:"bykea", name:"Bykea", segment:"qcommerce", colors:["#ffd600","#f5c400","#ffeb3b"], keywords:["bykea","ride","delivery","parcel"], headerText:["bykea"], format:"app" },
  { id:"keeta", name:"Keeta", segment:"qcommerce", colors:["#ff6b00","#ff8c00"], keywords:["keeta","food delivery"], headerText:["keeta"], format:"app" },
  { id:"swvl", name:"Swvl", segment:"qcommerce", colors:["#7b2ff7","#9c4dff"], keywords:["swvl","bus","ride"], headerText:["swvl"], format:"app", operatesIn:["AE","SA"] },
  { id:"indrive", name:"inDrive", segment:"qcommerce", colors:["#00c853","#00e676"], keywords:["indrive","in drive","ride","taxi"], headerText:["indrive","in drive"], format:"app", operatesIn:["PK"] },
  { id:"uber", name:"Uber", segment:"qcommerce", colors:["#000000","#1a1a1a"], keywords:["uber","ride","eats"], headerText:["uber"], format:"app", operatesIn:["US","UK","AE"] },
  { id:"grab", name:"Grab", segment:"qcommerce", colors:["#00b14f","#00d15c"], keywords:["grab","food","delivery"], headerText:["grab"], format:"app", operatesIn:["SG","MY","TH"] },

  // ===== E-COMMERCE =====
  { id:"daraz", name:"Daraz", segment:"ecommerce", colors:["#f57224","#f85606","#ff6a00","#e8590c"], keywords:["daraz","flash sale","collect","voucher","daraz mall","free shipping","daraz 11.11","daraz 12.12","coins","lazada"], headerText:["daraz"], format:"app" },
  { id:"kravemart", name:"KraveMart", segment:"ecommerce", colors:["#ffd600","#f5c400","#e6b800","#fdd835"], keywords:["kravemart","vouchers","express","super store","just for you","min order","maximum discount","pan ka khokha","kfresh","limit per day"], headerText:["kravemart","kfresh"], format:"app" },
  { id:"carrefour", name:"Carrefour", segment:"ecommerce", colors:["#8b1a1a","#a52a2a","#c62828","#b71c1c"], keywords:["carrefour","quality you can trust","free delivery","fresh","doorstep","skip intro","freshness delivered"], headerText:["carrefour"], format:"app" },
  { id:"telemart", name:"Telemart", segment:"ecommerce", colors:["#e31e24","#ff1744","#d50000"], keywords:["telemart","electronics","gadgets"], headerText:["telemart"], format:"app" },
  { id:"shophive", name:"ShopHive", segment:"ecommerce", colors:["#ff6600","#ff8800"], keywords:["shophive","shop hive"], headerText:["shophive"], format:"app" },
  { id:"olx", name:"OLX", segment:"ecommerce", colors:["#002f34","#23e5db"], keywords:["olx","classifieds","sell","buy"], headerText:["olx"], format:"app" },
  { id:"markaz", name:"Markaz", segment:"ecommerce", colors:["#6c5ce7","#a29bfe"], keywords:["markaz","reselling","dropshipping"], headerText:["markaz"], format:"app" },
  { id:"bagallery", name:"Bagallery", segment:"ecommerce", colors:["#e91e63","#f06292"], keywords:["bagallery","fashion","bags"], headerText:["bagallery"], format:"app" },
  { id:"outfitters", name:"Outfitters", segment:"ecommerce", colors:["#1a1a2e","#16213e"], keywords:["outfitters","clothing","fashion"], headerText:["outfitters"], format:"app" },
  { id:"sapphire", name:"Sapphire", segment:"ecommerce", colors:["#2d3436","#636e72"], keywords:["sapphire","clothing","un-stitched"], headerText:["sapphire"], format:"app" },
  { id:"khaadi", name:"Khaadi", segment:"ecommerce", colors:["#c0392b","#e74c3c"], keywords:["khaadi","fabric","un-stitched","lawn"], headerText:["khaadi"], format:"app" },
  { id:"limelight", name:"Limelight", segment:"ecommerce", colors:["#8e44ad","#9b59b6"], keywords:["limelight","clothing","women"], headerText:["limelight"], format:"app" },
  { id:"alkaram", name:"Alkaram Studio", segment:"ecommerce", colors:["#2c3e50","#34495e"], keywords:["alkaram","studio","fabric"], headerText:["alkaram"], format:"app" },
  { id:"gulahmed", name:"Gul Ahmed", segment:"ecommerce", colors:["#1abc9c","#16a085"], keywords:["gul ahmed","gulahmed","fabric","lawn"], headerText:["gul ahmed"], format:"app" },
  { id:"nishat", name:"Nishat Linen", segment:"ecommerce", colors:["#e74c3c","#c0392b"], keywords:["nishat","linen","fabric"], headerText:["nishat"], format:"app" },
  { id:"sanaullas", name:"Sana Safinaz", segment:"ecommerce", colors:["#d4a574","#c9956c"], keywords:["sana safinaz","luxury","pret"], headerText:["sana safinaz"], format:"app" },
  { id:"crossfit", name:"CrossFit Store", segment:"ecommerce", colors:["#2d3436","#636e72"], keywords:["crossfit","fitness","gym"], headerText:["crossfit"], format:"app" },
  { id:"shophive2", name:"iShopping", segment:"ecommerce", colors:["#3498db","#2980b9"], keywords:["ishopping","electronics","mobile"], headerText:["ishopping"], format:"app" },
  { id:"priceoye", name:"PriceOye", segment:"ecommerce", colors:["#f39c12","#e67e22"], keywords:["priceoye","price comparison","deals"], headerText:["priceoye"], format:"app" },
  { id:"homeshopping", name:"Home Shopping", segment:"ecommerce", colors:["#e74c3c","#c0392b"], keywords:["home shopping","tv shopping"], headerText:["home shopping"], format:"app" },
  { id:"humhum", name:"HumHum", segment:"ecommerce", colors:["#9b59b6","#8e44ad"], keywords:["humhum","fashion"], headerText:["humhum"], format:"app" },
  { id:"zara", name:"Zara (PK)", segment:"ecommerce", colors:["#000000","#333333"], keywords:["zara","fashion","clothing"], headerText:["zara"], format:"app" },
  { id:"hm", name:"H&M (PK)", segment:"ecommerce", colors:["#e50010","#cc0000"], keywords:["h&m","hm","fashion"], headerText:["h&m","hm"], format:"app" },
  { id:"aliexpress", name:"AliExpress", segment:"ecommerce", colors:["#e62e04","#ff4747"], keywords:["aliexpress","ali express","free shipping"], headerText:["aliexpress"], format:"app" },
  { id:"amazon", name:"Amazon (PK)", segment:"ecommerce", colors:["#ff9900","#ffb84d"], keywords:["amazon","prime","free delivery"], headerText:["amazon"], format:"app" },

  // ===== BANKS =====
  { id:"hbl", name:"HBL", segment:"bank", colors:["#006747","#00875a","#004d35"], keywords:["hbl","habib bank","konnect","hbl mobile","debit card","credit card"], headerText:["hbl","habib"], format:"app" },
  { id:"mcb", name:"MCB Bank", segment:"bank", colors:["#005a30","#007a3d","#004d28"], keywords:["mcb","mcb live","mcb islamic"], headerText:["mcb"], format:"app" },
  { id:"ubl", name:"UBL", segment:"bank", colors:["#003366","#004080","#00264d"], keywords:["ubl","united bank","omni","ubl digital"], headerText:["ubl","united bank"], format:"app" },
  { id:"meezan", name:"Meezan Bank", segment:"bank", colors:["#00695c","#00897b","#004d40"], keywords:["meezan","islamic bank","meezan digital","meezan app"], headerText:["meezan"], format:"app" },
  { id:"alfalah", name:"Bank Alfalah", segment:"bank", colors:["#1a237e","#283593","#0d1b6e"], keywords:["alfalah","bank alfalah","alfa","alfa app"], headerText:["alfalah"], format:"app" },
  { id:"askari", name:"Askari Bank", segment:"bank", colors:["#1b5e20","#2e7d32","#145218"], keywords:["askari","askari bank"], headerText:["askari"], format:"app" },
  { id:"allied", name:"Allied Bank", segment:"bank", colors:["#0d47a1","#1565c0","#0a3d91"], keywords:["allied","abl","allied bank"], headerText:["allied","abl"], format:"app" },
  { id:"jsbank", name:"JS Bank", segment:"bank", colors:["#1565c0","#1976d2"], keywords:["js bank","jsbank"], headerText:["js bank"], format:"app" },
  { id:"faysal", name:"Faysal Bank", segment:"bank", colors:["#004d40","#00695c"], keywords:["faysal","faysal bank"], headerText:["faysal"], format:"app" },
  { id:"bankislami", name:"BankIslami", segment:"bank", colors:["#00695c","#00897b"], keywords:["bankislami","bank islami","islami"], headerText:["bankislami"], format:"app" },
  { id:"silkbank", name:"SilkBank", segment:"bank", colors:["#4a148c","#6a1b9a"], keywords:["silkbank","silk bank"], headerText:["silkbank"], format:"app" },
  { id:"summit", name:"Summit Bank", segment:"bank", colors:["#b71c1c","#c62828"], keywords:["summit","summit bank"], headerText:["summit"], format:"app" },
  { id:"nbp", name:"NBP", segment:"bank", colors:["#1b5e20","#2e7d32"], keywords:["nbp","national bank"], headerText:["nbp","national bank"], format:"app" },
  { id:"bop", name:"Bank of Punjab", segment:"bank", colors:["#0d47a1","#1565c0"], keywords:["bop","bank of punjab","punjab"], headerText:["bop","punjab"], format:"app" },
  { id:"smb", name:"SMB (Samba)", segment:"bank", colors:["#e65100","#ef6c00"], keywords:["smb","samba"], headerText:["smb"], format:"app" },
  { id:"dubaiislamic", name:"Dubai Islamic", segment:"bank", colors:["#00695c","#00897b"], keywords:["dubai islamic","dib"], headerText:["dubai islamic"], format:"app" },
  { id:"standardchartered", name:"Standard Chartered", segment:"bank", colors:["#0072ce","#005bb5"], keywords:["standard chartered","scb"], headerText:["standard chartered"], format:"app" },
  { id:"citi", name:"Citi Bank", segment:"bank", colors:["#003b70","#00509e"], keywords:["citi","citibank"], headerText:["citi"], format:"app" },
  { id:"habibmetro", name:"HabibMetro", segment:"bank", colors:["#006747","#00875a"], keywords:["habibmetro","habib metro"], headerText:["habibmetro"], format:"app" },
  { id:"bankmaktaba", name:"Bank Maktaba", segment:"bank", colors:["#1a237e","#283593"], keywords:["maktaba"], headerText:["maktaba"], format:"app" },

  // ===== E-WALLETS / FINTECH =====
  { id:"easypaisa", name:"Easypaisa", segment:"ewallet", colors:["#4caf50","#66bb6a","#2e7d32","#388e3c"], keywords:["easypaisa","telenor","wallet","cashback","recharge","easy paisa","send money","bill payment"], headerText:["easypaisa","easy paisa"], format:"app" },
  { id:"jazzcash", name:"JazzCash", segment:"ewallet", colors:["#e53935","#d32f2f","#c62828","#ef5350"], keywords:["jazzcash","jazz","wallet","recharge","cashback","jazz cash","send money"], headerText:["jazzcash","jazz cash"], format:"app" },
  { id:"sadaapay", name:"SadaaPay", segment:"ewallet", colors:["#00c853","#00e676","#00b248"], keywords:["sadaapay","sadaa pay","card","transfer"], headerText:["sadaapay","sadaa"], format:"app" },
  { id:"nayapay", name:"NayaPay", segment:"ewallet", colors:["#6200ea","#7c4dff","#651fff"], keywords:["nayapay","naya pay","card","transfer"], headerText:["nayapay","naya"], format:"app" },
  { id:"raast", name:"Raast", segment:"ewallet", colors:["#00695c","#00897b"], keywords:["raast","instant payment","p2p"], headerText:["raast"], format:"app" },
  { id:"finja", name:"Finja", segment:"ewallet", colors:["#ff6f00","#ff8f00"], keywords:["finja","b2b","payments"], headerText:["finja"], format:"app" },
  { id:"tagpay", name:"TagPay", segment:"ewallet", colors:["#1565c0","#1976d2"], keywords:["tagpay","tag pay"], headerText:["tagpay"], format:"app" },
  { id:"upaisa", name:"uPaisa", segment:"ewallet", colors:["#7b1fa2","#9c27b0"], keywords:["upaisa","u paisa","wallet"], headerText:["upaisa"], format:"app" },
  { id:"keenu", name:"Keenu Wallet", segment:"ewallet", colors:["#00bcd4","#00acc1"], keywords:["keenu","wallet"], headerText:["keenu"], format:"app" },
  { id:"postex", name:"PostEx", segment:"ewallet", colors:["#ff5722","#e64a19"], keywords:["postex","cod","cash on delivery"], headerText:["postex"], format:"app" },

  // ===== RESTAURANTS / FOOD CHAINS =====
  { id:"kfc", name:"KFC", segment:"restaurant", colors:["#e4002b","#c8102e","#d32f2f"], keywords:["kfc","bucket","colonel","zinger","twister","hot wings"], headerText:["kfc"], format:"app" },
  { id:"mcdonalds", name:"McDonald's", segment:"restaurant", colors:["#ffc72c","#ffbc0d","#da291c"], keywords:["mcdonald","mcd","mcrib","mcflurry","big mac","happy meal","nuggets"], headerText:["mcdonald","mc donald"], format:"app" },
  { id:"pizzahut", name:"Pizza Hut", segment:"restaurant", colors:["#ee3124","#d32f2f","#c62828"], keywords:["pizza hut","hut","stuffed crust","pan pizza"], headerText:["pizza hut"], format:"app" },
  { id:"dominos", name:"Domino's", segment:"restaurant", colors:["#0b648f","#e31837","#0078ae"], keywords:["domino","dominos","pizza","extravaganza"], headerText:["domino"], format:"app" },
  { id:"burgerking", name:"Burger King", segment:"restaurant", colors:["#f5a623","#d62300","#ff8712"], keywords:["burger king","whopper","king deal"], headerText:["burger king"], format:"app" },
  { id:"hardees", name:"Hardee's", segment:"restaurant", colors:["#f5a623","#e8a020","#ffc72c"], keywords:["hardee","charbroiled","thickburger"], headerText:["hardee"], format:"app" },
  { id:"nandos", name:"Nando's", segment:"restaurant", colors:["#d32f2f","#b71c1c","#000000"], keywords:["nando","peri peri","flame grilled"], headerText:["nando"], format:"app" },
  { id:"subway", name:"Subway", segment:"restaurant", colors:["#00853f","#ffc600"], keywords:["subway","footlong","sandwich"], headerText:["subway"], format:"app" },
  { id:"popeyes", name:"Popeyes", segment:"restaurant", colors:["#f57c00","#e65100"], keywords:["popeyes","chicken","louisiana"], headerText:["popeyes"], format:"app" },
  { id:"tgif", name:"TGI Friday's", segment:"restaurant", colors:["#c62828","#b71c1c"], keywords:["tgi","friday","fridays"], headerText:["tgi"], format:"app" },
  { id:"chilis", name:"Chili's", segment:"restaurant", colors:["#d32f2f","#c62828"], keywords:["chili","chilis"], headerText:["chili"], format:"app" },
  { id:"optp", name:"OPTP", segment:"restaurant", colors:["#e53935","#d32f2f"], keywords:["optp","combo","burger","fries"], headerText:["optp"], format:"app" },
  { id:"broadway", name:"Broadway Pizza", segment:"restaurant", colors:["#1b5e20","#2e7d32"], keywords:["broadway","pizza"], headerText:["broadway"], format:"app" },
  { id:"cheezious", name:"Cheezious", segment:"restaurant", colors:["#ff6f00","#ff8f00"], keywords:["cheezious","pizza","pasta"], headerText:["cheezious"], format:"app" },
  { id:"pizzaa", name:"Pizzaa", segment:"restaurant", colors:["#e53935","#d32f2f"], keywords:["pizzaa","pizza"], headerText:["pizzaa"], format:"app" },
  { id:"gloria", name:"Gloria Jean's", segment:"restaurant", colors:["#4e342e","#5d4037"], keywords:["gloria","jean","coffee","latte"], headerText:["gloria"], format:"app" },
  { id:"starbucks", name:"Starbucks", segment:"restaurant", colors:["#00704a","#008c5e"], keywords:["starbucks","coffee","frappuccino","latte"], headerText:["starbucks"], format:"app" },
  { id:"dunkin", name:"Dunkin'", segment:"restaurant", colors:["#e11383","#ff6900"], keywords:["dunkin","donut","coffee"], headerText:["dunkin"], format:"app" },
  { id:"chaiwala", name:"Chai Wala", segment:"restaurant", colors:["#8d6e63","#795548"], keywords:["chai wala","chai","tea"], headerText:["chai wala"], format:"app" },
  { id:"secondfloor", name:"Second Floor", segment:"restaurant", colors:["#37474f","#455a64"], keywords:["second floor","cafe"], headerText:["second floor"], format:"app" },

  // ===== GROCERY / SUPERMARKETS =====
  { id:"imtiaz", name:"Imtiaz Super Market", segment:"grocery", colors:["#e53935","#d32f2f"], keywords:["imtiaz","super market","grocery"], headerText:["imtiaz"], format:"app" },
  { id:"metro", name:"Metro Cash & Carry", segment:"grocery", colors:["#003366","#004080"], keywords:["metro","cash and carry","wholesale"], headerText:["metro"], format:"app" },
  { id:"makro", name:"Makro", segment:"grocery", colors:["#e53935","#d32f2f"], keywords:["makro","wholesale","superstore"], headerText:["makro"], format:"app" },
  { id:"carrefourpk", name:"Carrefour PK", segment:"grocery", colors:["#8b1a1a","#a52a2a"], keywords:["carrefour","hypermarket","grocery"], headerText:["carrefour"], format:"app" },
  { id:"naheed", name:"Naheed Supermarket", segment:"grocery", colors:["#1565c0","#1976d2"], keywords:["naheed","supermarket"], headerText:["naheed"], format:"app" },
  { id:"chaseup", name:"Chase Up", segment:"grocery", colors:["#e53935","#d32f2f"], keywords:["chase up","chaseup","supermarket"], headerText:["chase"], format:"app" },
  { id:"albaik", name:"Al Baik", segment:"grocery", colors:["#00695c","#00897b"], keywords:["al baik","albaik","grocery"], headerText:["al baik"], format:"app" },
  { id:"bismillah", name:"Bismillah Superstore", segment:"grocery", colors:["#1b5e20","#2e7d32"], keywords:["bismillah","superstore"], headerText:["bismillah"], format:"app" },

  // ===== TRAVEL / BOOKING =====
  { id:"bookmyflight", name:"BookMyFlight", segment:"travel", colors:["#1565c0","#1976d2"], keywords:["bookmyflight","flight","airline"], headerText:["bookmyflight"], format:"app" },
  { id:"sastaticket", name:"Sastaticket", segment:"travel", colors:["#e53935","#d32f2f"], keywords:["sastaticket","sasta ticket","flight","hotel"], headerText:["sastaticket"], format:"app" },
  { id:"airblue", name:"Airblue", segment:"travel", colors:["#0072ce","#005bb5"], keywords:["airblue","air blue","flight","booking"], headerText:["airblue"], format:"app" },
  { id:"pia", name:"PIA", segment:"travel", colors:["#00695c","#00897b"], keywords:["pia","pakistan international","flight"], headerText:["pia"], format:"app" },
  { id:"serene", name:"Serene Air", segment:"travel", colors:["#00695c","#00897b"], keywords:["serene","serene air","flight"], headerText:["serene"], format:"app" },
  { id:"booking", name:"Booking.com", segment:"travel", colors:["#003580","#004494"], keywords:["booking","hotel","reservation"], headerText:["booking"], format:"app" },
  { id:"agoda", name:"Agoda", segment:"travel", colors:["#5c2d91","#6b3fa0"], keywords:["agoda","hotel","booking"], headerText:["agoda"], format:"app" },

  // ===== TELECOM / UTILITIES =====
  { id:"jazz", name:"Jazz", segment:"telecom", colors:["#e53935","#d32f2f"], keywords:["jazz","telenor","recharge","bundle","mb","gb"], headerText:["jazz"], format:"app" },
  { id:"telenor", name:"Telenor", segment:"telecom", colors:["#00aeef","#0099d6"], keywords:["telenor","recharge","bundle","easy paisa"], headerText:["telenor"], format:"app" },
  { id:"zong", name:"Zong", segment:"telecom", colors:["#8bc34a","#7cb342"], keywords:["zong","recharge","bundle","4g"], headerText:["zong"], format:"app" },
  { id:"ufone", name:"Ufone", segment:"telecom", colors:["#ff6f00","#ff8f00"], keywords:["ufone","recharge","bundle"], headerText:["ufone"], format:"app" },
  { id:"ptcl", name:"PTCL", segment:"telecom", colors:["#00695c","#00897b"], keywords:["ptcl","broadband","internet","bill"], headerText:["ptcl"], format:"app" },
  { id:"stormfiber", name:"StormFiber", segment:"telecom", colors:["#e53935","#d32f2f"], keywords:["stormfiber","storm fiber","internet","broadband"], headerText:["stormfiber"], format:"app" },
  { id:"nayatel", name:"Nayatel", segment:"telecom", colors:["#1565c0","#1976d2"], keywords:["nayatel","internet","fiber"], headerText:["nayatel"], format:"app" },

  // ===== PHARMACY / HEALTH =====
  { id:"dawai", name:"Dawai.pk", segment:"health", colors:["#00897b","#00695c"], keywords:["dawai","medicine","pharmacy","prescription"], headerText:["dawai"], format:"app" },
  { id:"sehat", name:"Sehat.com", segment:"health", colors:["#e53935","#d32f2f"], keywords:["sehat","medicine","pharmacy"], headerText:["sehat"], format:"app" },
  { id:"marham", name:"Marham", segment:"health", colors:["#1565c0","#1976d2"], keywords:["marham","doctor","appointment"], headerText:["marham"], format:"app" },
  { id:"oladoc", name:"Oladoc", segment:"health", colors:["#00bcd4","#00acc1"], keywords:["oladoc","doctor","appointment","clinic"], headerText:["oladoc"], format:"app" },

  // ===== EDUCATION =====
  { id:"byjus", name:"BYJU'S", segment:"education", colors:["#e53935","#d32f2f"], keywords:["byjus","learning","education"], headerText:["byjus"], format:"app" },
  { id:"ilmkidunya", name:"IlmKiDunya", segment:"education", colors:["#1565c0","#1976d2"], keywords:["ilmkidunya","ilm ki dunya","education","admission"], headerText:["ilmkidunya"], format:"app" }
];

const SEGMENT_LABELS = {
  qcommerce: "🚀 Quick Commerce",
  ecommerce: "🛒 E-Commerce",
  bank: "🏦 Bank",
  ewallet: "👛 E-Wallet",
  restaurant: "🍔 Restaurant / Food",
  grocery: "🛒 Grocery / Supermarket",
  travel: "✈️ Travel / Booking",
  telecom: "📱 Telecom / Utilities",
  health: "💊 Pharmacy / Health",
  education: "📚 Education"
};

// ---- Platform ⇄ Brand bridge ----
const SEGMENT_TO_BRAND_TYPE = {
  qcommerce: "delivery", ecommerce: "ecommerce", bank: "bank", ewallet: "wallet",
  restaurant: "qsr", grocery: "retail", travel: "travel", telecom: "telecom",
  health: "health", education: "education"
};
const FALLBACK_COLORS = ["#7c5cff","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#14b8a6","#ec4899","#6366f1","#84cc16"];
function stableColor(seed) {
  const t = normMerchant(seed) || "x";
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}
function findPlatformByName(rawName) {
  const key = normMerchant(rawName);
  if (!key) return null;
  return PK_PLATFORMS.find(p => p.id === key || normMerchant(p.name) === key) || null;
}
function findPlatformById(id) {
  return PK_PLATFORMS.find(p => p.id === id || normMerchant(p.name) === normMerchant(id)) || null;
}
function brandFromPlatform(pl) {
  return {
    id: pl.id, name: pl.name,
    brand_type: SEGMENT_TO_BRAND_TYPE[pl.segment] || "brand",
    color: (pl.colors && pl.colors[0]) || stableColor(pl.id),
    logo: null, segment: pl.segment,
    merchant_profile: { created_at: NOW.toISOString(), created_by: "ai_recognized", source: "platform_match", deal_count: 0, ai_confident: true }
  };
}
// Device-created/promoted brands survive fetchLive's wholesale DATA.brands replacement.
function deviceBrands() { try { return JSON.parse(store.get("dr_device_brands", "[]")); } catch { return []; } }
function rememberDeviceBrand(profile) {
  if (!profile || !profile.id) return;
  const list = deviceBrands().filter(b => b.id !== profile.id);
  list.push(profile);
  try { store.set("dr_device_brands", JSON.stringify(list.slice(-200))); } catch (e) {}
}

// ---- Correction memory (validated provider→merchant mappings) ----
function correctionMemory() {
  try { return JSON.parse(store.get("dr_corrections", "[]")); } catch { return []; }
}
function rememberCorrection(provider, merchant, code) {
  if (!provider || !merchant || provider === merchant) return;
  const mem = correctionMemory().filter(c => !(c.provider === provider && c.merchant === merchant));
  mem.push({ provider: provider.trim(), merchant: merchant.trim(), code: code || null, ts: Date.now() });
  try { store.set("dr_corrections", JSON.stringify(mem.slice(-100))); } catch (e) {}
}
function getCorrectionsFor(provider) {
  const key = normMerchant(provider);
  return correctionMemory().filter(c => normMerchant(c.provider) === key);
}
// Remember when user rejects an AI guess and picks the correct platform
function rememberAICorrection(wrongGuess, correctPlatform, context) {
  if (!wrongGuess || !correctPlatform || wrongGuess === correctPlatform) return;
  const mem = aiCorrectionMemory().filter(c => !(c.wrong === wrongGuess && c.correct === correctPlatform));
  mem.push({ wrong: wrongGuess, correct: correctPlatform, context: context || "", ts: Date.now() });
  try { store.set("dr_ai_corrections", JSON.stringify(mem.slice(-100))); } catch (e) {}
}
function aiCorrectionMemory() {
  try { return JSON.parse(store.get("dr_ai_corrections", "[]")); } catch { return []; }
}
// Get boost for a platform based on past corrections (user confirmed this platform before)
function getCorrectionBoost(platformId) {
  const mem = aiCorrectionMemory();
  const confirmed = mem.filter(c => c.correct === platformId).length;
  const rejected = mem.filter(c => c.wrong === platformId).length;
  // Each confirmation adds 5% boost (max 30%), each rejection subtracts 5% (max 30%)
  return Math.max(0.7, Math.min(1.3, 1 + (confirmed - rejected) * 0.05));
}

// ---- Founder Profile (user preference memory) ----
const FounderProfile = {
  data: JSON.parse(store.get("dr_founder_profile", "null")) || {
    totalSubmissions: 0,
    segmentCounts: {},       // {qcommerce: 12, bank: 5, ...}
    brandCounts: {},         // {foodpanda: 8, kfc: 3, ...}
    lastBrands: [],          // last 10 brand IDs submitted
    avgConfidence: 0,
    preferredSegments: [],   // top segments by frequency
    createdAt: null,
    updatedAt: null
  },
  save() {
    this.data.updatedAt = new Date().toISOString();
    store.set("dr_founder_profile", JSON.stringify(this.data));
  },
  recordSubmission(brandId, segment, confidence) {
    this.data.totalSubmissions++;
    this.data.segmentCounts[segment] = (this.data.segmentCounts[segment] || 0) + 1;
    this.data.brandCounts[brandId] = (this.data.brandCounts[brandId] || 0) + 1;
    this.data.lastBrands.unshift(brandId);
    if (this.data.lastBrands.length > 10) this.data.lastBrands.pop();
    this.data.avgConfidence = ((this.data.avgConfidence * (this.data.totalSubmissions - 1)) + confidence) / this.data.totalSubmissions;
    // Recompute preferred segments
    this.data.preferredSegments = Object.entries(this.data.segmentCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    if (!this.data.createdAt) this.data.createdAt = new Date().toISOString();
    this.save();
  },
  // Boost: if user frequently submits from a segment, boost that segment's platforms
  getSegmentBoost(platformId) {
    const p = PK_PLATFORMS.find(x => x.id === platformId);
    if (!p) return 1;
    const count = this.data.segmentCounts[p.segment] || 0;
    const total = this.data.totalSubmissions || 1;
    const freq = count / total;
    return 1 + (freq * 0.3); // up to 30% boost for frequent segments
  },
  // Boost: if user recently submitted this brand, it's more likely again
  getBrandBoost(platformId) {
    const idx = this.data.lastBrands.indexOf(platformId);
    if (idx === -1) return 1;
    return 1 + ((10 - idx) / 10) * 0.2; // up to 20% boost for recent brands
  }
};

// ---- Image Analysis Utilities ----
function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataUrl;
  });
}

// Analyze a specific region of the image (for header cropping)
function analyzeRegion(img, x, y, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = {};
  for (let i = 0; i < data.length; i += 16) {
    const r = Math.round(data[i] / 32) * 32;
    const g = Math.round(data[i + 1] / 32) * 32;
    const b = Math.round(data[i + 2] / 32) * 32;
    const key = `${r},${g},${b}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => {
    const [r, g, b] = k.split(",").map(Number);
    return { r, g, b, hex: `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}` };
  });
}

// Full image dominant colors
function analyzeFullColors(img) {
  return analyzeRegion(img, 0, 0, img.width, img.height);
}

// Crop header region (top 15%) as a data URL for targeted OCR
function cropHeader(img) {
  const h = Math.round(img.height * 0.15);
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, img.width, h, 0, 0, img.width, h);
  return canvas.toDataURL("image/png");
}

// Color distance
function colorDist(c1, c2) {
  return Math.sqrt((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2 + (c1[2]-c2[2])**2);
}

// Match colors against platform signatures
function matchByColor(colors, platforms) {
  const results = [];
  for (const p of platforms) {
    let best = 0;
    for (const dc of colors) {
      for (const pc of p.colors) {
        const r = parseInt(pc.slice(1,3),16), g = parseInt(pc.slice(3,5),16), b = parseInt(pc.slice(5,7),16);
        const score = Math.max(0, 1 - colorDist([dc.r,dc.g,dc.b],[r,g,b]) / 180);
        best = Math.max(best, score);
      }
    }
    if (best > 0.25) results.push({ platform: p, score: best });
  }
  return results.sort((a, b) => b.score - a.score);
}

// Match OCR text against platform keywords (word-boundary aware)
function matchByText(ocrText, platforms) {
  const T = String(ocrText || "").toLowerCase();
  const results = [];
  for (const p of platforms) {
    let hits = 0;
    for (const kw of p.keywords) {
      const k = kw.toLowerCase();
      if (k.includes(" ") || k.length > 5) {
        if (T.includes(k)) hits++;
      } else {
        const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(T)) hits++;
      }
    }
    // Also check headerText (brand name in header = very strong signal)
    let headerHit = false;
    for (const ht of (p.headerText || [])) {
      if (T.includes(ht.toLowerCase())) { headerHit = true; break; }
    }
    if (hits > 0 || headerHit) {
      let score = 1 - Math.pow(0.5, hits);
      if (headerHit) score = Math.max(score, 0.95); // brand name found = near-certain
      results.push({ platform: p, score, hits, headerHit });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// Format inference: when no brand name or color match, infer from screenshot format
function inferFromFormat(ocrText, img) {
  const T = String(ocrText || "").toLowerCase();
  const aspect = img ? img.height / img.width : 0;
  const clues = [];
  // Voucher/coupon format: has "code", "min order", "max discount", "% off"
  if (/code|coupon|voucher|promo/i.test(T) && /min order|maximum discount|limit per day/i.test(T))
    clues.push({ segment: "ecommerce", reason: "voucher format with min order/max discount", boost: 0.3 });
  // Bank card offer: has "card", "debit", "credit", "% off at"
  if (/card|debit|credit/i.test(T) && /% off|discount|cashback/i.test(T))
    clues.push({ segment: "bank", reason: "bank card offer format", boost: 0.3 });
  // E-wallet: has "wallet", "recharge", "cashback", "send money"
  if (/wallet|recharge|send money|bill payment/i.test(T))
    clues.push({ segment: "ewallet", reason: "e-wallet transaction format", boost: 0.3 });
  // Food delivery: has "delivery", "order", "restaurant", "min"
  if (/delivery|order now|restaurant|pick.?up/i.test(T) && aspect > 1.5)
    clues.push({ segment: "qcommerce", reason: "food delivery app format", boost: 0.25 });
  // Grocery: has "grocery", "fresh", "vegetables", "fruits"
  if (/grocery|fresh|vegetables|fruits|supermarket/i.test(T))
    clues.push({ segment: "grocery", reason: "grocery/supermarket format", boost: 0.25 });
  // Telecom: has "recharge", "bundle", "mb", "gb", "data"
  if (/recharge|bundle|\d+\s*(mb|gb)|data pack/i.test(T))
    clues.push({ segment: "telecom", reason: "telecom recharge format", boost: 0.25 });
  // Travel: has "flight", "hotel", "booking", "ticket"
  if (/flight|hotel|booking|ticket|airline/i.test(T))
    clues.push({ segment: "travel", reason: "travel/booking format", boost: 0.25 });
  return clues;
}

// ---- Main AI Guess: 3-tier cascade ----
async function aiGuessPlatform(dataUrl, ocrText) {
  try {
    const img = await loadImage(dataUrl);

    // Tier 1: Header color analysis (top 15% of image) — PK platforms only
    const headerColors = analyzeRegion(img, 0, 0, img.width, Math.round(img.height * 0.15));
    const headerColorMatches = matchByColor(headerColors, pkPlatforms());

    // Tier 2: Full-page color analysis — PK platforms only
    const fullColors = analyzeFullColors(img);
    const fullColorMatches = matchByColor(fullColors, pkPlatforms());

    // Tier 3: Text matching — all platforms (text is explicit evidence)
    const textMatches = matchByText(ocrText, PK_PLATFORMS);

    // Tier 4: Format inference (for vague screenshots)
    const formatClues = inferFromFormat(ocrText, img);

    // Combine all signals with weights
    // Color is a secondary clue ONLY — never sufficient evidence alone.
    // Text (recognized brand name) is the primary signal.
    const combined = {};
    const addScore = (platformId, score, weight, source) => {
      if (!combined[platformId]) combined[platformId] = { platform: PK_PLATFORMS.find(p => p.id === platformId), scores: {}, total: 0 };
      const weighted = score * weight;
      combined[platformId].scores[source] = Math.max(combined[platformId].scores[source] || 0, weighted);
    };

    // Header color is weak (0.12) — only supports, never leads
    headerColorMatches.slice(0, 5).forEach(m => addScore(m.platform.id, m.score, 0.12, "headerColor"));
    // Full color is weakest (0.06) — ambient color is unreliable
    fullColorMatches.slice(0, 5).forEach(m => addScore(m.platform.id, m.score, 0.06, "fullColor"));
    // Text is dominant (0.65) — brand name in text = near-certain
    textMatches.slice(0, 5).forEach(m => addScore(m.platform.id, m.score, 0.65, "text"));

    // Apply founder profile boosts + correction memory boosts
    for (const id of Object.keys(combined)) {
      const segBoost = FounderProfile.getSegmentBoost(id);
      const brandBoost = FounderProfile.getBrandBoost(id);
      const corrBoost = getCorrectionBoost(id);
      combined[id].total = Object.values(combined[id].scores).reduce((a, b) => a + b, 0) * segBoost * brandBoost * corrBoost;
      // HARD INVARIANT: color-only matches (no text evidence) are capped at 0.14
      // — below the 0.15 suggestion threshold. Color alone is never sufficient.
      if (!combined[id].scores.text) {
        combined[id].total = Math.min(combined[id].total, 0.14);
      }
    }

    // Format clues boost segments (not specific brands)
    for (const clue of formatClues) {
      const segPlatforms = PK_PLATFORMS.filter(p => p.segment === clue.segment);
      for (const p of segPlatforms) {
        if (combined[p.id]) {
          combined[p.id].total += clue.boost * 0.1; // small boost to existing candidates in that segment
        }
      }
    }

    const ranked = Object.values(combined)
      .filter(c => c.total > 0.15)
      .sort((a, b) => b.total - a.total);

    if (!ranked.length) return null;

    const top = ranked[0];
    return {
      platform: top.platform,
      totalScore: Math.min(top.total, 1),
      scores: top.scores,
      runnersUp: ranked.slice(1, 4).map(r => ({ platform: r.platform, score: r.total })),
      formatClues
    };
  } catch (e) {
    console.warn("aiGuessPlatform error:", e.message);
    return null;
  }
}

// ---- modular deal extractor (Phase 3) ----
// Not hard-wired to one model. Providers are tried in order; each returns
// { fields, confidence, provider }. Priority: native ML Kit (offline, fast)
// → Tesseract.js CDN (browser fallback). Later a cloud vision/LLM provider
// can be appended without touching callers.
const DealExtractor = {
  providers: [],
  register(p) { this.providers.push(p); },
  async extract(imageDataUrl, timeoutMs = 12000) {
    const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("OCR timed out — fill manually")), timeoutMs));
    try { return await Promise.race([this._runProviders(imageDataUrl), timer]); }
    catch (e) { return { fields: {}, confidence: 0, provider: "timeout", raw: "", error: e.message }; }
  },
  async _runProviders(imageDataUrl) {
    for (const p of this.providers) {
      try {
        const out = await p(imageDataUrl);
        if (out && out.fields) return out;
      } catch (e) { /* try next provider */ }
    }
    return { fields: {}, confidence: 0, provider: "none", raw: "" };
  }
};

// Native ML Kit provider (Android APK only — offline, bundled model)
DealExtractor.register(async (dataUrl) => {
  if (!window.AndroidBridge || typeof window.AndroidBridge.ocrBase64 !== "function") {
    throw new Error("Native OCR not available");
  }
  const jsonStr = window.AndroidBridge.ocrBase64(dataUrl);
  const result = JSON.parse(jsonStr);
  if (result.error) throw new Error(result.error);
  const raw = result.text || "";
  const ocrConfidence = result.confidence != null ? result.confidence : null;
  const parsed = parseDealText(raw, ocrConfidence);
  return { fields: parsed.fields, confidence: parsed.confidence, conf: parsed.conf, evidence: parsed.evidence, provider: "mlkit", raw, ocrConfidence, words: result.words };
});

// Lazy-load Tesseract.js OCR from CDN (kept optional — app still works offline without it)
let _tessLoading = null;
let _ocrAvailable = null; // null = unknown, true/false after first attempt
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (_ocrAvailable === false) return Promise.reject(new Error("OCR unavailable"));
  if (_tessLoading) return _tessLoading;
  _tessLoading = new Promise((res, rej) => {
    const timeout = setTimeout(() => { _ocrAvailable = false; rej(new Error("OCR unavailable offline")); }, 4000);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = () => { clearTimeout(timeout); _ocrAvailable = true; res(window.Tesseract); };
    s.onerror = () => { clearTimeout(timeout); _ocrAvailable = false; rej(new Error("OCR unavailable offline")); };
    document.head.appendChild(s);
  });
  return _tessLoading;
}

// Parse extracted text into structured deal fields with per-field confidence.
// HARD INVARIANTS:
//  - Never fabricate expiry from upload time. Only use explicit dates found in text.
//  - Relative countdowns ("30 min left") are NOT converted to calendar dates.
//  - Recurring patterns ("every Fri-Sun") are detected separately from fixed dates.
//  - Coupon codes preserve exact OCR characters; never replaced with alternatives.
//  - Confidence reflects actual evidence quality, not hardcoded constants.
function parseDealText(text, ocrConfidence) {
  const fields = {};
  const conf = {};
  const evidence = {};
  const T = String(text || "");
  const baseConf = ocrConfidence != null ? Math.max(0.2, Math.min(1, ocrConfidence)) : 0.5;

  // Discount %
  const pct = T.match(/(\d{1,3})\s*%\s*(?:off|discount|cashback|save)?/i);
  if (pct && +pct[1] <= 90) {
    fields.discount_kind = "percent"; fields.discount_value = +pct[1];
    conf.discount_value = baseConf * 0.9;
    evidence.discount_value = `Found "${pct[0].trim()}" in text`;
  }
  // Flat Rs off
  const flat = T.match(/Rs\.?\s*([\d,]{2,})\s*(?:off|discount)?/i);
  if (!fields.discount_value && flat) {
    fields.discount_kind = "flat"; fields.discount_value = +flat[1].replace(/,/g, "");
    conf.discount_value = baseConf * 0.8;
    evidence.discount_value = `Found "${flat[0].trim()}" in text`;
  }
  // BOGO
  if (/buy\s*1\s*get\s*1|bogo|buy one get one/i.test(T)) {
    fields.discount_kind = "bogo";
    conf.discount_kind = baseConf * 0.7;
    evidence.discount_kind = "BOGO pattern found in text";
  }
  // Cap
  const cap = T.match(/(?:up to|max(?:imum)?|cap(?:ped)? at?)\s*Rs\.?\s*([\d,]+)/i);
  if (cap) { fields.discount_cap = +cap[1].replace(/,/g, ""); conf.discount_cap = baseConf * 0.7; evidence.discount_cap = `Found "${cap[0].trim()}"`; }

  // Promo code — must be near a label, contain alphanumeric, preserve exact chars
  const CODE_WORDS = /^(code|coupon|promo|voucher|use|deal|offer|discount|free|today|only|checkout|valid|till|until|the|and|with|save|get|buy|now|ends|minutes?|hours?|days?)$/i;
  let codeMatch = T.match(new RegExp(`\\b(?:code|coupon|promo|voucher)\\s*[:\\-]?\\s*([A-Za-z0-9]{4,12})\\b`, "i"));
  let codeTok = codeMatch ? codeMatch[1] : null;
  if (!codeTok || CODE_WORDS.test(codeTok)) {
    // Fallback: standalone alphanumeric token that looks like a code
    const alt = T.match(/\b([A-Z]{2,8}\d{2,6}|\d{2,6}[A-Z]{2,8}|[A-Z0-9]{5,10})\b/g);
    if (alt) {
      for (const cand of alt) {
        if (!CODE_WORDS.test(cand) && /[A-Z]/.test(cand) && /\d/.test(cand)) { codeTok = cand; break; }
      }
    }
  }
  if (codeTok && !CODE_WORDS.test(codeTok)) {
    fields.code = codeTok.toUpperCase(); // preserve exact characters
    conf.code = codeMatch ? baseConf * 0.85 : baseConf * 0.5; // labelled = higher confidence
    evidence.code = codeMatch ? `Found near label: "${codeMatch[0].trim()}"` : `Standalone token "${codeTok}" (unlabelled — verify)`;
  }

  // Expiry — ONLY explicit dates. Never compute from upload time.
  const mon = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  let expires_at = null;
  let validity_type = "unknown"; // "fixed" | "recurring" | "ongoing" | "unknown"
  let valid_days = null;

  // Fixed date patterns: "31 Dec 2026", "Dec 31", "31/12/2026", "31-12-26"
  const dmy = T.match(new RegExp(`(\\d{1,2})[\\s\\-/](${mon})[a-z]*[\\s\\-/]?(\\d{2,4})`, "i"));
  if (dmy) {
    const yr = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
    const dt = new Date(`${dmy[2].slice(0,3)} ${dmy[1]}, ${yr} 23:59:59`);
    if (!isNaN(dt) && dt > NOW) {
      expires_at = dt.toISOString();
      validity_type = "fixed";
      conf.expires_at = baseConf * 0.7;
      evidence.expires_at = `Explicit date found: "${dmy[0]}"`;
    }
  }
  // Numeric date: "31/12/2026" or "12/31/26"
  if (!expires_at) {
    const numDate = T.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (numDate) {
      const [_, a, b, yrRaw] = numDate;
      const yr = yrRaw.length === 2 ? "20" + yrRaw : yrRaw;
      // Try DD/MM first (PK convention)
      let dt = new Date(`${yr}-${String(b).padStart(2,"0")}-${String(a).padStart(2,"0")}T23:59:59`);
      if (isNaN(dt) || dt < NOW) dt = new Date(`${yr}-${String(a).padStart(2,"0")}-${String(b).padStart(2,"0")}T23:59:59`);
      if (!isNaN(dt) && dt > NOW) {
        expires_at = dt.toISOString();
        validity_type = "fixed";
        conf.expires_at = baseConf * 0.6;
        evidence.expires_at = `Numeric date found: "${numDate[0]}" (interpreted DD/MM/YYYY)`;
      }
    }
  }
  // "Valid till/until X" pattern
  if (!expires_at) {
    const tillMatch = T.match(new RegExp(`(?:valid|till|until|expires?|ends?)\\s*(?:till|until|on|by)?\\s*(\\d{1,2}[\\s\\-/](?:${mon})[a-z]*[\\s\\-/]?\\d{2,4})`, "i"));
    if (tillMatch) {
      const inner = tillMatch[1];
      const d2 = inner.match(new RegExp(`(\\d{1,2})[\\s\\-/](${mon})[a-z]*[\\s\\-/]?(\\d{2,4})`, "i"));
      if (d2) {
        const yr2 = d2[3].length === 2 ? "20" + d2[3] : d2[3];
        const dt2 = new Date(`${d2[2].slice(0,3)} ${d2[1]}, ${yr2} 23:59:59`);
        if (!isNaN(dt2) && dt2 > NOW) {
          expires_at = dt2.toISOString();
          validity_type = "fixed";
          conf.expires_at = baseConf * 0.75;
          evidence.expires_at = `"Valid till" label + date: "${tillMatch[0].trim()}"`;
        }
      }
    }
  }

  // Recurring validity: "every Friday", "Fri-Sun", "weekends", "Mon to Thu"
  const dayMap = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
  const dayKeys = ["mon","tue","wed","thu","fri","sat","sun"];
  const recurRange = T.match(/\b(?:every|each)\s+(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:to|till|until|-|–)\s*(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (recurRange) {
    const start = dayMap[recurRange[1].toLowerCase().slice(0,3)];
    const end = dayMap[recurRange[2].toLowerCase().slice(0,3)];
    valid_days = [];
    for (let i = start; i <= end; i++) valid_days.push(dayKeys[i % 7]);
    validity_type = "recurring";
    conf.valid_days = baseConf * 0.7;
    evidence.valid_days = `Recurring range found: "${recurRange[0]}"`;
  } else if (/\b(?:every\s+day|daily)\b/i.test(T)) {
    valid_days = dayKeys.slice();
    validity_type = "recurring";
    conf.valid_days = baseConf * 0.7;
    evidence.valid_days = `"Every day/daily" found`;
  } else if (/\bweekends?\b/i.test(T)) {
    valid_days = ["fri", "sat", "sun"];
    validity_type = "recurring";
    conf.valid_days = baseConf * 0.6;
    evidence.valid_days = `"Weekend(s)" found — assumed Fri-Sun (PK convention)`;
  } else {
    // Single day: "every Friday"
    const singleDay = T.match(/\b(?:every|each|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i);
    if (singleDay) {
      const dk = dayKeys[dayMap[singleDay[1].toLowerCase().slice(0,3)]];
      valid_days = [dk];
      validity_type = "recurring";
      conf.valid_days = baseConf * 0.65;
      evidence.valid_days = `Single recurring day: "${singleDay[0]}"`;
    }
  }

  // "Ongoing" / "no expiry" / "always"
  if (validity_type === "unknown" && /(?:ongoing|no expiry|always|permanent|indefinite)/i.test(T)) {
    validity_type = "ongoing";
    conf.validity_type = baseConf * 0.6;
    evidence.validity_type = `"Ongoing/no expiry" language found`;
  }

  fields.expires_at = expires_at;
  fields.validity_type = validity_type;
  fields.valid_days = valid_days;

  // Provider detection: banks/wallets (promotion sponsors)
  const providerPlats = pkPlatforms().filter(p => p.segment === "bank" || p.segment === "ewallet");
  const providerMatch = matchByText(T, providerPlats);
  if (providerMatch.length > 0 && providerMatch[0].score > 0.4) {
    fields.provider = providerMatch[0].platform.name;
    fields.provider_id = providerMatch[0].platform.id;
    conf.provider = baseConf * providerMatch[0].score;
    evidence.provider = `Bank/wallet name found in text: "${providerMatch[0].platform.name}" (${providerMatch[0].hits} keyword hits)`;
  }

  // Merchant detection: food/retail/ecommerce (redemption locations)
  const merchantPlats = pkPlatforms().filter(p => ["qcommerce","restaurant","grocery","ecommerce"].includes(p.segment));
  const merchantMatch = matchByText(T, merchantPlats);
  if (merchantMatch.length > 0 && merchantMatch[0].score > 0.4) {
    fields.merchant = merchantMatch[0].platform.name;
    fields.merchant_id = merchantMatch[0].platform.id;
    conf.merchant = baseConf * merchantMatch[0].score;
    evidence.merchant = `Merchant/platform name found: "${merchantMatch[0].platform.name}"`;
  }

  // If only one entity found, it's the brand (provider = merchant)
  if (fields.provider && !fields.merchant) { fields.brand = fields.provider; }
  else if (fields.merchant && !fields.provider) { fields.brand = fields.merchant; }
  else if (fields.provider && fields.merchant) { fields.brand = fields.provider; } // provider takes priority as brand

  // Fallback: check DATA.brands for any name match
  if (!fields.brand) {
    for (const b of DATA.brands) {
      if (b.name && T.toLowerCase().includes(String(b.name).toLowerCase())) {
        fields.brand = b.name; conf.brand = baseConf * 0.6;
        evidence.brand = `Brand name "${b.name}" found in text`;
        break;
      }
    }
  }

  // Title: longest promotional line
  const lines = T.split(/\n+/).map(s => s.trim()).filter(s => s.length > 8 && s.length < 90);
  const promo = lines.find(l => /off|deal|discount|save|cashback|free|%|offer|voucher/i.test(l));
  if (promo) {
    fields.title = promo.replace(/\s+/g, " ");
    conf.title = baseConf * 0.5;
    evidence.title = `Promotional line selected from ${lines.length} candidates`;
  }

  // City detection
  const cityMatch = T.match(/\b(karachi|lahore|islamabad|rawalpindi|multan|faisalabad|peshawar|quetta|sialkot|gujranwala|hyderabad|all pakistan|nationwide)\b/i);
  if (cityMatch) {
    fields.city = cityMatch[1].toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    if (fields.city === "All Pakistan" || fields.city === "Nationwide") fields.city = "All Pakistan";
    conf.city = baseConf * 0.7;
    evidence.city = `City name found: "${cityMatch[0]}"`;
  }

  const vals = Object.values(conf);
  const confidence = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return { fields, confidence, conf, evidence };
}

DealExtractor.register(async (dataUrl) => {
  const Tess = await loadTesseract();
  const { data } = await Tess.recognize(dataUrl);
  const raw = data.text || "";
  // Compute real OCR confidence from word-level data (0-100 → 0-1)
  let ocrConfidence = null;
  if (data.words && data.words.length > 0) {
    const avg = data.words.reduce((a, w) => a + (w.confidence || 0), 0) / data.words.length;
    ocrConfidence = Math.max(0, Math.min(1, avg / 100));
  } else if (data.confidence != null) {
    ocrConfidence = Math.max(0, Math.min(1, data.confidence / 100));
  }
  const parsed = parseDealText(raw, ocrConfidence);
  return { fields: parsed.fields, confidence: parsed.confidence, conf: parsed.conf, evidence: parsed.evidence, provider: "tesseract", raw, ocrConfidence };
});

// ---- screenshot submission (Phase 3 + AI Brand Recognition) ----
function openScreenshotSubmit(preDataUrl, preFile) {
  pushNav("submit");
  $("#sheet").innerHTML = `<div class="grab"></div>
    <h3>📸 Submit a deal screenshot</h3>
    <p class="sheet-summary">Pick a screenshot of any deal. AI reads the offer and identifies the platform — you just confirm.</p>
    <div class="drop-zone ss-drop" id="ssDrop"><div class="icon">🖼️</div><p id="ssDropText">Tap to choose a screenshot</p></div>
    <input type="file" id="ssInput" accept="image/*" hidden>
    <div id="ssPreview"></div>
    <div id="ssProgress" class="ss-progress hidden"></div>
    <div id="ssAiZone" class="hidden"></div>
    <form class="form hidden" id="ssForm">
      <div class="ss-warn" id="ssWarn"></div>
      <label>Who's offering it? <span class="opt">(provider — bank, wallet, app)</span></label>
      <input name="provider" id="ssProvider" required autocomplete="off" placeholder="e.g. JazzCash, HBL, Foodpanda">
      <div class="merchant-hint" id="ssProvHint"></div>
      <label>Where can you use it? <span class="opt">(merchant — optional if same)</span></label>
      <input name="merchant" id="ssMerchant" autocomplete="off" placeholder="e.g. Foodpanda, KFC (leave blank if same as provider)">
      <div class="merchant-hint" id="ssHint"></div>
      <label>Offer (title)</label><input name="title" id="ssTitle" required>
      <label>Discount</label>
      <div class="f-row">
        <select name="disc_kind" id="ssKind"><option value="percent">% off</option><option value="flat">Rs off</option><option value="bogo">Buy 1 Get 1</option><option value="cashback">Cashback</option><option value="none">None</option></select>
        <input name="disc_value" id="ssValue" type="number" min="0" placeholder="value">
      </div>
      <label>Validity</label>
      <div class="f-row">
        <select name="validity_type" id="ssValidity">
          <option value="until">Ends on date</option>
          <option value="recurring">Recurring (specific days)</option>
          <option value="ongoing">Ongoing / no end date</option>
        </select>
      </div>
      <div id="ssUntilWrap"><input name="expires_at" id="ssExpires" type="datetime-local"></div>
      <div id="ssDaysWrap" class="hidden">
        <div class="day-chips" id="ssDays">
          ${["mon","tue","wed","thu","fri","sat","sun"].map(d => `<label class="day-chip"><input type="checkbox" name="valid_day" value="${d}"><span>${d.charAt(0).toUpperCase() + d.slice(1)}</span></label>`).join("")}
        </div>
      </div>
      <label>Promo code <span class="opt">(exact characters — case matters)</span></label><input name="code" id="ssCode" placeholder="(optional)" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <label>Category</label><select name="category" id="ssCat">${CATS.filter(c => c[0] !== "all").map(c => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>
      <label>City</label><select name="city">${CITIES.slice(1).map(c => `<option>${c}</option>`).join("")}<option>All Pakistan</option></select>
      <button class="submit" type="submit">✓ Confirm & submit</button>
    </form>`;
  showSheet();

  const drop = $("#ssDrop"), input = $("#ssInput");
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleScreenshot(ev.target.result, file);
    reader.readAsDataURL(file);
  });
  // Pre-picked image from the submit sheet — skip the picker, start AI reading now
  if (preDataUrl) { drop.classList.add("hidden"); handleScreenshot(preDataUrl, preFile); }

  async function handleScreenshot(dataUrl, file) {
    drop.classList.add("hidden");
    $("#ssPreview").innerHTML = `<img src="${dataUrl}" class="ss-img" alt="screenshot">`;
    const prog = $("#ssProgress"); prog.classList.remove("hidden");
    prog.innerHTML = `<div class="spin"></div> AI is reading your screenshot…`;
    try {
      // Run OCR + AI brand guess in parallel
      const [ocrOut, aiGuess] = await Promise.all([
        DealExtractor.extract(dataUrl),
        aiGuessPlatform(dataUrl, "") // color-based guess first; text added after OCR
      ]);
      const f = ocrOut.fields || {};
      // Re-run AI guess with OCR text for better accuracy
      const aiGuessFinal = await aiGuessPlatform(dataUrl, ocrOut.raw || "");
      const guess = aiGuessFinal || aiGuess;

      prog.classList.add("hidden");

      // ---- Diagnostic: show raw OCR text in collapsible area ----
      const diagHtml = ocrOut.raw
        ? `<details class="ss-diag"><summary>🔍 What the reader saw (tap to expand)</summary><pre class="ss-diag-text">${esc(ocrOut.raw.slice(0, 2000))}</pre></details>`
        : "";

      // Distinguish OCR failure states
      const ocrStatus = ocrOut.provider === "timeout" ? "timeout"
        : ocrOut.provider === "none" ? "unavailable"
        : (!ocrOut.raw || ocrOut.raw.trim().length < 5) ? "no_text"
        : "ok";

      // If OCR produced nothing useful, show manual form immediately
      const hasUsefulFields = f.brand || f.title || f.discount_value || f.code || f.provider;
      if (!hasUsefulFields && (ocrStatus === "unavailable" || ocrStatus === "timeout" || ocrStatus === "no_text")) {
        const failMsgs = {
          timeout: "⏱️ OCR timed out — the image may be too large or complex. Fill details manually.",
          unavailable: "📴 Auto-read isn't available on this device (needs internet for OCR engine). Fill the details below.",
          no_text: "🔍 No readable text found in this image. It may be a photo, not a screenshot. Fill details manually."
        };
        $("#ssForm").classList.remove("hidden");
        $("#ssWarn").innerHTML = (failMsgs[ocrStatus] || "⚠️ Couldn't read this image.") + diagHtml;
        $("#ssWarn").className = "ss-warn warn";
        $("#ssForm").dataset.confidence = "0.3";
        $("#ssForm").dataset.provider = "manual";
        wireSSHint();
        // Show color-based guess as a tappable suggestion (NOT auto-filled — color alone is unreliable)
        const aiZone2 = $("#ssAiZone");
        if (guess && guess.totalScore > 0.25) {
          aiZone2.classList.remove("hidden");
          const p2 = guess.platform;
          aiZone2.innerHTML = `<div class="ai-guess-card"><div class="ai-guess-header"><span class="ai-match-badge">🎨 Color hint</span><span class="ai-confidence">tap to use</span></div><div class="ai-guess-body"><div class="ai-guess-name">${p2.name}</div><div class="ai-guess-segment" style="font-size:11px;color:var(--muted)">Based on image colors only — verify before submitting</div></div></div>`;
          aiZone2.querySelector(".ai-guess-card").addEventListener("click", () => {
            $("#ssProvider").value = p2.name;
            $("#ssProvider").dispatchEvent(new Event("input"));
            aiZone2.classList.add("hidden");
          });
        }
        return;
      }

      // ---- AI Brand Confirmation Zone ----
      const aiZone = $("#ssAiZone");
      aiZone.classList.remove("hidden");
      if (guess && guess.totalScore > 0.25) {
        const p = guess.platform;
        const segLabel = SEGMENT_LABELS[p.segment] || p.segment;
        const confidence = Math.round(guess.totalScore * 100);
        const clueText = (guess.formatClues || []).slice(0, 2).map(c => c.reason).join(" · ");
        const runnersHtml = (guess.runnersUp || []).map(r =>
          `<button class="plat-chip ai-runner" data-plat="${r.platform.id}">${r.platform.name} ${Math.round(r.score * 100)}%</button>`).join("");
        aiZone.innerHTML = `
          <div class="ai-guess-card">
            <div class="ai-guess-header">
              <span class="ai-match-badge">✨ AI Match</span>
              <span class="ai-confidence">${confidence}% confident</span>
            </div>
            <div class="ai-guess-body">
              <div class="ai-guess-name">${p.name}</div>
              <div class="ai-guess-segment">${segLabel}${clueText ? ` · <span class="ai-clue">${clueText}</span>` : ""}</div>
            </div>
            ${runnersHtml ? `<div class="ai-runners"><span class="ai-runners-label">Or maybe:</span><div class="ai-platform-list">${runnersHtml}</div></div>` : ""}
            <div class="ai-guess-actions">
              <button class="ai-yes" id="aiYes">✓ Correct</button>
              <button class="ai-no" id="aiNo">✕ Not this one</button>
            </div>
          </div>
          <div class="ai-alt hidden" id="aiAlt">
            <p class="ai-alt-title">Which platform is this from?</p>
            <div class="ai-segment-tabs" id="aiSegTabs">
              ${Object.entries(SEGMENT_LABELS).map(([k, v]) => `<button class="seg-tab" data-seg="${k}">${v}</button>`).join("")}
            </div>
            <div class="ai-platform-list" id="aiPlatList"></div>
          </div>`;
        // Wire AI guess buttons
        function acceptPlatform(pl, conf) {
          // Remember correction if AI guessed wrong
          if (guess && guess.platform.id !== pl.id) {
            rememberAICorrection(guess.platform.id, pl.id, "user_rejected_ai");
          }
          $("#ssProvider").value = pl.name;
          $("#ssProvider").dispatchEvent(new Event("input"));
          $("#ssForm").dataset.aiPlatform = pl.id;
          if (conf > 0) FounderProfile.recordSubmission(pl.id, pl.segment, conf);
          aiZone.classList.add("hidden");
          showForm();
        }
        $("#aiYes").addEventListener("click", () => acceptPlatform(p, 0.9));
        $$(".ai-runner").forEach(chip => chip.addEventListener("click", () => {
          const pl = PK_PLATFORMS.find(x => x.id === chip.dataset.plat);
          if (pl) acceptPlatform(pl, 0.7);
        }));
        $("#aiNo").addEventListener("click", () => {
          $("#aiAlt").classList.remove("hidden");
          renderPlatformList("qcommerce"); // default tab
        });
        // Segment tabs
        $$("#aiSegTabs .seg-tab").forEach(tab => tab.addEventListener("click", () => {
          $$("#aiSegTabs .seg-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          renderPlatformList(tab.dataset.seg);
        }));
        function renderPlatformList(segment) {
          const plats = PK_PLATFORMS.filter(p => p.segment === segment);
          $("#aiPlatList").innerHTML = plats.map(p =>
            `<button class="plat-chip" data-plat="${p.id}">${p.name}</button>`
          ).join("") + `<button class="plat-chip plat-other" data-plat="__other">Other / Not listed</button>`;
          $$("#aiPlatList .plat-chip").forEach(chip => chip.addEventListener("click", () => {
            if (chip.dataset.plat === "__other") {
              $("#ssProvider").value = "";
              $("#ssProvider").focus();
            } else {
              const pl = PK_PLATFORMS.find(x => x.id === chip.dataset.plat);
              $("#ssProvider").value = pl.name;
              $("#ssProvider").dispatchEvent(new Event("input"));
              $("#ssForm").dataset.aiPlatform = pl.id;
              FounderProfile.recordSubmission(pl.id, pl.segment, 0.8);
            }
            aiZone.classList.add("hidden");
            showForm();
          }));
        }
      } else {
        // No confident guess — show segment picker directly
        aiZone.innerHTML = `
          <div class="ai-guess-card ai-noguess">
            <div class="ai-guess-header"><span class="ai-noguess-label">🤔 Couldn't identify the platform</span></div>
            <p class="ai-alt-sub">Which app is this screenshot from?</p>
            <div class="ai-segment-tabs" id="aiSegTabs">
              ${Object.entries(SEGMENT_LABELS).map(([k, v]) => `<button class="seg-tab" data-seg="${k}">${v}</button>`).join("")}
            </div>
            <div class="ai-platform-list" id="aiPlatList"></div>
          </div>`;
        $$("#aiSegTabs .seg-tab").forEach(tab => tab.addEventListener("click", () => {
          $$("#aiSegTabs .seg-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          renderPlatformList(tab.dataset.seg);
        }));
        function renderPlatformList(segment) {
          const plats = PK_PLATFORMS.filter(p => p.segment === segment);
          $("#aiPlatList").innerHTML = plats.map(p =>
            `<button class="plat-chip" data-plat="${p.id}">${p.name}</button>`
          ).join("") + `<button class="plat-chip plat-other" data-plat="__other">Other / Not listed</button>`;
          $$("#aiPlatList .plat-chip").forEach(chip => chip.addEventListener("click", () => {
            if (chip.dataset.plat === "__other") {
              $("#ssProvider").value = "";
              $("#ssProvider").focus();
            } else {
              const pl = PK_PLATFORMS.find(x => x.id === chip.dataset.plat);
              $("#ssProvider").value = pl.name;
              $("#ssProvider").dispatchEvent(new Event("input"));
              $("#ssForm").dataset.aiPlatform = pl.id;
              FounderProfile.recordSubmission(pl.id, pl.segment, 0.8);
            }
            aiZone.classList.add("hidden");
            showForm();
          }));
        }
        // Default tab: use format clue segment if AI detected one
        const defaultSeg = (guess && guess.formatClues && guess.formatClues[0] && guess.formatClues[0].segment) || "qcommerce";
        const defTab = $(`#aiSegTabs .seg-tab[data-seg="${defaultSeg}"]`) || $("#aiSegTabs .seg-tab");
        defTab.classList.add("active");
        renderPlatformList(defaultSeg);
      }

      // Pre-fill deal fields from OCR (structured, evidence-based)
      // Clean OCR garbage from title (leading single chars, numbers, UI noise)
      let cleanTitle = (f.title || "").replace(/^[a-z]\s+\d+\s+/i, "").replace(/^\d+\s+/, "").trim();
      $("#ssTitle").value = cleanTitle;
      $("#ssKind").value = f.discount_kind || "none";
      $("#ssValue").value = f.discount_value != null ? f.discount_value : "";
      $("#ssCode").value = f.code || "";

      // Validity: use structured validity_type from extraction
      if (f.validity_type === "recurring" && f.valid_days) {
        $("#ssValidity").value = "recurring";
        $("#ssValidity").dispatchEvent(new Event("change"));
        $$("#ssDays input[name=valid_day]").forEach(cb => { cb.checked = f.valid_days.includes(cb.value); });
      } else if (f.validity_type === "ongoing") {
        $("#ssValidity").value = "ongoing";
        $("#ssValidity").dispatchEvent(new Event("change"));
      } else if (f.expires_at) {
        $("#ssValidity").value = "until";
        const d = new Date(f.expires_at), pad = n => String(n).padStart(2, "0");
        $("#ssExpires").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      // If validity is unknown, leave the selector at default ("until") with no date — user decides

      // Provider/merchant separation from structured extraction
      if (f.provider && !$("#ssProvider").value) {
        $("#ssProvider").value = f.provider;
        $("#ssProvider").dispatchEvent(new Event("input"));
      }
      if (f.merchant && !$("#ssMerchant").value) {
        $("#ssMerchant").value = f.merchant;
        $("#ssMerchant").dispatchEvent(new Event("input"));
      }
      // Fallback: if only brand found (no provider/merchant split), use as provider
      if (f.brand && !$("#ssProvider").value) {
        $("#ssProvider").value = f.brand;
        $("#ssProvider").dispatchEvent(new Event("input"));
      }

      // Title-based bank override: if title mentions a specific bank different from OCR brand, prefer title
      if (cleanTitle.length > 5) {
        const titleBankMatch = matchByText(cleanTitle, pkPlatforms().filter(p => p.segment === "bank" || p.segment === "ewallet"));
        if (titleBankMatch.length > 0 && titleBankMatch[0].score > 0.5) {
          const titleBank = titleBankMatch[0].platform;
          const currentProv = $("#ssProvider").value.trim().toLowerCase();
          if (currentProv && normMerchant(currentProv) !== titleBank.id && normMerchant(currentProv) !== normMerchant(titleBank.name)) {
            $("#ssProvider").value = titleBank.name;
            $("#ssProvider").dispatchEvent(new Event("input"));
          } else if (!currentProv) {
            $("#ssProvider").value = titleBank.name;
            $("#ssProvider").dispatchEvent(new Event("input"));
          }
        }
      }

      // Warn about uncertain fields — use real confidence, not fabricated percentages
      const c = ocrOut.conf || {};
      const uncertain = [];
      if ((c.discount_value ?? 0) < 0.5 && f.discount_value != null) uncertain.push("discount");
      if ((c.code ?? 0) < 0.5 && f.code) uncertain.push("promo code");
      if ((c.expires_at ?? 0) < 0.5 && f.expires_at) uncertain.push("end date");
      if ((c.valid_days ?? 0) < 0.5 && f.valid_days) uncertain.push("recurring days");
      if ((c.title ?? 0) < 0.4) uncertain.push("offer text");
      const warnBase = uncertain.length
        ? `⚠️ Double-check: <b>${uncertain.join(", ")}</b> — low confidence from OCR.`
        : `✅ Please verify these details are correct before submitting.`;
      $("#ssWarn").innerHTML = warnBase + diagHtml;
      $("#ssWarn").className = "ss-warn " + (uncertain.length ? "warn" : "ok");
      $("#ssForm").dataset.confidence = String(ocrOut.confidence || 0.4);
      $("#ssForm").dataset.provider = ocrOut.provider || "none";
      $("#ssForm").dataset.aiPlatform = guess ? guess.platform.id : "";
      wireSSHint();

      function showForm() { $("#ssForm").classList.remove("hidden"); }
      // Auto-show form if brand is already filled (OCR found it)
      if ($("#ssProvider").value) showForm();

    } catch (err) {
      prog.classList.add("hidden");
      $("#ssForm").classList.remove("hidden");
      $("#ssWarn").innerHTML = `⚠️ Couldn't auto-read this screenshot (${err.message}). Fill the fields manually — it still works.`;
      $("#ssWarn").className = "ss-warn warn";
      wireSSHint();
      $("#ssForm").dataset.confidence = "0.3";
      $("#ssForm").dataset.provider = "manual";
    }
  }

  function wireSSHint() {
    const provHint = $("#ssProvHint"), merchHint = $("#ssHint");
    const resolve = (val, hintEl) => {
      if (val.length < 2) { hintEl.textContent = ""; return; }
      const key = normMerchant(val);
      const alias = MERCHANT_ALIASES[key] || userAliases()[key];
      const m = DATA.brands.find(x => x.id === key || normMerchant(x.name) === key || (alias && (x.id === alias || normMerchant(x.name) === alias)));
      hintEl.textContent = m ? `✓ Attaches to: ${m.name}` : `+ Creates profile "${val}"`;
    };
    $("#ssProvider").addEventListener("input", () => resolve($("#ssProvider").value.trim(), provHint));
    $("#ssMerchant").addEventListener("input", () => resolve($("#ssMerchant").value.trim(), merchHint));
    resolve($("#ssProvider").value.trim(), provHint);
    // Text-based provider detection from title: if title mentions a known platform, suggest it
    $("#ssTitle").addEventListener("input", () => {
      const titleVal = $("#ssTitle").value.trim().toLowerCase();
      if (titleVal.length < 3 || $("#ssProvider").value.trim().length > 1) return;
      const textMatch = matchByText(titleVal, PK_PLATFORMS);
      if (textMatch.length > 0 && textMatch[0].score > 0.5) {
        const pl = textMatch[0].platform;
        $("#ssProvider").value = pl.name;
        $("#ssProvider").dispatchEvent(new Event("input"));
      }
    });
    // Validity type toggle
    const valSel = $("#ssValidity");
    valSel.addEventListener("change", () => {
      $("#ssUntilWrap").classList.toggle("hidden", valSel.value !== "until");
      $("#ssDaysWrap").classList.toggle("hidden", valSel.value !== "recurring");
    });
  }

  $("#ssForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const category = f.get("category");
    const providerName = f.get("provider") || "Community";
    const merchantName = f.get("merchant") || providerName;
    const resolution = resolveMerchant(providerName, category, e.target.dataset.aiPlatform || "");
    const dupe = findDuplicateDeal(resolution.brandId, (function(){ const k=f.get("disc_kind"), v=f.get("disc_value"); return (k==="percent"&&v)?{kind:"percent",value:Number(v)}:(k==="flat"&&v)?{kind:"flat",value:Number(v)}:null; })(), f.get("code") || null);
    if (dupe) {
      reinforceDeal(dupe);
      addNotification("👥 Same deal already live — your spot was added as confirmation (+1)");
      brandMap.clear(); closeSheet(); state.tab = "home"; state.feedRendered = false; syncTabs(); renderAll(); toast("Already spotted — +1 added");
      return;
    }
    const brandId = resolution.brandId;
    const existing = DATA.brands.find(b => b.id === brandId);
    if (existing?.merchant_profile) existing.merchant_profile.deal_count = (existing.merchant_profile.deal_count || 0) + 1;
    const kind = f.get("disc_kind"), rv = f.get("disc_value");
    let discount = null;
    if (kind === "percent" && rv) discount = { kind: "percent", value: Number(rv) };
    else if (kind === "flat" && rv) discount = { kind: "flat", value: Number(rv) };
    else if (kind === "cashback" && rv) discount = { kind: "cashback", value: Number(rv) };
    else if (kind === "bogo") discount = { kind: "bogo", value: null };

    // Validity handling
    const validityType = f.get("validity_type") || "until";
    const validDays = validityType === "recurring" ? [...f.getAll("valid_day")] : null;
    const expires_at = (validityType === "until" && f.get("expires_at")) ? new Date(f.get("expires_at") + ":00+05:00").toISOString() : null;
    const isOngoing = validityType === "ongoing";
    const isRecurring = validityType === "recurring" && validDays && validDays.length > 0;

    const id = "s" + Date.now();
    const confidence = Math.max(0.3, Math.min(0.85, parseFloat(e.target.dataset.confidence || "0.4")));
    // FounderProfile memory: learn from this submission
    const aiPlatId = e.target.dataset.aiPlatform || "";
    if (aiPlatId) {
      const pl = PK_PLATFORMS.find(x => x.id === aiPlatId);
      if (pl) FounderProfile.recordSubmission(pl.id, pl.segment, confidence);
    }
    // Correction memory: store validated provider→merchant mappings
    if (merchantName !== providerName) {
      rememberCorrection(providerName, merchantName, f.get("code"));
    }

    DATA.deals.push({
      id, brand: brandId, brand_brand_type: existing?.brand_type || "brand", category,
      title: "[Spotted] " + (f.get("title") || "Community screenshot deal"),
      summary: `Submitted from a screenshot. Pending community verification.`,
      discount,
      eligibility: { payment: [], merchant: merchantName !== providerName ? merchantName : null, user: "any", min_spend: null },
      cities: [f.get("city")],
      valid_from: NOW.toISOString().slice(0, 10),
      valid_until: isOngoing ? "2099-12-31" : (isRecurring ? "2099-12-31" : (expires_at ? expires_at.slice(0, 10) : NOW.toISOString().slice(0, 10))),
      valid_days: isRecurring ? validDays : null,
      exclusions: ["Extracted from screenshot — verify before use"],
      steps: [],
      code: f.get("code") || null,
      campaign_type: expires_at ? "flash" : (isRecurring ? "recurring" : "standard"),
      first_seen_at: NOW.toISOString(), last_seen_at: NOW.toISOString(),
      starts_at: NOW.toISOString(), expires_at,
      merchant_info: { name: providerName, resolved_brand: resolution.matched || null, new_profile: resolution.isNew },
      source: { type: "community", platform: "screenshot OCR", url: "", status: "pending", captured_at: NOW.toISOString(), extractor: e.target.dataset.provider, ai_platform: e.target.dataset.aiPlatform || null },
      status: "reviewing", verification: "pending", confidence,
      extraction_confidence: confidence,
      community: { votes: 1, worked: 0, failed: 0, saves: 0, spotted_by: "@you", reports_expired: 0 }
    });
    normalizeDeal(DATA.deals[DATA.deals.length - 1]);
    saveLocalDeal(DATA.deals[DATA.deals.length - 1], resolution);
    const newDeal = DATA.deals[DATA.deals.length - 1];
    Sync.pushDeal(newDeal, resolution.profile);
    if (SB.enabled) SB.from("submissions").insert([{
      deal_id: newDeal.id, extractor: e.target.dataset.provider || "manual",
      fields: { title: newDeal.title, discount: newDeal.discount, code: newDeal.code, expires_at: newDeal.expires_at, valid_days: newDeal.valid_days, ai_platform: e.target.dataset.aiPlatform || null },
      confidence: newDeal.extraction_confidence ?? null, user_id: SB.userId, status: "pending"
    }]).catch(err => console.warn("submission log failed:", err.message));
    addNotification(`📸 Screenshot deal "${f.get("title") || "submitted"}" queued for verification`);
    brandMap.clear(); closeSheet(); state.tab = "home"; state.city = "All"; state.cat = "all"; state.q = ""; $("#q").value = ""; state.feedRendered = false; syncTabs(); renderAll(); toast("Screenshot submitted");
  });
}

// ---- founder mode ----
// The founder is the primary deal source at the start. Founder deals use the SAME deal
// model as community submissions — same fields, same lifecycle — but carry a higher trust
// tier (confidence + "Founder-verified" badge) and support precise flash timing.
function isFounder() { return store.get("dr_founder", "") === "on"; }
function setFounder(on) { store.set("dr_founder", on ? "on" : "off"); }

function openFounderSubmit() {
  pushNav("submit");
  const in30 = new Date(NOW.getTime() + 30 * 6e4);
  const pad = n => String(n).padStart(2, "0");
  const localDefault = `${in30.getFullYear()}-${pad(in30.getMonth() + 1)}-${pad(in30.getDate())}T${pad(in30.getHours())}:${pad(in30.getMinutes())}`;
  $("#sheet").innerHTML = `<div class="grab"></div>
    <h3>👑 Founder — add a flash deal</h3>
    <p class="sheet-summary">Seeds the live feed instantly. Set a precise end time so the urgency popup and "Ending soon" light up.</p>
    <form class="form" id="founderForm">
      <label>Merchant / brand</label><input name="brand" id="fMerchant" required placeholder="e.g. KFC, Daraz, a new restaurant" autocomplete="off">
      <div class="merchant-hint" id="fHint"></div>
      <label>Offer (title)</label><input name="title" required placeholder="e.g. Flat 50% off all burgers">
      <label>Discount</label>
      <div class="f-row">
        <select name="disc_kind"><option value="percent">% off</option><option value="flat">Rs off</option><option value="bogo">Buy 1 Get 1</option><option value="cashback">Cashback</option><option value="none">No numeric discount</option></select>
        <input name="disc_value" type="number" min="0" step="1" placeholder="value (e.g. 50)">
      </div>
      <label>Category</label>
      <select name="category">${CATS.filter(c => c[0] !== "all").map(c => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>
      <label>City</label>
      <select name="city">${CITIES.slice(1).map(c => `<option>${c}</option>`).join("")}<option>All Pakistan</option></select>
      <label>Ends at (precise)</label><input name="expires_at" type="datetime-local" value="${localDefault}" required>
      <label>Campaign type</label>
      <select name="campaign_type"><option value="flash">Flash sale</option><option value="happy_hour">Happy hour</option><option value="weekend">Weekend offer</option><option value="limited_stock">Limited stock</option><option value="standard">Standard promo</option></select>
      <label>Promo code (optional)</label><input name="code" placeholder="e.g. DEAL50">
      <label class="f-check"><input name="collect_required" type="checkbox"> Collect/coupon required</label>
      <label class="f-check"><input name="app_only" type="checkbox"> App-only deal</label>
      <label>Restrictions / terms</label><textarea name="restrictions" placeholder="Min spend, eligible cards, exclusions…"></textarea>
      <label>Source link</label><input name="url" placeholder="https://… (Instagram story, brand page…)">
      <label>How to avail (one step per line)</label><textarea name="steps" placeholder="1. Open app&#10;2. Collect voucher&#10;3. Pay at checkout"></textarea>
      <button class="submit" type="submit">⚡ Publish flash deal</button>
    </form>`;
  showSheet();
  const hintEl = $("#fHint");
  const updateHint = () => {
    const val = $("#fMerchant").value.trim();
    if (val.length < 2) { hintEl.textContent = ""; return; }
    const cat = $("#founderForm [name=category]").value;
    const key = normMerchant(val);
    const alias = MERCHANT_ALIASES[key] || userAliases()[key];
    const matched = DATA.brands.find(x => x.id === key || normMerchant(x.name) === key || (alias && (x.id === alias || normMerchant(x.name) === alias)));
    hintEl.textContent = matched ? `✓ Attaches to existing brand: ${matched.name}` : `+ Creates merchant profile "${val}" (${cat === "food" ? "restaurant" : "merchant"})`;
  };
  $("#fMerchant").addEventListener("input", updateHint);
  $("#founderForm [name=category]").addEventListener("change", updateHint);
  // hide the value input when "none" selected
  const kindSel = $("#founderForm [name=disc_kind]"), valInp = $("#founderForm [name=disc_value]");
  const syncDisc = () => { valInp.style.display = kindSel.value === "none" || kindSel.value === "bogo" ? "none" : ""; };
  kindSel.addEventListener("change", syncDisc); syncDisc();

  $("#founderForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const category = f.get("category");
    const resolution = resolveMerchant(f.get("brand"), category);
    const brandId = resolution.brandId;
    const existing = DATA.brands.find(b => b.id === brandId);
    if (existing?.merchant_profile) existing.merchant_profile.deal_count = (existing.merchant_profile.deal_count || 0) + 1;

    const kind = f.get("disc_kind");
    const rawVal = f.get("disc_value");
    let discount = null;
    if (kind === "percent" && rawVal) discount = { kind: "percent", value: Number(rawVal) };
    else if (kind === "flat" && rawVal) discount = { kind: "flat", value: Number(rawVal) };
    else if (kind === "cashback" && rawVal) discount = { kind: "cashback", value: Number(rawVal) };
    else if (kind === "bogo") discount = { kind: "bogo", value: null };

    // Precise expiry: treat the local datetime as PKT (+05:00)
    const expires_at = f.get("expires_at") ? new Date(f.get("expires_at") + ":00+05:00").toISOString() : null;
    const id = "f" + Date.now();
    const steps = (f.get("steps") || "").split("\n").map(s => s.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
    const restrictions = (f.get("restrictions") || "").trim();

    DATA.deals.push({
      id, brand: brandId, brand_brand_type: existing?.brand_type || "brand", category,
      title: f.get("title"), summary: restrictions || "Founder-verified flash deal.",
      discount,
      eligibility: { payment: [], merchant: f.get("brand"), user: "any", min_spend: null },
      cities: [f.get("city")],
      valid_from: NOW.toISOString().slice(0, 10),
      valid_until: expires_at ? expires_at.slice(0, 10) : NOW.toISOString().slice(0, 10),
      exclusions: restrictions ? restrictions.split(/[\n;]/).map(s => s.trim()).filter(Boolean) : [],
      steps,
      // flash fields
      campaign_type: f.get("campaign_type"),
      code: f.get("code") || null,
      collect_required: !!f.get("collect_required"),
      app_only: !!f.get("app_only"),
      restrictions: restrictions || null,
      first_seen_at: NOW.toISOString(),
      last_seen_at: NOW.toISOString(),
      starts_at: NOW.toISOString(),
      expires_at,
      merchant_info: { name: f.get("brand"), resolved_brand: resolution.matched || null, new_profile: resolution.isNew },
      source: { type: "founder", platform: "founder submission", url: f.get("url") || "", status: "active", captured_at: NOW.toISOString() },
      source_type: "founder", source_name: "Founder",
      status: "active", verification: "founder", confidence: 0.95,
      founder_verified: true, founder_added_at: NOW.toISOString(),
      community: { votes: 0, worked: 0, failed: 0, saves: 0, spotted_by: "founder", reports_expired: 0 }
    });
    normalizeDeal(DATA.deals[DATA.deals.length - 1]);
    saveLocalDeal(DATA.deals[DATA.deals.length - 1], resolution);
    Sync.pushDeal(DATA.deals[DATA.deals.length - 1], resolution.profile); // live to Supabase (fire-and-forget)
    // FounderProfile memory: learn brand preference
    const fBrand = (f.get("brand") || "").trim().toLowerCase();
    const fPlat = PK_PLATFORMS.find(x => x.name.toLowerCase() === fBrand || x.keywords.some(k => k.length > 2 && fBrand.includes(k)));
    if (fPlat) FounderProfile.recordSubmission(fPlat.id, fPlat.segment, 0.9);
    NOW = new Date(); // device clock stays authoritative
    addNotification(`⚡ Founder flash deal "${f.get("title")}" published`);
    brandMap.clear(); closeSheet(); state.tab = "home"; state.feedRendered = false; syncTabs(); renderAll();
    toast("Flash deal live");
  });
}

// ---- notification center ----
function openNotifications() {
  pushNav("notifications");
  const soon = DATA.deals.filter(d => d.status !== "evergreen" && !isHidden(d) && !isNews(d) && daysUntil(d) >= 0 && daysUntil(d) <= 2);
  const savedDeals = DATA.deals.filter(d => state.saved.has(d.id) && !isHidden(d));
  let html = `<div class="grab"></div><h3>🔔 Notifications</h3>`;

  if (soon.length) {
    html += `<h4 class="steps-title">Expiring soon</h4>`;
    soon.forEach(d => {
      html += `<div class="notif-item" data-notif-deal="${d.id}">
        <span class="notif-icon">⏳</span>
        <span class="notif-text"><b>${brandOf(d.brand).name}</b> — ${countdown(d).text} left</span>
      </div>`;
    });
  }
  if (savedDeals.length) {
    html += `<h4 class="steps-title">Your saved deals</h4>`;
    savedDeals.forEach(d => {
      html += `<div class="notif-item" data-notif-deal="${d.id}">
        <span class="notif-icon">🔔</span>
        <span class="notif-text"><b>${brandOf(d.brand).name}</b> — ${countdown(d).text}</span>
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

// ---- wallet setup: compact, dismissible in-feed nudge ----
// Replaces the old full-screen onboarding, which BLOCKED discovery on first
// open, and the boot-time urgency popup. The nudge never covers the feed and
// disappears permanently once the user configures a wallet or dismisses it.
function renderWalletNudge() {
  if (state.myPay.size || state.walletNudgeDismissed) return "";
  return `<div class="wallet-nudge" role="note">
    ${ic("wallet")}
    <p class="wn-tx">${t("nudgeText")}</p>
    <div class="wn-actions">
      <button class="wn-set" id="nudgeSetup" type="button">${t("nudgeSetup")}</button>
      <button class="wn-x" id="nudgeDismiss" type="button" aria-label="${t("nudgeDismiss")}">${ic("x")}</button>
    </div>
  </div>`;
}

function showOnboarding() {
  // Intentionally a no-op gate kept for any external callers: the old blocking
  // multi-screen onboarding is removed. Wallet selection is now an in-feed nudge.
  state.onboarded = true;
  store.set("dr_onboarded", "true");
}

// ---- sheet helpers ----
let sheetReturnFocus = null;
function showSheet() {
  const sheet = $("#sheet");
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "DealRadar dialog");
  sheetReturnFocus = document.activeElement;
  if (!sheet.querySelector(".sheet-close")) sheet.insertAdjacentHTML("afterbegin", `<button class="sheet-close" id="sheetClose" aria-label="Close">${ic("x")}</button>`);
  $("#sheetClose").onclick = closeSheet;
  sheet.classList.remove("hidden"); $("#sheetBackdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("#sheetClose").focus();
}
function closeSheet() {
  $("#sheet").classList.add("hidden"); $("#sheetBackdrop").classList.add("hidden");
  $("#sheet").style.transform = ""; $("#sheet").style.transition = "";
  document.body.style.overflow = "";
  if (sheetReturnFocus?.focus) sheetReturnFocus.focus(); sheetReturnFocus = null;
}

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
  const input = $("#q");
  if (document.activeElement !== input || input.value.trim()) { el.classList.add("hidden"); return; }
  const sugg = searchSuggestions();
  if (!sugg.length) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = `<div class="ss-title">Trending</div><div class="ss-tiles">${sugg.map(s => `<span class="ss-tile" data-ss="${esc(s)}">${esc(s)}</span>`).join("")}</div>`;
}

const APP_URL = "https://jaxy2k.github.io/dealradar-pk";

function shareText(d) {
  const disc = discountLabel(d.discount);
  const cap = d.discount?.cap ? ` (cap Rs ${Number(d.discount.cap).toLocaleString()})` : "";
  const fmtD = s => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const expiry = d.valid_until ? `\n⏰ Valid till ${fmtD(d.valid_until)}` : "";
  return `🔥 ${d.title}\n💰 ${disc}${cap}${expiry}\n${d.summary}\n\n📲 Found on DealRadar PK\n${APP_URL}`;
}

async function shareDeal(d) {
  const txt = shareText(d);
  const mi = d.merchant_info || {};
  const coverUrl = /^https:\/\//.test(mi.cover || "") ? mi.cover : null;

  // Try Web Share API Level 2 with image
  if (navigator.share && coverUrl) {
    try {
      const resp = await fetch(coverUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        const ext = blob.type.includes("png") ? "png" : "jpg";
        const file = new File([blob], `deal.${ext}`, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: d.title, text: txt, files: [file] });
          return;
        }
      }
    } catch (e) { /* fall through to text-only */ }
  }
  // Text-only share
  if (navigator.share) {
    navigator.share({ title: d.title, text: txt }).catch(() => {});
  } else {
    openExternal("https://wa.me/?text=" + encodeURIComponent(txt));
  }
}

function syncTabs() {
  const glyph = { home: "trend", explore: "search", saved: "check", cards: "wallet" };
  $("#tabbar").innerHTML = Object.keys(TABS).map(k =>
    `<button class="tab${state.tab === k ? " active" : ""}" data-tab="${k}"` +
    `${state.tab === k ? ' aria-current="page"' : ""}>${ic(glyph[k])}` +
    `<span class="tab-lbl">${t(k)}</span></button>`
  ).join("");
  $("#fab").classList.add("hidden");
}

function wire() {
  $("#sheet").addEventListener("keydown", e => {
    if (e.key === "Escape") { closeSheet(); return; }
    if (e.key !== "Tab") return;
    const focusable = $$("#sheet button, #sheet a[href], #sheet input, #sheet select, #sheet textarea, #sheet [tabindex='0']").filter(el => el.getClientRects().length && !el.disabled);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $("#catTabs").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.cat = b.dataset.cat;
    renderChips(); scheduleRender(); updateBackBtn();
  });
  $("#filterRow").addEventListener("change", e => {
    if (e.target.id === "citySelect") { state.city = e.target.value; renderChips(); scheduleRender(); updateBackBtn(); }
    if (e.target.id === "otypeSelect") { state.otype = e.target.value; renderChips(); scheduleRender(); updateBackBtn(); }
  });
  $("#filterRow").addEventListener("click", e => {
    if (e.target.closest("#resetFilters")) {
      state.city = "All"; state.cat = "all"; state.otype = "all"; state.q = ""; $("#q").value = "";
      state.hiddenBrands.clear(); store.set("dr_hidden", "[]");
      renderChips(); scheduleRender(); updateBackBtn();
      toast(LANG === "ur" ? "فلٹرز ری سیٹ ہو گئے" : "Filters reset — hidden deals restored");
    }
  });
  $("#feed").addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("article[data-id]")) { e.preventDefault(); e.target.click(); }
  });
  $("#feed").addEventListener("click", e => {
    if (e.target.closest("#clearSearch")) { state.q = ""; state.cat = "all"; state.otype = "all"; $("#q").value = ""; renderAll(); }
  });
  $("#backBtn").addEventListener("click", goBack);
  $("#exitStay").addEventListener("click", hideExitDialog);
  $("#exitLeave").addEventListener("click", () => {
    hideExitDialog();
    if (window.AndroidBridge) { window.AndroidBridge.exitApp(); }
    else { window.close(); }
  });
  let searchTimeout;
  $("#q").addEventListener("focus", renderSearchSuggestions);
  $("#q").addEventListener("blur", () => setTimeout(() => $("#searchSuggest").classList.add("hidden"), 180));
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
  // Retry path on the fallback banner (delegated: #banner innerHTML is re-rendered freely)
  $("#banner").addEventListener("click", e => { if (e.target.closest("#retryLive")) fetchLive(); });
  $("#feed").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; state.cat = b.dataset.cat; scheduleRender(); updateBackBtn(); });

  // Search suggestion tiles
  $("#searchSuggest").addEventListener("click", e => {
    const tile = e.target.closest("[data-ss]"); if (!tile) return;
    const val = tile.dataset.ss;
    $("#q").value = val; state.q = val;
    renderSearchSuggestions(); scheduleRender(); updateBackBtn();
  });

  // Phase 2B: offer-type filter row + wallet nudge (both live inside the feed).
  $("#feed").addEventListener("click", e => {
    const ot = e.target.closest("[data-otype]");
    if (ot) { state.otype = ot.dataset.otype; scheduleRender(); return; }
    if (e.target.closest("#nudgeSetup")) { $("#walletBtn").click(); return; }
    if (e.target.closest("#nudgeDismiss")) {
      state.walletNudgeDismissed = true;
      store.set("dr_wallet_nudge_dismissed", "true");
      scheduleRender();
      return;
    }
    if (e.target.closest("#openWalletFromEmpty")) { $("#walletBtn").click(); }
    if (e.target.closest("#savedToHome")) {
      const tabBtn = document.querySelector('#tabbar [data-tab="home"]');
      if (tabBtn) tabBtn.click();
    }
    // Explore sub-view navigation
    const exploreBtn = e.target.closest("[data-explore]");
    if (exploreBtn) {
      const view = exploreBtn.dataset.explore;
      state.exploreView = view;
      state.feedRendered = false;
      renderAll();
      return;
    }
    // Explore category tap → filter home by that category
    const catBtn = e.target.closest(".explore-cat");
    if (catBtn) {
      state.cat = catBtn.dataset.cat;
      state.tab = "home";
      state.feedRendered = false;
      syncTabs(); renderAll();
      return;
    }
    // Explore back button
    if (e.target.closest("#exploreBack")) {
      state.exploreView = null;
      state.feedRendered = false;
      renderAll();
      return;
    }
  });
  $("#walletBtn").addEventListener("click", () => {
    const wp = $("#walletPanel");
    if (wp.classList.contains("hidden")) { wp.classList.remove("hidden"); pushNav("wallet"); }
    else { wp.classList.add("hidden"); popNav(); }
  });
  $("#walletPanel").addEventListener("click", e => {
    if (e.target.closest("#walletDone")) { $("#walletPanel").classList.add("hidden"); $("#walletBtn").focus(); popNav(); return; }
    const b = e.target.closest("[data-pay]"); if (!b) return;
    const v = b.dataset.pay; state.myPay.has(v) ? state.myPay.delete(v) : state.myPay.add(v);
    store.set("dr_pay", JSON.stringify([...state.myPay])); renderWalletPanel(); renderFeed();
  });
  // Card search input (My Cards tab)
  $("#feed").addEventListener("input", e => {
    if (e.target.id === "cardSearch") renderCardResults(e.target.value);
  });
  // Card selection + chip removal inside feed
  $("#feed").addEventListener("click", e => {
    const chipX = e.target.closest(".chip-x");
    if (chipX) {
      const v = chipX.dataset.pay;
      state.myPay.delete(v);
      store.set("dr_pay", JSON.stringify([...state.myPay]));
      state.feedRendered = false; renderAll();
      return;
    }
    const payBtn = e.target.closest("#cardResults [data-pay], .card-quick [data-pay]");
    if (payBtn) {
      const v = payBtn.dataset.pay;
      state.myPay.has(v) ? state.myPay.delete(v) : state.myPay.add(v);
      store.set("dr_pay", JSON.stringify([...state.myPay]));
      state.feedRendered = false; renderAll();
      return;
    }
  });
  // Swipe-down to dismiss detail sheet (vertical only, preserves centering)
  let sheetTouchY = 0, sheetTouchX = 0;
  $("#sheet").addEventListener("touchstart", e => { sheetTouchY = e.touches[0].clientY; sheetTouchX = e.touches[0].clientX; }, {passive: true});
  $("#sheet").addEventListener("touchmove", e => {
    const dy = e.touches[0].clientY - sheetTouchY;
    const dx = Math.abs(e.touches[0].clientX - sheetTouchX);
    if (dy > 0 && dx < 40 && $("#sheet").scrollTop <= 0) {
      e.preventDefault();
      $("#sheet").style.transform = `translate(-50%, ${dy}px)`;
      $("#sheet").style.transition = "none";
    }
  }, {passive: false});
  $("#sheet").addEventListener("touchend", e => {
    const dy = e.changedTouches[0].clientY - sheetTouchY;
    $("#sheet").style.transition = "";
    $("#sheet").style.transform = "";
    if (dy > 80 && $("#sheet").scrollTop <= 0) closeSheet();
  }, {passive: true});
  $("#tabbar").addEventListener("click", e => {
    const t = e.target.closest("[data-tab]"); if (!t) return;
    state.tab = t.dataset.tab; state.feedRendered = false; state.exploreView = null;
    navStack.length = 0; updateBackBtn();
    syncTabs();
    const feed = $("#feed");
    feed.style.opacity = "0"; feed.style.transform = "translateY(8px)";
    setTimeout(() => { renderAll(); feed.style.transition = "opacity .25s ease, transform .25s ease"; feed.style.opacity = "1"; feed.style.transform = "none"; }, 120);
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  // Long-press FAB opens the founder flash-deal form; short tap opens normal submit
  let fabTimer = null, fabLong = false;
  const fab = $("#fab");
  fab.addEventListener("pointerdown", () => { fabLong = false; fabTimer = setTimeout(() => { fabLong = true; openFounderSubmit(); }, 550); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => fab.addEventListener(ev, () => clearTimeout(fabTimer)));
  fab.addEventListener("click", () => { if (fabLong) { fabLong = false; return; } openSubmit(); });
  $("#alertBell").addEventListener("click", openNotifications);
  $("#addDealBtn").addEventListener("click", () => openSubmit());
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
          <div class="ai-deal-meta">${esc(d.cities?.join(", ") || "")} · ${countdown(d).text}</div>
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
let inflight = null;        // single in-flight controller: startup, timer and pull-to-refresh share it
let dataProvenance = null;  // "live" = current feed · null = seed/offline fallback (banner label)
let liveAttempted = false;  // true after the first live-fetch attempt settles (avoid banner flicker on boot)

// Guard against replacing a working dataset with a bad payload.
// Contract (scraper.py output + build.py): { meta, brands[], deals[] }; every deal has a
// string id. Empty deals[] is VALID — the scraper can legitimately find zero offers —
// but only when the payload is well-formed AND meta.generated_at is fresh (< 12h).
// A stale empty file (e.g. a cached error response) must never wipe a working dataset.
function validateLivePayload(fresh) {
  if (!fresh || typeof fresh !== "object") return { ok: false, reason: "not an object" };
  if (!Array.isArray(fresh.deals) || !Array.isArray(fresh.brands)) return { ok: false, reason: "missing deals/brands arrays" };
  if (!fresh.deals.every(d => d && typeof d === "object" && typeof d.id === "string")) return { ok: false, reason: "record without id" };
  if (fresh.deals.length) return { ok: true };
  const gen = fresh.meta && fresh.meta.generated_at ? new Date(fresh.meta.generated_at).getTime() : NaN;
  if (Number.isNaN(gen)) return { ok: false, reason: "empty dataset without generated_at" };
  if (gen - Date.now() > 12 * 36e5) return { ok: false, reason: "empty dataset too far in the future" };
  if ((Date.now() - gen) / 36e5 > 12) return { ok: false, reason: "empty dataset older than 12h" };
  return { ok: true };
}

// Fetch + validate + merge. Concurrent callers await the SAME request (no stampede).
function fetchLive(silent = false) {
  if (inflight) return inflight;
  inflight = doFetchLive(silent).finally(() => { inflight = null; });
  return inflight;
}

async function doFetchLive(silent) {
  try {
    const base = API_URL || "";
    // Relative paths when same-origin so this works under GitHub Pages project
    // subpaths (/dealradar-pk/live_deals.json), not just at domain root.
    const paths = base ? [`${base}/api/deals`, `${base}/live_deals.json`]
                       : ["api/deals", "live_deals.json"];
    let fresh = null;
    for (const path of paths) {
      try {
        // 15s cap: a hung request on flaky mobile networks must not block the feed.
        // AbortController guard keeps very old Android WebViews working (no abort = still fetch).
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const tOut = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
        let r;
        try {
          r = await fetch(path, { cache: "no-cache", signal: ctrl ? ctrl.signal : undefined }); // revalidate past the Pages 600s CDN cache
        } finally { if (tOut) clearTimeout(tOut); }
        if (!r.ok) continue;
        fresh = await r.json();
        break;
      } catch (e) { continue; }
    }
    if (!fresh) throw new Error("No live source");
    const v = validateLivePayload(fresh);
    if (!v.ok) throw new Error("Invalid live payload: " + v.reason);
    // Valid payload (including a fresh, legitimately-empty one): replace deals wholesale.
    // Merge keeps local community state, device-local submissions and Supabase rows.
    const localMap = new Map((DATA.deals || []).map(d => [d.id, d]));
    DATA.deals = normalizeDataset({ deals: fresh.deals.map(fd => {
      const local = localMap.get(fd.id);
      if (local) {
        fd.community = { ...fd.community, ...local.community };
      }
      return fd;
    }) }).deals;
    DATA.brands = fresh.brands.length ? fresh.brands : DATA.brands;
    DATA.meta = { ...DATA.meta, ...fresh.meta };
    dataProvenance = "live";
    restoreLocalDeals(); // re-merge device-local founder/community/screenshot deals
    // Re-merge shared Supabase deals (fetchLive replaced DATA.deals). A Supabase
    // outage must not skip the re-render below — the live JSON already landed.
    await Sync.pullDeals().catch(e => console.warn("Sync pull failed:", e.message));
    flushSyncQueue(); // retry any deals/votes that failed to push while offline
    lastFetch = fresh.meta?.server_time || new Date().toISOString();
    NOW = new Date(); // Device clock always determines expiration
    heatCache.clear(); trustCache.clear(); brandMap.clear();
    renderAll();
    const newCount = fresh.deals.length - (localMap.size || 0);
    if (!silent) {
      if (newCount > 0) toast(`🆕 ${newCount} new deals just dropped!`);
      else toast("✓ Deals up to date");
    }
  } catch (e) {
    // Network error, timeout, invalid JSON, bad payload: keep the current dataset.
    // NEVER treat a failed fetch as an empty inventory.
    console.warn("Live refresh failed:", e.message);
    if (!silent) toast("📴 Offline — showing cached deals");
  } finally {
    liveAttempted = true;
    if (dataProvenance !== "live") renderBanner(); // label the fallback only once failure is known
  }
}

function setupLiveRefresh() {
  // Auto-refresh every 5 minutes
  refreshInterval = setInterval(fetchLive, 300000);
  // When connectivity returns, flush the sync retry queue immediately
  window.addEventListener("online", () => { flushSyncQueue(); });
  // Pull shared community deals every 2 minutes (Supabase)
  setInterval(async () => {
    const n = await Sync.pullDeals();
    if (n > 0) { brandMap.clear(); renderAll(); }
  }, 120000);

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


// ---- PWA: install prompt + safe update/reload flow ----
// SW update strategy: new sw.js stays "waiting" until the user taps Update,
// so nobody gets yanked mid-interaction. Code/data are network-first anyway,
// so even an un-updated SW never serves stale offers (cache = offline fallback).
let swRegistration = null;
let deferredInstallPrompt = null;
let swReloadTriggered = false;

function showPwaBar(text, actionLabel, onClick, dismissible) {
  let bar = document.getElementById("pwaBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "pwaBar";
    bar.className = "pwa-bar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = "";
  const msg = document.createElement("span");
  msg.textContent = text;
  bar.appendChild(msg);
  if (actionLabel && onClick) {
    const btn = document.createElement("button");
    btn.textContent = actionLabel;
    btn.addEventListener("click", onClick);
    bar.appendChild(btn);
  }
  if (dismissible) {
    const x = document.createElement("button");
    x.className = "pwa-x";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Dismiss");
    x.addEventListener("click", () => bar.remove());
    bar.appendChild(x);
  }
}

function setupPWA() {
  // Android/desktop Chromium install banner
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e.prompt;
    showPwaBar("Install DealRadar PK for one-tap access", "Install", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt();
      deferredInstallPrompt = null;
    }, true);
  });
  window.addEventListener("appinstalled", () => {
    const bar = document.getElementById("pwaBar");
    if (bar) bar.remove();
    toast("DealRadar installed 🎉");
  });

  try {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) return;
    // Only reload when an EXISTING controller is replaced (user tapped Update).
    // A first-ever install takes control without a reload.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").then(reg => {
      swRegistration = reg;
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            showPwaBar("New version available", "Update", () => {
              nw.postMessage({ type: "SKIP_WAITING" });
            }, false);
          }
        });
      });
    }).catch(() => {}); // failed update/recovery: current SW keeps serving network-first

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || swReloadTriggered) return;
      swReloadTriggered = true;
      window.location.reload(); // once, after the user tapped Update
    });
  } catch (e) {}

  // iOS: no beforeinstallprompt — show the manual Add-to-Home-Screen hint once.
  try {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || navigator.standalone === true;
    if (isIOS && !standalone && !store.get("dr_ios_hint_shown", "")) {
      store.set("dr_ios_hint_shown", "1");
      setTimeout(() => showPwaBar("iOS: tap Share → “Add to Home Screen” to install", null, null, true), 2500);
    }
  } catch (e) {}
}


(async function init() {
  try {
    // Register service worker for offline + push (plus install/update UX)
    setupPWA();
    if (window.__DEALS__) { DATA = normalizeDataset(window.__DEALS__); }
    else {
      const r = await fetch("deals.json");
      if (!r.ok) throw new Error("Failed to load deals");
      DATA = normalizeDataset(await r.json());
    }
    // Always use the device clock. Dataset timestamps describe freshness, not current time.
    NOW = new Date();
    restoreLocalDeals(); // merge founder/community/screenshot deals saved on this device
    // Supabase: restore/sign-in anon identity, then pull shared community deals
    SB.restoreSession();
    const bootIdentity = (async () => {
      if (SB.enabled && !SB.userId) await SB.signInAnon();
      const n = await Sync.pullDeals();
      if (n > 0) { brandMap.clear(); renderAll(); }
    })();
    document.documentElement.dir = LANG === "ur" ? "rtl" : "ltr";
    document.documentElement.lang = LANG;
    $("#langBtn").textContent = t("langToggle");
    renderWalletPanel(); syncTabs(); renderAll(); wire(); startTicking(); setTimeout(() => Notif.checkExpiring(), 3000);
    setupLiveRefresh();
    // Load the current live feed immediately (silent: no startup toast/spinner wall)
    // instead of waiting 5 minutes for the first timer tick. Chained after anon
    // sign-in so fetchLive's internal Sync.pullDeals() merge doesn't race it, but
    // capped at 2s: a hanging Supabase must never delay the live offer feed.
    // The seed render above stays on screen until this resolves, then views update
    // in place. If it fails, the seed remains as an explicitly-labelled fallback.
    Promise.race([bootIdentity, new Promise(res => setTimeout(res, 2000))]).then(() => fetchLive(true));
    // dismiss splash once first paint is ready
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sp = $("#splash");
      if (sp) { setTimeout(() => sp.classList.add("gone"), 350); }
    }));
    showOnboarding();
    // NOTE: the boot-time urgency popup (showDailyDealPopup) is intentionally not
    // restored — it interrupted discovery on every cold start. Real deadlines are
    // surfaced in-feed by the honest "Ending soon" strip instead.
  } catch (err) {
    console.error("DealRadar init error:", err);
    const sp = $("#splash"); if (sp) sp.classList.add("gone");
    $("#feed").innerHTML = `<div class="empty">${ic("info")}<p>Something went wrong loading deals.</p><button class="btn-primary" onclick="location.reload()">${t("retry")}</button></div>`;
  }
})();
