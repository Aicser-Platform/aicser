import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_extract_column_lineage_maps_a_renamed_column():
    from src.modules.pipeline.transform.lineage import extract_column_lineage

    sql = """
    WITH s0 AS (SELECT * FROM orders),
         s1 AS (SELECT *, amount * 2 AS doubled FROM s0)
    SELECT * FROM s1
    """
    mapping = extract_column_lineage(sql)

    assert "doubled" in mapping
    assert "amount" in mapping["doubled"]


def test_extract_column_lineage_fans_in_from_two_inputs():
    """A derived column built from two source columns records both."""
    from src.modules.pipeline.transform.lineage import extract_column_lineage

    sql = """
    WITH s0 AS (SELECT * FROM orders),
         s1 AS (SELECT *, price * quantity AS revenue FROM s0)
    SELECT * FROM s1
    """
    mapping = extract_column_lineage(sql)

    assert set(mapping["revenue"]) >= {"price", "quantity"}


def test_extract_column_lineage_tracks_across_a_join():
    from src.modules.pipeline.transform.lineage import extract_column_lineage

    sql = """
    WITH s0 AS (SELECT * FROM orders),
         s1 AS (SELECT s0.id, d.region_name FROM s0 LEFT JOIN dim_region AS d ON s0.region_id = d.id)
    SELECT * FROM s1
    """
    mapping = extract_column_lineage(sql)

    assert "region_name" in mapping
    assert any("region_name" in c for c in mapping["region_name"])


def test_openlineage_event_has_job_and_io():
    from src.modules.pipeline.transform.lineage import to_openlineage_event

    event = to_openlineage_event(
        pipeline_name="orders-silver",
        pipeline_id="p1",
        run_id="r1",
        graph={
            "nodes": [
                {"id": "n1", "name": "bronze.orders", "asset_id": "a"},
                {"id": "n2", "name": "silver.orders", "asset_id": "b"},
            ],
            "edges": [{"from": "n1", "to": "n2", "column_map": {"amount": ["total"]}}],
        },
    )
    assert event["job"]["name"] == "orders-silver"
    assert event["run"]["runId"] == "r1"
    assert event["schemaURL"].startswith("https://openlineage.io/")
    assert event["inputs"][0]["name"] == "bronze.orders"
    assert event["outputs"][0]["facets"]["columnLineage"]["fields"]["amount"]["inputFields"][0]["name"] == "total"


def test_extract_column_lineage_survives_unparseable_sql():
    """Lineage is best-effort metadata; it must never fail a pipeline run."""
    from src.modules.pipeline.transform.lineage import extract_column_lineage

    assert extract_column_lineage("this is not sql at all") == {}


async def test_upsert_node_is_idempotent():
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.pipeline.transform.lineage import upsert_node

    existing_id = uuid.uuid4()
    found = MagicMock()
    found.scalar_one_or_none.return_value = MagicMock(id=existing_id)
    session = AsyncMock()
    session.execute = AsyncMock(return_value=found)
    session.add = MagicMock()

    node_id = await upsert_node(
        session,
        org_id=uuid.uuid4(),
        node_type="bronze",
        asset_id="a",
        name="orders",
    )

    assert node_id == existing_id
    session.add.assert_not_called()
