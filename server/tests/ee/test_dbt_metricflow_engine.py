import asyncio
import os
import shutil
import tempfile
import uuid
import duckdb

from src.modules.pipeline.dbt.generator import DbtGenerator
from src.modules.pipeline.dbt.runner import DataQualityError, DbtDuckdbRunner
from src.modules.pipeline.dbt.schemas import (
    DbtGenerationRequest,
    DiscoveredColumn,
    DiscoveredStreamSchema,
    SemanticQueryFilter,
    SemanticQueryRequest,
)
from src.modules.pipeline.dbt.semantic_engine import MetricFlowSemanticEngine


def test_dbt_project_generation():
    """Verify programmatic dbt project and MetricFlow YAML generation."""
    org_id = uuid.uuid4()

    orders_stream = DiscoveredStreamSchema(
        stream_name="orders",
        primary_key="id",
        cursor_field="updated_at",
        columns=[
            DiscoveredColumn(name="id", raw_type="int", inferred_type="BIGINT", is_primary_key=True),
            DiscoveredColumn(name="customer_id", raw_type="int", inferred_type="BIGINT", is_foreign_key=True, foreign_table="customers", foreign_column="id"),
            DiscoveredColumn(name="amount", raw_type="varchar", inferred_type="DECIMAL(18,4)"),
            DiscoveredColumn(name="updated_at", raw_type="timestamp", inferred_type="TIMESTAMP", is_cursor=True),
            DiscoveredColumn(name="order_date", raw_type="date", inferred_type="DATE"),
            DiscoveredColumn(name="status", raw_type="varchar", inferred_type="VARCHAR"),
        ],
    )

    customers_stream = DiscoveredStreamSchema(
        stream_name="customers",
        primary_key="id",
        columns=[
            DiscoveredColumn(name="id", raw_type="int", inferred_type="BIGINT", is_primary_key=True),
            DiscoveredColumn(name="name", raw_type="varchar", inferred_type="VARCHAR"),
            DiscoveredColumn(name="region", raw_type="varchar", inferred_type="VARCHAR"),
        ],
    )

    req = DbtGenerationRequest(
        pipeline_name="E-Commerce Store",
        streams=[orders_stream, customers_stream],
        target_layer="gold",
    )

    result = DbtGenerator.generate_project(org_id=org_id, request=req)

    assert result.project_name.startswith(f"aiser_{str(org_id)[:8]}")
    assert os.path.isdir(result.project_dir)

    paths = [f.path for f in result.files]
    assert "dbt_project.yml" in paths
    assert "profiles.yml" in paths
    assert "models/sources.yml" in paths
    assert "models/silver/silver_orders.sql" in paths
    assert "models/silver/silver_customers.sql" in paths
    assert "models/gold/fct_orders.sql" in paths
    assert "models/gold/dim_customers.sql" in paths
    assert "models/schema.yml" in paths
    assert "models/semantic/semantic_models.yml" in paths
    assert "models/semantic/metrics.yml" in paths

    # Verify Silver SQL contains incremental merge logic
    silver_sql = next(f.content for f in result.files if f.path == "models/silver/silver_orders.sql")
    assert "materialized='incremental'" in silver_sql
    assert "unique_key='id'" in silver_sql
    assert "is_incremental()" in silver_sql
    assert "TRY_CAST(REPLACE" in silver_sql  # amount cast

    # Verify schema.yml contains unique and not_null tests
    schema_yaml = next(f.content for f in result.files if f.path == "models/schema.yml")
    assert "tests:" in schema_yaml
    assert "- unique" in schema_yaml
    assert "- not_null" in schema_yaml
    assert "relationships:" in schema_yaml

    # Verify MetricFlow semantic models and metrics
    sm_yaml = next(f.content for f in result.files if f.path == "models/semantic/semantic_models.yml")
    assert "semantic_models:" in sm_yaml
    assert "measures:" in sm_yaml
    assert "entities:" in sm_yaml

    metrics_yaml = next(f.content for f in result.files if f.path == "models/semantic/metrics.yml")
    assert "total_amount" in metrics_yaml
    assert "orders_volume" in metrics_yaml

    # Clean up test project directory
    shutil.rmtree(os.path.dirname(result.project_dir), ignore_errors=True)


async def test_dbt_duckdb_quality_tests():
    """Verify automated dbt tests catch nulls and duplicates and raise DataQualityError."""
    org_id = uuid.uuid4()
    runner = DbtDuckdbRunner(org_id=org_id, pipeline_slug="test_slug")

    conn = duckdb.connect(":memory:")

    # 1. Clean dataset
    conn.execute("CREATE TABLE clean_table (id BIGINT, updated_at TIMESTAMP)")
    conn.execute("INSERT INTO clean_table VALUES (1, '2026-01-01'), (2, '2026-01-02')")

    p, f = await runner.run_quality_tests(conn, "clean_table", pk_col="id", cursor_col="updated_at")
    assert p == 3
    assert f == 0

    # 2. Table with duplicates on primary key
    conn.execute("CREATE TABLE dup_table (id BIGINT, updated_at TIMESTAMP)")
    conn.execute("INSERT INTO dup_table VALUES (1, '2026-01-01'), (1, '2026-01-02')")

    dup_caught = False
    try:
        await runner.run_quality_tests(conn, "dup_table", pk_col="id")
    except DataQualityError as e:
        dup_caught = True
        assert e.test_name == "unique"
        assert e.failures_count == 1
    assert dup_caught, "Duplicate primary key was not caught"

    # 3. Table with NULL primary key
    conn.execute("CREATE TABLE null_table (id BIGINT, updated_at TIMESTAMP)")
    conn.execute("INSERT INTO null_table VALUES (NULL, '2026-01-01')")

    null_caught = False
    try:
        await runner.run_quality_tests(conn, "null_table", pk_col="id")
    except DataQualityError as e:
        null_caught = True
        assert e.test_name == "not_null"
    assert null_caught, "Null primary key was not caught"

    conn.close()


async def test_metricflow_query_compilation_and_execution():
    """Verify MetricFlow compiles metric requests into deterministic SQL and executes via DuckDB."""
    org_id = uuid.uuid4()

    # Generate sample project for this tenant
    stream = DiscoveredStreamSchema(
        stream_name="orders",
        primary_key="id",
        cursor_field="updated_at",
        columns=[
            DiscoveredColumn(name="id", raw_type="int", inferred_type="BIGINT", is_primary_key=True),
            DiscoveredColumn(name="amount", raw_type="decimal", inferred_type="DECIMAL(18,4)"),
            DiscoveredColumn(name="order_date", raw_type="timestamp", inferred_type="TIMESTAMP"),
            DiscoveredColumn(name="region", raw_type="varchar", inferred_type="VARCHAR"),
        ],
    )
    req = DbtGenerationRequest(
        pipeline_name="Analytics",
        streams=[stream],
        target_layer="gold",
    )
    DbtGenerator.generate_project(org_id=org_id, request=req)

    engine = MetricFlowSemanticEngine(org_id=org_id)

    # 1. Test catalog retrieval
    catalog = engine.get_catalog()
    assert len(catalog.semantic_models) >= 1
    assert len(catalog.metrics) >= 1
    metric_names = {m.name for m in catalog.metrics}
    assert "total_amount" in metric_names

    # 2. Test SQL compilation
    query_req = SemanticQueryRequest(
        metrics=["total_amount", "orders_volume"],
        dimensions=["order_date__month", "region"],
        filters=[
            SemanticQueryFilter(field="amount", operator=">", value=50),
            SemanticQueryFilter(field="region", operator="=", value="US-East"),
        ],
        limit=100,
    )
    sql = engine.compile_semantic_query(query_req)

    # Assert SQL structure
    assert "SELECT" in sql
    assert "DATE_TRUNC('month', silver_orders.order_date) AS order_date__month" in sql
    assert "silver_orders.region AS region" in sql
    assert "SUM(silver_orders.amount) AS amount_sum" in sql
    assert "COUNT(silver_orders.id) AS orders_count" in sql
    assert "FROM silver_orders" in sql
    assert "WHERE silver_orders.amount > 50 AND silver_orders.region = 'US-East'" in sql
    assert "GROUP BY 1, 2" in sql
    assert "ORDER BY 1 DESC" in sql

    # 3. Test execution
    res = await engine.execute_query(query_req)
    assert res.sql == sql
    assert "order_date__month" in res.columns
    assert "amount_sum" in res.columns
    assert res.execution_time_ms >= 0

    # Clean up test project directory
    shutil.rmtree(os.path.join("/app/dbt_projects", str(org_id)), ignore_errors=True)
