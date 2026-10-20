"""Source SQL quotes names the way each engine expects (MySQL rejected "orders")."""

import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_identifiers_and_limits_per_engine():
    from src.modules.pipeline.ingest.sql_columns import build_select_columns, quote_table, select_limited, sql_dialect

    assert quote_table("orders", "mysql") == "`orders`"
    assert quote_table("dbo.orders", "sqlserver") == "[dbo].[orders]"
    assert quote_table("sales.orders", "postgresql") == '"sales"."orders"'
    assert quote_table('"sales"."orders"', "mysql") == "`sales`.`orders`"
    assert build_select_columns(["id", "region"], {"region": "area"}, "mysql") == "`id`, `region` AS `area`"
    assert select_limited("*", "[dbo].[orders]", 10, "sqlserver") == "SELECT TOP 10 * FROM [dbo].[orders]"
    assert select_limited("*", '"orders"', 10, "postgresql") == 'SELECT * FROM "orders" LIMIT 10'
    assert sql_dialect({"db_type": "MySQL"}) == "mysql"
    assert sql_dialect(type("DS", (), {"db_type": None, "connection_config": {"type": "sqlserver"}, "type": "database"})()) == "sqlserver"


def test_watermark_source_quotes_for_its_engine():
    from src.modules.pipeline.ingest.watermark_source import WatermarkSource

    src = WatermarkSource(None, "orders", watermark_column="updated_at", dialect="mysql")
    assert src._select(where=" WHERE `updated_at` > :since") == (
        "SELECT * FROM `orders` WHERE `updated_at` > :since ORDER BY `updated_at` ASC"
    )
    assert WatermarkSource(None, "dbo.orders", dialect="sqlserver")._select() == "SELECT * FROM [dbo].[orders]"


def test_sql_server_ingest_url_names_the_odbc_driver():
    """Without the driver in the URL pyodbc fails with IM002 ("no default driver")."""
    from src.modules.data.services.multi_engine_query_service import DirectSQLArrowExecutor

    ds = {"db_type": "sqlserver", "connection_config": {"type": "sqlserver", "host": "db", "port": 1433, "database": "e2e",
                                                          "username": "sa", "password": "p@ss"}}
    uri = DirectSQLArrowExecutor(ds)._connection_uri()
    assert uri.startswith("mssql+pyodbc://sa:p%40ss@db:1433/e2e?")
    assert "driver=ODBC+Driver+18+for+SQL+Server" in uri and "TrustServerCertificate=yes" in uri
    pg = DirectSQLArrowExecutor({"db_type": "postgresql", "connection_config": {"host": "h", "database": "d", "username": "u"}})
    assert "?" not in pg._connection_uri()
