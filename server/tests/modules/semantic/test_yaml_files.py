"""YAML file helpers for the IDE editor endpoints: resolve, list, safe write."""

import pytest

from ee.modules.semantic.yaml_files import (
    list_yaml_files,
    resolve_semantic_dir,
    safe_yaml_path,
    save_yaml_file,
)

from tests.modules.semantic.test_loader import _full_dir


@pytest.fixture
def semantic_root(tmp_path):
    _full_dir(tmp_path)  # creates tmp_path/semantic/orders-source bound to ds-123
    return tmp_path / "semantic"


def test_resolve_semantic_dir_by_binding(semantic_root):
    d = resolve_semantic_dir(semantic_root, "ds-123")
    assert d is not None and d.name == "orders-source"


def test_resolve_unknown_source_returns_none(semantic_root):
    assert resolve_semantic_dir(semantic_root, "nope") is None


def test_list_yaml_files_returns_contents_and_issues(semantic_root):
    result = list_yaml_files(semantic_root, "ds-123")
    paths = {f["path"] for f in result["files"]}
    assert "orders-source/_source.yml" in paths
    assert "orders-source/orders.yml" in paths
    orders = next(f for f in result["files"] if f["path"].endswith("orders.yml"))
    assert "total_revenue" in orders["content"]
    assert result["issues"] == []
    assert result["dir"].endswith("orders-source")


def test_list_yaml_files_unknown_source(semantic_root):
    assert list_yaml_files(semantic_root, "nope") is None


@pytest.mark.parametrize(
    "bad",
    [
        "../outside.yml",
        "orders-source/../../etc/passwd.yml",
        "/etc/passwd.yml",
        "orders-source/orders.txt",
    ],
)
def test_safe_yaml_path_rejects(semantic_root, bad):
    with pytest.raises(ValueError):
        safe_yaml_path(semantic_root, bad)


def test_safe_yaml_path_rejects_symlink_escape(semantic_root, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (semantic_root / "link").symlink_to(outside)
    with pytest.raises(ValueError):
        safe_yaml_path(semantic_root, "link/sneaky.yml")


def test_save_yaml_file_writes_and_validates(semantic_root):
    rel = "orders-source/orders.yml"
    original = (semantic_root / rel).read_text()
    updated = original.replace(
        "description: Booked revenue in USD, excluding refunds",
        "description: Booked revenue (USD), refunds excluded",
    )
    result = save_yaml_file(semantic_root, rel, updated)
    assert result["success"] is True
    assert result["issues"] == []
    assert "refunds excluded" in (semantic_root / rel).read_text()


def test_save_malformed_yaml_still_writes_but_reports(semantic_root):
    rel = "orders-source/orders.yml"
    result = save_yaml_file(semantic_root, rel, "table: [unclosed")
    assert result["success"] is False
    assert any("orders.yml" in i["file"] for i in result["issues"])
    # the write happened — the editor round-trips what the user typed
    assert (semantic_root / rel).read_text() == "table: [unclosed"


def test_save_new_file_in_existing_dir(semantic_root):
    rel = "orders-source/customers.yml"
    content = (
        "table:\n"
        "  name: customers\n"
        "  source: public.customers\n"
        "  primary_key: customer_id\n"
        "  description: One row per customer\n"
        "dimensions: []\n"
        "measures: []\n"
        "metrics: []\n"
    )
    result = save_yaml_file(semantic_root, rel, content)
    assert result["success"] is True
    assert (semantic_root / rel).exists()


def test_draft_yaml_directory_creates_and_validates(tmp_path):
    from ee.modules.semantic.yaml_files import draft_yaml_directory

    root = tmp_path / "semantic"
    root.mkdir()
    schema_info = {
        "tables": [{
            "name": "loans",
            "schema": "public",
            "columns": [
                {"name": "loan_id", "type": "varchar"},
                {"name": "loan_amount", "type": "double"},
            ],
        }]
    }
    result = draft_yaml_directory(root, "ds-new", schema_info, "duckdb", "My Loans!")
    assert result["dir"].endswith("my-loans")
    assert any(p.endswith("model/tables/loans.yml") for p in result["written"])
    assert any(p.endswith("model/views/loans_view.yml") for p in result["written"])
    listed = list_yaml_files(root, "ds-new")
    assert listed is not None and listed["issues"] == []


def test_draft_yaml_directory_snake_cases_database_identifiers(tmp_path):
    from ee.modules.semantic.yaml_files import draft_yaml_directory

    root = tmp_path / "semantic"
    root.mkdir()
    schema_info = {
        "tables": [{
            "name": "AttemptAnswer",
            "schema": "public",
            "columns": [
                {"name": "attemptId", "type": "varchar"},
                {"name": "selectedIndex", "type": "integer"},
                {"name": "isCorrect", "type": "boolean"},
            ],
        }, {
            "name": "User",
            "schema": "public",
            "columns": [
                {"name": "id", "type": "varchar"},
                {"name": "streak", "type": "integer"},
            ],
        }]
    }
    draft_yaml_directory(root, "ds-camel", schema_info, "postgresql", "QuizMedix")
    listed = list_yaml_files(root, "ds-camel")
    assert listed is not None
    assert listed["issues"] == []
    paths = {f["path"] for f in listed["files"]}
    assert "quizmedix/model/tables/attempt_answer.yml" in paths
    content = next(f["content"] for f in listed["files"] if f["path"].endswith("attempt_answer.yml"))
    assert "name: attempt_answer" in content
    assert "name: selected_index" in content
    assert "measure: selected_index" in content
    assert "column: '\"selectedIndex\"'" in content
    assert "quizmedix/model/tables/table_user.yml" in paths
    assert "quizmedix/model/views/attempt_answer_view.yml" in paths


def test_draft_refuses_when_slug_and_suffix_directories_exist(semantic_root):
    from ee.modules.semantic.yaml_files import draft_yaml_directory

    (semantic_root / "orders-source-ds123").mkdir()
    with pytest.raises(ValueError, match="already exists"):
        draft_yaml_directory(semantic_root, "ds-123", {"tables": []}, "duckdb", "orders source")


def test_draft_uses_data_source_suffix_when_source_name_collides(semantic_root):
    from ee.modules.semantic.yaml_files import draft_yaml_directory, list_yaml_files

    schema_info = {
        "tables": [{
            "name": "customers",
            "schema": "public",
            "columns": [{"name": "customer_id", "type": "varchar"}],
        }]
    }
    result = draft_yaml_directory(semantic_root, "ds-456", schema_info, "duckdb", "orders source")
    assert result["dir"].endswith("orders-source-ds456")
    listed = list_yaml_files(semantic_root, "ds-456")
    assert listed is not None
    assert any(p["path"].startswith("orders-source-ds456/") for p in listed["files"])


def test_semantic_router_normalizes_flat_file_schema_for_drafting():
    from ee.modules.ai.semantic_router import _normalize_schema_for_semantic

    schema = {
        "columns": [
            {"name": "revenue_usd", "type": "number"},
            {"name": "category", "type": "string"},
        ]
    }
    normalized = _normalize_schema_for_semantic(schema)
    assert normalized["tables"] == [
        {
            "name": "data",
            "schema": "main",
            "columns": schema["columns"],
        }
    ]
