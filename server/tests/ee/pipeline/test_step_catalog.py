import os

os.environ.setdefault("AISER_EDITION", "enterprise")

VALID_GROUPS = {
    "shape",
    "clean",
    "derive",
    "validate",
    "combine",
    "reshape",
    "escape",
}


def test_every_registered_step_declares_group_and_label():
    from src.modules.pipeline.transform.steps import STEP_REGISTRY

    assert len(STEP_REGISTRY) == 19, "expected the full step catalog"
    for kind, cls in STEP_REGISTRY.items():
        assert cls.group in VALID_GROUPS, f"{kind} has group {cls.group!r}"
        assert cls.label, f"{kind} has no label"
        assert cls.label != kind, f"{kind} label must be human-readable"


def test_step_catalog_route_is_registered_before_the_id_route():
    # `router.routes` can't be introspected directly here: FastAPI 0.140's
    # `include_router` (used for the mounted formula sub-router) wraps entries in a
    # lazy `_IncludedRouter` that has no `.path` until something forces full
    # resolution. `app.openapi()` does that resolution and preserves route
    # registration order in `schema["paths"]`, so it verifies the same thing
    # test_formula_router.py's mount test does.
    from fastapi import FastAPI

    from src.modules.pipeline.router import router

    app = FastAPI()
    app.include_router(router)
    paths = list(app.openapi()["paths"].keys())
    assert "/pipelines/steps" in paths
    assert paths.index("/pipelines/steps") < paths.index("/pipelines/{pipeline_id}")


def test_build_step_catalog_returns_schema_per_kind():
    from src.modules.pipeline.router import build_step_catalog
    from src.modules.pipeline.transform.steps import STEP_REGISTRY

    entries = build_step_catalog()
    assert {e.kind for e in entries} == set(STEP_REGISTRY)

    by_kind = {e.kind: e for e in entries}
    assert by_kind["filter"].group == "shape"
    assert by_kind["sql"].group == "escape"

    filter_schema = by_kind["filter"].schema_
    assert filter_schema["type"] == "object"
    assert "where" in filter_schema["properties"]
    assert "where" in filter_schema["required"]

    # `kind` is a ClassVar and must never appear as an editable field.
    for entry in entries:
        assert "kind" not in entry.schema_.get("properties", {})


def test_catalog_is_sorted_by_group_then_kind():
    from src.modules.pipeline.router import build_step_catalog

    entries = build_step_catalog()
    order = [(e.group, e.kind) for e in entries]
    assert order == sorted(order)


def test_org_id_accepts_frontend_selected_org_header():
    from src.modules.pipeline.router import _org_id, pipeline_user_payload

    payload = {"sub": "user-1"}
    merged = __import__("asyncio").run(
        pipeline_user_payload(
            payload=payload,
            x_organization_id="11111111-1111-1111-1111-111111111111",
        )
    )

    assert merged["organization_id"] == "11111111-1111-1111-1111-111111111111"
    assert str(_org_id(merged)) == "11111111-1111-1111-1111-111111111111"


def test_pipeline_payload_rejects_org_header_without_user_identity():
    import pytest
    from fastapi import HTTPException

    from src.modules.pipeline.router import pipeline_user_payload

    with pytest.raises(HTTPException) as exc:
        __import__("asyncio").run(
            pipeline_user_payload(
                payload={},
                x_organization_id="11111111-1111-1111-1111-111111111111",
            )
        )

    assert exc.value.status_code == 401


def test_update_request_accepts_layer_and_mode():
    from src.modules.pipeline.schemas import PipelineUpdateRequest

    body = PipelineUpdateRequest(target_layer="gold", ingest_mode="incremental")
    assert body.target_layer == "gold"
    assert body.ingest_mode == "incremental"

    empty = PipelineUpdateRequest()
    assert empty.target_layer is None
    assert empty.ingest_mode is None


def test_update_request_rejects_unknown_layer_and_ignores_source_change():
    import pytest
    from pydantic import ValidationError

    from src.modules.pipeline.schemas import PipelineUpdateRequest

    with pytest.raises(ValidationError):
        PipelineUpdateRequest(target_layer="bronze")

    # source_asset_id is deliberately not a field — a source change invalidates the
    # pipeline's Bronze asset and recorded lineage, so it is not an edit.
    parsed = PipelineUpdateRequest(source_asset_id="ds-other")
    assert not hasattr(parsed, "source_asset_id")
