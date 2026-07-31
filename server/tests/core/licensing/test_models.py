"""Tests for the LicenseStateRecord model — column presence only (persistence is
covered end-to-end by Task 6's service tests against the real test DB)."""
from src.core.licensing.models import LicenseStateRecord


def test_tablename():
    assert LicenseStateRecord.__tablename__ == "license_state"


def test_expected_columns_present():
    columns = {c.name for c in LicenseStateRecord.__table__.columns}
    expected = {
        "id",
        "created_at",
        "updated_at",
        "instance_id",
        "license_id",
        "entitlement_token",
        "is_valid",
        "customer_id",
        "max_users",
        "features",
        "expires_at",
        "last_validated_at",
        "last_error",
    }
    assert expected.issubset(columns)


def test_instance_id_is_unique():
    col = LicenseStateRecord.__table__.columns["instance_id"]
    assert col.unique is True
    assert col.nullable is False
