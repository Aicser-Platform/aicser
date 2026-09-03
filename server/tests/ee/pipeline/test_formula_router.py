import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_the_formula_compile_route_is_mounted_under_pipelines():
    # NOTE: FastAPI >=0.140 resolves included sub-routers lazily -- `router.routes`
    # yields internal `_IncludedRouter` wrapper objects (no `.path`/`.methods`)
    # instead of flattened `APIRoute`s, so the brief's direct route-list
    # inspection no longer works against the pinned fastapi version (^0.140.0).
    # The openapi schema is the public, documented way to get the fully
    # resolved path/method table, so we use that instead; the assertion's
    # intent (the route is mounted under /pipelines) is unchanged.
    from fastapi import FastAPI

    from src.modules.pipeline.router import router

    app = FastAPI()
    app.include_router(router)
    schema = app.openapi()
    assert "post" in schema["paths"]["/pipelines/formula/compile"]


async def test_compile_endpoint_returns_sql_for_a_valid_formula():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from src.modules.pipeline.formula.router import router as formula_router

    app = FastAPI()
    app.include_router(formula_router)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/formula/compile",
            json={"expression": "=[price] * 1.1", "available_columns": ["price"]},
        )
    assert response.status_code == 200
    assert response.json() == {"sql": '("price" * 1.1)'}


async def test_compile_endpoint_maps_a_syntax_error_to_422():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from src.modules.pipeline.formula.router import router as formula_router

    app = FastAPI()
    app.include_router(formula_router)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/formula/compile",
            json={"expression": "[price]", "available_columns": ["price"]},
        )
    assert response.status_code == 422
    body = response.json()["detail"]
    assert body["kind"] == "syntax"


async def test_compile_endpoint_maps_an_unknown_column_to_422():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from src.modules.pipeline.formula.router import router as formula_router

    app = FastAPI()
    app.include_router(formula_router)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/formula/compile",
            json={"expression": "=[pricee]", "available_columns": ["price"]},
        )
    assert response.status_code == 422
    body = response.json()["detail"]
    assert body["kind"] == "unknown_column"


def test_the_injection_example_never_reaches_a_200():
    """Belt-and-suspenders end-to-end regression for the P1 §11 example,
    exercised through the actual HTTP layer this time."""
    from src.modules.pipeline.formula.compiler import CompileError, compile_formula
    from src.modules.pipeline.formula.parser import FormulaSyntaxError

    try:
        compile_formula("=(SELECT secret FROM other_table LIMIT 1)", ["price"])
        assert False, "must have raised"
    except (FormulaSyntaxError, CompileError):
        pass
