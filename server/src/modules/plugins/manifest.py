"""Pydantic models for Plug-in manifests and contributions."""

from __future__ import annotations

import re
from typing import Annotated, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

SLUG_REGEX = re.compile(r"^[a-z0-9_-]+$")
SUPPORTED_API_VERSIONS = {"1"}


class VisualContribution(BaseModel):
    kind: Literal["visual"]
    chart_type: str = Field(..., description="Unique chart type slug (e.g. 'sankey')")
    label: str = Field(..., description="Human-readable chart label")
    bundle: str = Field(
        ...,
        description="Relative path to prebuilt ESM bundle inside assets_dir (e.g. 'index.js')",
    )
    icon: Optional[str] = Field(None, description="Ant Design or Lucide icon name")

    @field_validator("chart_type")
    @classmethod
    def validate_chart_type(cls, v: str) -> str:
        if not SLUG_REGEX.match(v):
            raise ValueError(f"chart_type '{v}' must be a lowercase alphanumeric slug")
        return v

    @field_validator("bundle")
    @classmethod
    def validate_bundle_path(cls, v: str) -> str:
        if not v or v.startswith("/") or "\\" in v or "\0" in v or ".." in v.split("/"):
            raise ValueError(
                "bundle path must be relative and cannot contain path traversal ('..')"
            )
        return v


class ConnectorContribution(BaseModel):
    kind: Literal["connector"]
    db_type: str = Field(..., description="Unique database engine identifier (e.g. 'snowflake')")
    label: str = Field(..., description="Display name for database connection forms")
    target: str = Field(..., description="Import target string in 'package.module:attribute' format")
    default_port: Optional[int] = Field(None, description="Default TCP port")
    connector_type: Literal["url", "extended"] = Field(
        "url", description="Connector protocol type ('url' or 'extended')"
    )

    @field_validator("db_type")
    @classmethod
    def validate_db_type(cls, v: str) -> str:
        if not SLUG_REGEX.match(v):
            raise ValueError(f"db_type '{v}' must be a lowercase alphanumeric slug")
        return v

    @field_validator("target")
    @classmethod
    def validate_target(cls, v: str) -> str:
        if ":" not in v:
            raise ValueError("target must be in 'module:attribute' format")
        mod, attr = v.split(":", 1)
        if not mod.strip() or not attr.strip():
            raise ValueError("target module or attribute cannot be empty")
        return v


class AISkillContribution(BaseModel):
    kind: Literal["ai_skill"]
    skill_name: str = Field(..., description="Unique AI skill name")
    description: str = Field(..., description="Skill description for the AI orchestrator")
    permission_code: Optional[str] = Field(None, description="Optional RBAC permission code")
    target: Optional[str] = Field(None, description="Optional Python callable target 'mod:attr'")

    @field_validator("skill_name")
    @classmethod
    def validate_skill_name(cls, v: str) -> str:
        if not SLUG_REGEX.match(v):
            raise ValueError(f"skill_name '{v}' must be a lowercase alphanumeric slug")
        return v


class MCPServerContribution(BaseModel):
    kind: Literal["mcp_server"]
    server_name: str = Field(..., description="Unique MCP server slug")
    description: str = Field(..., description="Human-readable description of the MCP integration")
    default_url: Optional[str] = Field(None, description="Optional default MCP endpoint URL")

    @field_validator("server_name")
    @classmethod
    def validate_server_name(cls, v: str) -> str:
        if not SLUG_REGEX.match(v):
            raise ValueError(f"server_name '{v}' must be a lowercase alphanumeric slug")
        return v


Contribution = Annotated[
    Union[
        VisualContribution,
        ConnectorContribution,
        AISkillContribution,
        MCPServerContribution,
    ],
    Field(discriminator="kind"),
]


class PluginManifest(BaseModel):
    id: str = Field(..., description="Unique lowercase plug-in identifier (e.g. 'snowflake', 'sankey')")
    name: str = Field(..., description="Human-readable display name")
    version: str = Field(..., description="Semantic version string (e.g. '1.0.0')")
    api_version: str = Field(..., description="Aicser Plugin API version (must be '1')")
    description: Optional[str] = ""
    author: Optional[str] = None
    homepage: Optional[str] = None
    requires_feature: Optional[str] = Field(
        None, description="Optional plan feature entitlement requirement"
    )
    default_enabled: bool = Field(
        False, description="Default enabled state for new installations"
    )
    assets_dir: Optional[str] = Field(
        None, description="Relative path from package root containing static assets"
    )
    contributions: List[Contribution] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        if not SLUG_REGEX.match(v):
            raise ValueError(f"Plugin id '{v}' must be a lowercase alphanumeric slug")
        return v

    @field_validator("api_version")
    @classmethod
    def validate_api_version(cls, v: str) -> str:
        if v not in SUPPORTED_API_VERSIONS:
            raise ValueError(
                f"Unsupported api_version '{v}'. Supported: {SUPPORTED_API_VERSIONS}"
            )
        return v

    @field_validator("assets_dir")
    @classmethod
    def validate_assets_dir(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v.startswith("/") or "\\" in v or "\0" in v or ".." in v.split("/"):
            raise ValueError("assets_dir must be a relative path without '..'")
        return v

