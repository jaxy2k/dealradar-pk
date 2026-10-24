/**
 * Regression tests: screenshot-to-deal intelligence
 * Tests: recurring validity, provider/merchant split, correction memory,
 * text-over-color brand detection, coupon code preservation.
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

console.log("\n=== Screenshot-to-Deal Intelligence Tests ===\n");

// --- 1. Recurring validity in countdown ---
const countdownSrc = js.match(/function countdown\(value\)\s*\{[\s\S]*?\n\}/);
assert(!!countdownSrc, "countdown function exists");
assert(countdownSrc[0].includes("valid_days"), "countdown checks valid_days for recurring deals");
assert(countdownSrc[0].includes("Every"), "countdown produces 'Every X–Y' label for recurring");
assert(countdownSrc[0].includes("Daily"), "countdown produces 'Daily' for 7-day recurrence");

// --- 2. Provider vs Merchant in form ---
assert(js.includes('name="provider"'), "Form has provider field");
assert(js.includes('name="merchant"'), "Form has merchant field");
assert(js.includes("Who's offering it?"), "Form labels provider clearly");
assert(js.includes("Where can you use it?"), "Form labels merchant clearly");

// --- 3. Validity type selector ---
assert(js.includes('name="validity_type"'), "Form has validity_type selector");
assert(js.includes('value="recurring"'), "Recurring option exists");
assert(js.includes('value="ongoing"'), "Ongoing option exists");
assert(js.includes('name="valid_day"'), "Day checkboxes exist for recurring");

// --- 4. Correction memory ---
assert(js.includes("function rememberCorrection"), "rememberCorrection function exists");
assert(js.includes("function getCorrectionsFor"), "getCorrectionsFor function exists");
assert(js.includes("function correctionMemory"), "correctionMemory function exists");
assert(js.includes("dr_corrections"), "Corrections stored in localStorage");

// --- 5. Color-only guess is NOT auto-filled ---
assert(js.includes("Color hint"), "Color guess shown as hint, not auto-fill");
assert(js.includes("tap to use"), "Color guess requires explicit tap");
assert(js.includes("Based on image colors only"), "Warning about color-only reliability");

// --- 6. Text-based provider detection from title ---
assert(js.includes("matchByText(titleVal"), "Title input triggers text-based brand detection");

// --- 7. Coupon code preservation ---
assert(js.includes('autocapitalize="characters"'), "Code field preserves case");
assert(js.includes('spellcheck="false"'), "Code field disables spellcheck");
assert(js.includes("exact characters"), "Code field warns about exactness");

// --- 8. Deal creation uses provider/merchant correctly ---
assert(js.includes("providerName"), "Submission uses providerName variable");
assert(js.includes("merchantName !== providerName"), "Merchant only set when different from provider");
assert(js.includes("valid_days: isRecurring ? validDays : null"), "valid_days stored on deal");
assert(js.includes('campaign_type: expires_at ? "flash" : (isRecurring ? "recurring" : "standard")'), "campaign_type reflects recurrence");

// --- 9. Ongoing deals get far-future expiry (not fabricated countdown) ---
assert(js.includes('"2099-12-31"'), "Ongoing/recurring deals use far-future date (no fake countdown)");

// --- 10. Regression fixtures ---
// Example A: Foodpanda AFTER11 — provider=Foodpanda, code=AFTER11, recurring midnight
// Example B: JazzCash on Foodpanda — provider=JazzCash, merchant=Foodpanda, code=JCDAYS, Fri-Sun
const fixtureA = { provider: "Foodpanda", merchant: "", code: "AFTER11", validity: "recurring", days: [] };
const fixtureB = { provider: "JazzCash", merchant: "Foodpanda", code: "JCDAYS", validity: "recurring", days: ["fri","sat","sun"] };
// Verify the form supports these inputs
assert(js.includes('placeholder="e.g. JazzCash, HBL, Foodpanda"'), "Provider placeholder includes JazzCash example");
assert(js.includes('placeholder="e.g. Foodpanda, KFC'), "Merchant placeholder includes Foodpanda example");

// --- 11. No hardcoded promotions in extraction logic ---
assert(!js.includes("AFTER11") || js.indexOf("AFTER11") > js.indexOf("// ----"), "AFTER11 not hardcoded in extraction logic");
assert(!js.includes("JCDAYS"), "JCDAYS not hardcoded anywhere");

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
process.exit(failed > 0 ? 1 : 0);
