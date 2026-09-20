#!/usr/bin/env python3
"""DealRadar PK — Live Backend API
Serves deals from scraped sources. Auto-refreshes data via scheduler."""

import json, os, threading, time, logging
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify, send_from_directory, request
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("dealradar")

BASE = Path(__file__).parent
DATA_DIR = BASE / "data"
DATA_DIR.mkdir(exist_ok=True)
LIVE_FILE = DATA_DIR / "live_deals.json"

app = Flask(__name__, static_folder=str(BASE / "public"), static_url_path="")

# ---- in-memory cache ----
_cache = {"deals": None, "brands": None, "meta": None, "updated_at": None}
_lock = threading.Lock()

def load_data():
    """Load from live_deals.json (scraper output) or fallback to static deals.json."""
    src = LIVE_FILE if LIVE_FILE.exists() else DATA_DIR / "deals.json"
    try:
        d = json.loads(src.read_text(encoding="utf-8"))
        with _lock:
            _cache["deals"] = d.get("deals", [])
            _cache["brands"] = d.get("brands", [])
            _cache["meta"] = d.get("meta", {})
            _cache["updated_at"] = datetime.now(timezone.utc).isoformat()
        log.info(f"Loaded {len(_cache['deals'])} deals from {src.name}")
    except Exception as e:
        log.error(f"Failed to load data: {e}")

def get_data():
    if _cache["deals"] is None:
        load_data()
    return _cache

# ---- API routes ----

@app.route("/api/deals")
def api_deals():
    """Main deals endpoint. Supports ?since=ISO for incremental updates."""
    d = get_data()
    since = request.args.get("since")
    deals = d["deals"]
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
            deals = [x for x in deals if x.get("source", {}).get("captured_at", "") > since]
        except ValueError:
            pass
    return jsonify({
        "meta": {
            **d["meta"],
            "updated_at": d["updated_at"],
            "total_deals": len(deals),
            "total_brands": len(d["brands"]),
            "server_time": datetime.now(timezone.utc).isoformat()
        },
        "brands": d["brands"],
        "deals": deals
    })

@app.route("/api/health")
def api_health():
    d = get_data()
    return jsonify({
        "status": "ok",
        "deals": len(d["deals"]) if d["deals"] else 0,
        "updated_at": d["updated_at"]
    })

@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    """Trigger a manual data refresh (re-scrape)."""
    try:
        import subprocess
        result = subprocess.run(
            ["python3", str(BASE / "scraper.py")],
            capture_output=True, text=True, timeout=120, cwd=str(BASE)
        )
        load_data()
        return jsonify({"status": "refreshed", "deals": len(_cache["deals"] or []), "log": result.stdout[-500:]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ---- static file serving (for the app itself) ----

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)

# ---- background scheduler ----

def scheduler():
    """Run scraper every 30 minutes."""
    while True:
        time.sleep(1800)  # 30 min
        log.info("Scheduler: running scraper...")
        try:
            import subprocess
            result = subprocess.run(
                ["python3", str(BASE / "scraper.py")],
                capture_output=True, text=True, timeout=120, cwd=str(BASE)
            )
            load_data()
            log.info(f"Scheduler: scraper done, {len(_cache['deals'] or [])} deals loaded")
        except Exception as e:
            log.error(f"Scheduler error: {e}")

if __name__ == "__main__":
    load_data()
    t = threading.Thread(target=scheduler, daemon=True)
    t.start()
    log.info("DealRadar PK API starting on :8000")
    app.run(host="0.0.0.0", port=8000, debug=False)
