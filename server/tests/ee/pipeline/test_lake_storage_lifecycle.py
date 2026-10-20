from src.modules.pipeline.lake_storage_lifecycle import bronze_load_prefix


def test_bronze_load_prefix_from_object_key():
    key = "orgs/ab/bronze/ds1/orders/load_id=550e8400-e29b-41d4-a716-446655440000/part-0003.parquet"
    assert bronze_load_prefix(key) == "orgs/ab/bronze/ds1/orders/load_id=550e8400-e29b-41d4-a716-446655440000/"


def test_bronze_load_prefix_from_partition_values():
    key = "orgs/ab/bronze/ds1/part-0000.parquet"
    assert bronze_load_prefix(key, {"load_id": "run-1"}) == key.rsplit("/", 1)[0] + "/"
