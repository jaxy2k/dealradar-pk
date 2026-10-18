// Node harness: loads the REAL repo app.js in a stubbed DOM and unit-tests the
// three remediation fixes: (A) expiry display trust model, (B) news exclusion,
// (C) Ending tab 3d->7d fallback. Boundary cases per spec.
// NOTE: app.js declares NOW/state/DATA with let/const, which are NOT exposed as
// sandbox properties in a vm context; read/write them via runInContext (ev/set).
const fs = require("fs");
const vm = require("vm");

function makeEl() {
  return { style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    dataset:{}, value:"", textContent:"", innerHTML:"", addEventListener(){}, removeEventListener(){},
    appendChild(){}, removeChild(){}, setAttribute(){}, getAttribute(){return null;},
    querySelector(){return makeEl();}, querySelectorAll(){return [];}, closest(){return null;},
    focus(){}, blur(){}, scrollIntoView(){}, click(){}, remove(){}, insertAdjacentHTML(){},
    getBoundingClientRect(){return {top:0,left:0,width:0,height:0};}, showPicker(){}, files:[],
    getContext(){return {};} };
}
const FIXED_NOW = Date.UTC(2026, 9, 18, 6, 0, 0); // 2026-10-18T06:00Z
const storeMap = {};
const sandbox = {
  console,
  setTimeout:()=>0, setInterval:()=>0, clearTimeout:()=>{}, clearInterval:()=>{},
  document:{ querySelector:()=>makeEl(), querySelectorAll:()=>[], createElement:()=>makeEl(),
    addEventListener(){}, removeEventListener(){}, body:makeEl(), documentElement:makeEl(),
    head:makeEl(), getElementById:()=>makeEl(), readyState:"complete", visibilityState:"visible", characterSet:"UTF-8" },
  localStorage:{ getItem:k=>(k in storeMap?storeMap[k]:null), setItem:(k,v)=>{storeMap[k]=String(v);}, removeItem:k=>{delete storeMap[k];} },
  navigator:{ serviceWorker:null, onLine:true, language:"en", vibrate:()=>{} },
  location:{ href:"http://localhost/", origin:"http://localhost", hostname:"localhost", protocol:"http:", search:"" },
  fetch:()=>Promise.reject(new Error("offline")),
  URL:{ createObjectURL:()=>"", revokeObjectURL:()=>{} },
  Image:function(){return {setAttribute(){},addEventListener(){}};},
  alert:()=>{}, confirm:()=>false, prompt:()=>"", requestAnimationFrame:()=>0,
  matchMedia:()=>({matches:false,addListener(){}}), addEventListener(){}, removeEventListener(){},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
// Deterministic clock so NOW is fixed regardless of when the test runs.
sandbox.Date = new Proxy(Date, { construct(t,a){ return a.length? new t(...a) : new t(FIXED_NOW); } });
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
try { vm.runInContext(src, sandbox, { filename:"app.js" }); }
catch (e) { console.error("LOAD ERROR:", e.message); process.exit(1); }

const ev = expr => vm.runInContext(expr, sandbox);
const set = (name, val) => vm.runInContext(`${name} = ${JSON.stringify(val)}`, sandbox);
// Force the fixed NOW (app.js sets NOW=new Date(); proxy makes that FIXED_NOW).
const NOW = ev("NOW");
if (new Date(NOW).getTime() !== FIXED_NOW) { ev(`NOW = new Date(${FIXED_NOW})`); }

let PASS=0, FAIL=0;
function ok(name, cond){ if(cond){PASS++;console.log("  PASS  "+name);} else {FAIL++;console.log("  FAIL  "+name);} }
function dPlus(days, extra){
  const dt = new Date(FIXED_NOW + days*86400000);
  const iso = dt.toISOString().slice(0,10);
  return Object.assign({ id:"x", status:"active", discount:{kind:"percent",value:10},
    eligibility:{payment:["any"]}, cities:["All Pakistan"], category:"food", brand:"b",
    title:"t", summary:"s", valid_until:iso }, extra||{});
}
// functions are top-level `function` decls -> reachable via ev("name")
const countdown = ev("countdown"), expiryState = ev("expiryState"), isNews = ev("isNews"),
      baseFilter = ev("baseFilter"), endingMode = ev("endingMode"), endingDeals = ev("endingDeals"),
      daysUntil = ev("daysUntil");

console.log("NOW anchored:", new Date(ev("NOW")).toISOString());

console.log("\nFix A — expiry display:");
ok("today (0d) -> countdown (not Ongoing)", /left|m\b/.test(countdown(dPlus(0)).text));
// 1-2d render as an hours countdown (e.g. "37h 35m") — still a real countdown, not a label.
ok("tomorrow (1d) -> real countdown (has digits, not Ongoing/NA)",
   /\d/.test(countdown(dPlus(1)).text) && !/Ongoing|unavailable|expired/i.test(countdown(dPlus(1)).text));
ok("3d -> '3d left'", countdown(dPlus(3)).text === "3d left");
ok("4d -> '4d left'", countdown(dPlus(4)).text === "4d left");
ok("89d -> '89d left'", countdown(dPlus(89)).text === "89d left");
ok("90d -> 'End date unavailable'", countdown(dPlus(90)).text === "End date unavailable");
ok("439d -> 'End date unavailable' (no number)", countdown(dPlus(439)).text === "End date unavailable");
ok("3727d (Allied 2036) -> 'End date unavailable'", countdown(dPlus(3727)).text === "End date unavailable");
ok("missing expiry -> 'Ongoing'", countdown(dPlus(0,{valid_until:null})).text === "Ongoing");
ok("expired (past) -> 'expired'", countdown(dPlus(-2)).text === "expired");
ok("evergreen status -> 'Ongoing'", countdown(dPlus(0,{status:"evergreen"})).text === "Ongoing");
ok("expiryState buckets correct",
   expiryState(dPlus(-1))==="expired" && expiryState(dPlus(2))==="soon" &&
   expiryState(dPlus(95))==="unknown" && expiryState(dPlus(0,{valid_until:null}))==="ongoing");
ok("never renders a day number >= 90",
   [90,120,439,3727].every(n => !/\b\d{2,}\b/.test(countdown(dPlus(n)).text)));

console.log("\nFix B — news exclusion:");
const newsSrc = { id:"rss_abc", status:"active", source:{type:"news"}, brand_type:"news", category:"utility",
  cities:["All Pakistan"], eligibility:{payment:["any"]}, discount:{kind:"percent",value:0}, title:"NVIDIA...", summary:"" };
const newsBrand = Object.assign({}, newsSrc, { id:"n2", source:{type:"web"}, brand_type:"news" });
const newsId = Object.assign({}, newsSrc, { id:"rss_deadbeef", source:{type:"web"}, brand_type:"retail" });
const real = dPlus(5);
ok("isNews true source.type=news", isNews(newsSrc)===true);
ok("isNews true brand_type=news", isNews(newsBrand)===true);
ok("isNews true rss_ id prefix", isNews(newsId)===true);
ok("isNews false real offer", isNews(real)===false);
ok("baseFilter drops news", baseFilter(newsSrc)===false && baseFilter(newsId)===false);
ok("baseFilter keeps real offers", baseFilter(real)===true);

console.log("\nFix C — Ending tab fallback:");
function resetState(city){ ev(`state.city=${JSON.stringify(city||"All")}; state.cat="all"; state.q=""; state.hiddenBrands=new Set(); state.myPay=new Set();`); }
resetState();
// s1: <=3d trustworthy exists -> 3d mode, only <=3d shown
set("DATA", { deals:[dPlus(2),dPlus(5),dPlus(90)], meta:{} });
ok("mode=3d when <=3d exists", endingMode()==="3d");
let sel = endingDeals(ev("DATA.deals").filter(baseFilter));
ok("3d mode selects only <=3d", sel.length===1 && daysUntil(sel[0])<=3);
// s2: no <=3d but 4-7d -> 7d mode includes the 5d
set("DATA", { deals:[dPlus(5),dPlus(90)], meta:{} });
ok("mode=7d when only 4-7d", endingMode()==="7d");
sel = endingDeals(ev("DATA.deals").filter(baseFilter));
ok("7d mode includes the 4-7d offer", sel.length===1 && daysUntil(sel[0])<=7);
// s3: only far-future/placeholder -> empty (no fake urgency)
set("DATA", { deals:[dPlus(90),dPlus(439)], meta:{} });
sel = endingDeals(ev("DATA.deals").filter(baseFilter));
ok("no urgency for untrustworthy dates", sel.length===0);
// s4: news never in Ending
set("DATA", { deals:[Object.assign({},newsSrc,{valid_until:dPlus(2).valid_until,discount:{kind:"percent",value:20}})], meta:{} });
sel = endingDeals(ev("DATA.deals").filter(baseFilter));
ok("news excluded from Ending", sel.length===0);
// city eligibility preserved
resetState("Karachi");
const kOnly = dPlus(2,{cities:["Karachi"]}); const allPk = dPlus(2,{cities:["All Pakistan"]});
ok("cityMatch keeps city-specific + All Pakistan", baseFilter(kOnly)===true && baseFilter(allPk)===true);
resetState("Lahore");
ok("Karachi-only excluded for Lahore", baseFilter(kOnly)===false && baseFilter(allPk)===true);

console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL?1:0);
