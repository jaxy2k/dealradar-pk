#!/usr/bin/env python3
"""Deterministic PWA checks for DealRadar PK (GitHub Pages project-subpath safe).

Verifies, by parsing the actual deployed files (no browser needed):
  1. manifest.json is valid JSON with subpath-safe start_url/scope and real icons
  2. sw.js uses only relative URLs (root-absolute paths break Pages subpaths)
  3. sw.js never intercepts cross-origin requests (Supabase must stay live)
  4. data files are network-first (offers can't come from an aggressive cache)
  5. app.js registers sw.js, handles beforeinstallprompt + SKIP_WAITING update flow
  6. index.html links the manifest + iOS standalone metas (install eligibility)
  7. fetchLive uses RELATIVE same-origin data URLs (Pages 404 bug stays fixed)
"""
import json, re, sys

PASS = FAIL = 0
def check(name, cond):
    global PASS, FAIL
    if cond: PASS += 1
    else: FAIL += 1; print("FAIL:", name)

manifest = json.load(open("manifest.json", encoding="utf-8"))
sw = open("sw.js", encoding="utf-8").read()
app = open("app.js", encoding="utf-8").read()
html = open("index.html", encoding="utf-8").read()

# 1. manifest validity + subpath safety
check("manifest name/short_name present", manifest.get("name") and manifest.get("short_name"))
check("start_url relative (subpath-safe)", manifest.get("start_url") == "./")
check("scope relative (subpath-safe)", manifest.get("scope") == "./")
check("display standalone", manifest.get("display") == "standalone")
check("theme + background colors", manifest.get("theme_color") and manifest.get("background_color"))
icons = manifest.get("icons", [])
check("has >=1 icon >=192px", any("192" in i.get("sizes", "") for i in icons))
check("icon srcs relative (no leading slash)", all(not i["src"].startswith("/") for i in icons))
check("maskable icon provided", any(i.get("purpose") == "maskable" for i in icons))

# 2. service worker scope-safety: no root-absolute URLs anywhere in sw.js
check("CACHE_NAME bumped", re.search(r"dealradar-v([4-9]|\d{2,})", sw) is not None)
abs_urls = re.findall(r"""['"](/[A-Za-z0-9_.\-/]*)['"]""", sw)
check("no root-absolute asset URLs in sw.js", not abs_urls)
rel = re.findall(r"""['"](\./[^'"]*)['"]""", sw)
check("precache lists shell (index/app/styles)",
      {"./index.html", "./app.js", "./styles.css"} <= set(rel))
check("install never aborts on one missing file (allSettled)", "allSettled" in sw)

# 3. cross-origin must not be intercepted
check("SW returns early for cross-origin (Supabase live)", "url.origin !== self.location.origin" in sw)

# 4. network-first data strategy: fetch() is attempted BEFORE cache for every request
m = re.search(r"fetch\s*=\s*e\.respondWith\(([\s\S]*?)\)\s*\);", sw) \
    or re.search(r"e\.respondWith\(\s*fetch\(e\.request\)", sw)
check("respondWith uses fetch(request) first (network-first)",
      re.search(r"e\.respondWith\(\s*fetch\(e\.request\)", sw) is not None)
check("cache is offline fallback only (.catch -> caches.match)",
      re.search(r"\.catch\(\s*\(\)\s*=>\s*caches\.match", sw) is not None)
check("no cache-first pattern (caches.match before fetch in respondWith)",
      re.search(r"e\.respondWith\(\s*caches\.match", sw) is None)

# 5. update flow: waiting worker + SKIP_WAITING handshake + reload-once guard
check("SW listens for SKIP_WAITING message", "SKIP_WAITING" in sw)
check("SW always skipWaiting on install (immediate update)",
      "self.skipWaiting()" in sw)
check("app registers sw.js", re.search(r'serviceWorker\.register\("sw\.js"\)', app) is not None)
check("app handles beforeinstallprompt", "beforeinstallprompt" in app)
check("app prompts update via postMessage SKIP_WAITING", 'postMessage({ type: "SKIP_WAITING" })' in app)
check("app reloads only after hadController (no surprise reload)",
      "hadController" in app and "controllerchange" in app)
check("app handles appinstalled", "appinstalled" in app)

# 6. HTML entry point
check("index links manifest", 'rel="manifest"' in html)
check("manifest link relative", 'href="manifest.json"' in html)
check("iOS standalone metas", 'apple-mobile-web-app-capable' in html and 'apple-mobile-web-app-title' in html)
check("viewport fit cover (notch safe)", 'viewport-fit=cover' in html)

# 7. live data path bug stays fixed: relative same-origin fetch
check("fetchLive relative paths on same-origin", '"live_deals.json"' in app and "const paths = base ?" in app)
check("no root-absolute live data URL literal", '"/live_deals.json"' not in app)

# icons exist on disk
import os
check("icon files exist", os.path.getsize("icon-192.png") > 0 and os.path.getsize("icon-512.png") > 0)

print(f"\nPWA CHECKS: PASS {PASS} / FAIL {FAIL}")
sys.exit(1 if FAIL else 0)
