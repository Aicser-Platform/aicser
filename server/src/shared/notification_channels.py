"""Alert delivery channels that other modules add, so alerts never import those modules.

A module registers a handler for a channel type when it loads; CHANNEL_MODULES are loaded on first use.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Awaitable, Callable, Dict, Optional

logger = logging.getLogger(__name__)

ChannelHandler = Callable[[dict, dict, str, float, str], Awaitable[None]]
CHANNEL_MODULES = ("src.modules.plant.work_orders",)
_handlers: Dict[str, ChannelHandler] = {}
_loaded = False


def register_channel(kind: str, handler: ChannelHandler) -> None:
    _handlers[kind] = handler


def channel_handler(kind: str) -> Optional[ChannelHandler]:
    global _loaded
    if not _loaded:
        _loaded = True
        for name in CHANNEL_MODULES:
            try:
                importlib.import_module(name)
            except Exception as exc:  # noqa: BLE001 - a missing module only loses its channel
                logger.debug("Channel module %s not loaded: %s", name, exc)
    return _handlers.get(kind)
