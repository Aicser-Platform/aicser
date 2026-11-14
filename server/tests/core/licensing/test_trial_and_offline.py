"""Licensing a distributed image: it can't be switched off, and an air-gapped site can use a file."""
import base64
import datetime as dt
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from src.core.licensing import service, state as state_module, verify

PRIVATE = Ed25519PrivateKey.generate()
OTHER = Ed25519PrivateKey.generate()


def _pem(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def _token(key=PRIVATE, **claims) -> str:
    ends = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
    body = {"license_id": "lic-1", "customer_id": "c-1", "features": ["*"], "instance_id": "*", "offline": True,
            "max_users": 25, "license_type": "trial", "license_expires_at": ends.isoformat(), "exp": int(ends.timestamp())}
    return jwt.encode({**body, **claims}, key, algorithm="EdDSA")


@pytest.fixture
def public_key(tmp_path, monkeypatch):
    path = tmp_path / "key.pem"
    path.write_bytes(_pem(PRIVATE))
    monkeypatch.setattr(verify, "PUBLIC_KEY_PATH", str(path))


def test_removing_the_key_does_not_switch_licensing_off(monkeypatch, tmp_path):
    marker = tmp_path / "marker"
    marker.touch()
    monkeypatch.setattr(state_module, "LICENSE_REQUIRED_MARKER", str(marker))
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    assert state_module.state.requires_validation() is True


def test_our_own_cloud_and_development_are_unaffected(monkeypatch):
    monkeypatch.setattr(state_module, "LICENSE_REQUIRED_MARKER", "/nonexistent")
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    monkeypatch.delenv("AISER_LICENSE_FILE", raising=False)
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    assert state_module.state.requires_validation() is False


def test_a_valid_file_passes(public_key):
    assert verify.verify_license_file(_token(), "any-instance")["license_id"] == "lic-1"


def test_a_file_bound_to_this_installation_passes(public_key):
    assert verify.verify_license_file(_token(instance_id="i-1"), "i-1")


@pytest.mark.parametrize("token,why", [
    (lambda: _token(key=OTHER), "signature"),
    (lambda: _token(instance_id="someone-else"), "another installation"),
    (lambda: _token(offline=False), "not an offline"),
    (lambda: _token(exp=int(dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc).timestamp())), "expired"),
])
def test_bad_files_are_refused(public_key, token, why):
    with pytest.raises(verify.EntitlementTokenError) as refused:
        verify.verify_license_file(token(), "i-1")
    assert why in str(refused.value).lower()


def test_an_image_without_the_key_cant_accept_files(monkeypatch):
    monkeypatch.setattr(verify, "PUBLIC_KEY_PATH", "/nonexistent")
    with pytest.raises(verify.EntitlementTokenError):
        verify.verify_license_file(_token(), "i-1")


def test_a_refusal_is_not_an_outage():
    assert service._refused(SimpleNamespace(status_code=403)) is True
    assert service._refused(SimpleNamespace(status_code=502)) is False
    assert service._refused(Exception("timeout")) is False


async def test_usage_counts_are_for_trials_and_can_be_turned_off(monkeypatch):
    class Db:
        async def execute(self, *_):
            return SimpleNamespace(scalar=lambda: 7)

    state_module.state.update(is_valid=True, license_type="standard")
    assert await service._usage_counts(Db()) is None
    state_module.state.update(is_valid=True, license_type="trial")
    assert await service._usage_counts(Db()) == {"users": 7, "data_sources": 7, "dashboards": 7, "questions": 7}
    monkeypatch.setenv("AISER_LICENSE_USAGE_SIGNAL", "false")
    assert await service._usage_counts(Db()) is None
    state_module.state.update(is_valid=False)
