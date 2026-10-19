import pytest


@pytest.fixture(autouse=True)
def _no_policy_origins(monkeypatch):
    """Tests here that replay a fixed sequence of database results cover one source's own
    policies; inherited (origin) policies are covered in test_policy_lineage.py, which sets its own."""
    try:
        from ee.modules.data.services import policy_lineage
    except ImportError:
        return

    async def none(*_args, **_kwargs):
        return []

    monkeypatch.setattr(policy_lineage, "origins_for", none)


@pytest.fixture(autouse=True)
def _no_label_policies(monkeypatch):
    """Same for label policies: covered in test_catalog_labels.py."""
    try:
        from ee.modules.catalog import labels
    except ImportError:
        return

    async def none(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(labels, "label_decisions", none)
