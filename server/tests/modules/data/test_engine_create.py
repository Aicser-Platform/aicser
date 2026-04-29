import pytest

real_cube_mod = pytest.importorskip("app.modules.data.services.real_cube_integration_service")
RealCubeIntegrationService = real_cube_mod.RealCubeIntegrationService


@pytest.mark.asyncio
async def test_engine_create_retry_and_cache(monkeypatch):
    svc = RealCubeIntegrationService()

    # Prepare a fake config for postgres
    cfg = {
        "type": "postgresql",
        "username": "user",
        "password": "pass",
        "host": "localhost",
        "port": 5432,
        "database": "db"
    }

    # Monkeypatch _test_sqlalchemy_engine to fail first then succeed
    calls = {"n": 0}

    async def fake_test(engine):
        calls["n"] += 1
        if calls["n"] < 2:
            return {"success": False, "error": "transient"}
        return {"success": True}

    monkeypatch.setattr(svc, "_test_sqlalchemy_engine", fake_test)

    engine = await svc._create_sqlalchemy_engine(cfg)
    assert engine is not None

    # Second call should return cached instance
    engine2 = await svc._create_sqlalchemy_engine(cfg)
    assert engine is engine2


