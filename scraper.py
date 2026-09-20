#!/usr/bin/env python3
"""DealRadar PK Scraper v3 — Full coverage via Peekaboo Guru SDK API.

7 banks × 20 major cities × concurrent requests.
Pulls real-time merchant deals with discount %, card types, branches, validity.
"""

import json
import hashlib
import logging
import pathlib
import re
import sys
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("scraper")

BASE = pathlib.Path(__file__).parent
DATA = BASE / "data"
if not DATA.is_dir():
    DATA = BASE
OUT = DATA / "live_deals.json"
STATIC = DATA / "deals.json"

# ---- API Configuration ----
SDK_BASE = "https://secure-sdk.peekaboo.guru"
EP_CITIES = f"{SDK_BASE}/klaoshcjanaij2ktnbjkmiasvtafoabxtenstn5"
EP_MERCHANTS = f"{SDK_BASE}/uljin2s3nitoi89njkhklgkj5"
EP_DEALS = f"{SDK_BASE}/ksbolruuahrndcjchshjhejgjhasdo787kjieo767kjsgeskoyfgwwhkl6"

BANKS = {
    "HBL": {
        "ownerkey": "0a1755c7e5691a8f3380180979414d31",
        "subdomain": "hbl-web.peekaboo.guru",
        "brand_id": "hbl", "brand_name": "HBL", "brand_type": "bank", "color": "#006747",
    },
    "UBL": {
        "ownerkey": "7db159dc932ec461c1a6b9c1778bb2b0",
        "subdomain": "ubl-web.peekaboo.guru",
        "brand_id": "ubl", "brand_name": "UBL", "brand_type": "bank", "color": "#003DA5",
    },
    "Meezan": {
        "ownerkey": "af085488ba0578c025f03fc7fae7b25d",
        "subdomain": "meezan-web.peekaboo.guru",
        "brand_id": "meezan", "brand_name": "Meezan Bank", "brand_type": "bank", "color": "#005B31",
    },
    "Alfalah": {
        "ownerkey": "2fbabf2c60b4cc81e9ac6470a5a12eb0",
        "subdomain": "alfalah-web.peekaboo.guru",
        "brand_id": "bankalfalah", "brand_name": "Bank Alfalah", "brand_type": "bank", "color": "#1B3C73",
    },
    "MCB": {
        "ownerkey": "20b6989c507e2aa21567a44fb3c9c183",
        "subdomain": "mcb-web.peekaboo.guru",
        "brand_id": "mcb", "brand_name": "MCB Bank", "brand_type": "bank", "color": "#003366",
    },
    "Askari": {
        "ownerkey": "9be06ffc226c016edcf64c417914fbd5",
        "subdomain": "askari-web.peekaboo.guru",
        "brand_id": "askari", "brand_name": "Askari Bank", "brand_type": "bank", "color": "#1A5276",
    },
    "Allied": {
        "ownerkey": "de579fa6950f741c1cb383414a590095",
        "subdomain": "allied-web.peekaboo.guru",
        "brand_id": "allied", "brand_name": "Allied Bank", "brand_type": "bank", "color": "#2E4053",
    },
}

# Top 20 cities by population/deal density
CITIES = [
    "Karachi", "Lahore", "Islamabad", "Rawalpindi", "Multan",
    "Faisalabad", "Peshawar", "Quetta", "Gujranwala", "Sialkot",
    "Hyderabad", "Sargodha", "Bahawalpur", "Sukkur", "Abbottabad",
    "Gujrat", "Jhang", "Sahiwal", "Wah Cantt", "Mardan",
]

MAX_MERCHANTS_PER_CITY = 15
MAX_WORKERS = 6

HEADERS_TEMPLATE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "medium": "IFRAME",
}

CATEGORY_MAP = {
    "dining": "food", "restaurant": "food", "food": "food", "cafe": "food",
    "bakery": "food", "fast food": "food", "pizza": "food", "burger": "food",
    "shopping": "shopping", "retail": "retail", "fashion": "fashion",
    "clothing": "fashion", "electronics": "electronics", "grocery": "grocery",
    "supermarket": "grocery", "travel": "travel", "hotel": "travel",
    "telecom": "telecom", "fuel": "fuel", "utilities": "utilities",
    "health": "shopping", "beauty": "shopping", "education": "shopping",
    "entertainment": "shopping", "sports": "shopping", "automotive": "shopping",
    "home": "shopping", "jewelry": "shopping", "books": "shopping",
}


def map_card_to_payment(card_name, bank_id):
    card_lower = card_name.lower()
    is_credit = "credit" in card_lower
    if bank_id == "hbl":
        return "hbl_credit" if is_credit else "hbl_debit"
    elif bank_id == "meezan":
        return "meezan_debit"
    elif bank_id == "bankalfalah":
        return "bankalfalah_card"
    elif bank_id in ("mcb", "ubl", "askari", "allied"):
        return "visa_card"
    return "visa_card"


def make_deal_id(bank_id, merchant_slug, deal_id):
    raw = f"{bank_id}:{merchant_slug}:{deal_id}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def extract_discount(deal):
    title = deal.get("title", "")
    pct = deal.get("percentageValue", 0)
    pct_match = re.search(r"(\d+)%", title)
    flat_match = re.search(r"[Rr]s\.?\s*(\d[\d,]*)", title)
    if pct or pct_match:
        return {"kind": "percent", "value": pct or int(pct_match.group(1))}
    elif flat_match:
        return {"kind": "flat", "value": int(flat_match.group(1).replace(",", ""))}
    return {"kind": "percent", "value": 0}


def extract_cap(description):
    if not description:
        return None
    m = re.search(r"maximum (?:discount|cashback) of (?:PKR|Rs\.?)\s*([\d,]+)", description, re.I)
    return int(m.group(1).replace(",", "")) if m else None


def extract_min_spend(description):
    if not description:
        return None
    m = re.search(r"minimum (?:spend|purchase|bill|transaction) of (?:PKR|Rs\.?)\s*([\d,]+)", description, re.I)
    return int(m.group(1).replace(",", "")) if m else None


def guess_category(keywords, name):
    text = ((keywords or "") + " " + (name or "")).lower()
    for kw, cat in CATEGORY_MAP.items():
        if kw in text:
            return cat
    return "shopping"


def fetch_merchants(session, bank_cfg, city):
    headers = {**HEADERS_TEMPLATE, "ownerkey": bank_cfg["ownerkey"],
               "Origin": f"https://{bank_cfg['subdomain']}",
               "Referer": f"https://{bank_cfg['subdomain']}/"}
    payload = {
        "fksyd": city, "n4ja3s": "Pakistan", "js6nwf": "0", "pan3ba": "0",
        "mstoaw": "en", "angaks": "all", "j87asn": "_all",
        "makthya": "trending", "mnakls": MAX_MERCHANTS_PER_CITY, "opmsta": "0",
        "kaiwnua": "_all", "klaosw": False
    }
    try:
        r = session.post(EP_MERCHANTS, headers=headers, json=payload, timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []


def fetch_deals(session, bank_cfg, city, merchant):
    headers = {**HEADERS_TEMPLATE, "ownerkey": bank_cfg["ownerkey"],
               "Origin": f"https://{bank_cfg['subdomain']}",
               "Referer": f"https://{bank_cfg['subdomain']}/"}
    entity_id = merchant.get("entityId")
    merchant_name = merchant.get("name", "")
    payload = {
        "fksyd": city, "n4ja3s": "Pakistan", "js6nwf": "0", "pan3ba": "0",
        "mstoaw": "en", "cotuia": entity_id, "nai3asnu": "All",
        "ia3uas": "All", "kaiwnua": "_all", "matsw": merchant_name,
        "yudwq": "_all", "njsue": "sdk", "hgoeni": entity_id,
        "mnakls": "50", "opmsta": "0", "mghes": "true",
        "klaosw": False, "makthya": "discount"
    }
    try:
        r = session.post(EP_DEALS, headers=headers, json=payload, timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []


def process_merchant_deals(bank_cfg, city, merchant, raw_deals):
    deals = []
    entity_id = merchant.get("entityId")
    merchant_name = merchant.get("name", "")
    merchant_slug = merchant.get("slug", "")
    merchant_keywords = merchant.get("keywords", "")
    merchant_logo = merchant.get("logo", "")

    for raw in raw_deals:
        deal_id = raw.get("dealId")
        if not deal_id:
            continue

        title = raw.get("title", "")
        description = raw.get("description", "")
        start_date = raw.get("startDate", "")
        end_date = raw.get("endDate", "")
        pct = raw.get("percentageValue", 0)

        if not pct and not re.search(r"\d+%", title):
            continue

        valid_from = start_date[:10] if start_date else datetime.now().strftime("%Y-%m-%d")
        valid_until = end_date[:10] if end_date else ""
        if not valid_until:
            continue

        try:
            end_dt = datetime.strptime(valid_until, "%Y-%m-%d")
            if end_dt < datetime.now():
                continue
        except ValueError:
            continue

        payments = set()
        for assoc in raw.get("associations", []):
            card_name = assoc.get("name", "")
            if card_name:
                payments.add(map_card_to_payment(card_name, bank_cfg["brand_id"]))
        if not payments:
            payments = {"visa_card"}

        discount = extract_discount(raw)
        cap = extract_cap(description)
        min_spend = extract_min_spend(description)
        category = guess_category(merchant_keywords, merchant_name)

        deal = {
            "id": make_deal_id(bank_cfg["brand_id"], merchant_slug, deal_id),
            "brand": bank_cfg["brand_id"],
            "brand_type": "bank",
            "category": category,
            "title": f"{discount['value']}% off at {merchant_name} with {bank_cfg['brand_name']}",
            "summary": f"{title} at {merchant_name}. {bank_cfg['brand_name']} card discount.",
            "discount": discount,
            "eligibility": {
                "payment": sorted(payments),
                "merchant": merchant_name,
                "user": "any",
                "min_spend": min_spend,
            },
            "cities": [city],
            "valid_from": valid_from,
            "valid_until": valid_until,
            "exclusions": [],
            "steps": [
                f"Visit {merchant_name} in {city}",
                f"Pay with your {bank_cfg['brand_name']} card",
                f"Discount of {title} will be applied automatically"
            ],
            "source": {
                "type": "official",
                "platform": "Peekaboo Guru SDK",
                "url": f"https://{bank_cfg['subdomain']}",
                "status": "verified",
                "captured_at": datetime.now(timezone.utc).isoformat(),
            },
            "status": "active",
            "verification": "verified",
            "confidence": 0.9,
            "community": {
                "votes": raw.get("likeCount", 0),
                "worked": 0, "failed": 0, "saves": 0,
                "spotted_by": None, "reports_expired": 0,
            },
            "visual": {"gradient": [bank_cfg["color"], "#1a1e2a"]},
        }
        if cap:
            deal["discount"]["cap"] = cap
        deals.append(deal)

    return deals


def scrape_bank_city(bank_name, bank_cfg, city):
    session = requests.Session()
    merchants = fetch_merchants(session, bank_cfg, city)
    if not isinstance(merchants, list):
        return []

    deals = []
    for merchant in merchants[:MAX_MERCHANTS_PER_CITY]:
        if not merchant.get("entityId") or not merchant.get("name"):
            continue
        raw_deals = fetch_deals(session, bank_cfg, city, merchant)
        if isinstance(raw_deals, list):
            deals.extend(process_merchant_deals(bank_cfg, city, merchant, raw_deals))

    return deals


def run():
    log.info("Starting full scrape (7 banks × 20 cities)...")
    all_scraped = []

    # Build task list
    tasks = [(name, cfg, city) for name, cfg in BANKS.items() for city in CITIES]
    log.info(f"Total tasks: {len(tasks)}")

    completed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(scrape_bank_city, name, cfg, city): (name, city)
            for name, cfg, city in tasks
        }
        for future in as_completed(futures):
            name, city = futures[future]
            completed += 1
            try:
                deals = future.result()
                all_scraped.extend(deals)
                if deals:
                    log.info(f"[{completed}/{len(tasks)}] {name}/{city}: {len(deals)} deals")
            except Exception as e:
                log.warning(f"[{completed}/{len(tasks)}] {name}/{city}: {e}")

    # Deduplicate
    seen = set()
    unique = []
    for d in all_scraped:
        if d["id"] not in seen:
            seen.add(d["id"])
            unique.append(d)

    log.info(f"Total scraped: {len(all_scraped)}, unique: {len(unique)}")

    # Load curated
    curated = []
    if STATIC.exists():
        try:
            static = json.loads(STATIC.read_text(encoding="utf-8"))
            curated = static.get("deals", [])
            log.info(f"Curated: {len(curated)}")
        except Exception as e:
            log.error(f"Curated load failed: {e}")

    combined_ids = set(d["id"] for d in unique)
    for c in curated:
        if c["id"] not in combined_ids:
            unique.append(c)

    # Build brands
    brands = []
    brand_ids = set()
    static_brands = []
    if STATIC.exists():
        try:
            static_brands = json.loads(STATIC.read_text(encoding="utf-8")).get("brands", [])
        except:
            pass

    for d in unique:
        bid = d.get("brand", "")
        if bid and bid not in brand_ids:
            brand_ids.add(bid)
            bank_info = next((b for b in BANKS.values() if b["brand_id"] == bid), None)
            if bank_info:
                brands.append({
                    "id": bid, "name": bank_info["brand_name"],
                    "brand_type": bank_info["brand_type"],
                    "color": bank_info["color"], "logo": f"{bid}.png",
                })
            else:
                cb = next((b for b in static_brands if b["id"] == bid), None)
                if cb:
                    brands.append(cb)
                else:
                    brands.append({"id": bid, "name": bid.replace("_", " ").title(), "brand_type": "brand", "color": "#555"})

    output = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "server_time": datetime.now(timezone.utc).isoformat(),
            "now": datetime.now(timezone(timedelta(hours=5))).isoformat(),
            "source": "peekaboo_sdk",
            "banks_scraped": list(BANKS.keys()),
            "cities_scraped": CITIES,
            "total_deals": len(unique),
        },
        "brands": brands,
        "deals": unique,
    }

    OUT.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"Done: {len(unique)} total deals ({len(curated)} curated + {len(unique) - len(curated)} scraped) → {OUT}")


if __name__ == "__main__":
    run()
