#!/usr/bin/env python3
"""Build single-file DealRadarPK.html: inline CSS, JS, dataset and base64 logos."""
import base64, json, mimetypes, re, pathlib

ROOT = pathlib.Path(__file__).parent
PUB = ROOT / "public"
OUT = ROOT / "DealRadarPK.html"

html = (PUB / "index.html").read_text(encoding="utf-8")
css = (PUB / "styles.css").read_text(encoding="utf-8")
js = (PUB / "app.js").read_text(encoding="utf-8")
# Prefer live_deals.json (scraped) over deals.json (curated) for fresher baked data
live_file = ROOT / "data" / "live_deals.json"
curated_file = ROOT / "data" / "deals.json"
data = (live_file if live_file.exists() else curated_file).read_text(encoding="utf-8")

# Inline external stylesheet
html = re.sub(r'<link[^>]+href=["\']styles\.css["\'][^>]*>', lambda m: f"<style>\n{css}\n</style>", html)

# Inline app.js
html = re.sub(r'<script[^>]+src=["\']app\.js["\'][^>]*></script>', lambda m: f"<script>\n{js}\n</script>", html)

# Inline deals.json fetch: inject data before app script
data_tag = f'<script>window.__DEALS__ = {data.strip()};</script>'
assert "</head>" in html
html = html.replace("</head>", data_tag + "\n</head>", 1)

# Replace logo file paths in dataset with base64 data URIs
def b64(p):
    f = PUB / p
    if not f.exists():
        f = PUB / "logos" / p
    if not f.exists():
        return p
    mime = mimetypes.guess_type(str(f))[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(f.read_bytes()).decode()}"

logo_map = {}
dj = json.loads(data)
for b in dj["brands"]:
    if b.get("logo") and not b["logo"].startswith("data:"):
        logo_map[b["logo"]] = b64(b["logo"])
for old, new in logo_map.items():
    if old != new:
        html = html.replace(old, new)

# Inline manifest as data URI
mf = (PUB / "manifest.json").read_text(encoding="utf-8")
mf_uri = "data:application/manifest+json;base64," + base64.b64encode(mf.encode()).decode()
html = re.sub(r'href=["\']manifest\.json["\']', f'href="{mf_uri}"', html)

# Inline app icon for apple-touch-icon (single-file portability)
icon_file = PUB / "icon-192.png"
if icon_file.exists():
    icon_uri = "data:image/png;base64," + base64.b64encode(icon_file.read_bytes()).decode()
    html = re.sub(r'href=["\']icon-192\.png["\']', f'href="{icon_uri}"', html)

# Drop service worker registration (no scope on file://)
sw_src = 'navigator.serviceWorker.register("sw.js").catch(() => {});'
assert sw_src in html, "SW registration snippet not found"
html = html.replace(sw_src, "Promise.resolve();")

# Set API_URL to GitHub Pages for live refresh
api_src = 'const API_URL = window.__API_URL__ || "";'
api_dst = 'const API_URL = window.__API_URL__ || "https://jaxy2k.github.io/dealradar-pk";'
html = html.replace(api_src, api_dst)

OUT.write_text(html, encoding="utf-8")
print(f"built {OUT} ({OUT.stat().st_size//1024} KB), inlined {len(logo_map)} logos")
