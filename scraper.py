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
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("scraper")

BASE = pathlib.Path(__file__).parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
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


def fetch_merchants(session, bank_cfg, city, retries=2):
    headers = {**HEADERS_TEMPLATE, "ownerkey": bank_cfg["ownerkey"],
               "Origin": f"https://{bank_cfg['subdomain']}",
               "Referer": f"https://{bank_cfg['subdomain']}/"}
    payload = {
        "fksyd": city, "n4ja3s": "Pakistan", "js6nwf": "0", "pan3ba": "0",
        "mstoaw": "en", "angaks": "all", "j87asn": "_all",
        "makthya": "trending", "mnakls": MAX_MERCHANTS_PER_CITY, "opmsta": "0",
        "kaiwnua": "_all", "klaosw": False
    }
    for attempt in range(retries + 1):
        try:
            r = session.post(EP_MERCHANTS, headers=headers, json=payload, timeout=20)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                import time; time.sleep(2 ** attempt)
                continue
        except Exception:
            if attempt < retries:
                import time; time.sleep(1 + attempt)
    return []


def fetch_deals(session, bank_cfg, city, merchant, retries=2):
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
    for attempt in range(retries + 1):
        try:
            r = session.post(EP_DEALS, headers=headers, json=payload, timeout=20)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                import time; time.sleep(2 ** attempt)
                continue
        except Exception:
            if attempt < retries:
                import time; time.sleep(1 + attempt)
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
            "merchant_info": {
                "logo": merchant.get("logo", ""),
                "cover": merchant.get("cover", ""),
                "rating": merchant.get("entityRating", 0),
                "contact": merchant.get("contactNumber", ""),
            },
        }
        if cap:
            deal["discount"]["cap"] = cap
        deals.append(deal)

    return deals


# ---- RSS News Scraper (govt subsidies, public deals) ----
RSS_FEEDS = [
    ("Pakistan News", "https://news.google.com/rss?hl=en-PK&gl=PK&ceid=PK:en"),
    ("Pakistan Business", "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-PK&gl=PK&ceid=PK:en"),
    ("Pakistan Nation", "https://news.google.com/rss/headlines/section/topic/NATION?hl=en-PK&gl=PK&ceid=PK:en"),
    ("Pakistan World", "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-PK&gl=PK&ceid=PK:en"),
]

RSS_KEYWORDS = re.compile(
    r"(subsid|relief|scheme|discount|waiv|rebate|cashback|voucher|"
    r"سبسڈی|رعایت|مفت|چھوٹ|ریلیف|اسکیم|"
    r"Rs\s*\d|PKR\s*\d|percent|per cent|فیصد|"
    r"petrol|fuel|bijli|electricity|solar|wheat|flour|atta|"
    r"پیٹرول|بجلی|سولر|آٹا|گندم)",
    re.I
)

RSS_EXCLUDE = re.compile(
    r"(attack|kill|blast|terror|arrest|court|trial|verdict|sentence|"
    r"war|strike|protest|riot|murder|suicide|accident|crash|"
    r"election|vote|poll|cabinet|minister resign|impeach|"
    r"cricket|football|match|series|tournament|"
    r"hostage|militant|missile|defence|coalition|intercept|"
    r"gold price|stock|market|share|bond|forex)",
    re.I
)

# Strong deal signals that override exclusions
RSS_STRONG = re.compile(
    r"(subsid|relief|discount|waiv|rebate|cashback|voucher|"
    r"سبسڈی|رعایت|مفت|چھوٹ|ریلیف|"
    r"petrol|fuel|bijli|electricity|solar|wheat|flour|atta|"
    r"پیٹرول|بجلی|سولر|آٹا|گندم)",
    re.I
)

RSS_BRAND = {
    "Pakistan News": {"id": "news_pk", "name": "Pakistan News", "brand_type": "news", "color": "#1e3a5f"},
    "Pakistan Business": {"id": "news_pk_biz", "name": "Pakistan Business", "brand_type": "news", "color": "#2d5016"},
    "Pakistan Nation": {"id": "news_pk_nation", "name": "Pakistan Nation", "brand_type": "news", "color": "#0066b3"},
    "Pakistan World": {"id": "news_pk_world", "name": "Pakistan World", "brand_type": "news", "color": "#4a1a6b"},
}


def extract_amount_from_text(text):
    """Try to pull a discount amount from headline/description."""
    # "Rs 100 per litre", "Rs 50,000 subsidy", "Rs 10,500"
    m = re.search(r"Rs\.?\s*([\d,]+)", text, re.I)
    if m:
        return {"kind": "flat", "value": int(m.group(1).replace(",", ""))}
    # "50% off", "25 percent"
    m = re.search(r"(\d{1,3})\s*(%|per\s*cent|percent)", text, re.I)
    if m:
        return {"kind": "percent", "value": int(m.group(1))}
    return {"kind": "flat", "value": 0}


def guess_rss_category(text):
    t = text.lower()
    if any(w in t for w in ["petrol", "fuel", "diesel", "پیٹرول", "ایندھن"]):
        return "fuel"
    if any(w in t for w in ["electricity", "bijli", "solar", "بجلی", "سولر"]):
        return "utility"
    if any(w in t for w in ["wheat", "flour", "atta", "آٹا", "گندم", "ration"]):
        return "grocery"
    if any(w in t for w in ["health", "sehat", "hospital", "صحت", "ہسپتال"]):
        return "health"
    if any(w in t for w in ["education", "scholarship", "hec", "تعلیم"]):
        return "education"
    if any(w in t for w in ["mobile", "load", "internet", "data"]):
        return "mobile"
    return "utility"


def scrape_rss_feed(source_name, url):
    """Fetch and parse one RSS feed, return list of deal dicts."""
    deals = []
    try:
        r = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        if r.status_code != 200:
            return deals
        root = ET.fromstring(r.content)
    except Exception as e:
        log.warning(f"RSS {source_name}: fetch/parse error: {e}")
        return deals

    # Handle both RSS 2.0 (<item>) and Atom (<entry>)
    items = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")

    for item in items[:40]:  # Check top 40 headlines
        # Extract title
        title_el = item.find("title")
        if title_el is None:
            title_el = item.find("{http://www.w3.org/2005/Atom}title")
        if title_el is None or not title_el.text:
            continue
        raw_title = title_el.text.strip()

        # Google News format: "Headline - Source Name"
        source_name_in_title = ""
        if " - " in raw_title:
            parts = raw_title.rsplit(" - ", 1)
            title = parts[0].strip()
            source_name_in_title = parts[1].strip()
        else:
            title = raw_title

        # Extract link
        link_el = item.find("link")
        if link_el is None:
            link_el = item.find("{http://www.w3.org/2005/Atom}link")
        link = ""
        if link_el is not None:
            link = link_el.text.strip() if link_el.text else link_el.get("href", "")

        # Extract description
        desc_el = item.find("description")
        if desc_el is None:
            desc_el = item.find("{http://www.w3.org/2005/Atom}summary")
        desc = ""
        if desc_el is not None and desc_el.text:
            desc = re.sub(r"<[^>]+>", "", desc_el.text).strip()[:300]

        # Extract date
        date_el = item.find("pubDate")
        if date_el is None:
            date_el = item.find("{http://www.w3.org/2005/Atom}published")
        pub_date = date_el.text.strip() if date_el is not None and date_el.text else ""

        # Filter: title must contain a deal signal
        # Hard deal words (subsidy, relief, discount) always pass
        # Soft topic words (petrol, fuel, solar) only pass if no exclude word present
        hard_deal = re.search(r"(subsid|relief|discount|waiv|rebate|cashback|voucher|سبسڈی|ریلیف)", title, re.I)
        soft_topic = re.search(r"(petrol|fuel|bijli|electricity|solar|wheat|flour|atta|پیٹرول|بجلی|سولر|آٹا)", title, re.I)
        if not hard_deal and not soft_topic:
            continue
        if RSS_EXCLUDE.search(title) and not hard_deal:
            continue

        # Build deal
        brand_info = RSS_BRAND.get(source_name, {"id": "news", "name": source_name, "brand_type": "news", "color": "#555"})
        deal_id = f"rss_{hashlib.md5(title.encode()).hexdigest()[:12]}"
        full_text = f"{title} {desc}"
        discount = extract_amount_from_text(full_text)
        category = guess_rss_category(full_text)

        # Use original source name from Google News title if available
        display_source = source_name_in_title or source_name

        # Parse pub date for valid_until (7 days from publication)
        valid_from = datetime.now(timezone(timedelta(hours=5))).strftime("%Y-%m-%d")
        valid_until = (datetime.now(timezone(timedelta(hours=5))) + timedelta(days=7)).strftime("%Y-%m-%d")
        if pub_date:
            try:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(pub_date)
                valid_from = dt.strftime("%Y-%m-%d")
                valid_until = (dt + timedelta(days=7)).strftime("%Y-%m-%d")
            except Exception:
                pass

        deals.append({
            "id": deal_id,
            "brand": brand_info["id"],
            "brand_type": "news",
            "category": category,
            "title": title[:120],
            "summary": desc or title,
            "discount": discount,
            "eligibility": {"payment": ["any"], "merchant": "Government / Public", "user": "any"},
            "cities": ["Nationwide"],
            "valid_from": valid_from,
            "valid_until": valid_until,
            "exclusions": ["Verify details from the linked article before acting"],
            "steps": [f"Read the full article at {link}" if link else "Search for more details online"],
            "source": {
                "type": "news",
                "platform": display_source,
                "url": link,
                "status": "unverified",
                "captured_at": datetime.now(timezone.utc).isoformat(),
            },
            "status": "active",
            "verification": "unverified",
            "confidence": 0.6,
            "community": {"votes": 0, "worked": 0, "failed": 0, "saves": 0, "spotted_by": None, "reports_expired": 0},
            "visual": {"gradient": [brand_info["color"], "#94a3b8"]},
        })

    return deals


def scrape_all_rss():
    """Scrape all RSS feeds concurrently, return merged deal list."""
    log.info("Scraping RSS news feeds for govt/public deals...")
    all_news = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(scrape_rss_feed, name, url): name for name, url in RSS_FEEDS}
        for future in as_completed(futures):
            name = futures[future]
            try:
                deals = future.result()
                all_news.extend(deals)
                if deals:
                    log.info(f"  RSS {name}: {len(deals)} relevant headlines")
            except Exception as e:
                log.warning(f"  RSS {name}: error: {e}")

    # Deduplicate by title similarity
    seen_titles = set()
    unique_news = []
    for d in all_news:
        key = d["title"][:60].lower()
        if key not in seen_titles:
            seen_titles.add(key)
            unique_news.append(d)

    log.info(f"RSS total: {len(unique_news)} unique news deals")
    return unique_news


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
    bank_status = {}  # per-bank health tracking

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
                bank_status.setdefault(name, {"ok": 0, "fail": 0, "deals": 0})
                bank_status[name]["ok"] += 1
                bank_status[name]["deals"] += len(deals)
            except Exception as e:
                log.warning(f"[{completed}/{len(tasks)}] {name}/{city}: {e}")
                bank_status.setdefault(name, {"ok": 0, "fail": 0, "deals": 0})
                bank_status[name]["fail"] += 1

    # Log per-bank health
    for name, st in bank_status.items():
        status = "OK" if st["fail"] == 0 else ("DEGRADED" if st["ok"] > 0 else "DOWN")
        log.info(f"  Bank {name}: {status} ({st['ok']} ok, {st['fail']} fail, {st['deals']} deals)")

    # Write health status file for monitoring
    health = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_deals": len(all_scraped),
        "banks": bank_status,
        "overall": "OK" if all(st["fail"] == 0 for st in bank_status.values()) else
                   ("DEGRADED" if any(st["ok"] > 0 for st in bank_status.values()) else "DOWN")
    }
    (DATA / "health.json").write_text(json.dumps(health, indent=2), encoding="utf-8")
    log.info(f"Health status: {health['overall']}")

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
            combined_ids.add(c["id"])

    # ---- Non-bank deals (Daraz, Foodpanda, Easypaisa, JazzCash, etc.) ----
    # Maintained in nonbank_deals.json next to this script (repo-committed).
    # Same schema as bank deals; scraper merges them into every live_deals.json.
    nonbank = []
    NB_FILE = DATA / "nonbank_deals.json"
    if NB_FILE.exists():
        try:
            nb_data = json.loads(NB_FILE.read_text(encoding="utf-8"))
            for d in nb_data.get("deals", []):
                if d.get("id") and d["id"] not in combined_ids:
                    unique.append(d)
                    combined_ids.add(d["id"])
                    nonbank.append(d)
            log.info(f"Non-bank deals merged: {len(nonbank)}")
        except Exception as e:
            log.warning(f"nonbank_deals.json parse error: {e}")

    # ---- RSS News deals (govt subsidies, public announcements) ----
    news_deals = scrape_all_rss()
    for d in news_deals:
        if d["id"] not in combined_ids:
            unique.append(d)
            combined_ids.add(d["id"])
    log.info(f"News deals merged: {len(news_deals)}")

    # Build brands
    brands = []
    brand_ids = set()
    static_brands = []
    if STATIC.exists():
        try:
            static_brands = json.loads(STATIC.read_text(encoding="utf-8")).get("brands", [])
        except:
            pass

    # Load base64 logos (logos.json at root — makes live_deals.json self-contained)
    LOGOS_FILE = DATA / "logos.json"
    if not LOGOS_FILE.exists():
        LOGOS_FILE = BASE / "logos.json"
    logo_map = {}
    if LOGOS_FILE.exists():
        try:
            logo_map = json.loads(LOGOS_FILE.read_text(encoding="utf-8"))
        except Exception:
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
                    "color": bank_info["color"],
                    "logo": logo_map.get(bid, ""),
                })
            else:
                cb = next((b for b in static_brands if b["id"] == bid), None)
                if cb:
                    # Embed logo as base64 if it's a file reference
                    if cb.get("logo") and not cb["logo"].startswith("data:"):
                        cb = dict(cb)
                        cb["logo"] = logo_map.get(cb["logo"].replace(".png", ""), cb.get("logo", ""))
                    brands.append(cb)
                else:
                    brands.append({"id": bid, "name": bid.replace("_", " ").title(), "brand_type": "brand", "color": "#555", "logo": logo_map.get(bid, "")})

    # Add non-bank brands that didn't appear via a deal (still register their meta)
    if NB_FILE.exists():
        try:
            for nb_b in json.loads(NB_FILE.read_text(encoding="utf-8")).get("brands", []):
                if nb_b.get("id") and nb_b["id"] not in brand_ids:
                    brand_ids.add(nb_b["id"])
                    nb_b = dict(nb_b)
                    if nb_b.get("logo") and not nb_b["logo"].startswith("data:"):
                        nb_b["logo"] = logo_map.get(nb_b["logo"].replace(".png", ""), "")
                    brands.append(nb_b)
        except Exception:
            pass

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
    try:
        run()
    except Exception as e:
        log.error(f"Scraper crashed: {e}")
        # Write a minimal live_deals.json so the pipeline doesn't fully break
        fallback = {
            "meta": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "server_time": datetime.now(timezone.utc).isoformat(),
                "now": datetime.now(timezone(timedelta(hours=5))).isoformat(),
                "source": "fallback",
                "banks_scraped": [],
                "cities_scraped": [],
                "total_deals": 0,
                "error": str(e),
            },
            "brands": [],
            "deals": [],
        }
        try:
            OUT.write_text(json.dumps(fallback, indent=2), encoding="utf-8")
            log.info("Wrote fallback live_deals.json")
        except Exception:
            pass
        sys.exit(0)  # Don't fail the workflow — health check will flag it
