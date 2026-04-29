def test_dashboard_models_importable_from_dashboards():
    from src.modules.dashboards.models import (
        Dashboard, DashboardPage, DashboardShare,
        DashboardTemplate, DashboardAnalytics, dashboard_widgets_table,
    )
    assert Dashboard.__tablename__ == "dashboards"
