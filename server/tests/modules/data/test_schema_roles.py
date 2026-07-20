import pandas as pd

from src.modules.data.services.data_connectivity_service import DataConnectivityService


def _schema_for(df):
    return DataConnectivityService()._infer_schema_from_dataframe(df)


def test_roles_assigned():
    df = pd.DataFrame(
        {
            "customer_id": [1, 2, 3, 4],
            "order_date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]),
            "amount": [10.5, 20.0, 30.0, 40.0],
            "region": ["N", "S", "N", "S"],
        }
    )
    schema = _schema_for(df)
    roles = {c["name"]: c["role"] for c in schema["columns"]}
    assert roles["customer_id"] == "id"
    assert roles["order_date"] == "time"
    assert roles["amount"] == "metric"
    assert roles["region"] == "dimension"


def test_string_date_named_column_is_not_time():
    df = pd.DataFrame({"update_notes": ["a", "b", "c", "d"]})
    schema = _schema_for(df)
    assert schema["columns"][0]["role"] == "dimension"
