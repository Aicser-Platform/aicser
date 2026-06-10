from typing import Dict, Any
import os
import logging

logger = logging.getLogger(__name__)

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception:
    Fernet = None
    InvalidToken = Exception

# Log ENCRYPTION_KEY warning only once per process to avoid log noise
_encryption_warned = False


def _get_fernet():
    global _encryption_warned
    key = os.getenv("ENCRYPTION_KEY")
    if not key or Fernet is None:
        try:
            from src.core.production import require_encryption_key_in_production

            require_encryption_key_in_production()
        except RuntimeError:
            raise
        except Exception:
            pass
        if not _encryption_warned:
            _encryption_warned = True
            logger.warning(
                "ENCRYPTION_KEY not set or Fernet not available - credentials stored in plain text. "
                "Generate: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" and add to .env."
            )
        return None
    try:
        # ENCRYPTION_KEY should be urlsafe_base64
        return Fernet(key)
    except Exception:
        # SECURITY: Do not log exception message (may contain key material or path).
        if not _encryption_warned:
            _encryption_warned = True
            logger.warning("Invalid ENCRYPTION_KEY; credentials will not be encrypted/decrypted")
        return None


def encrypt_credentials(config: Dict[str, Any]) -> Dict[str, Any]:
    """Encrypt sensitive fields in-place and return a copy.

    Only encrypts known sensitive keys when ENCRYPTION_KEY is available.
    """
    if not isinstance(config, dict):
        return config
    f = _get_fernet()
    if not f:
        return dict(config)

    sensitive = {"password", "api_key", "token", "secret_access_key", "access_key_id", "connection_string", "credentials"}
    out = dict(config)
    for k in list(out.keys()):
        if k in sensitive and out.get(k) not in (None, ""):
            try:
                val = str(out[k]).encode("utf-8")
                out[k] = f.encrypt(val).decode("utf-8")
                out[f"__enc_{k}"] = True
            except Exception:
                logger.exception("Failed to encrypt key %s", k)
    return out


def _looks_like_fernet_token(value: Any) -> bool:
    """True if value looks like a Fernet-encrypted token (e.g. double-encrypted legacy data)."""
    if not value or not isinstance(value, str) or len(value) < 32:
        return False
    try:
        # Fernet tokens are urlsafe_b64; often start with 'gAAAAA' (version 0x80)
        return value.strip().startswith("gAAAAA") or (
            len(value) % 4 == 0 and all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in value.strip())
        )
    except Exception:
        return False


def decrypt_credentials(config: Dict[str, Any]) -> Dict[str, Any]:
    """Decrypt any encrypted sensitive fields when possible and return a copy.
    Handles legacy double-encrypted values (decrypts again if result looks like a Fernet token).
    """
    if not isinstance(config, dict):
        return config
    f = _get_fernet()
    if not f:
        return dict(config)

    out = dict(config)
    for k in list(out.keys()):
        if k.startswith("__enc_"):
            orig = k[len("__enc_"):]
            encval = out.get(orig)
            if encval:
                try:
                    dec = f.decrypt(encval.encode("utf-8")).decode("utf-8")
                    # Legacy: if this was double-encrypted, dec is still a Fernet token
                    if _looks_like_fernet_token(dec):
                        try:
                            dec = f.decrypt(dec.encode("utf-8")).decode("utf-8")
                        except (InvalidToken, Exception):
                            pass
                    out[orig] = dec
                except InvalidToken:
                    logger.warning("Invalid token when decrypting %s", orig)
                except Exception:
                    logger.exception("Failed to decrypt key %s", orig)
            out.pop(k, None)
    return out


