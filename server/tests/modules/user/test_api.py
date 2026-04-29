from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
import pytest
from sqlalchemy.orm import declarative_base  # Updated import for SQLAlchemy 2.0

user_api_mod = pytest.importorskip("app.modules.user.api")
router = user_api_mod.router

# Test Configuration
Base = declarative_base()


@pytest.fixture(scope="session")
def app():
    app = FastAPI()
    app.include_router(router, prefix="/users")
    return app


@pytest.fixture(scope="session")
def test_client(app):
    with TestClient(app) as client:
        yield client


@pytest.fixture(autouse=True)
def mock_auth():
    with patch("app.modules.user.api.TokenDep") as mock:
        mock.return_value = None
        yield mock


@pytest.fixture
def mock_user_service():
    with patch("app.modules.user.api.service") as mock:
        yield mock


class TestUserAPI:
    def test_get_user(self, test_client, mock_user_service):
        mock_user = {"id": 1, "email": "test@example.com", "name": "Test User"}
        mock_user_service.get_user.return_value = mock_user

        response = test_client.get(
            "/users/1", headers={"Authorization": "Bearer test-token"}
        )

        assert response.status_code == 200
        assert response.json() == mock_user

    def test_update_user(self, test_client, mock_user_service):
        user_data = {"name": "Updated", "email": "updated@test.com"}
        mock_user_service.update_user.return_value = {**user_data, "id": 1}

        response = test_client.put(
            "/users/1", headers={"Authorization": "Bearer test-token"}, json=user_data
        )

        assert response.status_code == 200
        assert response.json()["name"] == user_data["name"]

    def test_get_me(self, test_client, mock_user_service):
        mock_user = {"id": 1, "email": "me@test.com", "name": "Current User"}
        mock_user_service.get_me.return_value = mock_user

        response = test_client.get(
            "/users/me", headers={"Authorization": "Bearer test-token"}
        )

        assert response.status_code == 200
        assert response.json() == mock_user

    def test_sign_in(self, test_client, mock_user_service):
        credentials = {"email": "user@test.com", "password": "password"}
        token_response = {"access_token": "test-token", "token_type": "bearer"}
        mock_user_service.sign_in.return_value = token_response

        response = test_client.post("/users/sign-in", json=credentials)

        assert response.status_code == 200
        assert response.json() == token_response
