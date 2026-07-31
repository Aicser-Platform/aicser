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

    def requires_validation(self) -> bool:
        """True only when this instance is both self-hosted and has a license key."""
        return is_self_host_deployment() and bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())

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
    ) -> None:
        self.is_valid = is_valid
        self.license_id = license_id
        self.customer_id = customer_id
        self.max_users = max_users
        self.features = features or []
        self.expires_at = expires_at
        self.last_error = last_error
        self.last_validated_at = datetime.now(timezone.utc)

    def mark_unreachable(self, error: str) -> None:
        """Record a failed refresh without changing is_valid — the caller (service.py)
        decides whether the grace period has elapsed before flipping validity."""
        self.last_error = error


state = LicenseState()
