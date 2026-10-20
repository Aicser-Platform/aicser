import pytest

from src.modules.pipeline.load.sheets_loader import _parse_sheet_url


def test_parse_google_sheet_url():
    sheet_id, gid = _parse_sheet_url(
        "https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=42",
        None,
    )
    assert sheet_id == "abc123XYZ"
    assert gid == "42"


def test_parse_sheet_url_requires_spreadsheet_path():
    with pytest.raises(ValueError):
        _parse_sheet_url("https://example.com/not-a-sheet", None)
