"""Introspection: draft semantic YAML from a stored data-source schema."""

from pathlib import Path

from ee.modules.semantic.introspect import draft_manifest_files
from ee.modules.semantic.loader import load_semantic_dir

SCHEMA_INFO = {
    "tables": [
        {
            "name": "loans",
            "schema": "public",
            "columns": [
                {"name": "loan_id", "type": "varchar"},
                {"name": "disbursement_date", "type": "timestamp"},
                {"name": "branch", "type": "varchar"},
                {"name": "loan_amount", "type": "double"},
                {"name": "is_delinquent", "type": "boolean"},
                {"name": "notes", "type": "text"},
            ],
        }
    ]
}

DISTINCT = {"loans.branch": 12, "loans.notes": 4000}
SAMPLES = {"loans.branch": ["Phnom Penh", "Siem Reap"]}


def _generate(tmp_path: Path) -> Path:
    files = draft_manifest_files(
        SCHEMA_INFO,
        data_source_id="ds-loans",
        dialect="duckdb",
        source_name="loans-source",
        sample_values=SAMPLES,
        distinct_counts=DISTINCT,
    )
    root = tmp_path / "semantic" / "loans-source"
    root.mkdir(parents=True)
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return root


def test_emits_source_joins_and_table_files(tmp_path):
    root = _generate(tmp_path)
    names = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}
    assert names == {"_source.yml", "joins.yml", "model/tables/loans.yml", "model/views/loans_view.yml"}


def test_generated_files_validate_cleanly(tmp_path):
    manifest, issues = load_semantic_dir(_generate(tmp_path))
    assert issues == []
    assert manifest.source.data_source_id == "ds-loans"


def test_column_role_heuristics(tmp_path):
    manifest, _ = load_semantic_dir(_generate(tmp_path))
    table = manifest.tables[0]
    dims = {d.name: d for d in table.dimensions}
    measures = {m.name: m for m in table.measures}

    assert dims["disbursement_date"].type == "time"
    assert dims["disbursement_date"].granularity == ["day", "week", "month", "year"]
    assert dims["branch"].type == "categorical"
    assert dims["branch"].sample_values == ["Phnom Penh", "Siem Reap"]
    assert dims["is_delinquent"].type == "boolean"
    assert "notes" not in dims          # 4000 distinct values → not a dimension
    assert "loan_amount" in measures
    assert "loan_id" not in measures    # id column is not a measure
    assert table.table.primary_key == "loan_id"


def test_drafted_metrics(tmp_path):
    manifest, _ = load_semantic_dir(_generate(tmp_path))
    metric_names = {m.name for m in manifest.tables[0].metrics}
    assert "total_loan_amount" in metric_names
    assert "loans_count" in metric_names


def test_drafted_view_exposes_curated_fields(tmp_path):
    manifest, _ = load_semantic_dir(_generate(tmp_path))
    assert manifest.views[0].name == "loans_view"
    assert manifest.views[0].meta.ai_context
    includes = manifest.views[0].cubes[0].includes
    assert "total_loan_amount" in includes
    assert "branch" in includes


def test_todo_review_markers_present(tmp_path):
    root = _generate(tmp_path)
    text = (root / "model/tables/loans.yml").read_text()
    assert "TODO: review" in text


def test_drafted_view_uses_aicser_models_key(tmp_path):
    root = _generate(tmp_path)
    text = (root / "model/views/loans_view.yml").read_text()
    assert "models:" in text
    assert "cubes:" not in text


def test_drafts_foreign_key_joins_with_quoted_columns(tmp_path):
    schema = {
        "tables": [
            {
                "name": "Subject",
                "schema": "public",
                "columns": [
                    {"name": "id", "type": "varchar"},
                    {"name": "universityId", "type": "varchar"},
                    {"name": "questionCount", "type": "int"},
                ],
            },
            {
                "name": "University",
                "schema": "public",
                "columns": [
                    {"name": "id", "type": "varchar"},
                    {"name": "name", "type": "varchar"},
                ],
            },
        ]
    }
    files = draft_manifest_files(schema, data_source_id="ds", dialect="postgres", source_name="quiz")
    assert 'subject."universityId" = university.id' in files["joins.yml"]
