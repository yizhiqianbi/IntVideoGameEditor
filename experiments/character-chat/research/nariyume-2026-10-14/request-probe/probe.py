#!/usr/bin/env python3
"""Offline, explicit-input request evidence inspection. No network execution."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import statistics
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
BASELINE = ROOT.parent / "tokenizer-candidates" / "tokenizer-baseline.json"
MAX_BYTES = 1024 * 1024
SAFE_HEADERS = {
    "content-type", "x-nariyume-openrouter-route", "x-nariyume-gated",
    "server-timing", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining",
}
COUNT_KEYS = {
    "prompt_tokens", "completion_tokens", "total_tokens", "input_tokens",
    "output_tokens", "cached_tokens", "reasoning_tokens", "audio_tokens",
    "accepted_prediction_tokens", "rejected_prediction_tokens",
    "cache_creation_input_tokens", "cache_read_input_tokens",
}
DETAIL_KEYS = {
    "prompt_tokens_details", "completion_tokens_details", "input_tokens_details",
    "output_tokens_details",
}
REQUEST_KEYS = {
    "kind", "characterId", "clientTurnId", "conversationSummary", "history",
    "userMessage", "imageDataURL", "dynamic", "language", "pronunciation",
    "rungIndex",
}
SECRET_KEY = re.compile(r"authorization|cookie|password|secret|api.?key|firebase|access.?token|id.?token|refresh.?token", re.I)
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,119}\Z")


def fail(message):
    raise ValueError(message)


def load_text(path):
    # Only the caller-supplied ordinary file is opened; no browser/profile/env scan.
    if not path.is_file() or path.is_symlink():
        fail("Input must be an explicit regular file, not a symlink.")
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        fail("Input exceeds the 1 MiB limit.")
    return data.decode("utf-8")


def load_json(path):
    try:
        return json.loads(load_text(path))
    except json.JSONDecodeError:
        fail("Input is not valid JSON; input contents are omitted.")


def exact_keys(value, allowed):
    if not isinstance(value, dict) or set(value) - allowed:
        fail("Unexpected input structure or field; provide only the documented metadata schema.")


def counter(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail("Usage counts must be nonnegative integers.")
    return value


def usage_fields(value):
    exact_keys(value, COUNT_KEYS | DETAIL_KEYS)
    return {key: (usage_fields(item) if key in DETAIL_KEYS else counter(item))
            for key, item in value.items() if item is not None}


def identifier(value):
    if value is None:
        return None
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        fail("Model/provider must be a short redacted identifier or null.")
    return value


def metadata(value):
    exact_keys(value, {"status", "response", "headers"})
    response = value.get("response", {})
    exact_keys(response, {"model", "provider", "usage"})
    headers = value.get("headers", {})
    if not isinstance(headers, dict):
        fail("Headers must be an object.")
    if any(not isinstance(key, str) or SECRET_KEY.search(key) for key in headers):
        fail("Credential-bearing header names are forbidden. Remove them before supplying input.")
    safe = {}
    omitted = 0
    for key, item in headers.items():
        if key.lower() not in SAFE_HEADERS:
            omitted += 1
            continue
        if not isinstance(item, str) or len(item) > 1024 or any(c in item for c in "\r\n\x00"):
            fail("Invalid allowlisted response header value.")
        safe[key.lower()] = item
    status = value.get("status")
    if status is not None and (isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599):
        fail("Status must be an HTTP status integer.")
    return {
        "mode": "offline_metadata", "network_requests_sent": 0, "status": status,
        "model_reported_by_response": identifier(response.get("model")),
        "provider_reported_by_response": identifier(response.get("provider")),
        "usage": usage_fields(response.get("usage") or {}),
        "headers": safe, "omitted_header_count": omitted,
        "attribution_limit": "Gateway-reported names and route headers are evidence, not independent proof of deployed weights.",
    }


def redacted_body(value):
    # For a curl template only: every string except kind/characterId is a marker.
    exact_keys(value, REQUEST_KEYS)
    def visit(item):
        if isinstance(item, dict):
            if any(not isinstance(key, str) or SECRET_KEY.search(key) for key in item):
                fail("Credential-like keys are forbidden in request templates.")
            for nested in item.values():
                visit(nested)
        elif isinstance(item, list):
            for nested in item:
                visit(nested)
        elif isinstance(item, str) and item not in ("", "<REDACTED>"):
            fail("Request strings must be <REDACTED> or empty, except kind and characterId.")
        elif item is not None and not isinstance(item, (str, bool, int, float)):
            fail("Invalid request template value.")
    for key, item in value.items():
        if key == "kind" and item in ("chat", "summary", "memory"):
            continue
        if key == "characterId" and item in ("Nari", "Yume"):
            continue
        visit(item)
    return sorted(value)


def curl_template(text):
    # shlex only parses inert text. This function never uses a shell or subprocess.
    try:
        words = shlex.split(text)
    except ValueError:
        fail("Malformed curl template; input contents are omitted.")
    if not words or words[0] != "curl":
        fail("Expected one inert curl template beginning with curl.")
    words = words[1:]
    method, url, body, headers = None, None, None, []
    index = 0
    while index < len(words):
        word = words[index]
        if word in ("-s", "-S", "-sS", "--silent", "--show-error", "--compressed"):
            index += 1
            continue
        if word in ("-X", "--request", "-H", "--header", "--data-raw", "--data", "-d", "--url"):
            index += 1
            if index >= len(words):
                fail("Curl option lacks a value.")
            item = words[index]
            if word in ("-X", "--request"):
                if item not in ("POST", "GET"):
                    fail("Only GET/POST method metadata is supported.")
                method = item
            elif word in ("-H", "--header"):
                name, sep, value = item.partition(":")
                name, value = name.strip().lower(), value.strip()
                if not sep or not re.fullmatch(r"[a-z0-9-]+", name):
                    fail("Invalid header template.")
                if name == "content-type" and value == "application/json":
                    pass
                elif value not in ("<REDACTED>", "Bearer <REDACTED>"):
                    fail("All curl header values except JSON Content-Type must be <REDACTED>.")
                headers.append(name)
            elif word == "--url":
                if url is not None:
                    fail("Only one URL is supported.")
                url = item
            else:
                if body is not None or item.startswith("@"):
                    fail("Only one inline redacted JSON body is supported; no referenced files.")
                try:
                    body = json.loads(item)
                except json.JSONDecodeError:
                    fail("Curl body must be a redacted JSON object.")
        elif word.startswith("https://") and url is None:
            url = word
        else:
            fail("Unsupported curl option or shell token; the template is never executed.")
        index += 1
    parsed = urlsplit(url or "")
    if (parsed.scheme != "https" or parsed.netloc not in ("nariyume.com", "www.nariyume.com")
            or parsed.path != "/api/chat" or parsed.query or parsed.fragment):
        fail("Template URL must be the known HTTPS NariYume /api/chat endpoint without query or credentials.")
    return {"mode": "offline_curl_template", "network_requests_sent": 0,
            "method": method or ("POST" if body is not None else "GET"),
            "endpoint": "https://www.nariyume.com/api/chat",
            "header_names_only": sorted(set(headers)),
            "body_fields_only": redacted_body(body) if body is not None else [],
            "model_identity": None, "response_observed": False}


def compare(value, tolerance):
    exact_keys(value, {"measurement", "fixed_context_verified", "visible_raw_content_only_verified", "samples"})
    measurement = value.get("measurement")
    if measurement not in ("prompt_tokens", "completion_tokens"):
        fail("Measurement must be prompt_tokens or completion_tokens.")
    samples = value.get("samples")
    if not isinstance(samples, list) or not samples:
        fail("At least one sample is required.")
    reference = json.loads(BASELINE.read_text(encoding="utf-8"))
    probes = {row["id"]: row for row in reference["probes"]}
    rows, actual, used = [], [], set()
    for sample in samples:
        exact_keys(sample, {"probe_id", "native_tokens", "raw_completion_text"})
        probe_id = sample.get("probe_id")
        if not isinstance(probe_id, str) or probe_id not in probes or probe_id in used:
            fail("Every sample must use a distinct known reference probe_id.")
        used.add(probe_id)
        row = probes[probe_id]
        if measurement == "completion_tokens":
            raw = sample.get("raw_completion_text")
            if not isinstance(raw, str) or hashlib.sha256(raw.encode("utf-8")).hexdigest() != row["sha256_utf8"]:
                fail("Completion text must exactly match its public reference probe, including labels and whitespace.")
        elif "raw_completion_text" in sample:
            fail("Prompt observations must omit completion content.")
        rows.append(row)
        actual.append(counter(sample.get("native_tokens")))
    scores = []
    for family in reference["families"]:
        deltas = [count - row["counts"][family] for count, row in zip(actual, rows)]
        offset = statistics.median(deltas) if measurement == "prompt_tokens" else 0
        residuals = [abs(delta - offset) for delta in deltas]
        scores.append({"family": family, "fitted_offset": offset,
                       "max_absolute_residual": max(residuals),
                       "mean_absolute_residual": statistics.mean(residuals)})
    scores.sort(key=lambda row: (row["max_absolute_residual"], row["mean_absolute_residual"], row["family"]))
    matches = [row["family"] for row in scores if row["max_absolute_residual"] <= tolerance]
    verified = value.get("fixed_context_verified" if measurement == "prompt_tokens" else "visible_raw_content_only_verified") is True
    status = ("insufficient_distinct_probes" if len(rows) < 3 else
              "unverified_measurement_scope" if not verified else
              "no_reference_match" if not matches else
              "multiple_reference_matches" if len(matches) > 1 else "reference_family_compatible")
    return {"mode": "offline_tokenizer_comparison", "network_requests_sent": 0,
            "status": status, "distinct_probes": len(rows), "compatible_references": matches,
            "scores": scores, "model_identity": None,
            "limit": "Reference compatibility cannot identify model weights. Prompt fitting requires fixed hidden context, wrapping, normalization and route; completion counts may include hidden reasoning/EOS/tool content."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("metadata", "curl-template", "compare"))
    parser.add_argument("--input", type=Path, required=True, help="Explicit, already authorized and redacted file")
    parser.add_argument("--authorized-redacted-input", action="store_true", required=True,
                        help="Attest that you are authorized and removed credentials/private content before input")
    parser.add_argument("--tolerance", type=int, default=0, help="Nonnegative token residual tolerance for compare")
    args = parser.parse_args()
    if args.tolerance < 0:
        parser.error("Tolerance cannot be negative.")
    try:
        result = (curl_template(load_text(args.input)) if args.command == "curl-template" else
                  metadata(load_json(args.input)) if args.command == "metadata" else
                  compare(load_json(args.input), args.tolerance))
    except (ValueError, OSError, UnicodeError, TypeError, KeyError):
        # No raw input, paths, source excerpts, or traceback in diagnostics.
        print("Input rejected. Check the documented redacted schema and local reference file; no request was sent.", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
