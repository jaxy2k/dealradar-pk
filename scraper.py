#!/usr/bin/env python3
"""DealRadar PK — Live Deal Scraper
Fetches deals from Pakistani sources and outputs live_deals.json.
Sources: Easypaisa, Picodi, Daraz, Meezan Bank, JazzCash, Foodpanda."""

import json, re, hashlib, logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("scraper")

BASE = Path(__file__).parent
DATA = BASE / "data"
if not DATA.is_dir():
    DATA = BASE
OUT = DATA / "live_deals.json"
STATIC = DATA / "deals.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Accept-Language": "en-PK,en;q=0.9",
}

NOW = datetime.now(timezone(timedelta(hours=5)))  # PKT

def deal_id(prefix, title):
    return f"{prefix}_{hashlib.md5(title.encode()).hexdigest()[:8]}"

def make_deal(prefix, brand, brand_type, category, title, summary, discount, eligibility,
              cities, valid_from, valid_until, source_url, source_type, source_platform,
              status="active", verification="pending", confidence=0.7, steps=None, exclusions=None):
    return {
        "id": deal_id(prefix, title),
        "brand": brand,
        "brand_type": brand_type,
        "category": category,
        "title": title,
        "summary": summary,
        "discount": discount,
        "eligibility": eligibility,
        "cities": cities,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "exclusions": exclusions or [],
        "steps": steps or [],
        "source": {
            "type": source_type,
            "platform": source_platform,
            "url": source_url,
            "status": "live",
            "captured_at": NOW.isoformat()
        },
        "status": status,
        "verification": verification,
        "confidence": confidence,
        "community": {"votes": 0, "worked": 0, "failed": 0, "saves": 0, "spotted_by": None, "reports_expired": 0},
        "visual": {"gradient": ["#22c55e", "#3b82f6"]}
    }

# ---- SCRAPERS ----

def scrape_easypaisa():
    """Scrape Easypaisa coffee house / partner deals."""
    deals = []
    try:
        url = "https://easypaisa.com.pk/coffee-house-partners/"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            log.warning(f"Easypaisa: HTTP {r.status_code}")
            return deals
        soup = BeautifulSoup(r.text, "lxml")
        # Look for partner/deal entries
        text = soup.get_text()
        # Extract percentage discounts
        patterns = re.findall(r'(\d+)%\s*(?:off|discount|cashback)', text, re.I)
        if patterns:
            for i, pct in enumerate(set(patterns[:5])):
                deals.append(make_deal(
                    "ep", "easypaisa", "wallet", "food",
                    f"{pct}% off at partner outlets with Easypaisa",
                    f"Get {pct}% off at Easypaisa partner coffee shops and restaurants.",
                    {"kind": "percent", "value": int(pct), "cap": None},
                    {"payment": ["easypaisa_wallet"], "merchant": "partner_outlets", "user": "any", "min_spend": None},
                    ["All Pakistan"], NOW.strftime("%Y-%m-%d"), (NOW + timedelta(days=30)).strftime("%Y-%m-%d"),
                    url, "official", "easypaisa.com.pk",
                    verification="verified", confidence=0.85
                ))
        log.info(f"Easypaisa: {len(deals)} deals found")
    except Exception as e:
        log.error(f"Easypaisa scrape error: {e}")
    return deals

def scrape_picodi_foodpanda():
    """Scrape Picodi for Foodpanda voucher codes."""
    deals = []
    try:
        url = "https://www.picodi.com/pk/foodpanda"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            log.warning(f"Picodi: HTTP {r.status_code}")
            return deals
        soup = BeautifulSoup(r.text, "lxml")
        # Look for coupon entries
        coupons = soup.select(".coupon, .promo, [class*=coupon], [class*=promo]")
        for c in coupons[:8]:
            text = c.get_text(strip=True)
            # Extract discount info
            pct_match = re.search(r'(\d+)%', text)
            flat_match = re.search(r'Rs\s*(\d+)', text)
            title_el = c.select_one("h2, h3, .title, [class*=title]")
            title = title_el.get_text(strip=True) if title_el else text[:80]
            if pct_match:
                deals.append(make_deal(
                    "fp", "foodpanda", "delivery", "food",
                    f"{pct_match.group(1)}% off Foodpanda orders",
                    f"Use this Picodi-verified code for {pct_match.group(1)}% off on Foodpanda.",
                    {"kind": "percent", "value": int(pct_match.group(1)), "cap": 200},
                    {"payment": ["any"], "merchant": "foodpanda", "user": "any", "min_spend": None},
                    ["All Pakistan"], NOW.strftime("%Y-%m-%d"), (NOW + timedelta(days=14)).strftime("%Y-%m-%d"),
                    url, "aggregator", "picodi.com",
                    verification="pending", confidence=0.6
                ))
            elif flat_match:
                deals.append(make_deal(
                    "fp", "foodpanda", "delivery", "food",
                    f"Rs {flat_match.group(1)} off Foodpanda orders",
                    f"Use this Picodi-verified code for Rs {flat_match.group(1)} off on Foodpanda.",
                    {"kind": "flat", "value": int(flat_match.group(1)), "cap": None},
                    {"payment": ["any"], "merchant": "foodpanda", "user": "any", "min_spend": None},
                    ["All Pakistan"], NOW.strftime("%Y-%m-%d"), (NOW + timedelta(days=14)).strftime("%Y-%m-%d"),
                    url, "aggregator", "picodi.com",
                    verification="pending", confidence=0.6
                ))
        log.info(f"Picodi/Foodpanda: {len(deals)} deals found")
    except Exception as e:
        log.error(f"Picodi scrape error: {e}")
    return deals

def scrape_daraz():
    """Scrape Daraz for active sales/promotions."""
    deals = []
    try:
        url = "https://www.daraz.pk/"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            log.warning(f"Daraz: HTTP {r.status_code}")
            return deals
        soup = BeautifulSoup(r.text, "lxml")
        text = soup.get_text()
        # Look for sale banners
        sale_patterns = re.findall(r'(?:up to|upto)\s*(\d+)%\s*(?:off|discount)', text, re.I)
        if sale_patterns:
            max_pct = max(int(p) for p in sale_patterns)
            deals.append(make_deal(
                "dz", "daraz", "ecommerce", "ecommerce",
                f"Up to {max_pct}% off — Daraz Sale Live Now",
                f"Daraz is running a sale with discounts up to {max_pct}% off across categories.",
                {"kind": "percent", "value": max_pct, "cap": None},
                {"payment": ["any"], "merchant": "daraz", "user": "any", "min_spend": None},
                ["All Pakistan"], NOW.strftime("%Y-%m-%d"), (NOW + timedelta(days=7)).strftime("%Y-%m-%d"),
                url, "official", "daraz.pk",
                verification="verified", confidence=0.8
            ))
        log.info(f"Daraz: {len(deals)} deals found")
    except Exception as e:
        log.error(f"Daraz scrape error: {e}")
    return deals

def scrape_meezan():
    """Scrape Meezan Bank card discount page."""
    deals = []
    try:
        url = "https://www.meezanbank.com/card-discounts/"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            log.warning(f"Meezan: HTTP {r.status_code}")
            return deals
        soup = BeautifulSoup(r.text, "lxml")
        text = soup.get_text()
        # Look for merchant discounts
        patterns = re.findall(r'(\d+)%\s*(?:off|discount).*?(\w[\w\s]{2,30})', text, re.I)
        for pct, merchant in patterns[:5]:
            deals.append(make_deal(
                "mz", "meezan", "bank", "shopping",
                f"{pct}% off at {merchant.strip()} with Meezan card",
                f"Get {pct}% discount at {merchant.strip()} when paying with Meezan Bank debit/credit card.",
                {"kind": "percent", "value": int(pct), "cap": None},
                {"payment": ["meezan_debit"], "merchant": merchant.strip().lower(), "user": "any", "min_spend": None},
                ["All Pakistan"], NOW.strftime("%Y-%m-%d"), (NOW + timedelta(days=60)).strftime("%Y-%m-%d"),
                url, "official", "meezanbank.com",
                verification="verified", confidence=0.85
            ))
        log.info(f"Meezan: {len(deals)} deals found")
    except Exception as e:
        log.error(f"Meezan scrape error: {e}")
    return deals

def scrape_jazzcash():
    """Scrape JazzCash offers page."""
    deals = []
    try:
        url = "https://www.jazzcash.pk/offers/"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            log.warning(f"JazzCash: HTTP {r.status_code}")
            return deals
        soup = BeautifulSoup(r.text, "lxml")
        text = soup.get_text()
        patterns = re.findall(r'(\d+)%\s*(?:off|discount|cashback)', text, re.I)
        if patterns:
            for pct in set(list(patterns)[:3]):
                deals.append(make_deal(
                    "jc", "jazzcash", "wallet", "shopping",
                    f"{pct}% off/cashback with JazzCash",
                    f"Get {pct}% off or cashback when paying via JazzCash app or QR.",
                    {"kind": "percent", "value": int(pct), "cap": None},
                    {"payment": ["jazzcash_app"], "merchant": "partner_outlets", "user": "any", "min_spend": None},
                    ["All Pakistan"], NOW.strftime("%Y-%m-%d"), (NOW + timedelta(days=30)).strftime("%Y-%m-%d"),
                    url, "official", "jazzcash.pk",
                    verification="verified", confidence=0.8
                ))
        log.info(f"JazzCash: {len(deals)} deals found")
    except Exception as e:
        log.error(f"JazzCash scrape error: {e}")
    return deals

# ---- MAIN ----

def run():
    log.info("Starting scrape...")
    all_deals = []
    all_deals += scrape_easypaisa()
    all_deals += scrape_picodi_foodpanda()
    all_deals += scrape_daraz()
    all_deals += scrape_meezan()
    all_deals += scrape_jazzcash()

    # Deduplicate by ID
    seen = set()
    unique = []
    for d in all_deals:
        if d["id"] not in seen:
            seen.add(d["id"])
            unique.append(d)

    # Merge with static deals (keep curated ones, add scraped ones)
    try:
        static = json.loads(STATIC.read_text(encoding="utf-8"))
        static_deals = static.get("deals", [])
        brands = static.get("brands", [])
        meta = static.get("meta", {})
    except:
        static_deals = []
        brands = []
        meta = {}

    # Combine: static curated + live scraped (avoid duplicates)
    static_ids = set(d["id"] for d in static_deals)
    combined = static_deals + [d for d in unique if d["id"] not in static_ids]

    output = {
        "meta": {
            **meta,
            "now": NOW.isoformat(),
            "total_deals": len(combined),
            "last_scrape": NOW.isoformat(),
            "scraped_deals": len(unique),
            "curated_deals": len(static_deals)
        },
        "brands": brands,
        "deals": combined
    }

    OUT.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"Done: {len(combined)} total deals ({len(static_deals)} curated + {len(unique)} scraped) → {OUT}")

if __name__ == "__main__":
    run()
