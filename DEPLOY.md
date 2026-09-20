# DealRadar PK — Live Deployment Guide

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Android App │────▶│  Flask API   │────▶│  live_deals.json │
│  (WebView)   │     │  :8000       │     │  (scraper output)│
└─────────────┘     └──────┬───────┘     └────────┬────────
                           │                      │
                           │              ┌───────┴────────┐
                           │              │   scraper.py    │
                           │              │  (every 30 min) │
                           │              └───────┬────────┘
                           │                      │
                    ┌──────┴──────┐       ┌───────┴────────┐
                    │  Static UI  │       │  PK Sources:    │
                    │  (HTML/CSS) │       │  Picodi, Daraz, │
                    └─────────────┘       │  Easypaisa, etc │
                                          └────────────────┘
```

## Quick Start (Local)

```bash
cd deals-app
pip install flask requests beautifulsoup4 lxml

# 1. Run scraper once to generate live data
python3 scraper.py

# 2. Start the API server (serves app + API + auto-scrapes every 30 min)
python3 server.py

# 3. Open http://localhost:8000 in browser
```

## Deploying to a Server

### Option A: Any VPS (DigitalOcean, AWS, etc.)

```bash
# On your server:
git clone <your-repo> deals-app
cd deals-app
pip install flask requests beautifulsoup4 lxml
python3 scraper.py
nohup python3 server.py &
```

Then update the APK's API URL:
- Edit `public/app.js` line 3: `const API_URL = "https://your-server.com";`
- Rebuild APK

### Option B: Free Hosting

- **Render.com** — Deploy `server.py` as a web service (free tier)
- **Railway.app** — Same, free tier available
- **PythonAnywhere** — Free tier, run `server.py` as a web app

### Option C: Serverless (no server needed)

- Host `live_deals.json` on GitHub Pages / Cloudflare Pages
- Run scraper via GitHub Actions (cron every 30 min)
- Point `API_URL` to your GitHub raw URL
- App fetches JSON directly (no Flask needed)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/deals` | GET | All deals + brands + meta |
| `/api/deals?since=ISO` | GET | Deals captured after timestamp |
| `/api/health` | GET | Server status |
| `/api/refresh` | POST | Trigger manual re-scrape |
| `/` | GET | App UI |

## How Live Updates Work

1. **Scraper** (`scraper.py`) fetches deals from PK sources every 30 min
2. **API** (`server.py`) serves the latest data from `live_deals.json`
3. **App** fetches from `/api/deals` on load, auto-refreshes every 5 min
4. **Pull-to-refresh** — swipe down on the feed to force refresh
5. **Fallback** — if API is unreachable, app uses baked-in static data

## Adding New Sources

Edit `scraper.py`, add a new `scrape_*()` function:

```python
def scrape_newsource():
    deals = []
    url = "https://newsource.pk/offers"
    r = requests.get(url, headers=HEADERS, timeout=15)
    soup = BeautifulSoup(r.text, "lxml")
    # ... extract deals ...
    return deals
```

Then add it to `run()`:
```python
all_deals += scrape_newsource()
```

## Current Sources

| Source | URL | Status |
|--------|-----|--------|
| Picodi (Foodpanda codes) | picodi.com/pk/foodpanda | Working |
| Daraz | daraz.pk | Blocked (403) — needs proxy |
| Easypaisa | easypaisa.com.pk | Blocked (403) — needs proxy |
| Meezan Bank | meezanbank.com | Blocked (403) — needs proxy |
| JazzCash | jazzcash.pk | DNS fails — needs proxy |

Some sources block datacenter IPs. For production, use a residential proxy
or run the scraper from a PK-based server.
