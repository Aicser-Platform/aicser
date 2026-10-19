from src.modules.pipeline.run_errors import SOURCE_MISSING, error_code_for, user_error


def test_missing_file_becomes_an_action():
    msg = user_error("[Errno 2] No such file or directory: '/app/lake/user_files/abc/def'")
    assert msg.startswith("The source file is no longer available") and "/app" not in msg


def test_other_errors_lose_server_paths_only():
    assert user_error("Permission denied: /tmp/x/y.parquet") == "Permission denied: …"
    assert user_error("Column \"a\" not found") == "Column \"a\" not found"
    assert user_error(None) is None


def test_missing_file_gets_an_actionable_code_even_for_old_runs():
    assert error_code_for("[Errno 2] No such file or directory: '/app/x'", "stage_failed") == SOURCE_MISSING
    assert error_code_for("Column \"a\" not found", "stage_failed") == "stage_failed"
