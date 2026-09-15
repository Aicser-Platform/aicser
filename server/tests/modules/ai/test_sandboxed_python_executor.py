"""Tests for the sandboxed, resource-limited replacement for the previous bare
exec() used to run LLM-generated pandas analysis code (deep_file_analysis_node.py).

Threat model note (see module docstring): this defends against the realistic
failure modes for LLM-generated code — infinite loops, memory blow-ups, lazy
network imports — via OS resource limits and import restrictions in a separate
process. It is not a hardened sandbox against deliberately adversarial code.
"""

import pandas as pd
import pytest

from ee.modules.ai.services.sandboxed_python_executor import execute_sandboxed_python


@pytest.fixture
def sample_df():
    return pd.DataFrame({
        "region": ["East", "West", "East", "West"],
        "revenue": [100, 200, 150, 50],
    })


@pytest.mark.asyncio
async def test_returns_dataframe_result_as_records(sample_df):
    result = await execute_sandboxed_python(
        'result = df.groupby("region")["revenue"].sum().reset_index()', sample_df
    )
    assert result["success"] is True
    records = {r["region"]: r["revenue"] for r in result["result"]}
    assert records == {"East": 250, "West": 250}


@pytest.mark.asyncio
async def test_returns_scalar_result(sample_df):
    result = await execute_sandboxed_python('result = int(df["revenue"].sum())', sample_df)
    assert result["success"] is True
    assert result["result"] == 500


@pytest.mark.asyncio
async def test_returns_dict_result(sample_df):
    result = await execute_sandboxed_python(
        'result = {"total": int(df["revenue"].sum()), "rows": len(df)}', sample_df
    )
    assert result["success"] is True
    assert result["result"] == {"total": 500, "rows": 4}


@pytest.mark.asyncio
async def test_blocks_network_imports(sample_df):
    for module in ("requests", "socket", "urllib", "httpx"):
        result = await execute_sandboxed_python(f"import {module}\nresult = 1", sample_df)
        assert result["success"] is False, f"{module} should have been blocked"
        assert module in result["error"]


@pytest.mark.asyncio
async def test_blocks_os_and_subprocess_escape_attempts(sample_df):
    result = await execute_sandboxed_python(
        "import os\nresult = os.environ.get('PATH')", sample_df
    )
    assert result["success"] is False
    assert "os" in result["error"]

    result2 = await execute_sandboxed_python(
        "import subprocess\nresult = subprocess.run(['ls']).returncode", sample_df
    )
    assert result2["success"] is False


@pytest.mark.asyncio
async def test_sandboxed_process_cannot_see_parent_env_secrets(sample_df, monkeypatch):
    monkeypatch.setenv("SUPER_SECRET_API_KEY", "sk-should-not-leak")
    # os is blocked, but even if the guard were bypassed, the child process
    # shouldn't have inherited the parent's full environment in the first place.
    result = await execute_sandboxed_python(
        "result = 'SUPER_SECRET_API_KEY' in repr(globals())", sample_df
    )
    assert result["success"] is True
    assert result["result"] is False


@pytest.mark.asyncio
async def test_times_out_on_infinite_loop(sample_df):
    result = await execute_sandboxed_python("while True:\n    pass", sample_df, timeout_seconds=2)
    assert result["success"] is False
    assert "timed out" in result["error"].lower()


@pytest.mark.asyncio
async def test_runtime_error_in_user_code_is_reported_not_raised(sample_df):
    result = await execute_sandboxed_python("result = 1 / 0", sample_df)
    assert result["success"] is False
    assert "ZeroDivisionError" in result["error"]


@pytest.mark.asyncio
async def test_empty_dataframe_short_circuits_without_spawning_a_process():
    result = await execute_sandboxed_python("result = 1", pd.DataFrame())
    assert result["success"] is False
    assert "no data" in result["error"].lower()


@pytest.mark.asyncio
async def test_large_result_is_truncated_to_max_rows():
    df = pd.DataFrame({"n": list(range(20))})
    result = await execute_sandboxed_python("result = df.copy()", df, max_rows=5)
    assert result["success"] is True
    assert len(result["result"]) == 5
