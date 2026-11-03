"""Aicser Plug-in Architecture module (Kernel)."""

from src.modules.plugins.manifest import (
    AISkillContribution,
    ConnectorContribution,
    Contribution,
    MCPServerContribution,
    PluginManifest,
    VisualContribution,
)
from src.modules.plugins.registry import PluginRegistry, registry

__all__ = [
    "AISkillContribution",
    "ConnectorContribution",
    "Contribution",
    "MCPServerContribution",
    "PluginManifest",
    "PluginRegistry",
    "VisualContribution",
    "registry",
]

