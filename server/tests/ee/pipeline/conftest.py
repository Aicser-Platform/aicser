import pytest


@pytest.fixture(autouse=True)
def _encryption_not_required(monkeypatch):
    """Stage tests run on mock sessions: the organization's lakehouse settings default to
    "encryption at rest not required" (test_s3_lake_end_to_end covers the requirement)."""
    async def defaults(_session, _org_id):
        return {"require_encryption_at_rest": False}

    try:
        monkeypatch.setattr("src.modules.pipeline.lakehouse_settings.get_org_lakehouse_settings", defaults)
    except (ImportError, AttributeError):
        pass
