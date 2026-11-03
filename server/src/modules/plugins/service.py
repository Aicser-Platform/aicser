"""Business logic for Plug-in state evaluation (Installed ∧ Entitled ∧ Enabled)."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.data.utils.credentials import decrypt_text, encrypt_text
from src.modules.plugins.manifest import (
    AISkillContribution,
    ConnectorContribution,
    MCPServerContribution,
    PluginManifest,
    VisualContribution,
)
from src.modules.plugins.models import PluginEnablement
from src.modules.plugins.registry import registry
from src.modules.plugins.schemas import (
    ActiveConnectorResponse,
    ActivePluginsResponse,
    ActiveVisualResponse,
    ContributionSummary,
    PluginStateResponse,
)
from src.modules.pricing.feature_gate import org_has_plan_feature

logger = logging.getLogger(__name__)

INSTANCE_SCOPE_KEY = "instance"


def resolve_scope_key(organization_id: Optional[str] = None) -> str:
    """Resolve scope key: organization UUID in EE, or 'instance' in CE."""
    org = (organization_id or "").strip()
    if org and org.lower() != "ce":
        return org
    return INSTANCE_SCOPE_KEY


def _summarize_contributions(manifest: PluginManifest) -> List[ContributionSummary]:
    summaries: List[ContributionSummary] = []
    for c in manifest.contributions:
        if isinstance(c, VisualContribution):
            summaries.append(
                ContributionSummary(
                    kind="visual",
                    label=c.label,
                    chart_type=c.chart_type,
                    icon=c.icon,
                )
            )
        elif isinstance(c, ConnectorContribution):
            summaries.append(
                ContributionSummary(
                    kind="connector",
                    label=c.label,
                    db_type=c.db_type,
                    default_port=c.default_port,
                )
            )
        elif isinstance(c, AISkillContribution):
            summaries.append(
                ContributionSummary(
                    kind="ai_skill",
                    skill_name=c.skill_name,
                    description=c.description,
                )
            )
        elif isinstance(c, MCPServerContribution):
            summaries.append(
                ContributionSummary(
                    kind="mcp_server",
                    server_name=c.server_name,
                    description=c.description,
                )
            )
    return summaries


async def is_plugin_entitled(
    manifest: PluginManifest,
    organization_id: Optional[str],
    db: Optional[AsyncSession],
) -> bool:
    """Evaluate whether the org's subscription plan entitles it to `manifest`."""
    if not manifest.requires_feature:
        return True
    if db is None:
        return False
    try:
        return await org_has_plan_feature(organization_id, db, manifest.requires_feature)
    except Exception as err:
        logger.warning(
            "Entitlement check failed for plug-in '%s' (feature='%s'): %s",
            manifest.id,
            manifest.requires_feature,
            err,
        )
        return False


async def get_plugin_states(
    db: AsyncSession,
    scope_key: str,
    organization_id: Optional[str] = None,
) -> List[PluginStateResponse]:
    """Return full state (Installed, Entitled, Enabled, Active) for all installed plug-ins."""
    manifests = registry.get_all_manifests()
    if not manifests:
        return []

    rows_by_id: Dict[str, PluginEnablement] = {}
    try:
        stmt = select(PluginEnablement).where(PluginEnablement.scope_key == scope_key)
        result = await db.execute(stmt)
        for row in result.scalars().all():
            rows_by_id[row.plugin_id] = row
    except Exception as err:
        logger.warning("Could not query plugin_enablements (using manifest defaults): %s", err)

    states: List[PluginStateResponse] = []
    for manifest in manifests:
        entitled = await is_plugin_entitled(manifest, organization_id or scope_key, db)
        row = rows_by_id.get(manifest.id)
        enabled = row.enabled if row is not None else manifest.default_enabled
        active = True and entitled and enabled
        states.append(
            PluginStateResponse(
                id=manifest.id,
                name=manifest.name,
                version=manifest.version,
                api_version=manifest.api_version,
                description=manifest.description or "",
                author=manifest.author,
                homepage=manifest.homepage,
                installed=True,
                entitled=entitled,
                enabled=enabled,
                active=active,
                default_enabled=manifest.default_enabled,
                requires_feature=manifest.requires_feature,
                has_config=bool(row and row.config_encrypted),
                contributions=_summarize_contributions(manifest),
            )
        )
    return states


async def is_plugin_active(
    db: Optional[AsyncSession],
    scope_key: str,
    plugin_id: str,
    organization_id: Optional[str] = None,
) -> bool:
    """Evaluate `Active = Installed ∧ Entitled ∧ Enabled` for a single plug-in."""
    manifest = registry.get_manifest(plugin_id)
    if manifest is None:
        return False

    entitled = await is_plugin_entitled(manifest, organization_id or scope_key, db)
    if not entitled:
        return False

    if db is None:
        return manifest.default_enabled

    try:
        stmt = select(PluginEnablement).where(
            PluginEnablement.scope_key == scope_key,
            PluginEnablement.plugin_id == manifest.id,
        )
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()
        if row is not None:
            return bool(row.enabled)

        from src.core.edition import is_ee_enabled

        if scope_key != INSTANCE_SCOPE_KEY and not is_ee_enabled():
            stmt_inst = select(PluginEnablement).where(
                PluginEnablement.scope_key == INSTANCE_SCOPE_KEY,
                PluginEnablement.plugin_id == manifest.id,
            )
            res_inst = await db.execute(stmt_inst)
            row_inst = res_inst.scalar_one_or_none()
            if row_inst is not None:
                return bool(row_inst.enabled)
    except Exception as err:
        logger.warning("Error reading plugin_enablements for '%s': %s", plugin_id, err)

    return manifest.default_enabled


async def get_active_contributions(
    db: AsyncSession,
    scope_key: str,
    organization_id: Optional[str] = None,
) -> ActivePluginsResponse:
    """Return active plug-ins, visuals, connectors, and soft-disabled maps for the caller's scope."""
    states = await get_plugin_states(db, scope_key=scope_key, organization_id=organization_id)
    active_plugins: List[str] = []
    visuals: List[ActiveVisualResponse] = []
    connectors: List[ActiveConnectorResponse] = []
    disabled_chart_types: Dict[str, str] = {}
    disabled_db_types: Dict[str, str] = {}

    for st in states:
        manifest = registry.get_manifest(st.id)
        if not manifest:
            continue
        if st.active:
            active_plugins.append(st.id)
            for c in manifest.contributions:
                if isinstance(c, VisualContribution):
                    bundle_rel = c.bundle.lstrip("/")
                    visuals.append(
                        ActiveVisualResponse(
                            chart_type=c.chart_type,
                            label=c.label,
                            icon=c.icon,
                            bundle_url=f"/api/plugins/{manifest.id}/assets/{manifest.version}/{bundle_rel}",
                            plugin_id=manifest.id,
                        )
                    )
                elif isinstance(c, ConnectorContribution):
                    connectors.append(
                        ActiveConnectorResponse(
                            db_type=c.db_type,
                            label=c.label,
                            default_port=c.default_port,
                            plugin_id=manifest.id,
                        )
                    )
        else:
            for c in manifest.contributions:
                if isinstance(c, VisualContribution):
                    disabled_chart_types[c.chart_type] = c.label
                elif isinstance(c, ConnectorContribution):
                    disabled_db_types[c.db_type] = c.label

    return ActivePluginsResponse(
        active_plugins=active_plugins,
        visuals=visuals,
        connectors=connectors,
        disabled_chart_types=disabled_chart_types,
        disabled_db_types=disabled_db_types,
    )


async def set_plugin_enablement(
    db: AsyncSession,
    scope_key: str,
    plugin_id: str,
    enabled: bool,
    config: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
) -> PluginEnablement:
    """Create or update the enablement row for `(scope_key, plugin_id)`."""
    manifest = registry.get_manifest(plugin_id)
    if manifest is None:
        raise LookupError(f"Plug-in '{plugin_id}' is not installed")

    encrypted_str: Optional[str] = None
    if config is not None:
        encrypted_str = encrypt_text(json.dumps(config))

    stmt = select(PluginEnablement).where(
        PluginEnablement.scope_key == scope_key,
        PluginEnablement.plugin_id == manifest.id,
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        row = PluginEnablement(
            scope_key=scope_key,
            plugin_id=manifest.id,
            enabled=enabled,
            config_encrypted=encrypted_str,
            updated_by_user_id=user_id,
        )
        db.add(row)
    else:
        row.enabled = enabled
        if config is not None:
            row.config_encrypted = encrypted_str
        if user_id is not None:
            row.updated_by_user_id = user_id

    await db.commit()
    await db.refresh(row)
    return row


async def get_decrypted_plugin_config(
    db: AsyncSession,
    scope_key: str,
    plugin_id: str,
) -> Optional[Dict[str, Any]]:
    """Internal backend helper to decrypt a plug-in's stored config (never exposed via API)."""
    stmt = select(PluginEnablement).where(
        PluginEnablement.scope_key == scope_key,
        PluginEnablement.plugin_id == plugin_id,
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row or not row.config_encrypted:
        return None
    raw_json = decrypt_text(row.config_encrypted)
    return json.loads(raw_json)
