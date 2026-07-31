"""Tests for the in-memory LicenseState cache."""
from src.core.licensing.state import LicenseState


def test_requires_validation_false_when_no_key(monkeypatch):
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    st = LicenseState()
    assert st.requires_validation() is False


def test_requires_validation_false_when_not_self_host(monkeypatch):
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "AICSER-ENT-AAAA-BBBB-CCCC-DDDD")
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    st = LicenseState()
    assert st.requires_validation() is False


def test_requires_validation_true_when_both(monkeypatch):
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "AICSER-ENT-AAAA-BBBB-CCCC-DDDD")
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    st = LicenseState()
    assert st.requires_validation() is True


def test_update_sets_fields_and_last_validated_at():
    st = LicenseState()
    assert st.last_validated_at is None
    st.update(is_valid=True, license_id="lic-1", customer_id="cust-1", max_users=30, features=["sso"], expires_at=None)
    assert st.is_valid is True
    assert st.license_id == "lic-1"
    assert st.customer_id == "cust-1"
    assert st.max_users == 30
    assert st.features == ["sso"]
    assert st.last_error is None
    assert st.last_validated_at is not None


def test_mark_unreachable_sets_error_without_changing_is_valid():
    st = LicenseState()
    st.update(is_valid=True, license_id="lic-1", customer_id="cust-1", features=[], expires_at=None)
    st.mark_unreachable("connection refused")
    assert st.is_valid is True
    assert st.last_error == "connection refused"
