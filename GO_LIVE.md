# DealRadar PK — Go Live in 3 Steps (Free, No Server)

## How it works

```
GitHub Actions (runs every 30 min, free)
       │
       ▼
  scraper.py fetches deals from PK sources
       │
       ▼
  live_deals.json pushed to GitHub Pages (free)
       │
       ▼
  App fetches live_deals.json on every load
```

**No server. No hosting. No cost. GitHub does everything.**

---

## Step 1: Create a GitHub repo

1. Go to github.com → New repository → name it `dealradar-pk` → Public
2. Upload ALL files from this zip into the repo (drag & drop works)

## Step 2: Enable GitHub Pages

1. In your repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** → Folder: **/docs** → Save
4. Your app will be live at: `https://YOUR_USERNAME.github.io/dealradar-pk/`

## Step 3: Point the APK at your GitHub Pages URL

1. Open `public/app.js` in the repo
2. Find line 3: `const API_URL = window.__API_URL__ || "";`
3. Change it to: `const API_URL = "https://YOUR_USERNAME.github.io/dealradar-pk";`
4. Commit the change

**Done.** GitHub Actions will now:
- Run the scraper every 30 minutes automatically
- Push fresh deals to GitHub Pages
- Your app fetches the latest data every time it opens

---

## What the app does on load

1. **Has baked-in data?** → Shows instantly (works offline)
2. **Can reach GitHub Pages?** → Silently upgrades to live data
3. **Can't reach anything?** → Uses baked-in data (still fully functional)

## Manual refresh

- Pull down on the feed to force a refresh
- Or wait 5 minutes (auto-refresh)

## To add more sources

Edit `scraper.py`, add a new `scrape_*()` function, push to GitHub.
The workflow picks it up automatically.

---

## Files in this package

| File | Purpose |
|------|---------|
| `DealRadarPK.apk` | Android app (install on phone) |
| `DealRadarPK.html` | Web version (open in any browser) |
| `server.py` | Optional: local Flask API (if you want your own server) |
| `scraper.py` | The deal scraper (runs automatically via GitHub Actions) |
| `.github/workflows/scrape.yml` | GitHub Actions config (auto-scrape every 30 min) |
| `public/` | App source files |
| `data/` | Dataset (curated + live) |
