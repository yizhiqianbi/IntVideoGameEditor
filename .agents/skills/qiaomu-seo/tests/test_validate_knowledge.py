#!/usr/bin/env python3
"""Tests for the Qiaomu SEO source-registry validator."""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("validate_knowledge", ROOT / "scripts" / "validate_knowledge.py")
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("unable to load validate_knowledge.py")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)
REGISTRY = json.loads((ROOT / "data" / "seo-source-registry.json").read_text(encoding="utf-8"))


class ValidateKnowledgeTest(unittest.TestCase):
    def test_current_registry_passes(self) -> None:
        result = VALIDATOR.validate_registry(copy.deepcopy(REGISTRY), ROOT, date(2026, 8, 3))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["overdue_sources"], [])

    def test_duplicate_source_id_fails(self) -> None:
        payload = copy.deepcopy(REGISTRY)
        payload["sources"][1]["id"] = payload["sources"][0]["id"]
        result = VALIDATOR.validate_registry(payload, ROOT, date(2026, 8, 3))
        self.assertFalse(result["ok"])
        self.assertTrue(any("duplicate source id" in item for item in result["failures"]))

    def test_overdue_source_warns(self) -> None:
        payload = copy.deepcopy(REGISTRY)
        payload["sources"][0]["reviewed_at"] = "2020-01-01"
        payload["sources"][0]["review_after_days"] = 30
        result = VALIDATOR.validate_registry(payload, ROOT, date(2026, 8, 3))
        self.assertTrue(result["ok"], result)
        self.assertIn(payload["sources"][0]["id"], result["overdue_sources"])

    def test_deprecated_claim_in_reference_fails(self) -> None:
        payload = copy.deepcopy(REGISTRY)
        payload["deprecated_claim_patterns"] = ["stale SEO certainty"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "references").mkdir()
            (root / "SKILL.md").write_text("clean", encoding="utf-8")
            (root / "references" / "test.md").write_text("Stale SEO certainty", encoding="utf-8")
            result = VALIDATOR.validate_registry(payload, root, date(2026, 8, 3))
        self.assertFalse(result["ok"])
        self.assertTrue(any("deprecated claim found" in item for item in result["failures"]))


if __name__ == "__main__":
    unittest.main()
