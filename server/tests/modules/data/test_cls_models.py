import os

os.environ["DEBUG"] = "false"
import src.db.registry  # noqa: F401
from src.modules.data.models import (
    DataSourceAccessGrant,
    DataSourceCLSPolicy,
    DataSourceCLSRule,
)


def test_cls_policy_table_and_columns():
    cols = DataSourceCLSPolicy.__table__.columns
    assert DataSourceCLSPolicy.__tablename__ == "data_source_cls_policies"
    for name in ("organization_id", "data_source_id", "name", "description", "enabled", "settings", "created_by"):
        assert name in cols, name


def test_cls_rule_carries_action_and_strategy():
    cols = DataSourceCLSRule.__table__.columns
    assert DataSourceCLSRule.__tablename__ == "data_source_cls_rules"
    for name in ("policy_id", "table_name", "column_name", "action", "mask_strategy", "mask_config", "sort_order"):
        assert name in cols, name


def test_grant_points_at_a_column_policy():
    """A grant carries row and column policies independently."""
    cols = DataSourceAccessGrant.__table__.columns
    assert "cls_policy_id" in cols
    assert cols["cls_policy_id"].nullable is True
