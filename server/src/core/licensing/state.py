"""In-memory cache of the current instance's license validity.

Populated only by src.core.licensing.service (activate/validate/refresh).
Every read here is synchronous, in-memory, no I/O — the hot path for
require_valid_license() and the status endpoint never makes a network call.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import os

from src.core.deployment_mode import is_self_host_deployment

# Written into images we distribute (Dockerfile.prod LICENSE_REQUIRED=true). A file in the image, not
# an environment variable, because a customer controls their environment: removing the key or
# changing the deployment mode must not switch licensing off.
LICENSE_REQUIRED_MARKER = "/app/.license-required"


def license_required() -> bool:
    return os.path.exists(LICENSE_REQUIRED_MARKER)


@dataclass
class LicenseState:
    is_valid: bool = False
    license_id: str | None = None
    customer_id: str | None = None
    max_users: int | None = None
    features: list[str] = field(default_factory=list)
    expires_at: datetime | None = None
    last_validated_at: datetime | None = None
    last_error: str | None = None
    license_type: str | None = None
    offline: bool = False

    def requires_validation(self) -> bool:
        """True for a distributed image, and for any self-hosted instance with a license set."""
        configured = bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip() or os.getenv("AISER_LICENSE_FILE", "").strip())
        return license_required() or (is_self_host_deployment() and configured)

    def usable(self) -> bool:
        """Valid and not past its end date. The date is checked here too, so blocking the license
        server can't stretch a license past its end."""
        if not self.is_valid:
            return False
        return self.expires_at is None or self.expires_at > datetime.now(timezone.utc)

    def days_left(self) -> int | None:
        if self.expires_at is None:
            return None
        return max(0, (self.expires_at - datetime.now(timezone.utc)).days)

    def update(
        self,
        *,
        is_valid: bool,
        license_id: str | None = None,
        customer_id: str | None = None,
        max_users: int | None = None,
        features: list[str] | None = None,
        expires_at: datetime | None = None,
        last_error: str | None = None,
        license_type: str | None = None,
        offline: bool = False,
    ) -> None:
        self.is_valid = is_valid
        self.license_id = license_id
        self.customer_id = customer_id
        self.max_users = max_users
        self.features = features or []
        self.expires_at = expires_at
        self.last_error = last_error
        self.license_type = license_type
        self.offline = offline
        self.last_validated_at = datetime.now(timezone.utc)

    def mark_unreachable(self, error: str) -> None:
        """Record a failed refresh without changing is_valid — the caller (service.py)
        decides whether the grace period has elapsed before flipping validity."""
        self.last_error = error


state = LicenseState()
