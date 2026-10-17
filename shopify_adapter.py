#!/usr/bin/env python3
"""
DealRadar PK — Shopify product-deal source adapter.

Purpose (per MASTER IMPLEMENTATION PROMPT §4/§5/§6A):
  Ingest a brand's public Shopify /products.json feed and emit ONLY genuine,
  verified product-level price reductions as offers, using the EXISTING
  deal schema. Product deals are one offer type, not the whole product.

Hard rules enforced here (no fabrication):
  - A deal is emitted ONLY when both a valid current price and a valid
    reference (compare_at) price exist AND reference > current > 0.
  - discountPercent = round((1 - current / reference) * 100).
  - A "Sale" tag alone is NOT proof of a discount -> ignored for math.
  - Missing / zero / malformed reference price -> NOT a deal (skipped).
  - Expiry is NOT invented: product feeds rarely carry it, so valid_until
    stays "" (the app treats no-expiry active deals as "no countdown").
  - We do NOT infer a brand-wide campaign from discounted products.
  - Provenance (source url, captured_at, reference-price origin) is recorded.

This module is pure and network-free: feed it parsed JSON, get deals back.
A thin fetch() helper is provided for the live poller, but tests use fixtures.
"""
from __future__ import annotations
import hashlib
import json
import re
from datetime import datetime, timezone

# ---- Brand config: which stores we poll and how to label their offers ----
# category/brand_type/color keep parity with the existing dataset vocabulary.
SHOPIFY_BRANDS = [
    {
        "id": "gulahmed", "name": "Gul Ahmed", "category": "fashion",
        "brand_type": "retail", "color": "#8e44ad",
        "products_url": "https://www.gulahmedshop.com/products.json?limit=250",
        "site": "https://www.gulahmedshop.com",
    },
    {
        "id": "mariab", "name": "Maria.B", "category": "fashion",
        "brand_type": "retail", "color": "#c0392b",
        "products_url": "https://mariab.pk/products.json?limit=250",
        "site": "https://mariab.pk",
    },
]


def _to_float(v):
    """Parse a Shopify price string ('2396.00') to float; None if not valid."""
    if v is None:
        return None
    try:
        s = re.sub(r"[^0-9.]", "", str(v))
        if s in ("", "."):
            return None
        f = float(s)
        return f if f > 0 else None
    except (ValueError, TypeError):
        return None


def _deal_id(brand_id, handle, sku):
    raw = f"sg:{brand_id}:{handle}:{sku or ''}"
    return "sg" + hashlib.sha1(raw.encode()).hexdigest()[:10]


def _canonical_offer(brand, product, variant, current, reference, pct, available, up_to, price_range):
    """Emit one offer dict (ONE per product) in the EXISTING schema + additive fields."""
    title = product.get("title", "").strip() or "Item"
    handle = product.get("handle", "")
    img = ""
    if product.get("images"):
        img = product["images"][0].get("src", "")
    product_url = f"{brand['site']}/products/{handle}" if handle else brand["site"]
    now = datetime.now(timezone.utc).isoformat()
    pct_label = f"Up to {pct}% off" if up_to else f"{pct}% off"

    return {
        # ---- existing schema fields (so the current app renders it as-is) ----
        "id": _deal_id(brand["id"], handle, ""),
        "brand": brand["id"],
        "brand_type": brand["brand_type"],
        "category": brand["category"],
        "title": f"{pct_label} {title} at {brand['name']}",
        "summary": f"{title} reduced from Rs {int(reference):,} to Rs {int(current):,} at {brand['name']}.",
        "discount": {"kind": "percent", "value": pct, "cap": None},
        "eligibility": {"payment": ["any"], "user": "any", "min_spend": None},
        "cities": ["All Pakistan"],
        "valid_from": now[:10],
        "valid_until": "",                       # NOT invented
        "exclusions": [],
        "steps": [
            f"Open the product at {brand['name']}",
            "The discounted price is applied automatically",
            "Terms shown on the product page apply",
        ],
        "source": {
            "type": "official",
            "platform": "shopify_products_json",
            "url": product_url,
            "status": "verified",
            "captured_at": now,
        },
        "status": "active",
        "verification": "verified",
        "confidence": 0.85,
        "community": {"votes": 0, "worked": 0, "failed": 0, "saves": 0,
                      "spotted_by": None, "reports_expired": 0},
        "visual": {"gradient": [brand["color"], "#1a1e2a"]},
        "merchant_info": {"logo": None},
        # ---- additive fields: offer-first model + product provenance ----
        "offer_type": "PRODUCT_DEAL",
        "scope": "selected_product",
        "product": {
            "title": title,
            "url": product_url,
            "image": img,
            "variant": variant.get("title"),
            "available": bool(available),
            "up_to": bool(up_to),
            "price_range": bool(price_range),
            "price": current,
            "reference_price": reference,
            "currency": "PKR",
            "reference_provenance": "shopify_compare_at_price",
        },
        "last_fetched_at": now,
        "last_verified_at": now,
    }


def extract_product_deals(brand, products_json):
    """Pure: parsed /products.json -> ONE offer per discounted product.

    Honest rollup. A product's discounted variants may differ by PRICE (sizes/
    styles priced differently) and/or by DROP PERCENTAGE. We emit a single card
    that never exaggerates:
      * headline discount = the DEEPEST real drop among discounted variants;
      * displayed price/reference = a variant that genuinely has that drop and
        the lowest such price (so shown math always equals the headline pct);
      * "Up to X%" label when the drop varies; "from Rs Y" hint when price varies.
    Nothing is invented: a product with no variant whose reference > current > 0
    is skipped entirely, and expiry/terms are never fabricated.
    """
    deals = []
    seen = set()
    for product in products_json.get("products", []):
        handle = product.get("handle", "")
        options = []  # (pct, current, reference, variant)
        for variant in product.get("variants", []):
            current = _to_float(variant.get("price"))
            reference = _to_float(variant.get("compare_at_price"))
            if not current or not reference or reference <= current:
                continue
            pct = round((1 - current / reference) * 100)
            if pct <= 0:
                continue
            options.append((pct, current, reference, variant))
        if not options:
            continue
        max_pct = max(o[0] for o in options)
        # A variant that actually carries the headline discount, cheapest first.
        pct, current, reference, variant = min(
            (o for o in options if o[0] == max_pct), key=lambda o: o[1])
        available = any(o[3].get("available", True) for o in options)
        up_to = len({o[0] for o in options}) > 1
        price_range = len({o[1] for o in options}) > 1
        offer = _canonical_offer(brand, product, variant, current, reference, pct,
                                 available, up_to, price_range)
        if offer["id"] in seen:          # dedupe across products within a run
            continue
        seen.add(offer["id"])
        deals.append(offer)
    return deals


def merge_into_dataset(existing_dataset, new_deals):
    """Idempotent merge by id; preserves everything already present."""
    by_id = {d["id"]: d for d in existing_dataset.get("deals", [])}
    added = updated = 0
    for nd in new_deals:
        if nd["id"] in by_id:
            by_id[nd["id"]] = {**by_id[nd["id"]], **nd}
            updated += 1
        else:
            by_id[nd["id"]] = nd
            added += 1
    out = dict(existing_dataset)
    out["deals"] = list(by_id.values())
    return out, added, updated


if __name__ == "__main__":
    import sys, urllib.request
    # tiny live runner for manual checks: python3 shopify_adapter.py live
    if len(sys.argv) > 1 and sys.argv[1] == "live":
        all_deals = []
        for b in SHOPIFY_BRANDS:
            req = urllib.request.Request(b["products_url"], headers={"User-Agent": "Mozilla/5.0"})
            try:
                data = json.loads(urllib.request.urlopen(req, timeout=25).read())
                ds = extract_product_deals(b, data)
                print(f"{b['name']}: {len(ds)} discounted products")
                all_deals += ds
            except Exception as e:
                print(f"{b['name']}: FETCH FAILED (source stays disabled, pipeline continues): {e}")
        print("TOTAL product deals:", len(all_deals))
    else:
        print("usage: python3 shopify_adapter.py live")
