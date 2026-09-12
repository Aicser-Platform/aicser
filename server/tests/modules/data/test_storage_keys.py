from src.modules.data.utils.storage_keys import safe_object_filename


def test_safe_object_filename_strips_directories():
    name = safe_object_filename("../../etc/passwd", prefix_uuid=False)
    assert name == "passwd"
    assert ".." not in name


def test_safe_object_filename_prefixes_uuid():
    name = safe_object_filename("sales.parquet")
    assert name.endswith("sales.parquet")
    assert "_" in name
    assert "/" not in name
