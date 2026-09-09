#!/usr/bin/env python3
"""Convert long-form audit responses into the app's two-response items CSV."""

from __future__ import annotations

import argparse
import csv
import sys
from collections import OrderedDict
from pathlib import Path

OUTPUT_COLUMNS = (
    "item_id",
    "item_label",
    "version_a_id",
    "version_a_label",
    "version_a_content",
    "version_b_id",
    "version_b_label",
    "version_b_content",
)


def parse_mapping(value: str) -> tuple[str, str]:
    """Parse SOURCE=OUTPUT metadata mappings used by the command line."""
    if "=" not in value:
        raise argparse.ArgumentTypeError("metadata mappings must use SOURCE=OUTPUT")
    source, output = (part.strip() for part in value.split("=", 1))
    if not source or not output:
        raise argparse.ArgumentTypeError("metadata mappings must use non-empty SOURCE=OUTPUT names")
    if not output.replace("_", "").isalnum() or output[0].isdigit():
        raise argparse.ArgumentTypeError("metadata output names may contain letters, numbers, and underscores")
    return source, output


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse source-column mappings for a long-form audit dataset."""
    parser = argparse.ArgumentParser(
        description="Pair exactly two audit responses per item and write the standard items CSV."
    )
    parser.add_argument("--input", required=True, type=Path, help="Long-form source CSV")
    parser.add_argument("--output", required=True, type=Path, help="Standardized items CSV")
    parser.add_argument(
        "--item-id-column",
        action="append",
        required=True,
        help="Column forming the item ID; repeat to create a composite ID",
    )
    parser.add_argument("--item-label-column", required=True, help="Human-readable item label column")
    parser.add_argument("--version-column", required=True, help="Treatment or audit-round column")
    parser.add_argument("--content-column", required=True, help="Response-text column")
    parser.add_argument(
        "--version-label-column",
        help="Optional display-label column; defaults to the version value",
    )
    parser.add_argument(
        "--metadata",
        action="append",
        default=[],
        type=parse_mapping,
        metavar="SOURCE=OUTPUT",
        help="Metadata column to retain; repeat for multiple columns",
    )
    parser.add_argument(
        "--delimiter",
        default="|",
        help="Delimiter for composite item IDs (default: |)",
    )
    return parser.parse_args(argv)


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Read the source data and report file errors without a traceback."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            return reader.fieldnames or [], list(reader)
    except OSError as error:
        raise SystemExit(f"Could not read source CSV {path}: {error}") from error


def required_columns(args: argparse.Namespace) -> list[str]:
    """Return all source columns needed by the selected mappings."""
    columns = [
        *args.item_id_column,
        args.item_label_column,
        args.version_column,
        args.content_column,
        *(source for source, _ in args.metadata),
    ]
    if args.version_label_column:
        columns.append(args.version_label_column)
    return list(dict.fromkeys(columns))


def prepare_items(args: argparse.Namespace) -> tuple[list[str], list[dict[str, str]]]:
    """Group long rows and require two unique response versions per item."""
    columns, source_rows = read_rows(args.input)
    missing = [column for column in required_columns(args) if column not in columns]
    if missing:
        raise SystemExit(f"Source CSV is missing required columns: {', '.join(missing)}")

    groups: OrderedDict[str, dict] = OrderedDict()
    for row_number, row in enumerate(source_rows, start=2):
        id_parts = [(row.get(column) or "").strip() for column in args.item_id_column]
        item_id = args.delimiter.join(id_parts)
        label = (row.get(args.item_label_column) or "").strip()
        version_id = (row.get(args.version_column) or "").strip()
        content = (row.get(args.content_column) or "").strip()
        if not item_id or not label or not version_id or not content:
            raise SystemExit(
                f"Source row {row_number} has a blank item ID, label, version, or response text."
            )
        version_label = (
            (row.get(args.version_label_column) or "").strip()
            if args.version_label_column
            else version_id
        )
        if not version_label:
            version_label = version_id
        metadata = {
            output: (row.get(source) or "").strip() for source, output in args.metadata
        }

        group = groups.setdefault(
            item_id,
            {"label": label, "metadata": metadata, "versions": OrderedDict()},
        )
        if group["label"] != label or group["metadata"] != metadata:
            raise SystemExit(f"Source rows disagree on label or metadata for item {item_id!r}.")
        if version_id in group["versions"]:
            raise SystemExit(f"Item {item_id!r} has more than one response for version {version_id!r}.")
        group["versions"][version_id] = {"label": version_label, "content": content}

    metadata_outputs = [output for _, output in args.metadata]
    output_columns = [*OUTPUT_COLUMNS, *(f"meta_{name}" for name in metadata_outputs)]
    output_rows = []
    for item_id, group in groups.items():
        versions = list(group["versions"].items())
        if len(versions) != 2:
            raise SystemExit(
                f"Item {item_id!r} has {len(versions)} unique versions; exactly two are required."
            )
        (version_a_id, version_a), (version_b_id, version_b) = versions
        output_row = {
            "item_id": item_id,
            "item_label": group["label"],
            "version_a_id": version_a_id,
            "version_a_label": version_a["label"],
            "version_a_content": version_a["content"],
            "version_b_id": version_b_id,
            "version_b_label": version_b["label"],
            "version_b_content": version_b["content"],
        }
        for key, value in group["metadata"].items():
            output_row[f"meta_{key}"] = value
        output_rows.append(output_row)
    if not output_rows:
        raise SystemExit("Source CSV contains no response rows.")
    return output_columns, output_rows


def write_items(path: Path, columns: list[str], rows: list[dict[str, str]]) -> None:
    """Write standardized items with correct CSV quoting for multiline text."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
    except OSError as error:
        raise SystemExit(f"Could not write items CSV {path}: {error}") from error


def main(argv: list[str] | None = None) -> int:
    """Convert the requested dataset and report the generated item count."""
    args = parse_args(argv or sys.argv[1:])
    columns, rows = prepare_items(args)
    write_items(args.output, columns, rows)
    print(f"Wrote {len(rows)} paired items to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
