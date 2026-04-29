def test_user_endpoints_in_user_module():
    from src.modules.user.router import router
    paths = [r.path for r in router.routes]
    assert "/settings" in paths
    assert "/api-keys" in paths
    assert "/preferences/ai-model" in paths
    assert "/team-members" in paths
