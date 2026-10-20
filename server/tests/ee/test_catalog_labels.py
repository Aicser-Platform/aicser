"""Sensitivity labels and the organization's label policies (mask every email, deny restricted…)."""

import asyncio
import os

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")

SCHEMA = {"tables": [{"name": "customers", "columns": [
    {"name": "id"}, {"name": "customerEmail"}, {"name": "card_number"}, {"name": "shipping_city"},
    {"name": "business_unit"}, {"name": "hotel_name"}, {"name": "client_ip"},
]}]}


def test_detection_reads_whole_words():
    from ee.modules.catalog.labels import detected_labels

    found = {col: v["classes"] for (_t, col), v in detected_labels(SCHEMA).items()}
    assert found["customeremail"] == ["email"] and found["card_number"] == ["credit_card"]
    assert found["client_ip"] == ["ip_address"]
    # Substrings are not words: shipping has "ip", business "sin", hotel "tel".
    assert "shipping_city" not in found and "business_unit" not in found
    assert detected_labels(SCHEMA)[("customers", "card_number")]["sensitivity"] == "restricted"


def test_a_stewards_word_wins_including_nothing_sensitive():
    from ee.modules.catalog.labels import effective_labels

    schema = {**SCHEMA, "business_metadata": {"column_labels": {
        "customers.client_ip": {"classes": [], "sensitivity": "public"},          # reviewed: not sensitive
        "customers.hotel_name": {"classes": ["location"], "sensitivity": "internal"},
    }}}
    labels = effective_labels(schema)
    assert ("customers", "client_ip") not in labels
    assert labels[("customers", "hotel_name")]["source"] == "steward"
    assert labels[("customers", "customeremail")]["source"] == "detected"


def test_policies_validate_and_decide_with_exemptions():
    from ee.modules.catalog.labels import decisions_for_labels, effective_labels, validate_label_policy

    with pytest.raises(ValueError):
        validate_label_policy({"action": "mask"})
    with pytest.raises(ValueError):
        validate_label_policy({"match_class": "email", "action": "mask", "strategy": "rot13"})
    mask_email = validate_label_policy({"match_class": "email", "action": "mask", "strategy": "hash", "exempt_roles": ["Admin"]})
    deny_restricted = validate_label_policy({"match_sensitivity": "restricted", "action": "deny"})
    labels = effective_labels(SCHEMA)

    analyst = decisions_for_labels(labels, [mask_email, deny_restricted], roles={"analyst"})
    assert analyst[("customers", "customeremail")].action == "mask"
    assert analyst[("customers", "card_number")].action == "deny"

    admin = decisions_for_labels(labels, [mask_email, deny_restricted], roles={"admin"})
    assert ("customers", "customeremail") not in admin  # exempt from the email rule
    assert admin[("customers", "card_number")].action == "deny"  # not exempt from the other

    export = decisions_for_labels(labels, [mask_email], roles=None)
    assert export[("customers", "customeremail")].action == "mask"  # nobody is exempt in an export


def test_sensitivity_matches_that_level_and_above():
    from ee.modules.catalog.labels import _matches

    policy = {"match_sensitivity": "confidential"}
    assert _matches(policy, {"sensitivity": "restricted"}) and _matches(policy, {"sensitivity": "confidential"})
    assert not _matches(policy, {"sensitivity": "internal"})


def test_label_policies_reach_column_enforcement(monkeypatch):
    """A label policy masks a column through the same enforcement as column policies."""
    from ee.modules.catalog import labels
    from ee.modules.data.services import data_source_cls_enforcement_service as cls
    from ee.modules.data.services.cls_rule_resolver import ColumnDecision

    async def no_grants(**_kw):
        return {}

    async def label_rule(_session, **_kw):
        return {("customers", "customeremail"): ColumnDecision("mask", "hash")}

    monkeypatch.setattr(cls.DataSourceCLSEnforcementService, "_grant_decisions_for", staticmethod(no_grants))
    monkeypatch.setattr(labels, "label_decisions", label_rule)
    got = asyncio.run(cls.DataSourceCLSEnforcementService._decisions_for(user_id="u", data_source_id="ds", project_id=None, session=None))
    assert got == {("customers", "customeremail"): ColumnDecision("mask", "hash")}
