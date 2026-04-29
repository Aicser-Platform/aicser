def test_standalone_chart_router_importable_from_charts():
    from src.modules.charts.router import standalone_chart_router
    assert standalone_chart_router is not None
