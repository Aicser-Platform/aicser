from src.modules.data.services.multi_engine_query_service import (
    MultiEngineQueryService,
    QueryEngine,
)


def test_query_cache_key_includes_project_context():
    service = MultiEngineQueryService()
    data_source = {
        "id": "ds-1",
        "organization_id": "org-1",
        "project_id": "source-project",
    }

    project_a_key = service._generate_cache_key(
        "SELECT * FROM dim_customer",
        data_source,
        QueryEngine.DUCKDB,
        cache_context={
            "organization_id": "org-1",
            "project_id": "project-a",
            "user_id": "user-1",
        },
    )
    project_b_key = service._generate_cache_key(
        "SELECT * FROM dim_customer",
        data_source,
        QueryEngine.DUCKDB,
        cache_context={
            "organization_id": "org-1",
            "project_id": "project-b",
            "user_id": "user-1",
        },
    )

    assert project_a_key != project_b_key


def test_query_cache_key_does_not_fall_back_to_source_project_when_context_differs():
    service = MultiEngineQueryService()
    data_source = {
        "id": "ds-1",
        "organization_id": "org-1",
        "project_id": "source-project",
    }

    source_project_key = service._generate_cache_key(
        "SELECT * FROM dim_customer",
        data_source,
        QueryEngine.DUCKDB,
        cache_context={
            "organization_id": "org-1",
            "project_id": "source-project",
            "user_id": "user-1",
        },
    )
    request_project_key = service._generate_cache_key(
        "SELECT * FROM dim_customer",
        data_source,
        QueryEngine.DUCKDB,
        cache_context={
            "organization_id": "org-1",
            "project_id": "request-project",
            "user_id": "user-1",
        },
    )

    assert source_project_key != request_project_key
