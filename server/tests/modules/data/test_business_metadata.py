from src.modules.data.services.business_metadata import merge_column_meaning


def test_column_meaning_is_merged_and_cleared():
    bm = {"column_descriptions": {"old": "kept"}, "column_roles": {"x": "id"}, "personal_columns": ["email"], "measures": [1]}
    out = merge_column_meaning(bm, {
        "amount": {"description": "Order value in USD", "role": "amount"},
        "email": {"description": "", "role": None, "personal": False},
        "phone": {"personal": True, "role": "bogus"},
    })
    assert out["column_descriptions"] == {"old": "kept", "amount": "Order value in USD"}
    assert out["column_roles"] == {"x": "id", "amount": "amount"}
    assert out["personal_columns"] == ["phone"]
    assert out["measures"] == [1]


def test_column_entries_are_found_however_they_were_keyed():
    from src.modules.data.services.business_metadata import column_entry

    m = {"banking.accounts.balance": "schema tab", "orders.amount": "two part", "region": "prepare"}
    assert column_entry(m, "accounts", "balance") == "schema tab"
    assert column_entry(m, "banking.accounts", "BALANCE") == "schema tab"
    assert column_entry(m, "orders", "amount") == "two part"
    assert column_entry(m, "data", "region") == "prepare"
    assert column_entry(m, "orders", "missing") is None


def test_roles_feed_the_prompt_and_question_discovery_without_duplicates():
    from src.modules.data.services.business_metadata import business_context_lines, columns_by_role

    bm = {"column_roles": {"orders.amount": "amount", "region": "category", "id": "id", "day": "date"},
          "personal_columns": ["email"], "measures": [{"name": "old"}]}
    lines = business_context_lines(bm)
    assert any("orders.amount=add up" in l for l in lines) and any("id=count distinct" in l for l in lines)
    assert not any("old" in l for l in lines)  # measures are the semantic model's, not listed here
    assert columns_by_role(bm) == {"measures": ["amount"], "dimensions": ["region", "day"]}


async def test_schema_responses_carry_what_people_said_about_the_columns(monkeypatch):
    from src.modules.data import router as data_router

    async def live(*a, **k):
        return {"success": True, "schema": {"tables": [{"name": "data"}]}}

    async def stored(data_source_id):
        return {"column_roles": {"data.region": "category"}}

    monkeypatch.setattr(data_router, "_data_source_schema_response", live)
    monkeypatch.setattr(data_router, "_stored_business_metadata", stored)
    out = await data_router.get_data_source_schema("ds1", current_token={"sub": "u1"})
    assert out["schema"]["business_metadata"] == {"column_roles": {"data.region": "category"}}
    assert out["schema"]["tables"] == [{"name": "data"}]
