"""Pydantic request and response schemas for Plug-in APIs."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ContributionSummary(BaseModel):
    kind: str
    label: Optional[str] = None
    chart_type: Optional[str] = None
    db_type: Optional[str] = None
    skill_name: Optional[str] = None
    server_name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    default_port: Optional[int] = None


class PluginStateResponse(BaseModel):
    id: str
    name: str
    version: str
    api_version: str
    description: Optional[str] = ""
    author: Optional[str] = None
    homepage: Optional[str] = None
    installed: bool = True
    entitled: bool
    enabled: bool
    active: bool
    default_enabled: bool
    requires_feature: Optional[str] = None
    has_config: bool = False
    contributions: List[ContributionSummary] = Field(default_factory=list)


class ActiveVisualResponse(BaseModel):
    chart_type: str
    label: str
    icon: Optional[str] = None
    bundle_url: str
    plugin_id: str


class ActiveConnectorResponse(BaseModel):
    db_type: str
    label: str
    default_port: Optional[int] = None
    plugin_id: str


class ActivePluginsResponse(BaseModel):
    active_plugins: List[str] = Field(default_factory=list)
    visuals: List[ActiveVisualResponse] = Field(default_factory=list)
    connectors: List[ActiveConnectorResponse] = Field(default_factory=list)
    disabled_chart_types: Dict[str, str] = Field(default_factory=dict)
    disabled_db_types: Dict[str, str] = Field(default_factory=dict)


class PluginEnablementUpdate(BaseModel):
    enabled: bool
    config: Optional[Dict[str, Any]] = None

