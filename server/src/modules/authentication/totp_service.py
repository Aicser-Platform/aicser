"""TOTP (RFC 6238) service for two-factor authentication.

Pure helpers: secret generation, otpauth:// provisioning URIs for
authenticator apps, 6-digit code verification (with the standard +/-1
time-step window for clock drift), and one-time backup codes. No DB access
here -- see src/modules/authentication/service.py for the enrollment/login
flows that call into this module.

Secrets are encrypted at rest with ENCRYPTION_KEY via Fernet -- the same
scheme src/modules/data/utils/credentials.py already uses for data-source
credentials. That helper is dict/allowlist-shaped (keyed on fields like
"password"/"api_key") and lives in the data module, so rather than reaching
across module boundaries this file keeps its own tiny Fernet wrapper against
the same ENCRYPTION_KEY env var -- operators still only manage one key.
"""

from __future__ import annotations

import logging
import os
import secrets
from typing import List, Optional, Tuple

import pyotp

logger = logging.getLogger(__name__)

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception:  # pragma: no cover - cryptography is a hard dependency in practice
    Fernet = None  # type: ignore
    InvalidToken = Exception  # type: ignore

ISSUER = "Aicser"

# Backup-code alphabet excludes visually ambiguous characters (0/O, 1/I).
_BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _get_fernet():
    """Return a Fernet instance for encrypting/decrypting TOTP secrets.

    No plaintext fallback: encryption is required in every environment.
    ENCRYPTION_KEY is already a hard requirement in production (see
    src/core/production.py), so this only fails loudly in a misconfigured
    dev/self-host setup.
    """
    key = os.getenv("ENCRYPTION_KEY")
    if not key or Fernet is None:
        raise RuntimeError(
            "ENCRYPTION_KEY is not set (or the 'cryptography' package is unavailable). "
            "TOTP secrets cannot be encrypted at rest without it. Generate one with: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "and set it as ENCRYPTION_KEY."
        )
    try:
        return Fernet(key)
    except Exception:
        raise RuntimeError(
            "ENCRYPTION_KEY is set but invalid; TOTP secrets cannot be encrypted/decrypted."
        ) from None


def generate_secret() -> str:
    """A fresh random base32 TOTP secret (pyotp default: 160-bit)."""
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> Optional[str]:
    if not encrypted:
        return None
    try:
        return _get_fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("Invalid token when decrypting a TOTP secret")
        return None
    except Exception:
        logger.exception("Failed to decrypt TOTP secret")
        return None


def build_provisioning_uri(secret: str, account_label: str, issuer: str = ISSUER) -> str:
    """Standard otpauth://totp/... URI, renderable as a QR code by any authenticator app."""
    return pyotp.totp.TOTP(secret).provisioning_uri(name=account_label, issuer_name=issuer)


def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a submitted 6-digit code against *secret*, allowing +/-1 time step (~30s) of drift."""
    if not secret or not code:
        return False
    normalized = code.strip().replace(" ", "")
    if not normalized.isdigit() or len(normalized) != 6:
        return False
    try:
        return bool(pyotp.TOTP(secret).verify(normalized, valid_window=1))
    except Exception:
        logger.exception("TOTP verification raised unexpectedly")
        return False


def normalize_backup_code(code: str) -> str:
    """Strip formatting so 'ab12-cd34', 'AB12CD34', and 'ab12 cd34' all compare equal."""
    return (code or "").strip().upper().replace(" ", "").replace("-", "")


def generate_backup_codes(count: int = 10) -> List[str]:
    """Fresh one-time backup codes, formatted for display (e.g. 'AB12-CD34'). Caller hashes
    (via normalize_backup_code + the app's password hasher) before persisting -- these plaintext
    values are meant to be shown to the user exactly once."""
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(_BACKUP_CODE_ALPHABET) for _ in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes


def verify_and_consume_backup_code(hashed_codes: List[str], submitted: str) -> Tuple[bool, List[str]]:
    """Check *submitted* against the stored hashed backup codes.

    Backup codes are single-use: on a match the consumed hash is removed from
    the returned list. Uses the same password hasher as the rest of auth
    (src.modules.authentication.service.verify_password / hash_password).
    """
    from src.modules.authentication.service import verify_password

    if not hashed_codes or not submitted:
        return False, list(hashed_codes or [])
    normalized = normalize_backup_code(submitted)
    if not normalized:
        return False, list(hashed_codes)
    remaining = list(hashed_codes)
    for hashed in hashed_codes:
        try:
            if verify_password(normalized, hashed):
                remaining.remove(hashed)
                return True, remaining
        except Exception:
            continue
    return False, remaining
