#!/usr/bin/env python3
"""Build a versioned rating-study bundle from JSON configuration and CSV items."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

REQUIRED_COLUMNS = (
    "item_id",
    "item_label",
    "version_a_id",
    "version_a_label",
    "version_a_content",
    "version_b_id",
    "version_b_label",
    "version_b_content",
)


def repair_mojibake(value: str) -> str:
    """Repair common UTF-8 text accidentally decoded as Windows-1252."""
    if not value or not any(marker in value for marker in ("â", "Ã", "€")):
        return value
    try:
        return value.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def read_config(path: Path) -> dict:
    """Read a study configuration with actionable file and JSON errors."""
    try:
        with path.open(encoding="utf-8") as stream:
            value = json.load(stream)
    except OSError as error:
        raise SystemExit(f"Could not read configuration {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Configuration {path} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise SystemExit("The configuration must be a JSON object.")
    study = value.get("study", value)
    if not isinstance(study, dict):
        raise SystemExit("The configuration's study field must be an object.")
    for field in ("id", "title"):
        if not str(study.get(field, "")).strip():
            raise SystemExit(f"The configuration must define study.{field}.")
    return study


def read_items(path: Path, should_repair_mojibake: bool) -> list[dict]:
    """Read pairwise audit responses from the documented CSV schema."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            columns = reader.fieldnames or []
            missing = [column for column in REQUIRED_COLUMNS if column not in columns]
            if missing:
                raise SystemExit(f"Items CSV is missing required columns: {', '.join(missing)}")
            rows = list(reader)
    except OSError as error:
        raise SystemExit(f"Could not read items {path}: {error}") from error

    items = []
    seen_ids: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        values = {
            key: repair_mojibake(value or "") if should_repair_mojibake else (value or "")
            for key, value in row.items()
        }
        missing_values = [column for column in REQUIRED_COLUMNS if not values[column].strip()]
        if missing_values:
            raise SystemExit(
                f"Items CSV row {row_number} has blank required fields: {', '.join(missing_values)}"
            )
        item_id = values["item_id"].strip()
        if item_id in seen_ids:
            raise SystemExit(f"Items CSV contains duplicate item_id {item_id!r}.")
        seen_ids.add(item_id)
        metadata = {
            column.removeprefix("meta_"): value.strip()
            for column, value in values.items()
            if column.startswith("meta_") and value.strip()
        }
        items.append(
            {
                "id": item_id,
                "label": values["item_label"].strip(),
                "metadata": metadata,
                "versions": [
                    {
                        "id": values["version_a_id"].strip(),
                        "label": values["version_a_label"].strip(),
                        "content": values["version_a_content"].strip(),
                    },
                    {
                        "id": values["version_b_id"].strip(),
                        "label": values["version_b_label"].strip(),
                        "content": values["version_b_content"].strip(),
                    },
                ],
            }
        )
    if not items:
        raise SystemExit("Items CSV must contain at least one data row.")
    return items


def write_bundle(path: Path, bundle: dict) -> None:
    """Write the generated bundle without exposing it through console output."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as stream:
            json.dump(bundle, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
    except OSError as error:
        raise SystemExit(f"Could not write bundle {path}: {error}") from error


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse command-line paths and optional text repair behavior."""
    parser = argparse.ArgumentParser(
        description="Build a study-bundle.json file for the audit response rating app."
    )
    parser.add_argument("--config", required=True, type=Path, help="Study configuration JSON")
    parser.add_argument("--items", required=True, type=Path, help="Pairwise response items CSV")
    parser.add_argument("--output", required=True, type=Path, help="Generated bundle JSON")
    parser.add_argument(
        "--repair-mojibake",
        action="store_true",
        help="Repair common UTF-8/Windows-1252 corruption in CSV text",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Build the uploadable bundle and report only its path and item count."""
    args = parse_args(argv or sys.argv[1:])
    study = read_config(args.config)
    items = read_items(args.items, args.repair_mojibake)
    bundle = {"schema_version": 1, "study": study, "items": items}
    write_bundle(args.output, bundle)
    print(f"Wrote {len(items)} items to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
