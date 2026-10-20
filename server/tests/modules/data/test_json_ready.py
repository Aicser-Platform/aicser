import datetime
import math
import uuid
from decimal import Decimal

from src.modules.data.services.data_connectivity_service import _json_ready


def test_preview_values_become_plain_json():
    out = _json_ready({
        "rows": [{"amount": Decimal("12.50"), "day": datetime.date(2026, 10, 17), "bad": float("nan"),
                  "id": uuid.UUID(int=1), "n": 3, "tags": ("a", "b"), "blob": b"x"}],
        1: math.inf,
    })
    row = out["rows"][0]
    assert row == {"amount": 12.5, "day": "2026-10-17", "bad": None, "id": str(uuid.UUID(int=1)), "n": 3,
                   "tags": ["a", "b"], "blob": None}
    assert out["1"] is None
