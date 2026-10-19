import pytest

from src.modules.pipeline.lakehouse_settings import (
    _validate_template,
    lakehouse_settings_from_org,
    merge_movement_policy,
)


def test_validate_template_requires_placeholders():
    assert _validate_template("orgs/{org_id}/{layer}/") == "orgs/{org_id}/{layer}/"
    with pytest.raises(ValueError):
        _validate_template("bronze/")


def test_lakehouse_settings_from_org_defaults():
    s = lakehouse_settings_from_org({})
    assert "{org_id}" in s["object_prefix_template"]
    assert s["openlineage_export_enabled"] is True


def test_merge_movement_policy():
    opts = merge_movement_policy({}, {"bronze_retention_days": 30, "compaction_mode": "manual"})
    assert opts["movement_policy"]["bronze_retention_days"] == 30
