"""Pointer-only contract: facts, blobs, and signed URLs are defects."""
import pytest

from ee.modules.ontology.pointer_contract import (
    PointerContractError,
    looks_like_presigned_url,
    prompt_block,
    sanitize_props,
    tokenize_question,
    validate_node,
    validate_pointer,
)


def test_rejects_warehouse_facts_on_nodes():
    with pytest.raises(PointerContractError, match="Forbidden"):
        sanitize_props({"revenue": 1200000})


def test_rejects_file_bytes_and_chunk_text():
    with pytest.raises(PointerContractError, match="Forbidden"):
        sanitize_props({"content": "lorem ipsum from the PDF"})
    with pytest.raises(PointerContractError, match="Forbidden"):
        sanitize_props({"bytes": "AAAA"})


def test_rejects_presigned_url_as_ptr():
    sas = "https://acct.blob.core.windows.net/c/k?sv=2023&se=2026&sig=abc"
    assert looks_like_presigned_url(sas)
    with pytest.raises(PointerContractError, match="signed"):
        validate_pointer(sas, "s3")


def test_accepts_canonical_s3_and_metric_pointers():
    assert validate_pointer("s3://lake/org/1/bronze/orders.parquet", "s3")[1] == "s3"
    assert validate_pointer("metric-uuid-1", "metric")[0] == "metric-uuid-1"
    node = validate_node(
        kind="Metric",
        ptr="m1",
        ptr_type="metric",
        tenant_id="org-1",
        props={"name": "Revenue", "certified": True},
    )
    assert node["props"]["certified"] is True
    assert "expression" not in node["props"]


def test_requires_tenant():
    with pytest.raises(PointerContractError, match="tenant"):
        validate_node(kind="Entity", ptr="k", ptr_type="entity_key", tenant_id="")


def test_prompt_block_contains_no_numbers_from_facts():
    text = prompt_block(
        [
            {
                "kind": "Metric",
                "ptr": "m1",
                "ptr_type": "metric",
                "tenant_id": "o",
                "props": {"name": "Revenue", "certified": True},
            }
        ]
    )
    assert "ptr=metric:m1" in text
    assert "not facts" in text.lower()
    assert "1200000" not in text


def test_canonical_object_url_never_returns_signed_blob():
    from ee.modules.ontology.service import _canonical_object_url, _presign_pointer

    sas = "https://acct.blob.core.windows.net/c/k?sv=2023&se=2026&sig=abc"
    assert _canonical_object_url(sas) is None
    assert _presign_pointer(sas) is None
    assert _canonical_object_url("s3://") is None
    built = _canonical_object_url("s3://lake/org/1/bronze/orders.parquet")
    assert built is not None
    assert "orders.parquet" in built
    assert "sig=" not in built.lower()


def test_tokenize_ignores_tiny_words():
    tokens = tokenize_question("what is the revenue by region")
    assert "the" not in tokens
    assert "what" not in tokens
    assert "revenue" in tokens
    assert "region" in tokens
    assert "%" not in "".join(tokenize_question("revenue% by region_id"))
