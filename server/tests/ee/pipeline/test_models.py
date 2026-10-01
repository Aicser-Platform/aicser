import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_data_pipeline_model_shape():
    from src.modules.data.models import DataPipeline

    cols = DataPipeline.__table__.columns
    assert DataPipeline.__tablename__ == "data_pipelines"
    for name in (
        "organization_id",
        "name",
        "slug",
        "source_asset_type",
        "source_asset_id",
        "target_layer",
        "ingest_mode",
        "yaml_artifact_id",
        "schedule_cron",
        "next_run_at",
        "enabled",
    ):
        assert name in cols, f"missing column {name}"


def test_lineage_edge_carries_column_map_and_step():
    from src.modules.data.models import DataLineageEdge

    cols = DataLineageEdge.__table__.columns
    assert DataLineageEdge.__tablename__ == "data_lineage_edges"
    assert "column_map" in cols
    assert "transform_step" in cols
    assert "run_id" in cols


def test_lineage_edge_run_id_references_ingestion_job():
    from src.modules.data.models import DataLineageEdge

    run_id = DataLineageEdge.__table__.columns["run_id"]
    targets = {fk.target_fullname for fk in run_id.foreign_keys}
    assert targets == {"data_ingestion_jobs.id"}


def test_lineage_edge_identity_is_unique_with_or_without_step():
    from src.modules.data.models import DataLineageEdge

    indexes = {idx.name: idx for idx in DataLineageEdge.__table__.indexes}

    no_step = indexes["uq_data_lineage_edge_identity_no_step"]
    assert no_step.unique is True
    assert [col.name for col in no_step.columns] == [
        "from_node_id",
        "to_node_id",
    ]
    assert "transform_step IS NULL" in str(
        no_step.dialect_options["postgresql"]["where"]
    )

    with_step = indexes["uq_data_lineage_edge_identity_with_step"]
    assert with_step.unique is True
    assert [col.name for col in with_step.columns] == [
        "from_node_id",
        "to_node_id",
        "transform_step",
    ]
    assert "transform_step IS NOT NULL" in str(
        with_step.dialect_options["postgresql"]["where"]
    )


def test_ingestion_job_gains_pipeline_id():
    """data_ingestion_jobs is reinterpreted as the RUN record; definitions live in data_pipelines."""
    from src.modules.data.models import DataIngestionJob

    assert "pipeline_id" in DataIngestionJob.__table__.columns
