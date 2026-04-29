import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

from fastapi.testclient import TestClient
from src.main import app


@pytest.mark.integration
def test_create_and_delete_data_source(monkeypatch):
    client = TestClient(app)

    async def fake_verify(request, organization_id, project_id):
        return True

    monkeypatch.setattr('app.modules.data.api.verify_project_access', fake_verify)

    # Create a simple file data source via project API
    payload = {
        'name': 'test-delete-source',
        'type': 'file',
        'description': 'created for delete test',
        'config': {},
        'metadata': {'created_via': 'test'}
    }

    r = client.post('/data/api/organizations/1/projects/1/data-sources', json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body.get('success') is True
    ds = body.get('data_source')
    assert ds and ds.get('id')

    ds_id = ds.get('id')

    # Now delete via the delete endpoint
    dr = client.delete(f'/data/sources/{ds_id}')
    assert dr.status_code == 200
    dbody = dr.json()
    assert dbody.get('success') is True


