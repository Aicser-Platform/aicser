#!/usr/bin/env python3
"""Copy missing keys from en.json into other locale files (English fallback)."""

from __future__ import annotations

import json
from pathlib import Path

LOCALES = ["vi", "de", "fr", "es", "zh", "ja", "th", "km", "id"]
MESSAGES = Path(__file__).resolve().parents[1] / "client" / "src" / "messages"


def deep_merge_missing(base: dict, target: dict) -> dict:
    for key, value in base.items():
        if key not in target:
            target[key] = value
        elif isinstance(value, dict) and isinstance(target.get(key), dict):
            deep_merge_missing(value, target[key])
    return target


def main() -> None:
    en_path = MESSAGES / "en.json"
    en = json.loads(en_path.read_text(encoding="utf-8"))
    for loc in LOCALES:
        path = MESSAGES / f"{loc}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        merged = deep_merge_missing(en, data)
        path.write_text(json.dumps(merged, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
        print(f"Updated {path.name}")


if __name__ == "__main__":
    main()
