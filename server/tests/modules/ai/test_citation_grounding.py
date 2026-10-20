from ee.modules.ai.utils.citation_grounding import apply_citation_grounding, ground_citations


def test_drops_citations_without_ids():
    result = ground_citations([{"source": "doc.pdf", "excerpt": "hello"}])
    assert result["citations"] == []
    assert result["dropped"] == 1
    assert result["grounded"] is False


def test_keeps_chunk_backed_citations():
    result = ground_citations(
        [{"source": "doc.pdf", "chunk_id": "c1", "document_id": "d1"}],
        allowed_chunk_ids=["c1"],
    )
    assert len(result["citations"]) == 1
    assert result["grounded"] is True


def test_drops_chunk_not_in_allowed_set():
    result = ground_citations(
        [{"chunk_ids": ["other"], "source": "x"}],
        allowed_chunk_ids=["c1"],
    )
    assert result["dropped"] == 1


def test_metric_cite_must_match_graph_ids():
    result = ground_citations(
        [{"metric_id": "m-secret", "source": "layer"}],
        allowed_metric_ids=["m-public"],
    )
    assert result["citations"] == []


def test_apply_merges_graph_and_rag_ids():
    state = {
        "rag_citations": [
            {"chunk_id": "c1", "source": "a"},
            {"source": "hallucinated"},
        ],
        "graph_chunk_ids": ["c1"],
        "execution_metadata": {},
    }
    apply_citation_grounding(state)
    assert len(state["rag_citations"]) == 1
    assert state["execution_metadata"]["citation_grounding"]["dropped"] == 1
