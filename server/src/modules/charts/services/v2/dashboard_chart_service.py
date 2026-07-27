from uuid import UUID
from typing import List, Optional, Mapping, Any, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.modules.charts.models import Chart
from src.modules.dashboards.models import DashboardChart
from src.modules.charts.services.v2.chart_service import ChartService


class DashboardChartService:
    """
    Manages the relationship between dashboards and charts,
    including layout and composition concerns.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.chart_service = ChartService(db)

    async def create(
        self,
        dashboard_id: UUID,
        chart_payload: Mapping[str, Any],
        layout: Optional[Mapping[str, Any]] = None,
    ) -> Chart:
        """
        Creates a chart and attaches it to a dashboard
        in a single transaction.
        """
        try:
            chart = await self.chart_service.create(
                chart_payload,
                commit=False,
            )

            dashboard_chart = DashboardChart(
                dashboard_id=dashboard_id,
                chart_id=chart.id,
                layout=layout,
            )
            self.db.add(dashboard_chart)

            await self.db.commit()
            return chart

        except Exception:
            await self.db.rollback()
            raise

    async def link_existing(
        self,
        dashboard_id: UUID,
        chart_id: UUID,
        layout: Optional[Mapping[str, Any]] = None,
    ) -> Tuple[Chart, bool]:
        """
        Place an existing library chart on a dashboard (no copy).
        Returns (chart, created) where created=False if already linked.
        """
        chart = await self.chart_service.get(chart_id)
        if not chart:
            raise ValueError("Chart not found")

        existing = await self.get_dashboard_chart(dashboard_id, chart_id)
        if existing:
            if layout is not None:
                existing.layout = dict(layout)
                await self.db.commit()
            return chart, False

        self.db.add(
            DashboardChart(
                dashboard_id=dashboard_id,
                chart_id=chart_id,
                layout=layout,
            )
        )
        await self.db.commit()
        return chart, True

    async def detach(
        self,
        dashboard_id: UUID,
        chart_id: UUID,
    ) -> bool:
        """Remove placement only — keeps the library chart definition."""
        rel = await self.get_dashboard_chart(dashboard_id, chart_id)
        if not rel:
            return False
        await self.db.delete(rel)
        await self.db.commit()
        return True

    async def copy_chart_to_dashboard(
        self,
        dashboard_id: UUID,
        source_chart: Chart,
        layout: Optional[Mapping[str, Any]] = None,
        title_suffix: str = " (Copy)",
    ) -> Chart:
        """Explicit detach/copy: new chart row + placement."""
        payload = {
            "data_source_id": source_chart.data_source_id,
            "chart_type": source_chart.chart_type,
            "title": f"{source_chart.title or 'Untitled'}{title_suffix}",
            "chart_query": dict(source_chart.chart_query or {}),
            "chart_options": dict(source_chart.chart_options or {}),
            "dashboard_id": str(dashboard_id),
            "user_id": source_chart.user_id,
            "project_id": source_chart.project_id,
            "collection_id": getattr(source_chart, "collection_id", None),
            "tags": list(getattr(source_chart, "tags", None) or []),
        }
        return await self.create(dashboard_id, payload, layout)

    async def get_chart(
        self,
        dashboard_id: UUID,
        chart_id: UUID,
    ) -> Optional[Chart]:
        stmt = (
            select(Chart)
            .join(DashboardChart, DashboardChart.chart_id == Chart.id)
            .where(
                DashboardChart.dashboard_id == dashboard_id,
                Chart.id == chart_id,
            )
        )

        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_charts(self, dashboard_id: UUID) -> List[Chart]:
        stmt = (
            select(Chart)
            .join(DashboardChart, DashboardChart.chart_id == Chart.id)
            .where(DashboardChart.dashboard_id == dashboard_id)
        )

        result = await self.db.execute(stmt)
        return list(result.scalars())

    async def list_charts_with_layout(
        self,
        dashboard_id: UUID,
    ) -> List[Tuple[Chart, Optional[dict]]]:
        """
        Returns list of (Chart, layout) tuples.
        """
        stmt = (
            select(Chart, DashboardChart.layout)
            .join(DashboardChart, DashboardChart.chart_id == Chart.id)
            .where(DashboardChart.dashboard_id == dashboard_id)
        )

        result = await self.db.execute(stmt)
        return result.all()

    async def update_layout(
        self,
        dashboard_id: UUID,
        chart_id: UUID,
        layout: Mapping[str, Any],
    ) -> bool:
        """
        Updates layout for a chart inside a dashboard.
        Returns False if relation does not exist.
        """
        stmt = (
            select(DashboardChart)
            .where(
                DashboardChart.dashboard_id == dashboard_id,
                DashboardChart.chart_id == chart_id,
            )
        )

        result = await self.db.execute(stmt)
        dashboard_chart = result.scalar_one_or_none()

        if not dashboard_chart:
            return False

        dashboard_chart.layout = layout
        await self.db.commit()
        return True

    async def get_dashboard_chart(
        self,
        dashboard_id: UUID,
        chart_id: UUID,
    ) -> Optional[DashboardChart]:
        stmt = (
            select(DashboardChart)
            .where(
                DashboardChart.dashboard_id == dashboard_id,
                DashboardChart.chart_id == chart_id,
            )
        )

        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
