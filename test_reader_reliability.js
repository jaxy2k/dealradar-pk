/**
 * Regression tests: Screenshot Reader Reliability
 * Tests: PK eligibility, color-only invariant, no fabricated expiry,
 * recurring validity, code extraction, provider/merchant separation,
 * OCR failure states, confidence grounding.
 *
 * Run: node test_reader_reliability.js
 */
const fs = require("fs");
const vm = require("vm");

const js = fs.readFileSync(__dirname + "/app.js", "utf8");
const data = JSON.parse(fs.readFileSync(__dirname + "/data/live_deals.json", "utf8"));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.log("  FAIL  " + msg); }
}

// Create a sandbox to execute parseDealText and matchByText
const sandbox = {
  console,
  NOW: new Date("2026-10-25T12:00:00Z"),
  DATA: data,
  store: { get: () => "[]", set: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: {},
  document: { createElement: () => ({ getContext: () => ({}) }) },
};

// Extract just the functions we need to test
const funcExtract = js.match(/function pkPlatforms\(\)[\s\S]*?\n\}/);
const matchByTextSrc = js.match(/function matchByText\(ocrText, platforms\)[\s\S]*?\n\}/);
const parseDealTextSrc = js.match(/function parseDealText\(text, ocrConfidence\)[\s\S]*?\n\}/);
const matchByColorSrc = js.match(/function matchByColor\(colors, platforms\)[\s\S]*?\n\}/);
const colorDistSrc = js.match(/function colorDist\(c1, c2\)[\s\S]*?\n\}/);
const normMerchantSrc = js.match(/function normMerchant\(s\)[\s\S]*?\n\}/);
const genericPhrasesSrc = js.match(/const GENERIC_PHRASES = new Set\([\s\S]*?\]\);/);

// Extract PK_PLATFORMS array
const pkPlatStart = js.indexOf("const PK_PLATFORMS = [");
const pkPlatEnd = js.indexOf("];", pkPlatStart) + 2;
const pkPlatSrc = js.slice(pkPlatStart, pkPlatEnd);

// Build the sandbox code
const sandboxCode = `
${normMerchantSrc ? normMerchantSrc[0] : ""}
${genericPhrasesSrc ? genericPhrasesSrc[0] : ""}
${pkPlatSrc}
${funcExtract ? funcExtract[0] : ""}
${colorDistSrc ? colorDistSrc[0] : ""}
${matchByColorSrc ? matchByColorSrc[0] : ""}
${matchByTextSrc ? matchByTextSrc[0] : ""}
${parseDealTextSrc ? parseDealTextSrc[0] : ""}
this.PK_PLATFORMS = PK_PLATFORMS;
this.pkPlatforms = pkPlatforms;
this.matchByColor = typeof matchByColor !== "undefined" ? matchByColor : undefined;
this.matchByText = typeof matchByText !== "undefined" ? matchByText : undefined;
this.parseDealText = parseDealText;
`;

try {
  vm.runInNewContext(sandboxCode, sandbox);
} catch (e) {
  console.log("SANDBOX ERROR:", e.message);
  process.exit(1);
}

const { parseDealText, matchByText, pkPlatforms, PK_PLATFORMS, matchByColor } = sandbox;

console.log("\n=== Screenshot Reader Reliability Tests ===\n");

// ---- 1. Pakistan Eligibility ----
console.log("--- 1. Pakistan Eligibility ---");
const uber = PK_PLATFORMS.find(p => p.id === "uber");
const grab = PK_PLATFORMS.find(p => p.id === "grab");
const swvl = PK_PLATFORMS.find(p => p.id === "swvl");
const foodpanda = PK_PLATFORMS.find(p => p.id === "foodpanda");
const hbl = PK_PLATFORMS.find(p => p.id === "hbl");

assert(uber && uber.operatesIn && !uber.operatesIn.includes("PK"), "Uber marked as non-PK");
assert(grab && grab.operatesIn && !grab.operatesIn.includes("PK"), "Grab marked as non-PK");
assert(swvl && swvl.operatesIn && !swvl.operatesIn.includes("PK"), "Swvl marked as non-PK");
assert(!foodpanda.operatesIn || foodpanda.operatesIn.includes("PK"), "Foodpanda defaults to PK");
assert(!hbl.operatesIn || hbl.operatesIn.includes("PK"), "HBL defaults to PK");

const pkList = pkPlatforms();
assert(!pkList.find(p => p.id === "uber"), "pkPlatforms() excludes Uber");
assert(!pkList.find(p => p.id === "grab"), "pkPlatforms() excludes Grab");
assert(!pkList.find(p => p.id === "swvl"), "pkPlatforms() excludes Swvl");
assert(pkList.find(p => p.id === "foodpanda"), "pkPlatforms() includes Foodpanda");
assert(pkList.find(p => p.id === "hbl"), "pkPlatforms() includes HBL");
assert(pkList.length < PK_PLATFORMS.length, "pkPlatforms() is smaller than full list");

// ---- 2. Color-Only Invariant ----
console.log("\n--- 2. Color-Only Invariant (no text = no suggestion) ---");
// Simulate a dark screenshot (black colors) — should NOT match Uber via color alone
const darkColors = [{ r: 0, g: 0, b: 0, hex: "#000000" }];
const darkMatches = matchByColor(darkColors, pkPlatforms());
assert(!darkMatches.find(m => m.platform.id === "uber"), "Dark colors don't match Uber (excluded from PK)");
// Even if Uber were in the list, color-only should be capped
const darkMatchesAll = matchByColor(darkColors, PK_PLATFORMS);
const uberColorMatch = darkMatchesAll.find(m => m.platform.id === "uber");
if (uberColorMatch) {
  // Color-only score should be below suggestion threshold when no text
  assert(uberColorMatch.score * 0.12 < 0.15, "Uber color-only score below threshold (weighted 0.12)");
} else {
  assert(true, "Uber not in color matches for dark screenshot");
}

// Green bank colors should match multiple banks (ambiguous) — that's OK, text resolves
const greenColors = [{ r: 0, g: 103, b: 71, hex: "#006747" }];
const greenMatches = matchByColor(greenColors, pkPlatforms());
const greenBankIds = greenMatches.filter(m => m.platform.segment === "bank").map(m => m.platform.id);
assert(greenBankIds.length >= 2, "Green colors match multiple banks (ambiguous — needs text)");

// ---- 3. No Fabricated Expiry ----
console.log("\n--- 3. No Fabricated Expiry ---");
// Relative countdown must NOT produce a date
const relResult = parseDealText("Flash sale! 30 minutes left! Hurry!", 0.8);
assert(relResult.fields.expires_at === null, "Relative '30 minutes' does NOT create expiry date");
assert(relResult.fields.validity_type === "unknown", "Relative countdown → validity_type 'unknown'");

// "2 hours remaining" must NOT create a date
const relResult2 = parseDealText("Deal ends in 2 hours. Grab now!", 0.7);
assert(relResult2.fields.expires_at === null, "'2 hours' does NOT create expiry date");

// No date at all → no expiry
const noDateResult = parseDealText("Get 20% off on all items today!", 0.8);
assert(noDateResult.fields.expires_at === null, "No date in text → no expiry fabricated");
assert(noDateResult.fields.validity_type === "unknown", "No date → validity_type 'unknown'");

// ---- 4. Explicit Fixed Dates ----
console.log("\n--- 4. Explicit Fixed Dates ---");
const fixedResult = parseDealText("Valid till 31 Dec 2026. Use code SAVE50.", 0.85);
assert(fixedResult.fields.expires_at !== null, "Explicit date '31 Dec 2026' produces expiry");
assert(fixedResult.fields.validity_type === "fixed", "Explicit date → validity_type 'fixed'");
assert(fixedResult.fields.code === "SAVE50", "Code SAVE50 extracted");

const numDateResult = parseDealText("Offer valid until 15/11/2026", 0.8);
assert(numDateResult.fields.expires_at !== null, "Numeric date '15/11/2026' produces expiry");
assert(numDateResult.fields.validity_type === "fixed", "Numeric date → validity_type 'fixed'");

// ---- 5. Recurring Validity ----
console.log("\n--- 5. Recurring Validity ---");
const recurResult = parseDealText("Every Friday to Sunday get 25% off. Code JCDAYS.", 0.85);
assert(recurResult.fields.validity_type === "recurring", "'Every Friday to Sunday' → recurring");
assert(recurResult.fields.valid_days && recurResult.fields.valid_days.includes("fri"), "valid_days includes fri");
assert(recurResult.fields.valid_days && recurResult.fields.valid_days.includes("sun"), "valid_days includes sun");
assert(recurResult.fields.valid_days && recurResult.fields.valid_days.length === 3, "Fri-Sun = 3 days");
assert(recurResult.fields.code === "JCDAYS", "Code JCDAYS extracted exactly");
assert(recurResult.fields.expires_at === null, "Recurring deal has NO fixed expiry date");

const weekendResult = parseDealText("Weekend special: 30% off all orders", 0.7);
assert(weekendResult.fields.validity_type === "recurring", "'Weekend' → recurring");
assert(weekendResult.fields.valid_days && weekendResult.fields.valid_days.length === 3, "Weekend = 3 days (Fri-Sun PK)");

const dailyResult = parseDealText("Daily deal: buy 1 get 1 free", 0.75);
assert(dailyResult.fields.validity_type === "recurring", "'Daily' → recurring");
assert(dailyResult.fields.valid_days && dailyResult.fields.valid_days.length === 7, "Daily = 7 days");

const ongoingResult = parseDealText("Ongoing offer: 10% cashback on all purchases", 0.7);
assert(ongoingResult.fields.validity_type === "ongoing", "'Ongoing' → validity_type 'ongoing'");
assert(ongoingResult.fields.expires_at === null, "Ongoing → no expiry date");

// ---- 6. Provider/Merchant Separation ----
console.log("\n--- 6. Provider/Merchant Separation ---");
const jazzFoodResult = parseDealText("JazzCash users get 20% off on Foodpanda orders. Code JC20FP.", 0.85);
assert(jazzFoodResult.fields.provider === "JazzCash", "JazzCash detected as provider");
assert(jazzFoodResult.fields.merchant === "Foodpanda", "Foodpanda detected as merchant");
assert(jazzFoodResult.fields.brand === "JazzCash", "Brand = provider (JazzCash)");
assert(jazzFoodResult.fields.code === "JC20FP", "Code JC20FP extracted");

const hblResult = parseDealText("HBL debit card holders: 15% off at KFC. Valid till 20 Nov 2026.", 0.85);
assert(hblResult.fields.provider === "HBL", "HBL detected as provider");
assert(hblResult.fields.merchant === "KFC", "KFC detected as merchant");
assert(hblResult.fields.validity_type === "fixed", "HBL offer has fixed expiry");

// Single entity (no provider/merchant split)
const kfcOnly = parseDealText("KFC bucket deal: Rs 500 off on family bucket", 0.8);
assert(kfcOnly.fields.brand === "KFC", "KFC-only deal → brand = KFC");
assert(kfcOnly.fields.provider === undefined || kfcOnly.fields.provider === "KFC", "No separate provider for KFC-only");

// ---- 7. Coupon Code Extraction ----
console.log("\n--- 7. Coupon Code Extraction ---");
const codeLabelled = parseDealText("Use code AFTER11 for 25% off after 11pm", 0.9);
assert(codeLabelled.fields.code === "AFTER11", "Labelled code AFTER11 extracted exactly");
assert(codeLabelled.conf.code > 0.5, "Labelled code has higher confidence");

const codeUnlabelled = parseDealText("AFTER11 25% off midnight deals", 0.7);
assert(codeUnlabelled.fields.code === "AFTER11", "Unlabelled code AFTER11 still found");
assert(codeUnlabelled.conf.code < codeLabelled.conf.code, "Unlabelled code has lower confidence than labelled");

// Code with easily confused chars (O vs 0, I vs 1)
const codeConfused = parseDealText("Promo code: HBL25OFF", 0.85);
assert(codeConfused.fields.code === "HBL25OFF", "Code HBL25OFF preserved exactly (no O→0 replacement)");

// No code → no fabricated code
const noCode = parseDealText("Get 20% off on all items this weekend", 0.8);
assert(noCode.fields.code === undefined, "No code in text → no code fabricated");

// ---- 8. Confidence Grounding ----
console.log("\n--- 8. Confidence Grounding ---");
const highConf = parseDealText("50% off everything. Code MEGA50. Valid till 31 Dec 2026.", 0.95);
const lowConf = parseDealText("50% off everything. Code MEGA50. Valid till 31 Dec 2026.", 0.3);
assert(highConf.conf.discount_value > lowConf.conf.discount_value, "Higher OCR confidence → higher field confidence");
assert(highConf.confidence > lowConf.confidence, "Overall confidence scales with OCR quality");
assert(highConf.conf.discount_value < 1, "Confidence never reaches 1.0 (always uncertain)");
assert(lowConf.conf.discount_value > 0, "Low OCR confidence still produces non-zero field confidence");

// No OCR confidence provided → uses default 0.5 base
const noOcrConf = parseDealText("20% off deal", null);
assert(noOcrConf.conf.discount_value > 0 && noOcrConf.conf.discount_value < 0.6, "No OCR conf → moderate default confidence");

// ---- 9. OCR Failure States ----
console.log("\n--- 9. OCR Failure States (code inspection) ---");
assert(js.includes('ocrStatus === "timeout"'), "Timeout state distinguished");
assert(js.includes('ocrStatus === "unavailable"'), "Unavailable state distinguished");
assert(js.includes('ocrStatus === "no_text"'), "No readable text state distinguished");
assert(js.includes("OCR timed out"), "Timeout message exists");
assert(js.includes("isn't available on this device"), "Unavailable message exists");
assert(js.includes("No readable text found"), "No-text message exists");

// ---- 10. Diagnostic Area ----
console.log("\n--- 10. Raw OCR Text Diagnostic ---");
assert(js.includes("ss-diag"), "Diagnostic CSS class exists");
assert(js.includes("What the reader saw"), "Diagnostic label exists");
assert(js.includes("ocrOut.raw.slice(0, 2000)"), "Raw text capped at 2000 chars");

// ---- 11. ML Kit Integration ----
console.log("\n--- 11. ML Kit Integration ---");
assert(js.includes("AndroidBridge.ocrBase64"), "JS checks for native OCR bridge");
assert(js.includes('provider: "mlkit"'), "ML Kit provider registered");
assert(js.includes("Native OCR not available"), "Graceful fallback when bridge missing");
const mainActivity = fs.readFileSync(__dirname + "/android/app/src/main/java/com/dealradar/pk/MainActivity.java", "utf8");
assert(mainActivity.includes("com.google.mlkit"), "ML Kit imported in MainActivity");
assert(mainActivity.includes("ocrBase64"), "ocrBase64 method exists in bridge");
assert(mainActivity.includes("TextRecognition"), "TextRecognition client used");
assert(mainActivity.includes("OCR_TIMEOUT_MS"), "OCR timeout defined");
assert(mainActivity.includes("MAX_IMAGE_DIMENSION"), "Image size limit defined");
const buildGradle = fs.readFileSync(__dirname + "/android/app/build.gradle", "utf8");
assert(buildGradle.includes("com.google.mlkit:text-recognition"), "ML Kit dependency in build.gradle");

// ---- 12. Evidence Tracking ----
console.log("\n--- 12. Evidence Tracking ---");
const evResult = parseDealText("JazzCash: 20% off on Foodpanda. Code JC20. Every Fri-Sun.", 0.85);
assert(evResult.evidence !== undefined, "Evidence object returned");
assert(evResult.evidence.provider && evResult.evidence.provider.includes("JazzCash"), "Provider evidence recorded");
assert(evResult.evidence.code && evResult.evidence.code.includes("JC20"), "Code evidence recorded");
assert(evResult.evidence.valid_days && evResult.evidence.valid_days.includes("Fri"), "Validity evidence recorded");

// ---- 13. Dark Screenshot Must Not Produce Uber ----
console.log("\n--- 13. Dark Screenshot Invariant ---");
// Text that could match Uber keywords but from a PK context
const darkText = parseDealText("Get your ride sorted. 20% off your next trip.", 0.7);
assert(darkText.fields.brand !== "Uber", "Generic 'ride' text does NOT produce Uber");
assert(darkText.fields.provider === undefined || darkText.fields.provider !== "Uber", "Uber never suggested as provider");

// ---- 14. City Detection ----
console.log("\n--- 14. City Detection ---");
const cityResult = parseDealText("Karachi only: 30% off at all restaurants", 0.8);
assert(cityResult.fields.city === "Karachi", "City 'Karachi' detected");
const nationwideResult = parseDealText("Nationwide offer: 15% off everywhere", 0.8);
assert(nationwideResult.fields.city === "All Pakistan", "'Nationwide' → All Pakistan");

// ---- 15. Real-world Tim Hortons + Easypaisa screenshot fixtures ----
console.log("\n--- 15. Real-world screenshot defects ---");
// The exact OCR text pattern from the Instagram Tim Hortons/Easypaisa post:
// big "30% OFF" split across lines, browser chrome, "T&CS APPLY", mangled brand.
const realOcr = [
  "1:32", "A % instagram.com/dis", "dw", "discountworld_dw Follow",
  "Paid partnership", "ENJOY", "30", "% OFF", "WITH easypaisa DEBIT CARDS",
  "AT Tim Hortons", "T&CS APPLY", "551", "8", "5",
].join("\n");
const real = parseDealText(realOcr, 0.6);
assert(real.fields.discount_value === 30, "Split '30' + '% OFF' still detected as 30% discount");
assert(real.fields.provider === "Easypaisa", "Easypaisa detected as provider from real OCR");
assert(real.fields.merchant === "Tim Hortons", "Tim Hortons detected as merchant (in dictionary now)");
assert(!/instagram\.com|\.com|Paid partnership/i.test(real.fields.title || ""), "Title excludes browser/social chrome");

// Generic marketing phrase alone must NOT identify a brand
const genericOnly = matchByText("T&CS APPLY order now limited time offers", pkPlatforms());
const fp = genericOnly.find(m => m.platform.id === "foodpanda");
assert(!fp || fp.score <= 0.2, "'t&cs apply' alone does not strongly match Foodpanda");
const fpCombined = fp ? fp.score * 0.65 : 0;
assert(fpCombined < 0.15, "Generic-only Foodpanda text falls below 0.15 suggestion threshold");

// Tim Hortons / Second Cup / Cinnabon now present
assert(pkPlatforms().some(p => p.id === "timhortons"), "Tim Hortons in PK platforms");
assert(pkPlatforms().some(p => p.id === "secondcup"), "Second Cup in PK platforms");
assert(pkPlatforms().some(p => p.id === "cinnabon"), "Cinnabon in PK platforms");
// Clean Tim Hortons text matches by brand name (headerHit)
const thMatch = matchByText("Enjoy at Tim Hortons this week", pkPlatforms());
assert(thMatch[0] && thMatch[0].platform.id === "timhortons" && thMatch[0].score >= 0.9, "Clean 'Tim Hortons' text matches strongly");

// Unknown validity → no fabricated expiry, no implied end date
const unk = parseDealText("Enjoy 30% OFF with easypaisa debit cards", 0.6);
assert(unk.fields.expires_at === null, "Real ad (no date) → no expiry");
assert(unk.fields.validity_type === "unknown", "Real ad (no date) → validity_type 'unknown'");

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
process.exit(failed > 0 ? 1 : 0);
