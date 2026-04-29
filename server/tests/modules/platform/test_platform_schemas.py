"""Lightweight tests for platform policy/catalog contracts."""

from src.modules.platform.schemas import PolicyRuleConfig


def test_policy_rule_config_accepts_camel_case():
    cfg = PolicyRuleConfig.model_validate(
        {
            "resourceType": "data_source",
            "resourceId": "*",
            "effect": "deny",
            "actions": ["read", "ai_analyze"],
        }
    )
    assert cfg.resource_id == "*"
    assert cfg.effect.value == "deny"


def test_policy_rule_config_accepts_snake_case():
    cfg = PolicyRuleConfig.model_validate(
        {
            "resource_type": "global",
            "resource_id": "*",
            "effect": "allow",
            "actions": ["ai_analyze"],
        }
    )
    assert cfg.resource_type == "global"
