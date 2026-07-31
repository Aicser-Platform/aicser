"""Orchestrates activation, validation, and periodic refresh — the only
module in src/core/licensing/ that touches the database or the state singleton."""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import logging
import socket
import uuid

from sqlalchemy import select

from src.core.config import get_settings
from src.core.licensing import client, verify
from src.core.licensing.models import LicenseStateRecord
from src.core.licensing.state import state
from src.db.session import async_session

logger = logging.getLogger(__name__)


def _coerce_max_users(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value != 0 else None
    if isinstance(value, float) and value.is_integer():
        int_value = int(value)
        return int_value if int_value != 0 else None
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("", "none", "null", "unset"):
            return None
        if normalized in ("unlimited", "infinite", "infinity"):
            return -1
        try:
            int_value = int(normalized)
        except ValueError:
            return None
        return int_value if int_value != 0 else None
    return None


def _fingerprint(instance_id: str) -> str:
    raw = f"{instance_id}:{socket.gethostname()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_claim_datetime(value: object) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    return dt.datetime.fromisoformat(value)


async def _get_or_create_row(db) -> LicenseStateRecord:
    result = await db.execute(select(LicenseStateRecord).limit(1))
    row = result.scalars().first()
    if row is not None:
        return row
    row = LicenseStateRecord(instance_id=str(uuid.uuid4()), is_valid=False)
    db.add(row)
    await db.flush()
    return row


async def _apply_result(db, row: LicenseStateRecord, result: client.ActivationResult) -> None:
    claims = await verify.verify_entitlement_token(result.entitlement_token)
    row.license_id = claims["license_id"]
    row.entitlement_token = result.entitlement_token
    row.is_valid = True
    row.customer_id = claims["customer_id"]
    row.max_users = (
        _coerce_max_users(claims.get("max_users"))
        or _coerce_max_users(result.max_users)
        or row.max_users
    )
    row.features = claims.get("features", [])
    row.expires_at = result.license_expires_at or _parse_claim_datetime(
        claims.get("license_expires_at")
    )
    row.last_validated_at = dt.datetime.now(dt.timezone.utc)
    row.last_error = None
    await db.commit()

    state.update(
        is_valid=True,
        license_id=row.license_id,
        customer_id=row.customer_id,
        max_users=row.max_users,
        features=row.features,
        expires_at=row.expires_at,
    )


async def _handle_bootstrap_failure(db, row: LicenseStateRecord, exc: Exception) -> None:
    """bootstrap()'s failure path. Anchored on the row's *persisted*
    last_validated_at rather than the in-memory state — state always starts
    blank on every process restart, so using it here would either grant an
    unbounded grace period (None treated as "just validated") or, if left
    unset, immediately lock out an instance that's simply mid-restart during
    a brief outage. Only a row that has never been successfully validated
    gets no grace period at all — there's nothing to be lenient about."""
    error = str(exc)
    row.last_error = error
    reference = row.last_validated_at
    grace_deadline = (
        reference + dt.timedelta(days=get_settings().LICENSE_GRACE_PERIOD_DAYS) if reference else None
    )

    if grace_deadline is not None and dt.datetime.now(dt.timezone.utc) <= grace_deadline:
        await db.commit()
        # row.is_valid is untouched — still whatever it was persisted as.
        # Restore in-memory state from it, since state has no memory of its
        # own yet this process.
        state.is_valid = row.is_valid
        state.license_id = row.license_id
        state.customer_id = row.customer_id
        state.max_users = row.max_users
        state.features = row.features or []
        state.expires_at = row.expires_at
        state.last_validated_at = row.last_validated_at
        state.mark_unreachable(error)
        logger.warning("License validation failed at startup, within grace period: %s", error)
    else:
        row.is_valid = False
        await db.commit()
        state.update(is_valid=False, last_error=error)
        logger.error(
            "License validation failed at startup%s: %s",
            " (grace period exceeded)" if reference else "",
            error,
        )


async def bootstrap(db_session_factory=async_session) -> None:
    """Run once at startup. No-op unless this instance is self-hosted with a
    license key configured."""
    if not state.requires_validation():
        return

    async with db_session_factory() as db:
        row = await _get_or_create_row(db)
        try:
            if row.license_id is None:
                settings = get_settings()
                result = await client.activate(
                    license_key=settings.AISER_EDITION_LICENSE_KEY,
                    instance_id=row.instance_id,
                    fingerprint=_fingerprint(row.instance_id),
                    product_version=settings.APP_VERSION,
                )
            else:
                result = await client.validate(license_id=row.license_id, instance_id=row.instance_id)
            await _apply_result(db, row, result)
            logger.info("License activation/validation succeeded for instance %s", row.instance_id)
        except (client.LicenseServerError, verify.EntitlementTokenError) as exc:
            await _handle_bootstrap_failure(db, row, exc)


async def refresh_once(db_session_factory=async_session) -> None:
    """One periodic re-validation cycle. Called by refresh_loop()."""
    if not state.requires_validation():
        return

    async with db_session_factory() as db:
        result = await db.execute(select(LicenseStateRecord).limit(1))
        row = result.scalars().first()
        if row is None or row.license_id is None:
            return

        try:
            activation = await client.validate(license_id=row.license_id, instance_id=row.instance_id)
            await _apply_result(db, row, activation)
        except (client.LicenseServerError, verify.EntitlementTokenError) as exc:
            state.mark_unreachable(str(exc))
            grace_deadline = (state.last_validated_at or dt.datetime.now(dt.timezone.utc)) + dt.timedelta(
                days=get_settings().LICENSE_GRACE_PERIOD_DAYS
            )
            if dt.datetime.now(dt.timezone.utc) > grace_deadline:
                state.is_valid = False
                row.is_valid = False
                row.last_error = str(exc)
                await db.commit()
                logger.error("License grace period exceeded, marking instance unlicensed: %s", exc)
            else:
                logger.warning("License server unreachable, within grace period: %s", exc)


async def refresh_loop() -> None:
    """Background task: re-validate on an interval shorter than the
    entitlement token's own expiry (license-server default 60 min; refresh
    every LICENSE_REFRESH_INTERVAL_MINUTES, default 15)."""
    interval_seconds = get_settings().LICENSE_REFRESH_INTERVAL_MINUTES * 60
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await refresh_once()
        except Exception as exc:  # noqa: BLE001 — one bad cycle must not kill the loop
            logger.error("License refresh cycle failed unexpectedly: %s", exc)
