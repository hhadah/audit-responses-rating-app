"""Behavioral tests for the study-data preparation commands."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StudyScriptTests(unittest.TestCase):
    """Verify generated bundles and long-to-wide response pairing."""

    def run_script(self, script: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        """Run one repository script without invoking a shell."""
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / script), *arguments],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_example_bundle_is_reproducible(self) -> None:
        """The documented example command should reproduce the committed bundle."""
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "bundle.json"
            result = self.run_script(
                "build-study.py",
                "--config",
                "examples/study-config.json",
                "--items",
                "examples/items.csv",
                "--output",
                str(output),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8") as stream:
                generated = json.load(stream)
            with (ROOT / "examples" / "study-bundle.json").open(encoding="utf-8") as stream:
                committed = json.load(stream)
            self.assertEqual(generated, committed)
            self.assertEqual(len(generated["items"]), 2)

    def test_long_rows_are_paired_with_composite_ids_and_metadata(self) -> None:
        """Two audit versions should become one standardized row per item."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            output = Path(directory) / "items.csv"
            with source.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(
                    stream,
                    fieldnames=["institution", "email", "round", "response", "state"],
                )
                writer.writeheader()
                writer.writerows(
                    [
                        {
                            "institution": "School A",
                            "email": "a@example.test",
                            "round": "1",
                            "response": "First A",
                            "state": "LA",
                        },
                        {
                            "institution": "School A",
                            "email": "a@example.test",
                            "round": "2",
                            "response": "Second A",
                            "state": "LA",
                        },
                        {
                            "institution": "School B",
                            "email": "b@example.test",
                            "round": "1",
                            "response": "First B",
                            "state": "TX",
                        },
                        {
                            "institution": "School B",
                            "email": "b@example.test",
                            "round": "2",
                            "response": "Second B",
                            "state": "TX",
                        },
                    ]
                )

            result = self.run_script(
                "prepare-items.py",
                "--input",
                str(source),
                "--output",
                str(output),
                "--item-id-column",
                "institution",
                "--item-id-column",
                "email",
                "--item-label-column",
                "institution",
                "--version-column",
                "round",
                "--content-column",
                "response",
                "--metadata",
                "state=state",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8", newline="") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["item_id"], "School A|a@example.test")
            self.assertEqual(rows[0]["version_a_content"], "First A")
            self.assertEqual(rows[0]["version_b_content"], "Second A")
            self.assertEqual(rows[0]["meta_state"], "LA")

    def test_converter_rejects_items_without_exactly_two_versions(self) -> None:
        """An incomplete pair must stop rather than silently enter a study bundle."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            output = Path(directory) / "items.csv"
            source.write_text(
                "item,round,response\nSchool A,1,Only response\n",
                encoding="utf-8",
            )
            result = self.run_script(
                "prepare-items.py",
                "--input",
                str(source),
                "--output",
                str(output),
                "--item-id-column",
                "item",
                "--item-label-column",
                "item",
                "--version-column",
                "round",
                "--content-column",
                "response",
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("exactly two are required", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
