"""Kernel tool registry — one catalog of governed tools for every agent surface.

Agent (chat), MCP clients and the desktop device agent all read tools from here. Each
module registers its own tools at import time, so an add-on never imports another
add-on to use its tools: Operate registers alert tools, Decide registers decision tools,
and the Agent add-on only reads the registry.

A tool declares what it can change (``tier``), the RBAC permission it needs, and the
SKU that sells it. The runtime decides from those three facts whether a call runs,
asks first, or is handed back to the person — never from the tool's name.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)


class ToolTier(IntEnum):
    """What a call can change. Higher tiers need more approval (see ``approval_for``)."""

    READ = 0  # query governed data, read granted files, look at a screen
    WORKSPACE = 1  # write inside the task workspace: drafts, files, charts not yet saved
    INTERNAL = 2  # change a shared record: save a dashboard, update a CRM field
    EXTERNAL = 3  # reach outside the company: send email or chat, submit a form
    IRREVERSIBLE = 4  # payments, deletions, permission changes, sign-in and MFA


@dataclass(frozen=True)
class ToolCaller:
    """Who a call runs as. Tools never run as a service account."""

    user_id: str
    organization_id: Optional[str]
    project_id: Optional[str] = None
    run_id: Optional[str] = None


def verify_by_preview(preview: Callable[["ToolCaller", Dict[str, Any]], Awaitable[Dict[str, Any]]]):
    """For a tool with a preview: run it again after the change. Whatever still differs didn't land."""

    async def verify(caller: "ToolCaller", args: Dict[str, Any], result: Dict[str, Any]) -> Optional[str]:
        import json

        def text(value: Any) -> str:
            return json.dumps(value, sort_keys=True, default=str)

        fresh = await preview(caller, args)
        left = [c for c in (fresh or {}).get("changes") or [] if isinstance(c, dict) and text(c.get("before")) != text(c.get("after"))]
        return ("These did not take effect: " + ", ".join(str(c.get("field")) for c in left[:8])) if left else None

    return verify


class ToolError(Exception):
    """A failure the model can read and act on (bad argument, no access, refused query)."""


ToolHandler = Callable[[ToolCaller, Dict[str, Any]], Awaitable[Dict[str, Any]]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: ToolHandler
    tier: ToolTier = ToolTier.READ
    permission_code: Optional[str] = None
    sku: str = "kernel"
    # Plan feature that must be on for the caller's organization (None = always on).
    feature: Optional[str] = None
    # Where the tool is offered. "agent" = Aicser Agent, "mcp" = outside AI clients.
    surfaces: frozenset = field(default_factory=lambda: frozenset({"agent", "mcp"}))
    # Owning module, for audit and the admin console.
    source: str = ""
    # Returns text written outside Aicser (web pages, emails, uploaded documents). After such
    # a call, outside effects in the same task need a fresh approval (see approval_for).
    untrusted_output: bool = False
    # AI credits a call costs on cloud plans, for tools that run AI themselves (an analysis,
    # a dashboard build): a number, or a function of the call's arguments. Plain data tools
    # cost nothing beyond the agent's own steps.
    credit_cost: Any = 0.0

    def credits_for_call(self, args: Dict[str, Any]) -> float:
        try:
            return float(self.credit_cost(args) if callable(self.credit_cost) else self.credit_cost or 0)
        except Exception:
            return 0.0
    # Arguments that need no approval for this call (e.g. a shell command on the admin
    # allowlist). Never applies to tier 4 or after untrusted content (see approval_for).
    auto_approve: Optional[Callable[[Dict[str, Any]], bool]] = None
    # For changes to existing work: what the call would change, as {"title", "changes": [{"field",
    # "before", "after"}]}, shown to the person before they approve it.
    preview: Optional[Callable[["ToolCaller", Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None
    # Reads the work back after a change: returns what didn't land, or None when it all did.
    verify: Optional[Callable[["ToolCaller", Dict[str, Any], Dict[str, Any]], Awaitable[Optional[str]]]] = None

    @property
    def read_only(self) -> bool:
        return self.tier == ToolTier.READ

    def to_function_schema(self) -> Dict[str, Any]:
        """OpenAI / LiteLLM function-calling definition."""
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": self.input_schema},
        }

    def to_mcp_tool(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "readOnlyHint": self.read_only,
                "destructiveHint": self.tier >= ToolTier.IRREVERSIBLE,
                "openWorldHint": self.tier >= ToolTier.EXTERNAL,
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        existing = self._tools.get(spec.name)
        if existing and existing.source != spec.source:
            raise ValueError(f"Tool '{spec.name}' is already registered by {existing.source or 'another module'}")
        self._tools[spec.name] = spec

    def register_many(self, specs: Iterable[ToolSpec]) -> None:
        for spec in specs:
            self.register(spec)

    def get(self, name: str) -> Optional[ToolSpec]:
        return self._tools.get(name)

    def list(self, surface: Optional[str] = None) -> List[ToolSpec]:
        return [t for t in self._tools.values() if surface is None or surface in t.surfaces]

    def clear(self) -> None:
        """Tests only."""
        self._tools.clear()


_REGISTRY = ToolRegistry()

# Modules that register tools when imported. Spelled through the src.modules shims, so this
# list is safe in Community Edition: a module that is not installed is simply skipped.
TOOL_MODULES = (
    "src.modules.ai.governed_tools",
    "src.modules.ai.agent_actions",
    "src.modules.ai.agent_edit_tools",
    "src.modules.ai.agent_sheet_tools",
    "src.modules.ai.agent_doc_tools",
    "src.modules.notebook_runs.agent_tools",
    "src.modules.plant.agent_tools",
    "src.modules.activation.agent_tools",
)


# How to take back a change a tool made: the tool returns {"undo": {"handler": name, "args": {...}}} and
# the person's Undo runs that handler as them (same permission checks as the change itself).
UndoHandler = Callable[[ToolCaller, Dict[str, Any]], Awaitable[Dict[str, Any]]]
_UNDO: Dict[str, UndoHandler] = {}


def register_undo(name: str, handler: UndoHandler) -> None:
    _UNDO[name] = handler


def get_undo(name: str) -> Optional[UndoHandler]:
    return _UNDO.get(name)


def get_tool_registry() -> ToolRegistry:
    return _REGISTRY


def load_registered_tools() -> ToolRegistry:
    """Import every tool module once so its tools are in the registry."""
    import importlib

    for name in TOOL_MODULES:
        try:
            importlib.import_module(name)
        except ImportError:
            continue
        except Exception as exc:  # a broken module must not take every other tool down
            logger.warning("Tool module %s failed to load: %s", name, exc)
    return _REGISTRY


# ── Approval policy ──────────────────────────────────────────────────────────

ALLOW = "allow"
ASK_ONCE = "ask_once"  # once per task, then allowed for the rest of that task
ASK_EVERY_TIME = "ask"
HAND_BACK = "hand_back"  # the person does it themselves (pay, delete, sign in)

_DEFAULT_APPROVAL = {
    ToolTier.READ: ALLOW,
    ToolTier.WORKSPACE: ALLOW,
    ToolTier.INTERNAL: ASK_ONCE,
    ToolTier.EXTERNAL: ASK_EVERY_TIME,
    ToolTier.IRREVERSIBLE: HAND_BACK,
}


def approval_for(
    spec: ToolSpec,
    *,
    pre_approved: Iterable[str] = (),
    approved_in_task: Iterable[str] = (),
    untrusted_content_seen: bool = False,
    args: Optional[Dict[str, Any]] = None,
) -> str:
    """How a call to ``spec`` must be approved right now.

    ``pre_approved`` = tools an admin pre-approved for the caller's role (never tier 4).
    ``approved_in_task`` = tools the person already approved once in this task.
    ``untrusted_content_seen`` = the task has read email, web or file text it did not
    write; an outside effect then always needs a fresh approval, so text planted in that
    content cannot send data out on its own.
    """
    base = _DEFAULT_APPROVAL[spec.tier]
    if base == HAND_BACK:
        return HAND_BACK
    if spec.tier >= ToolTier.EXTERNAL and untrusted_content_seen:
        return ASK_EVERY_TIME
    if spec.name in set(pre_approved):
        return ALLOW
    if spec.auto_approve is not None and args is not None:
        try:
            if spec.auto_approve(args):
                return ALLOW
        except Exception:
            pass
    if base == ASK_ONCE and spec.name in set(approved_in_task):
        return ALLOW
    return base
