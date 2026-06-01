#!/usr/bin/env python3
"""Merge missing keys from messages/en.json into other locale files (English fallback)."""
from __future__ import annotations

import json
from pathlib import Path

MESSAGES_DIR = Path(__file__).resolve().parents[1] / "src" / "messages"
SOURCE = "en.json"
LOCALES = ("de.json", "es.json", "fr.json", "id.json", "ja.json", "km.json", "th.json", "vi.json", "zh.json")


def deep_merge_missing(target: dict, source: dict) -> int:
    added = 0
    for key, value in source.items():
        if key not in target:
            target[key] = value
            added += 1
        elif isinstance(value, dict) and isinstance(target.get(key), dict):
            added += deep_merge_missing(target[key], value)
    return added


def main() -> None:
    en_path = MESSAGES_DIR / SOURCE
    en_data = json.loads(en_path.read_text(encoding="utf-8"))
    total = 0
    for name in LOCALES:
        path = MESSAGES_DIR / name
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        count = deep_merge_missing(data, en_data)
        if count:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{name}: +{count} keys")
            total += count
        else:
            print(f"{name}: up to date")
    print(f"Done. {total} keys added across locales.")


if __name__ == "__main__":
    main()
