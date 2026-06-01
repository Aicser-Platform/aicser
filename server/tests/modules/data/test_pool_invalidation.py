"""Tests for Direct SQL pool invalidation hooks."""

from unittest.mock import patch

from src.modules.data.services.pool_invalidation import dispose_direct_sql_pool_for_data_source


def test_dispose_direct_sql_pool_for_data_source():
    with patch(
        "src.modules.data.services.direct_sql_pool.dispose_engine_for_data_source"
    ) as dispose:
        dispose_direct_sql_pool_for_data_source("ds-99")
        dispose.assert_called_once_with("ds-99")


def test_dispose_direct_sql_pool_ignores_empty_id():
    with patch(
        "src.modules.data.services.direct_sql_pool.dispose_engine_for_data_source"
    ) as dispose:
        dispose_direct_sql_pool_for_data_source("")
        dispose.assert_not_called()
