#!/usr/bin/env python3
"""Tests for the machine-readable SEO audit contract."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("validate_audit", ROOT / "scripts" / "validate_audit.py")
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("unable to load validate_audit.py")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def valid_payload() -> dict:
    return {
        "schema_version": "1.0",
        "generated_at": "2026-08-03T00:00:00+08:00",
        "scope": {
            "mode": "page",
            "targets": ["https://example.com/"],
            "market": "SG",
            "language": "en",
            "device": "mobile",
            "evidence_modes": ["live"],
        },
        "coverage": {
            "discovered": 1,
            "selected": 1,
            "fetched": 1,
            "rendered": 1,
            "data_backed": 0,
            "failed": [],
            "exclusions": [],
            "limitations": ["No Search Console access"],
        },
        "findings": [
            {
                "id": "F-001",
                "category": "canonical",
                "issue": "Canonical points to a different host",
                "status": "fail",
                "evidence_level": "observed",
                "evidence_refs": [{"kind": "rendered_dom", "ref": "https://example.com/"}],
                "impact": "high",
                "confidence": "high",
                "recommended_fix": "Align the canonical host with the preferred production host.",
                "effort": "s",
                "dependencies": ["deployment"],
                "verification": "Re-fetch and inspect the rendered canonical after deployment.",
            }
        ],
        "action_plan": [
            {
                "id": "A-001",
                "finding_ids": ["F-001"],
                "action": "Fix canonical host generation.",
                "impact": "high",
                "effort": "s",
                "owner": "web team",
                "verification": "Rendered canonical matches the preferred host.",
            }
        ],
        "missing_evidence": ["Search Console canonical selection"],
    }


class ValidateAuditTest(unittest.TestCase):
    def test_valid_audit_passes(self) -> None:
        result = VALIDATOR.validate(valid_payload())
        self.assertTrue(result["ok"], result)

    def test_observed_finding_requires_evidence_reference(self) -> None:
        payload = valid_payload()
        payload["findings"][0]["evidence_refs"] = []
        result = VALIDATOR.validate(payload)
        self.assertFalse(result["ok"])
        self.assertTrue(any("requires evidence_refs" in item for item in result["failures"]))

    def test_missing_evidence_cannot_confirm_failure(self) -> None:
        payload = valid_payload()
        payload["findings"][0]["evidence_level"] = "missing evidence"
        payload["findings"][0]["evidence_refs"] = []
        result = VALIDATOR.validate(payload)
        self.assertFalse(result["ok"])
        self.assertTrue(any("cannot be a confirmed pass or fail" in item for item in result["failures"]))

    def test_invalid_evidence_kind_fails(self) -> None:
        payload = valid_payload()
        payload["findings"][0]["evidence_refs"][0]["kind"] = "guess"
        result = VALIDATOR.validate(payload)
        self.assertFalse(result["ok"])
        self.assertTrue(any("kind must be one of" in item for item in result["failures"]))

    def test_mutable_platform_finding_warns_without_source_review(self) -> None:
        payload = valid_payload()
        payload["findings"][0]["category"] = "ai_search"
        result = VALIDATOR.validate(payload)
        self.assertTrue(result["ok"], result)
        self.assertTrue(any("source_review" in item for item in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
