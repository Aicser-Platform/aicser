import pytest

from ee.modules.ai.nodes.graph_retrieval_node import graph_retrieval_node


@pytest.mark.asyncio
async def test_graph_retrieve_skips_without_identity():
    state = {"query": "revenue by region"}
    out = await graph_retrieval_node(state)
    assert out["graph_neighborhood"] == []
    assert out["graph_metric_ids"] == []
    assert out["graph_chunk_ids"] == []


@pytest.mark.asyncio
async def test_graph_retrieve_writes_pointers_only(monkeypatch):
    async def _expand(session, *, identity, question, data_source_id=None, hops=2):
        assert identity.organization_id == "org-1"
        assert "revenue" in question
        return {
            "prompt_block": "ONTOLOGY POINTERS (not facts — hydrate via ptr; do not invent numbers):\n- Metric Revenue certified ptr=metric:m1",
            "nodes": [
                {
                    "kind": "Metric",
                    "ptr": "m1",
                    "ptr_type": "metric",
                    "name": "Revenue",
                    "certified": True,
                }
            ],
            "metric_ids": ["m1"],
            "chunk_ids": [],
            "backend": "relational",
        }

    class _CM:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(
        "src.db.session.async_session",
        lambda: _CM(),
    )
    monkeypatch.setattr(
        "ee.modules.ontology.service.ontology_service.expand_for_question",
        _expand,
    )

    state = {
        "query": "what is revenue",
        "user_id": "u1",
        "organization_id": "org-1",
        "execution_metadata": {},
    }
    out = await graph_retrieval_node(state)
    assert out["graph_metric_ids"] == ["m1"]
    assert "m1" in out["graph_context"]
    assert "1200000" not in (out["graph_context"] or "")
    assert out["execution_metadata"]["ontology_backend"] == "relational"
