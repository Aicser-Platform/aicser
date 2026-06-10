import pytest

from src.modules.authentication.cookies import auth_cookie_secure


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ("true", True),
        ("1", True),
        ("yes", True),
        ("false", False),
        ("0", False),
        ("no", False),
        ("", False),
    ],
)
def test_auth_cookie_secure_explicit(monkeypatch, env, expected):
    monkeypatch.setenv("COOKIE_SECURE", env)
    assert auth_cookie_secure() is expected
