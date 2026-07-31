"""Confirms lifespan.py calls licensing bootstrap/refresh at the right times,
without spinning up the full FastAPI app (that's covered by the existing
integration-style tests elsewhere in this repo)."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI

from src.core.lifespan import lifespan


@pytest.mark.asyncio
async def test_lifespan_calls_licensing_bootstrap_and_starts_refresh_loop():
    app = FastAPI()
    with (
        patch("src.core.licensing.service.bootstrap", new=AsyncMock()) as mock_bootstrap,
        patch("asyncio.create_task") as mock_create_task,
    ):
        async with lifespan(app):
            pass
    mock_bootstrap.assert_awaited_once()
    # refresh_loop is one of several background tasks started via create_task;
    # confirm at least one call was made with a coroutine from the licensing
    # module's refresh_loop function.
    scheduled = [call.args[0] for call in mock_create_task.call_args_list]
    assert any(getattr(coro, "__qualname__", "").startswith("refresh_loop") for coro in scheduled)
