#!/usr/bin/env python3
"""Deterministic fixture tests for the Shopify product-deal adapter (§12)."""
import copy
from shopify_adapter import extract_product_deals, merge_into_dataset, SHOPIFY_BRANDS

BRAND = SHOPIFY_BRANDS[0]
PASS = FAIL = 0
def check(name, cond):
    global PASS, FAIL
    if cond: PASS += 1
    else: FAIL += 1; print("FAIL:", name)

def variant(price, compare, sku="S1", avail=True, title="M"):
    return {"price": price, "compare_at_price": compare, "sku": sku,
            "available": avail, "title": title}
def product(handle, variants, title="Item", images=None):
    return {"handle": handle, "title": title, "variants": variants,
            "images": images or [{"src": "https://cdn/x.jpg"}]}

# 1. Valid product discount (Gul Ahmed real case: 2396 vs 5990 -> 60%)
ds = extract_product_deals(BRAND, {"products": [product("shacket", [variant("2396.00", "5990.00")])]})
check("valid discount emits 1 deal", len(ds) == 1)
check("discount pct = 60", ds and ds[0]["discount"]["value"] == 60)
check("offer_type PRODUCT_DEAL", ds and ds[0]["offer_type"] == "PRODUCT_DEAL")
check("provenance recorded", ds and ds[0]["product"]["reference_provenance"] == "shopify_compare_at_price")
check("source url present", ds and ds[0]["source"]["url"].startswith("https://www.gulahmedshop.com/products/"))
check("expiry NOT invented (empty)", ds and ds[0]["valid_until"] == "")
check("captured_at present", ds and bool(ds[0]["source"]["captured_at"]))

# 2. Full-price product (compare 0.00) -> no deal
check("full-price compare 0.00 skipped", extract_product_deals(BRAND, {"products": [product("a", [variant("60990.00", "0.00")])]}) == [])
# 3. Missing reference price (null) -> no deal
check("null reference skipped", extract_product_deals(BRAND, {"products": [product("b", [variant("7990.00", None)])]}) == [])
# 4. Malformed reference price -> no deal
check("malformed reference skipped", extract_product_deals(BRAND, {"products": [product("c", [variant("100.00", "abc")])]}) == [])
# 5. reference <= current -> no deal (no fake discount)
check("reference below current skipped", extract_product_deals(BRAND, {"products": [product("d", [variant("200.00", "100.00")])]}) == [])
check("reference equal current skipped", extract_product_deals(BRAND, {"products": [product("e", [variant("100.00", "100.00")])]}) == [])
# 6. "Sale" tag alone with no price drop -> no deal (tag is not proof)
p = product("f", [variant("100.00", "0.00")]); p["tags"] = ["Sale"]
check("Sale tag without price drop skipped", extract_product_deals(BRAND, {"products": [p]}) == [])
# 7. zero/negative current -> no deal
check("zero current skipped", extract_product_deals(BRAND, {"products": [product("g", [variant("0.00", "100.00")])]}) == [])

# 8. Dedupe within a run (same handle+sku twice)
ds = extract_product_deals(BRAND, {"products": [product("h", [variant("50.00", "100.00", sku="X")]),
                                                  product("h", [variant("50.00", "100.00", sku="X")])]})
check("duplicate id deduped within run", len(ds) == 1)

# 9. Multiple discounted variants of one product -> ONE honest product card
#    (deepest real drop, "up to" label), never a fabricated brand-wide sale.
ds = extract_product_deals(BRAND, {"products": [product("i", [variant("50.00","100.00",sku="A"),
                                                              variant("60.00","100.00",sku="B")])]})
check("many variants collapse to 1 product card", len(ds) == 1)
card = ds[0]
check("card uses deepest drop (50%)", card["discount"]["value"] == 50)
check("card price is a real variant price (not invented)", card["product"]["price"] == 50.0 and card["product"]["reference_price"] == 100.0)
check("mixed pct -> up_to label", card["product"]["up_to"] is True and "Up to 50% off" in card["title"])
check("id stable regardless of size mix", card["id"] == extract_product_deals(
    BRAND, {"products": [product("i", [variant("50.00","100.00",sku="A")])]})[0]["id"])
# uniform pct across variants -> no "up to" hedge
uni = extract_product_deals(BRAND, {"products": [product("u", [variant("50.00","100.00",sku="A"),
                                                               variant("50.00","100.00",sku="B")])]})
check("uniform pct -> plain label, up_to False",
      len(uni) == 1 and uni[0]["product"]["up_to"] is False and "Up to" not in uni[0]["title"])

# 10. merge_into_dataset: idempotent + preserves existing records
base = {"deals": [{"id": "keep1", "title": "existing bank offer"}]}
new = extract_product_deals(BRAND, {"products": [product("j", [variant("25.00","100.00",sku="K")])]})
out, added, updated = merge_into_dataset(base, new)
check("merge adds new", added == 1 and len(out["deals"]) == 2)
check("merge preserves existing", any(d["id"] == "keep1" for d in out["deals"]))
out2, added2, updated2 = merge_into_dataset(out, new)
check("re-merge is idempotent (0 added)", added2 == 0 and updated2 == 1 and len(out2["deals"]) == 2)

# 11. malformed/empty feed -> no crash, no deals
check("empty feed safe", extract_product_deals(BRAND, {}) == [])
check("no-products key safe", extract_product_deals(BRAND, {"products": []}) == [])

# 12. (live-found case) same pct but different variant PRICES -> card shows the
#     cheapest real price, price_range=True (honest "from Rs Y"), no "up to".
pr = extract_product_deals(BRAND, {"products": [product("bed", [
    variant("3920.00", "5600.00", sku="S"), variant("6160.00", "8800.00", sku="D"),
    variant("6720.00", "9600.00", sku="K")])]})
check("price-range collapses to 1 card", len(pr) == 1)
check("headline shows cheapest real price", pr[0]["product"]["price"] == 3920.0)
check("uniform pct with varied price -> price_range True",
      pr[0]["product"]["price_range"] is True and pr[0]["product"]["up_to"] is False)
check("shown math equals headline pct (no exaggeration)",
      round((1 - pr[0]["product"]["price"] / pr[0]["product"]["reference_price"]) * 100)
      == pr[0]["discount"]["value"])

# 13. availability rollup: card available if ANY discounted variant is in stock.
mixed = extract_product_deals(BRAND, {"products": [product("sock", [
    variant("50.00", "100.00", sku="A", avail=False),
    variant("50.00", "100.00", sku="B", avail=True)])]})
check("card available if any variant in stock", mixed[0]["product"]["available"] is True)

print(f"\nADAPTER TESTS: PASS {PASS} / FAIL {FAIL}")
raise SystemExit(1 if FAIL else 0)
