#!/usr/bin/env python3
"""Stage the single-file WebView asset that the APK ships.

Why this exists
---------------
The Android wrapper loads file:///android_asset/index.html, and a file:// page
cannot fetch() its sibling files (the scheme is blocked for CORS requests). So
the stylesheet, the app script, the deal dataset and the icons have to be
inlined into one HTML document before packaging. This is the same job the
top-level build.py was written for; build.py itself is left untouched because it
still expects the old public/ layout and a service-worker snippet that no longer
exists.

Usage (from the repository root):
    python3 android/build_asset.py
    cd android && ./gradlew assembleDebug

The generated file is derived output and is git-ignored; regenerate it before
every build so the APK cannot ship a UI older than the sources.
"""
import base64, json, mimetypes, re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "android" / "app" / "src" / "main" / "assets" / "index.html"

html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
js = (ROOT / "app.js").read_text(encoding="utf-8")

live_file = ROOT / "data" / "live_deals.json"
curated_file = ROOT / "data" / "deals.json"
data_file = live_file if live_file.exists() else curated_file
data = data_file.read_text(encoding="utf-8")

html = re.sub(r'<link[^>]+href=["\']styles\.css["\'][^>]*>',
              lambda m: f"<style>\n{css}\n</style>", html)
html = re.sub(r'<script[^>]+src=["\']app\.js["\'][^>]*></script>',
              lambda m: f"<script>\n{js}\n</script>", html)

assert "</head>" in html, "no </head> to inject the dataset before"
html = html.replace("</head>", f'<script>window.__DEALS__ = {data.strip()};</script>\n</head>', 1)

dj = json.loads(data)


def data_uri(p):
    for cand in (ROOT / p, ROOT / "logos" / p):
        if cand.exists():
            mime = mimetypes.guess_type(str(cand))[0] or "image/png"
            return f"data:{mime};base64,{base64.b64encode(cand.read_bytes()).decode()}"
    return None


inlined = 0
logo_map = {}
for b in dj.get("brands", []):
    lg = b.get("logo")
    if lg and not lg.startswith(("data:", "http")):
        uri = data_uri(lg)
        if uri:
            logo_map[lg] = uri
for d in dj.get("deals", []):
    lg = (d.get("merchant_info") or {}).get("logo")
    if lg and not lg.startswith(("data:", "http")):
        uri = data_uri(lg)
        if uri:
            logo_map[lg] = uri
for old, new in logo_map.items():
    html = html.replace(old, new)
    inlined += 1

mf = (ROOT / "manifest.json").read_text(encoding="utf-8")
mf_uri = "data:application/manifest+json;base64," + base64.b64encode(mf.encode()).decode()
html = re.sub(r'href=["\']manifest\.json["\']', f'href="{mf_uri}"', html)

icon = ROOT / "icon-192.png"
if icon.exists():
    icon_uri = "data:image/png;base64," + base64.b64encode(icon.read_bytes()).decode()
    html = re.sub(r'href=["\']icon-192\.png["\']', f'href="{icon_uri}"', html)

# The WebView has no service-worker scope on file://, and relative data fetches
# are blocked, so point the live refresh at the deployed Pages copy instead.
api_src = 'const API_URL = window.__API_URL__ || "";'
api_dst = 'const API_URL = window.__API_URL__ || "https://jaxy2k.github.io/dealradar-pk";'
if api_src not in html:
    sys.exit("ERROR: API_URL default not found in app.js - update this script.")
html = html.replace(api_src, api_dst)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"staged {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
print(f"dataset {data_file.name}: {len(dj.get('deals', []))} deals, {len(dj.get('brands', []))} brands")
print(f"inlined {inlined} local logo asset(s)")
