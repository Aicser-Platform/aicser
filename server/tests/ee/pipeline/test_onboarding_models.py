import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_models_are_registered_with_the_expected_tables():
    from src.modules.data.models import DataAssetProfile, DataOnboardingSession

    assert DataAssetProfile.__tablename__ == "data_asset_profiles"
    assert DataOnboardingSession.__tablename__ == "data_onboarding_sessions"


def test_profile_carries_score_and_payload_columns():
    from src.modules.data.models import DataAssetProfile

    columns = {c.name for c in DataAssetProfile.__table__.columns}
    assert {
        "organization_id",
        "lake_object_id",
        "layer",
        "row_count",
        "sampled",
        "health_score",
        "profile",
        "findings",
        "duration_ms",
    } <= columns


def test_session_carries_lifecycle_columns():
    from src.modules.data.models import DataOnboardingSession

    columns = {c.name for c in DataOnboardingSession.__table__.columns}
    assert {
        "organization_id",
        "data_source_id",
        "staging_object_id",
        "bronze_object_id",
        "profile_id",
        "status",
        "decisions",
        "error_message",
        "created_by",
    } <= columns


def test_only_one_open_session_per_source_is_allowed():
    """The partial unique index is what makes 'resume onboarding' unambiguous."""
    from src.modules.data.models import DataOnboardingSession

    indexes = {ix.name: ix for ix in DataOnboardingSession.__table__.indexes}
    open_ix = indexes["uq_data_onboarding_open_per_source"]
    assert open_ix.unique is True
    assert [c.name for c in open_ix.columns] == ["data_source_id"]


def test_the_open_session_index_is_also_scoped_by_sheet():
    """Regression: a multi-sheet workbook fans out into one open session per
    sheet, all sharing data_source_id. Without the sheet_name expression, the
    second sibling session's insert would violate the index above."""
    from src.modules.data.models import DataOnboardingSession

    indexes = {ix.name: ix for ix in DataOnboardingSession.__table__.indexes}
    open_ix = indexes["uq_data_onboarding_open_per_source"]

    assert len(open_ix.expressions) == 2
    sheet_expression = open_ix.expressions[1]
    assert "sheet_name" in str(sheet_expression)
    assert "COALESCE" in str(sheet_expression).upper()


def test_registry_imports_both_models():
    import src.db.registry as registry

    assert hasattr(registry, "DataAssetProfile")
    assert hasattr(registry, "DataOnboardingSession")
