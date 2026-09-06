"""Regression: schema RAG's persisted index (schema_table_index /
schema_column_index) is built by schema_index_service.py from a
data-source-connect request (src/modules/data/router.py) -- a path that never
runs inside the ambient AI request context api_streaming.py sets for a live
chat request. schema_retrieval_service.py and schema_domain_service.py query
that same persisted index from WITHIN a live chat request, which DOES have
ambient org context.

Without forcing both sides onto the platform-wide EMBEDDING_PROVIDER config
(use_org_byok=False), an organization that configures a BYOK embedding key
would silently query its platform-embedded schema index with a BYOK-embedded
query vector -- a different, incomparable vector space, with no error raised
anywhere; every schema RAG retrieval for that org would just silently return
near-random results. This locks in that both the index-build and query-time
calls opt out of org BYOK, so they can never drift into that state.
"""

import inspect

import ee.modules.ai.services.schema_domain_service as schema_domain_service
import ee.modules.ai.services.schema_index_service as schema_index_service
import ee.modules.ai.services.schema_retrieval_service as schema_retrieval_service


def _source(module) -> str:
    return inspect.getsource(module)


def test_schema_retrieval_service_query_embedding_opts_out_of_org_byok():
    src = _source(schema_retrieval_service)
    assert "use_org_byok=False" in src


def test_schema_domain_service_query_embedding_opts_out_of_org_byok():
    src = _source(schema_domain_service)
    assert "use_org_byok=False" in src


def test_schema_index_service_build_embeddings_opt_out_of_org_byok():
    src = _source(schema_index_service)
    # Both the table-level and column-level batch embedding calls must opt
    # out -- missing either one reintroduces the mismatch for that half of
    # the index.
    assert src.count("use_org_byok=False") >= 2
