def test_lifespan_importable():
    from src.core.lifespan import lifespan, _check_predictive_deps, _check_ai_capabilities
    import inspect
    assert inspect.isasyncgenfunction(lifespan) or callable(lifespan)
    result = _check_predictive_deps()
    assert isinstance(result, dict)
    assert "prophet" in result
