"""Restricted metric-filter parser + SQL materialization helpers."""

import pytest

from ee.modules.semantic.filters import (
    FilterParseError,
    ParsedFilter,
    agg_sql,
    clean_map_to_case,
    filter_to_sql,
    filters_to_case_agg,
    parse_filter,
)


# ── parsing ──────────────────────────────────────────────────────────────────

def test_parse_string_inequality():
    f = parse_filter("status != 'refunded'")
    assert f == ParsedFilter(field="status", op="!=", value="refunded")


def test_parse_numeric_comparison():
    f = parse_filter("amount_usd >= 100.5")
    assert f.op == ">=" and f.value == 100.5


def test_parse_boolean():
    assert parse_filter("is_active = true").value is True


def test_parse_in_list():
    f = parse_filter("country IN ('KH', 'TH')")
    assert f.op == "IN" and f.value == ["KH", "TH"]


def test_parse_like():
    f = parse_filter("name LIKE '%corp%'")
    assert f.op == "LIKE" and f.value == "%corp%"


@pytest.mark.parametrize(
    "bad",
    [
        "status = 'a' OR 1=1",                      # boolean connector
        "status = (SELECT 1)",                       # subquery
        "status = 'a'; DROP TABLE x",                # statement separator
        "status = refunded",                         # unquoted string
        "status ~ 'x'",                              # unknown operator
        "lower(status) = 'a'",                       # function call on field
        "status",                                    # no operator
    ],
)
def test_rejects_unsafe_filters(bad):
    with pytest.raises(FilterParseError):
        parse_filter(bad)


def test_reject_message_is_readable():
    with pytest.raises(FilterParseError, match="filter"):
        parse_filter("status = refunded")


# ── SQL materialization ──────────────────────────────────────────────────────

def test_filter_to_sql_escapes_quotes():
    f = parse_filter("note = 'it''s fine'")
    assert filter_to_sql(f) == "note = 'it''s fine'"


def test_injection_value_stays_a_literal():
    f = ParsedFilter(field="country", op="=", value="KH'); DROP TABLE x;--")
    assert filter_to_sql(f) == "country = 'KH''); DROP TABLE x;--'"


def test_filters_to_case_agg_sum():
    fs = [parse_filter("status != 'refunded'")]
    assert (
        filters_to_case_agg("sum", "amount_usd", fs)
        == "SUM(CASE WHEN status != 'refunded' THEN amount_usd END)"
    )


def test_filters_to_case_agg_multiple_conditions_anded():
    fs = [parse_filter("status = 'paid'"), parse_filter("amount_usd > 0")]
    assert (
        filters_to_case_agg("sum", "amount_usd", fs)
        == "SUM(CASE WHEN status = 'paid' AND amount_usd > 0 THEN amount_usd END)"
    )


def test_filters_to_case_agg_count():
    fs = [parse_filter("status = 'refunded'")]
    assert (
        filters_to_case_agg("count", "order_id", fs)
        == "COUNT(CASE WHEN status = 'refunded' THEN 1 END)"
    )


def test_filters_to_case_agg_count_distinct():
    fs = [parse_filter("status = 'refunded'")]
    assert (
        filters_to_case_agg("count_distinct", "customer_id", fs)
        == "COUNT(DISTINCT CASE WHEN status = 'refunded' THEN customer_id END)"
    )


def test_agg_sql_plain():
    assert agg_sql("sum", "amount_usd") == "SUM(amount_usd)"
    assert agg_sql("count", "order_id") == "COUNT(*)"
    assert agg_sql("count_distinct", "customer_id") == "COUNT(DISTINCT customer_id)"


def test_clean_map_to_case():
    assert (
        clean_map_to_case("ship_country", {"KH": "Cambodia", "TH": "Thailand"})
        == "CASE ship_country WHEN 'KH' THEN 'Cambodia' WHEN 'TH' THEN 'Thailand' "
        "ELSE ship_country END"
    )
