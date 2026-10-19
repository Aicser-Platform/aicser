from src.modules.data.services.api_stream_catalog import (
    configured_streams,
    infer_schema_tables_from_streams,
    normalize_stream_entry,
    resolve_stream_config,
    streams_from_openapi,
)


def test_configured_streams():
    cfg = {
        "url": "https://api.example.com",
        "streams": [
            {"name": "orders", "path": "v1/orders", "primary_key": ["id"]},
            {"name": "users", "path": "v1/users"},
        ],
    }
    streams = configured_streams(cfg)
    assert len(streams) == 2
    assert streams[0]["name"] == "orders"


def test_resolve_stream_merges_path():
    cfg = {
        "url": "https://api.example.com",
        "streams": [{"name": "orders", "path": "v1/orders", "pagination_type": "cursor"}],
    }
    merged = resolve_stream_config(cfg, "orders")
    assert merged["path"] == "v1/orders"
    assert merged["pagination_type"] == "cursor"


def test_openapi_paths_to_streams():
    spec = {
        "paths": {
            "/v1/orders": {"get": {"operationId": "listOrders"}},
            "/v1/users": {"post": {}},
        }
    }
    streams = streams_from_openapi(spec)
    assert len(streams) == 1
    assert streams[0]["name"] == "listOrders"


def test_infer_schema_tables():
    tables = [{"name": "a", "columns": [{"name": "id", "type": "string"}]}]
    schema = infer_schema_tables_from_streams(tables)
    assert schema["multi_stream"] is False
    assert schema["tables"][0]["name"] == "a"
