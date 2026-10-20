"""Match and merge across sources, with survivorship and steward decisions."""

import pyarrow as pa

from ee.modules.master_data.matching import Rule, Survivorship, master_id, match

RECORDS = pa.table({
    "_source": ["crm", "crm", "billing", "billing", "shop"],
    "_record_id": ["1", "2", "A7", "A9", "x1"],
    "name": ["Sok Dara", "Lina Chan", "SOK DARA ", "Lina Chann", "Vanna Kim"],
    "email": ["dara@acme.com", None, "Dara@Acme.com", "lina@shop.kh", "vanna@kim.kh"],
    "city": ["Phnom Penh", "Siem Reap", "Phnom Penh", "Siem Reap", "Battambang"],
    "phone": [None, "012 345 678", "+855 12 345 678", None, None],
})


def test_exact_email_merges_across_sources_and_keeps_the_most_complete_values():
    out = match(RECORDS, [Rule(["email"])])
    assert out["stats"]["records"] == 5 and out["stats"]["masters"] == 4
    dara = next(g for g in out["golden"] if g["email"] and "dara" in g["email"].lower())
    assert dara["source_records"] == 2 and dara["phone"] == "+855 12 345 678"
    xw = [c for c in out["crosswalk"] if c["master_id"] == dara["master_id"]]
    assert {(c["source"], c["record_id"]) for c in xw} == {("crm", "1"), ("billing", "A7")}


def test_fuzzy_names_in_the_same_city_match_and_near_misses_go_to_review():
    strict = match(RECORDS, [Rule(["name", "city"], "fuzzy", threshold=0.99)])
    assert strict["stats"]["masters"] == 4  # "Sok Dara" = "SOK DARA " after normalizing
    assert any({tuple(r["a"]), tuple(r["b"])} == {("crm", "2"), ("billing", "A9")} for r in strict["review"])
    loose = match(RECORDS, [Rule(["name", "city"], "fuzzy", threshold=0.9)])
    assert loose["stats"]["masters"] == 3 and not loose["review"]


def test_steward_decisions_override_the_rules():
    keep_apart = [{"a": ["crm", "1"], "b": ["billing", "A7"], "decision": "different"}]
    assert match(RECORDS, [Rule(["email"])], decisions=keep_apart)["stats"]["masters"] == 5
    merge = [{"a": ["crm", "2"], "b": ["billing", "A9"], "decision": "same"}]
    out = match(RECORDS, [Rule(["name", "city"], "fuzzy", threshold=0.99)], decisions=merge)
    assert out["stats"]["masters"] == 3 and not out["review"]


def test_source_priority_and_stable_ids():
    out = match(RECORDS, [Rule(["email"])], survivorship=Survivorship("source_priority", ["crm", "billing"]))
    dara = next(g for g in out["golden"] if g["source_records"] == 2)
    assert dara["name"] == "Sok Dara"
    assert dara["master_id"] == master_id([("crm", "1"), ("billing", "A7")])
