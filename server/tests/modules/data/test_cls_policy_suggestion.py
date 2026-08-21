import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401

from src.modules.data import router as data_router
from src.modules.data.services.data_source_access_service import DataSourceAccessService


class _Session:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)


def _source_with_schema(schema=None):
    return SimpleNamespace(
        id="ds-1",
        organization_id=None,
        schema=schema
        or {
            "tables": [
                {
                    "name": "customers",
                    "columns": [
                        {"name": "ssn", "type": "varchar"},
                        {"name": "email", "type": "varchar"},
                        {"name": "order_total", "type": "decimal"},
                    ],
                }
            ]
        },
    )


def _patch_permission(monkeypatch, *, allow=True, schema=None):
    async def active_source(_db, _data_source_id):
        return _source_with_schema(schema)

    async def can_access(*_args, **_kwargs):
        return allow

    monkeypatch.setattr(data_router, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(data_router, "_get_active_data_source_or_404", active_source)
    monkeypatch.setattr(DataSourceAccessService, "can_access", staticmethod(can_access))


@pytest.mark.asyncio
async def test_suggest_cls_policy_finds_sensitive_columns_without_persisting(monkeypatch):
    _patch_permission(monkeypatch, allow=True)
    session = _Session()

    result = await data_router.suggest_data_source_cls_policy(
        "ds-1",
        current_token={"id": "user-1"},
        db=session,
    )

    suggested = {(rule["table_name"], rule["column_name"]) for rule in result["rules"]}
    assert suggested == {("customers", "ssn"), ("customers", "email")}
    assert all(rule["action"] == "mask" for rule in result["rules"])
    assert all(rule["mask_strategy"] == "fixed" for rule in result["rules"])
    assert ("customers", "order_total") not in suggested
    assert session.added == []


@pytest.mark.asyncio
async def test_suggest_cls_policy_accepts_information_schema_column_keys(monkeypatch):
    _patch_permission(
        monkeypatch,
        allow=True,
        schema={
            "tables": [
                {
                    "name": "user",
                    "columns": [
                        {"column_name": "password", "data_type": "varchar"},
                        {"column_name": "salary", "data_type": "decimal"},
                    ],
                }
            ]
        },
    )

    result = await data_router.suggest_data_source_cls_policy(
        "ds-1",
        current_token={"id": "user-1"},
        db=_Session(),
    )

    suggested = {(rule["table_name"], rule["column_name"]) for rule in result["rules"]}
    assert ("user", "password") in suggested


@pytest.mark.asyncio
async def test_suggest_cls_policy_walks_nested_schema_tables(monkeypatch):
    _patch_permission(
        monkeypatch,
        allow=True,
        schema={
            "schemas": [
                {
                    "name": "railway",
                    "tables": [
                        {
                            "name": "user",
                            "columns": [
                                {"name": "email", "type": "varchar"},
                                {"name": "age", "type": "int"},
                            ],
                        }
                    ],
                }
            ]
        },
    )

    result = await data_router.suggest_data_source_cls_policy(
        "ds-1",
        current_token={"id": "user-1"},
        db=_Session(),
    )

    assert result["count"] == 1
    assert result["rules"][0]["table_name"] == "user"
    assert result["rules"][0]["column_name"] == "email"


@pytest.mark.asyncio
async def test_suggest_cls_policy_requires_manage_permission(monkeypatch):
    _patch_permission(monkeypatch, allow=False)

    with pytest.raises(HTTPException) as exc:
        await data_router.suggest_data_source_cls_policy(
            "ds-1",
            current_token={"id": "user-1"},
            db=_Session(),
        )

    assert exc.value.status_code == 403
