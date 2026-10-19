"""Finding and removing one person's rows, and keeping them out of later runs."""

import pyarrow as pa

from ee.modules.privacy.engine import apply_suppressions, candidate_columns, mask, normalize, remove_rows, spellings

TABLE = pa.table({
    "customer_id": ["C1", "C2", "C3"],
    "Email Address": ["Dara@Acme.com ", "lina@shop.kh", None],
    "mobile": ["+855 12 345 678", "098 765 432", "012-345-678"],
    "amount": [10, 20, 30],
    "_ingested_at": ["t", "t", "t"],
})


def test_normalizing_and_masking():
    assert normalize("email", " Dara@ACME.com") == "dara@acme.com"
    assert normalize("phone", "+855 12 345 678") == normalize("phone", "012-345-678") == "12345678"
    assert mask("email", "dara@acme.com") == "d***@acme.com" and mask("phone", "012345678") == "01***78"


def test_candidate_columns_come_from_names_and_classification():
    assert candidate_columns(TABLE.column_names, "email") == ["Email Address"]
    assert candidate_columns(TABLE.column_names, "phone") == ["mobile"]
    assert candidate_columns(TABLE.column_names, "other", classified=["amount"]) == ["amount"]
    assert "_ingested_at" not in candidate_columns(TABLE.column_names, "other", classified=["_ingested_at"])


def test_remove_rows_across_spellings():
    kept, n = remove_rows(TABLE, ["mobile"], "phone", "12345678")
    assert n == 2 and kept["customer_id"].to_pylist() == ["C2"]
    assert spellings(TABLE, ["Email Address"], "email", "dara@acme.com") == {"Email Address": ["Dara@Acme.com "]}


def test_suppressions_apply_on_later_runs():
    out, removed = apply_suppressions(TABLE, [{"identifier_type": "email", "value": "lina@shop.kh", "columns": ["Email Address"]},
                                             {"identifier_type": "email", "value": "x@y.z", "columns": ["not_here"]}])
    assert removed == 1 and out.num_rows == 2
