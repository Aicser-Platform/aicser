from src.modules.data.utils.masking import (
    MASKED_VALUE,
    is_sensitive_result_column,
    mask_query_result_rows,
    sensitive_query_result_masking_enabled,
)


def test_sensitive_result_column_detection_handles_camel_case_and_payroll_terms():
    assert is_sensitive_result_column("accessToken")
    assert is_sensitive_result_column("refreshToken")
    assert is_sensitive_result_column("idToken")
    assert is_sensitive_result_column("employeeSalary")
    assert is_sensitive_result_column("base_salary")
    assert not is_sensitive_result_column("userId")
    assert not is_sensitive_result_column("accountId")


def test_mask_query_result_rows_masks_sensitive_values_without_mutating_input():
    rows = [
        {
            "id": "1",
            "userId": "u1",
            "accessToken": "secret-token",
            "password": "secret-password",
            "salary": 1000,
        }
    ]

    masked_rows, masked_columns = mask_query_result_rows(
        rows,
        ["id", "userId", "accessToken", "password", "salary"],
        enabled=True,
    )

    assert masked_columns == ["accessToken", "password", "salary"]
    assert masked_rows[0]["id"] == "1"
    assert masked_rows[0]["userId"] == "u1"
    assert masked_rows[0]["accessToken"] == MASKED_VALUE
    assert masked_rows[0]["password"] == MASKED_VALUE
    assert masked_rows[0]["salary"] == MASKED_VALUE
    assert rows[0]["accessToken"] == "secret-token"


def test_mask_query_result_rows_can_be_disabled_for_admin_debugging():
    rows = [{"accessToken": "secret-token"}]

    masked_rows, masked_columns = mask_query_result_rows(rows, ["accessToken"], enabled=False)

    assert masked_columns == []
    assert masked_rows == rows


def test_sensitive_query_result_masking_is_default_on_with_env_override(monkeypatch):
    monkeypatch.delenv("AICSER_ALLOW_SENSITIVE_QUERY_RESULTS", raising=False)
    monkeypatch.delenv("AICSER_MASK_SENSITIVE_QUERY_RESULTS", raising=False)
    assert sensitive_query_result_masking_enabled()

    monkeypatch.setenv("AICSER_ALLOW_SENSITIVE_QUERY_RESULTS", "true")
    assert not sensitive_query_result_masking_enabled()

    monkeypatch.setenv("AICSER_ALLOW_SENSITIVE_QUERY_RESULTS", "false")
    monkeypatch.setenv("AICSER_MASK_SENSITIVE_QUERY_RESULTS", "false")
    assert not sensitive_query_result_masking_enabled()
