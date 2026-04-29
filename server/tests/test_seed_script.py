def test_seed_script_importable():
    import importlib
    mod = importlib.import_module("app.scripts.seed")
    assert hasattr(mod, "main")
