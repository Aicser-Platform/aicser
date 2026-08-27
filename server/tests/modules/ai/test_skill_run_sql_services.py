"""Regression: skill_run_sql (the agent kernel's run_sql capability, used for
open-ended goals like "find me interesting insights") pulled data_service and
multi_query_service out of ctx for query_execution_node but forgot to pass
any of the three required services through to nl2sql_node, so every kernel
run_sql call failed with "missing 3 required positional arguments".

Once that was fixed, the very next line surfaced a second, previously-masked
bug: nl2sql_node and query_execution_node are both wrapped by
handle_node_errors(), whose wrapper is `async def wrapper(state, **kwargs)` -
it only accepts `state` positionally, everything else MUST be passed as a
keyword or the call fails with "takes 1 positional argument but N were
given". The fakes below enforce keyword-only args (mirroring that real
constraint) so this test fails again if either call site regresses to
positional passing."""

import pytest

from ee.modules.ai.skills import skill_graph_handlers


@pytest.mark.asyncio
async def test_skill_run_sql_passes_services_to_nl2sql_node(monkeypatch):
    captured = {}

    async def fake_nl2sql_node(state, *, litellm_service=None, data_service=None, multi_query_service=None):
        captured["litellm_service"] = litellm_service
        captured["data_service"] = data_service
        captured["multi_query_service"] = multi_query_service
        state["sql_query"] = "SELECT 1"
        return state

    async def fake_query_execution_node(state, *, multi_query_service=None, data_service=None):
        state["query_result"] = [{"a": 1}]
        return state

    # skill_graph_handlers imports via the `src.modules.ai` alias (redirected to
    # ee/modules/ai by src/modules/ai/__init__.py when EE is enabled), which is a
    # separately-loaded module object from `ee.modules.ai...` - patch the same
    # alias production code actually resolves against.
    import src.modules.ai.nodes.nl2sql_node as nl2sql_module
    import src.modules.ai.nodes.query_execution_node as query_exec_module

    monkeypatch.setattr(nl2sql_module, "nl2sql_node", fake_nl2sql_node)
    monkeypatch.setattr(query_exec_module, "query_execution_node", fake_query_execution_node)

    sentinel_litellm = object()
    sentinel_data = object()
    sentinel_multi = object()
    ctx = {
        "query": "find me interesting insights",
        "data_source_id": "ds-1",
        "litellm_service": sentinel_litellm,
        "data_service": sentinel_data,
        "multi_query_service": sentinel_multi,
    }

    out = await skill_graph_handlers.skill_run_sql(ctx)

    assert captured["litellm_service"] is sentinel_litellm
    assert captured["data_service"] is sentinel_data
    assert captured["multi_query_service"] is sentinel_multi
    assert out["success"] is True
