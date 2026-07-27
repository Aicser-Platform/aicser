"""Loader: discover + parse + validate a semantic/ directory."""

from pathlib import Path

from ee.modules.semantic.loader import (
    dump_raw,
    load_raw,
    load_semantic_dir,
    parse_join_on,
    validate_columns,
)

SOURCE_YML = """\
data_source_id: ds-123
dialect: duckdb
description: Orders analytics source
"""

ORDERS_YML = """\
# Orders fact table — reviewed 2026-07
table:
  name: orders
  source: analytics.public.orders
  primary_key: order_id
  description: One row per customer order, all statuses

dimensions:
  - name: order_date
    column: created_at
    type: time
    granularity: [day, month, year]
    description: Date the order was placed
  - name: country
    column: ship_country
    type: categorical
    description: Shipping destination country
    clean:
      map: { "KH": "Cambodia" }
    sample_values: [Cambodia, Thailand]

measures:
  - name: revenue_amount
    column: amount_usd
    agg: sum
    description: Raw summed order value in USD

metrics:
  - name: total_revenue
    label: Total revenue
    type: simple
    measure: revenue_amount
    filters: ["status != 'refunded'"]
    format: currency_usd
    drill_fields: [order_date, country]
    description: Booked revenue in USD, excluding refunds
    meta:
      ai_context: Use for booked revenue questions; excludes refunded orders.
"""

ITEMS_YML = """\
table:
  name: order_items
  source: analytics.public.order_items
  primary_key: order_item_id
  description: One row per ordered item

dimensions: []
measures:
  - name: item_count
    column: order_item_id
    agg: count
    description: Number of items
metrics:
  - name: total_items
    type: simple
    measure: item_count
    description: Total ordered items
"""

JOINS_YML = """\
joins:
  - left: order_items
    right: orders
    on: order_items.order_id = orders.order_id
    type: many_to_one
"""

VIEWS_YML = """\
views:
  - name: orders_view
    label: Orders View
    description: Curated order analysis surface
    meta:
      ai_context: Use this view when users ask about order revenue.
    cubes:
      - join_path: orders
        includes:
          - total_revenue
          - order_date
          - country
      - join_path: order_items.orders
        prefix: true
        includes: "*"
    default_drill_fields: [order_date, country]
"""

VIEWS_MODELS_YML = """\
views:
  - name: orders_view
    label: Orders View
    description: Curated order analysis surface
    models:
      - join_path: orders
        includes:
          - total_revenue
          - order_date
          - country
"""


def _write_dir(tmp_path: Path, files: dict) -> Path:
    root = tmp_path / "semantic" / "orders-source"
    root.mkdir(parents=True)
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return root


def _full_dir(tmp_path: Path) -> Path:
    return _write_dir(
        tmp_path,
        {
            "_source.yml": SOURCE_YML,
            "orders.yml": ORDERS_YML,
            "order_items.yml": ITEMS_YML,
            "joins.yml": JOINS_YML,
            "views.yml": VIEWS_YML,
        },
    )


def test_happy_path_loads(tmp_path):
    manifest, issues = load_semantic_dir(_full_dir(tmp_path))
    assert issues == []
    assert manifest.source.data_source_id == "ds-123"
    assert {t.table.name for t in manifest.tables} == {"orders", "order_items"}
    assert manifest.joins[0].type == "many_to_one"
    assert manifest.views[0].name == "orders_view"
    assert manifest.views[0].meta.ai_context.startswith("Use this view")
    metric = next(m for t in manifest.tables for m in t.metrics if m.name == "total_revenue")
    assert metric.drill_fields == ["order_date", "country"]
    assert metric.meta.ai_context.startswith("Use for booked revenue")


def test_view_join_path_unknown_table_is_an_issue(tmp_path):
    bad_views = VIEWS_YML.replace("join_path: orders", "join_path: customers", 1)
    root = _write_dir(
        tmp_path,
        {
            "_source.yml": SOURCE_YML,
            "orders.yml": ORDERS_YML,
            "views.yml": bad_views,
        },
    )
    manifest, issues = load_semantic_dir(root)
    assert manifest is not None
    assert any("customers" in i.message for i in issues)


def test_missing_source_binding_is_an_issue(tmp_path):
    root = _write_dir(tmp_path, {"orders.yml": ORDERS_YML})
    manifest, issues = load_semantic_dir(root)
    assert manifest is None
    assert any("_source.yml" in i.file for i in issues)


def test_malformed_yaml_reports_filename(tmp_path):
    root = _write_dir(
        tmp_path, {"_source.yml": SOURCE_YML, "orders.yml": "table: [unclosed"}
    )
    manifest, issues = load_semantic_dir(root)
    assert any(i.file.endswith("orders.yml") for i in issues)


def test_pydantic_error_mapped_to_file_path_message(tmp_path):
    bad = ORDERS_YML.replace("    description: Date the order was placed\n", "")
    root = _write_dir(tmp_path, {"_source.yml": SOURCE_YML, "orders.yml": bad})
    manifest, issues = load_semantic_dir(root)
    issue = next(i for i in issues if "description" in i.path)
    assert issue.file.endswith("orders.yml")
    assert "dimensions" in issue.path
    assert "required" in issue.message.lower()


def test_join_referencing_unknown_table_is_an_issue(tmp_path):
    joins = JOINS_YML.replace("right: orders", "right: customers")
    root = _write_dir(
        tmp_path,
        {"_source.yml": SOURCE_YML, "orders.yml": ORDERS_YML, "joins.yml": joins},
    )
    manifest, issues = load_semantic_dir(root)
    assert any("customers" in i.message for i in issues)


def test_model_local_joins_are_loaded_without_joins_yml(tmp_path):
    items_with_join = ITEMS_YML + """\

joins:
  - left: order_items
    right: orders
    on: order_items.order_id = orders.order_id
    type: many_to_one
"""
    root = _write_dir(
        tmp_path,
        {
            "_source.yml": SOURCE_YML,
            "orders.yml": ORDERS_YML,
            "order_items.yml": items_with_join,
        },
    )
    manifest, issues = load_semantic_dir(root)
    assert issues == []
    assert manifest is not None
    assert len(manifest.joins) == 1
    assert manifest.joins[0].left == "order_items"
    assert manifest.joins[0].right == "orders"


def test_unparseable_metric_filter_names_metric(tmp_path):
    bad = ORDERS_YML.replace(
        'filters: ["status != \'refunded\'"]',
        'filters: ["status != refunded OR 1=1"]',
    )
    root = _write_dir(tmp_path, {"_source.yml": SOURCE_YML, "orders.yml": bad})
    manifest, issues = load_semantic_dir(root)
    assert any("total_revenue" in i.message for i in issues)


def test_duplicate_table_names_across_files(tmp_path):
    dup = ITEMS_YML.replace("name: order_items", "name: orders", 1)
    root = _write_dir(
        tmp_path,
        {"_source.yml": SOURCE_YML, "orders.yml": ORDERS_YML, "dup.yml": dup},
    )
    manifest, issues = load_semantic_dir(root)
    assert any("duplicate table" in i.message for i in issues)


def test_validate_columns_flags_missing_column(tmp_path):
    manifest, issues = load_semantic_dir(_full_dir(tmp_path))
    assert issues == []
    schema_info = {
        "tables": [
            {"name": "orders", "columns": [{"name": "created_at"}, {"name": "amount_usd"}]},
            {"name": "order_items", "columns": [{"name": "order_item_id"}]},
        ]
    }
    col_issues = validate_columns(manifest, schema_info)
    # ship_country is not in the schema above
    assert any("ship_country" in i.message for i in col_issues)
    assert not any("amount_usd" in i.message for i in col_issues)


def test_parse_join_on():
    assert parse_join_on("order_items.order_id = orders.order_id") == (
        "order_items", "order_id", "orders", "order_id"
    )


def test_parse_join_on_quoted_columns():
    assert parse_join_on('subjects."universityId" = universities.id') == (
        "subjects", "universityId", "universities", "id"
    )


def test_loads_separate_view_files_with_models_key(tmp_path):
    root = _write_dir(
        tmp_path,
        {
            "_source.yml": SOURCE_YML,
            "model/tables/orders.yml": ORDERS_YML,
            "model/views/orders_view.yml": VIEWS_MODELS_YML,
        },
    )
    manifest, issues = load_semantic_dir(root)
    assert issues == []
    assert manifest.views[0].name == "orders_view"
    assert manifest.views[0].cubes[0].join_path == "orders"


def test_round_trip_preserves_comments(tmp_path):
    root = _full_dir(tmp_path)
    path = root / "orders.yml"
    doc = load_raw(path)
    doc["table"]["description"] = "Updated description"
    dump_raw(doc, path)
    text = path.read_text()
    assert "# Orders fact table — reviewed 2026-07" in text
    assert "Updated description" in text
