"""Deterministic regression tests for the additive offer_type tagging pass.

Covers:
  1. classify_offer_type() rule-by-rule behaviour (R1..R8), first-match-wins.
  2. tag_offers() is ADDITIVE and LOSSLESS: only offer_type is ever added; no
     other field is mutated; no record is removed; already-tagged records keep
     their tag; ambiguous records get NO key at all.
  3. End-to-end on the REAL live_deals.json: all existing offers survive, the
     203 PRODUCT_DEAL records are untouched, news/government stay untagged, and
     the output format is unchanged (same top-level keys, same deal count).
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scraper import classify_offer_type, tag_offers  # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}")


# ---------------------------------------------------------------- rule tests
def deal(payment=None, brand_type=None, category=None, source_type=None, offer_type=None):
    d = {
        "id": "x",
        "eligibility": {"payment": payment or []},
        "brand_type": brand_type,
        "category": category,
        "source": {"type": source_type},
    }
    if offer_type:
        d["offer_type"] = offer_type
    return d


print("classify_offer_type rules:")
# R1 already tagged wins over everything
check("R1 keeps existing tag (product deal)",
      classify_offer_type(deal(offer_type="PRODUCT_DEAL", payment=["visa"])) == "PRODUCT_DEAL")
# R2 news is never an offer
check("R2 source.type=news -> None",
      classify_offer_type(deal(source_type="news", payment=["visa"])) is None)
check("R2 brand_type=news -> None",
      classify_offer_type(deal(brand_type="news")) is None)
# R3 mixed wallet+card = ambiguous
check("R3 wallet+card mixed -> None",
      classify_offer_type(deal(payment=["easypaisa", "visa credit"])) is None)
# R4 wallet
check("R4 easypaisa -> WALLET_OFFER",
      classify_offer_type(deal(payment=["easypaisa"])) == "WALLET_OFFER")
check("R4 jazzcash_app -> WALLET_OFFER",
      classify_offer_type(deal(payment=["jazzcash_app"])) == "WALLET_OFFER")
# R5 card
check("R5 visa credit -> BANK_CARD_OFFER",
      classify_offer_type(deal(payment=["visa credit"])) == "BANK_CARD_OFFER")
check("R5 master debit -> BANK_CARD_OFFER",
      classify_offer_type(deal(payment=["master debit"])) == "BANK_CARD_OFFER")
# 'any' alone is not a card marker
check("R5 'any' payment is not a card hit",
      classify_offer_type(deal(payment=["any"])) is None)
# R6 bank brand_type w/o instrument = ambiguous
check("R6 bank brand, no instrument -> None",
      classify_offer_type(deal(brand_type="bank")) is None)
check("R6 bank brand, payment 'any' -> None",
      classify_offer_type(deal(brand_type="bank", payment=["any"])) is None)
# R7 food promotion (merchant-side, no payment qualifier)
check("R7 food category + any -> FOOD_PROMOTION",
      classify_offer_type(deal(category="food", payment=["any"], brand_type="qsr")) == "FOOD_PROMOTION")
check("R7 food category, empty payment -> FOOD_PROMOTION",
      classify_offer_type(deal(category="food", brand_type="delivery")) == "FOOD_PROMOTION")
# food but with a card instrument should be classified by instrument (R5 wins, R7 needs no/any pay)
check("food+card -> BANK_CARD_OFFER (instrument wins)",
      classify_offer_type(deal(category="food", payment=["visa credit"])) == "BANK_CARD_OFFER")
# R8 everything else untagged
check("R8 grocery w/ any -> None",
      classify_offer_type(deal(category="grocery", payment=["any"], brand_type="retail")) is None)


# ------------------------------------------------------- tag_offers additivity
print("\ntag_offers additive/lossless:")
sample = [
    deal(payment=["easypaisa"], brand_type="wallet"),        # WALLET_OFFER
    deal(payment=["visa credit"], brand_type="bank"),        # BANK_CARD_OFFER
    deal(category="food", brand_type="qsr", payment=["any"]),# FOOD_PROMOTION
    deal(brand_type="bank"),                                 # ambiguous -> untagged
    deal(source_type="news"),                                # news -> untagged
    deal(offer_type="PRODUCT_DEAL", payment=["visa"]),       # preserved
    deal(payment=["easypaisa", "master"]),                   # mixed -> untagged
]
for i, d in enumerate(sample):
    d["id"] = f"s{i}"
    d["title"] = f"t{i}"

before = copy.deepcopy(sample)
tagged, counts = tag_offers(sample)

check("returns tag_count == number newly tagged", tagged == 3)
check("counts correct", counts == {"WALLET_OFFER": 1, "BANK_CARD_OFFER": 1, "FOOD_PROMOTION": 1})
check("no records removed", len(sample) == len(before))

expected_types = {0: "WALLET_OFFER", 1: "BANK_CARD_OFFER", 2: "FOOD_PROMOTION",
                  3: None, 4: None, 5: "PRODUCT_DEAL", 6: None}
for idx, exp in expected_types.items():
    d = sample[idx]
    if exp is None:
        check(f"idx {idx} left untagged (no key)", "offer_type" not in d)
    else:
        check(f"idx {idx} == {exp}", d.get("offer_type") == exp)

# verify nothing but offer_type changed
all_but_type_equal = True
for idx in range(len(sample)):
    a = copy.deepcopy(before[idx]); b = copy.deepcopy(sample[idx])
    a.pop("offer_type", None); b.pop("offer_type", None)
    if a != b:
        all_but_type_equal = False
check("ONLY offer_type field changed on every record", all_but_type_equal)

# idempotent: running again adds nothing further
tagged2, _ = tag_offers(sample)
check("idempotent (second pass tags 0 new)", tagged2 == 0)


# ---------------------------------------------- end-to-end on real live feed
print("\nlive_deals.json end-to-end:")
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_deals.json")
if os.path.exists(path):
    data = json.load(open(path, encoding="utf-8"))
    deals = data["deals"]
    n_before = len(deals)
    product_before = [d for d in deals if d.get("offer_type") == "PRODUCT_DEAL"]
    news_before = [d for d in deals if d.get("source", {}).get("type") == "news" or d.get("brand_type") == "news"]
    frozen = copy.deepcopy(deals)

    tagged, counts = tag_offers(deals)

    check("all offers preserved (count unchanged)", len(deals) == n_before)
    check("PRODUCT_DEAL records untouched",
          all(d.get("offer_type") == "PRODUCT_DEAL" for d in product_before)
          and len([d for d in deals if d.get("offer_type") == "PRODUCT_DEAL"]) == len(product_before))
    check("news records remain untagged",
          all("offer_type" not in d for d in news_before))
    # only offer_type may differ
    lossless = True
    for a, b in zip(frozen, deals):
        if a.get("id") != b.get("id"):
            lossless = False; break
        aa = copy.deepcopy(a); bb = copy.deepcopy(b)
        aa.pop("offer_type", None); bb.pop("offer_type", None)
        if aa != bb:
            lossless = False; break
    check("lossless vs real data (only offer_type added)", lossless)
    # output format keys unchanged
    check("top-level keys unchanged", set(data.keys()) == {"meta", "brands", "deals"})
    print(f"  INFO  tagged {tagged} -> {counts}")
else:
    print("  SKIP  live_deals.json not present")


print(f"\n==== {PASS} passed, {FAIL} failed ====")
sys.exit(1 if FAIL else 0)
