#!/usr/bin/env python3
"""Deterministic integration tests: scraper <-> Shopify adapter (§12, §4 isolation).

No network is used; requests are stubbed. We verify:
  1. a healthy brand feed yields product deals,
  2. a failing brand is isolated (returns [], run continues, other brands survive),
  3. scrape_all_shopify aggregates across brands,
  4. merge into the existing dataset is idempotent and preserves bank deals.
"""
import types
import scraper
from shopify_adapter import SHOPIFY_BRANDS, extract_product_deals, merge_into_dataset

BRAND = SHOPIFY_BRANDS[0]
PASS = FAIL = 0
def check(name, cond):
    global PASS, FAIL
    if cond: PASS += 1
    else: FAIL += 1; print("FAIL:", name)

def v(price, comp, avail=True):
    return {"price": price, "compare_at_price": comp, "available": avail, "title": "M", "sku": "S"}

GOOD_FEED = {"products": [
    {"handle": "shacket", "title": "Shacket", "images": [{"src": "x.jpg"}],
     "variants": [v("2396.00", "5990.00")]},
    {"handle": "bag", "title": "Bag", "images": [], "variants": [v("7990.00", None)]},  # skipped
]}
BAD_FEED = "not-json{{{"  # will raise on .json()

class Resp:
    def __init__(self, payload): self.payload = payload
    def raise_for_status(self): pass
    def json(self):
        if isinstance(self.payload, str): raise ValueError("bad json")
        return self.payload

def make_stub(url_map):
    def _get(url, timeout=None, headers=None):
        if url not in url_map: raise ConnectionError("blocked")
        return Resp(url_map[url])
    return _get

# --- 1. healthy feed -> product deals, full-price excluded ---
scraper.requests = types.SimpleNamespace(get=make_stub({"u": GOOD_FEED}))
deals = scraper.fetch_shopify_brand({**BRAND, "products_url": "u"})
check("healthy brand yields 1 deal (bag skipped)", len(deals) == 1 and deals[0]["offer_type"] == "PRODUCT_DEAL")

# --- 2. failure isolation: exception -> [] ---
scraper.requests = types.SimpleNamespace(get=make_stub({"u": BAD_FEED}))
check("bad json isolated to []", scraper.fetch_shopify_brand({**BRAND, "products_url": "u"}) == [])
scraper.requests = types.SimpleNamespace(get=make_stub({}))  # URL not present -> ConnectionError
check("network error isolated to []", scraper.fetch_shopify_brand({**BRAND, "products_url": "u"}) == [])

# --- 3. aggregate across brands; one failing brand never kills the run ---
scraper.requests = types.SimpleNamespace(get=make_stub({
    SHOPIFY_BRANDS[0]["products_url"]: GOOD_FEED,   # gulahmed ok
    # mariab URL absent -> ConnectionError -> isolated
}))
agg = scraper.scrape_all_shopify()
check("aggregate survives one dead brand", len(agg) == 1 and agg[0]["brand"] == "gulahmed")

# --- 4. idempotent merge into a dataset that already has a bank deal ---
base = {"deals": [{"id": "bank_hbl_1", "title": "HBL 20% off restaurant", "brand": "hbl"}]}
out, added, updated = merge_into_dataset(base, agg)
check("merge adds product deal, keeps bank deal",
      added == 1 and any(d["id"] == "bank_hbl_1" for d in out["deals"]) and len(out["deals"]) == 2)
out2, added2, updated2 = merge_into_dataset(out, agg)
check("re-merge idempotent", added2 == 0 and updated2 == 1 and len(out2["deals"]) == 2)

print(f"\nINTEGRATION TESTS: PASS {PASS} / FAIL {FAIL}")
raise SystemExit(1 if FAIL else 0)
