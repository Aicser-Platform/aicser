"""Charts created on a dashboard belong to their creator and the dashboard's project, so the
chart library (which authorises by owner or project) can manage them."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from src.modules.charts.services.v2 import dashboard_chart_service as dcs


class _Db:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def rollback(self):
        pass


@pytest.mark.asyncio
async def test_new_dashboard_chart_gets_owner_and_project():
    project, user = uuid.uuid4(), uuid.uuid4()
    service = dcs.DashboardChartService(_Db())
    created = {}

    async def create(payload, commit=True):
        created.update(payload)
        return type("C", (), {"id": uuid.uuid4()})()

    with patch("src.modules.data.services.project_scope.dashboard_project", AsyncMock(return_value=str(project))), \
         patch("src.modules.data.services.project_scope.ensure_source_in_project", AsyncMock()), \
         patch.object(service.chart_service, "create", side_effect=create):
        await service.create(uuid.uuid4(), {"chart_type": "bar", "data_source_id": "ds"}, None, user_id=str(user))

    assert created["project_id"] == project and created["user_id"] == user


@pytest.mark.asyncio
async def test_explicit_owner_and_project_are_kept():
    keep_project, keep_user = uuid.uuid4(), uuid.uuid4()
    service = dcs.DashboardChartService(_Db())
    created = {}

    async def create(payload, commit=True):
        created.update(payload)
        return type("C", (), {"id": uuid.uuid4()})()

    with patch("src.modules.data.services.project_scope.dashboard_project", AsyncMock(return_value=str(uuid.uuid4()))), \
         patch("src.modules.data.services.project_scope.ensure_source_in_project", AsyncMock()), \
         patch.object(service.chart_service, "create", side_effect=create):
        await service.create(
            uuid.uuid4(),
            {"chart_type": "bar", "project_id": keep_project, "user_id": keep_user},
            None,
            user_id=str(uuid.uuid4()),
        )

    assert created["project_id"] == keep_project and created["user_id"] == keep_user
