#!/usr/bin/env python3
"""Inspect an existing MaiBot instance; never starts it or accepts its agreements.

Offline checks are read-only. Optional authenticated HTTP checks use the existing
native WebUI. --probe-embedding explicitly asks its runtime to refresh the real
embedding self-check (a small paid model request); --query performs real recall.
No credentials, prompts, memory text, or full model configuration are printed.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tomllib
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
STATUS_KEYS = {
    "success", "ok", "code", "enabled", "memory_enabled", "runtime_ready",
    "retrieval_ready", "degraded", "embedding_degraded", "retrieval_mode",
    "available_channels", "unavailable_channels", "startup_state", "initializing",
    "initialization_failed", "error_stage", "startup_queue_pending", "data_dir",
    "configured_dimension", "vector_store_dimension", "detected_dimension",
    "encoded_dimension", "embedding_dimension", "elapsed_ms", "auto_save",
    "paragraphs", "relations", "episodes", "profiles", "vector_count",
    "trained", "is_trained", "dimension", "model_name", "status",
    "stored_vector_dimension", "vector_rebuild_required", "relation_vectors_enabled",
    "vector_pools_ready", "vector_pools_effective_mode", "embedding_fingerprint_status",
    "paragraph_vector_backfill_pending", "paragraph_vector_backfill_failed",
}


def load_toml(path: Path) -> dict:
    return tomllib.loads(path.read_text("utf-8")) if path.is_file() else {}


def summarize_status(value: object) -> object:
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            if key in STATUS_KEYS and not isinstance(child, dict):
                result[key] = child
            elif key in {"report", "self_check", "runtime", "runtime_status", "vector_health", "data"}:
                result[key] = summarize_status(child)
        return result
    return value if isinstance(value, (bool, int, float, str, type(None))) else None


def agreement_state(instance: Path, upstream: Path) -> dict:
    result = {}
    for name in ("eula", "privacy"):
        document = upstream / f"{name.upper()}.md"
        confirmation = instance / f"{name}.confirmed"
        current = hashlib.md5(document.read_text("utf-8").encode()).hexdigest() if document.exists() else None
        result[name] = {
            "confirmation_file_exists": confirmation.is_file(),
            "matches_current_document": bool(current and confirmation.is_file() and confirmation.read_text("utf-8") == current),
        }
    return result


def config_summary(instance: Path) -> dict:
    bot = load_toml(instance / "config/bot_config.toml")
    models = load_toml(instance / "config/model_config.toml")
    memory = bot.get("a_memorix", {})
    integration = memory.get("integration", {})
    defaults = {
        "enable_memory_query_tool": True, "enable_person_profile_query_tool": True,
        "enable_person_profile_injection": True, "person_fact_writeback_enabled": True,
        "chat_summary_writeback_enabled": True, "heuristic_memory_recall_enabled": False,
        "heuristic_memory_cross_chat_enabled": False,
    }
    embedding = memory.get("embedding", {})
    selected = models.get("model_task_config", {}).get("embedding", {}).get("model_list", [])
    configured_models = [
        {key: row.get(key) for key in ("name", "model_identifier", "model_type", "api_provider")}
        for row in models.get("models", []) if row.get("name") in selected
    ]
    data_dir = Path(memory.get("storage", {}).get("data_dir", "data/a-memorix"))
    if not data_dir.is_absolute():
        data_dir = instance / data_dir
    return {
        "bot_config_exists": (instance / "config/bot_config.toml").is_file(),
        "model_config_exists": (instance / "config/model_config.toml").is_file(),
        "enabled": memory.get("plugin", {}).get("enabled", False),
        "data_dir": str(data_dir.resolve()),
        "integration": {key: integration.get(key, default) for key, default in defaults.items()},
        "global_memory_sharing_enabled": memory.get("global_memory_sharing_enabled", False),
        "shared_memory_group_count": len(memory.get("shared_memory_groups", [])),
        "embedding": {"task_models": configured_models, "model_name": embedding.get("model_name", "auto"),
                      "dimension": embedding.get("dimension", 1024),
                      "dimension_request_mode": embedding.get("dimension_request_mode", "explicit")},
        "image_embedding_configured": bool(models.get("model_task_config", {}).get("image_embedding", {}).get("model_list", [])),
        "relation_vectorization_enabled": memory.get("retrieval", {}).get("relation_vectorization", {}).get("enabled", False),
    }


def storage_summary(directory: Path) -> dict:
    database = directory / "metadata/metadata.db"
    result: dict = {"directory_exists": directory.is_dir(), "database_exists": database.is_file()}
    if database.is_file():
        try:
            with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=3) as connection:
                connection.execute("PRAGMA query_only=ON")
                existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                names = ("paragraphs", "relations", "episodes", "person_profile_snapshots", "fact_claims", "fact_evidence")
                result["row_counts"] = {name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                                        for name in names if name in existing}
                result["sqlite_quick_check"] = connection.execute("PRAGMA quick_check(1)").fetchone()[0]
        except sqlite3.Error as error:
            result["sqlite_error"] = type(error).__name__
    for name in ("vectors", "graph"):
        path = directory / name
        files = [item for item in path.rglob("*") if item.is_file()] if path.is_dir() else []
        result[name] = {"file_count": len(files), "total_bytes": sum(item.stat().st_size for item in files)}
    return result


def http_json(base: str, path: str, token: str, *, method: str = "GET") -> tuple[int, dict]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Cookie"] = "maibot_session=" + token
    request = Request(base.rstrip("/") + path, headers=headers, method=method,
                      data=b"" if method == "POST" else None)
    try:
        with urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, {"error_type": "http_error"}
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        return 0, {"error_type": type(error).__name__}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instance", type=Path, default=ROOT / "instance")
    parser.add_argument("--upstream", type=Path, default=ROOT / "upstream")
    parser.add_argument("--base-url", help="Existing local native WebUI, e.g. http://127.0.0.1:8001")
    parser.add_argument("--token-env", default="MAIBOT_WEBUI_TOKEN", help="Environment variable containing an existing WebUI login token")
    parser.add_argument("--probe-embedding", action="store_true", help="Native real embedding refresh; may incur model cost")
    parser.add_argument("--query", help="Recall a synthetic test fact; requires --chat-id")
    parser.add_argument("--chat-id", default="")
    parser.add_argument("--expect-text", help="Report only whether recall contained this known test text")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if (args.probe_embedding or args.query) and not args.base_url:
        parser.error("--probe-embedding/--query requires --base-url")
    if args.query and not args.chat_id:
        parser.error("--query requires a real native --chat-id; unscoped recall is not used")
    if args.base_url and urlparse(args.base_url).hostname not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("Only local native WebUI endpoints are accepted")
    instance, upstream = args.instance.resolve(), args.upstream.resolve()
    commit = subprocess.run(["git", "-C", str(upstream), "rev-parse", "HEAD"], capture_output=True, text=True)
    config = config_summary(instance)
    report = {"upstream_commit": commit.stdout.strip() if commit.returncode == 0 else None,
              "instance": str(instance), "agreements": agreement_state(instance, upstream),
              "config": config, "storage": storage_summary(Path(config["data_dir"])), "dependencies": {}}
    patch = ROOT / "patches/0001-metadata-json-scope.patch"
    if patch.is_file():
        patch_check = subprocess.run(["git", "-C", str(upstream), "apply", "--reverse", "--check", str(patch)], capture_output=True)
        report["local_compatibility_patch"] = {
            "name": patch.name, "sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
            "source_patch_present": patch_check.returncode == 0,
            "runtime_restart_verified_by_this_script": False,
        }
    for package in ("faiss-cpu", "numpy", "scipy", "maibot-plugin-sdk"):
        try:
            report["dependencies"][package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            report["dependencies"][package] = None
    if args.base_url:
        token = os.environ.get(args.token_env, "")
        if any(char in token for char in "\r\n;"):
            parser.error("Invalid WebUI token format")
        report["native_http"] = {}
        # Upstream GET self-check also makes a fresh provider call. Keep both
        # variants out of default inspection and use only the explicit probe.
        paths = {"runtime": "/api/webui/memory/runtime/config"}
        for label, path in paths.items():
            status, payload = http_json(args.base_url, path, token)
            report["native_http"][label] = {"http_status": status, "summary": summarize_status(payload)}
        if args.probe_embedding:
            status, payload = http_json(args.base_url, "/api/webui/memory/runtime/self-check/refresh", token, method="POST")
            report["native_http"]["embedding_probe"] = {"http_status": status, "summary": summarize_status(payload)}
        if args.query:
            status, payload = http_json(args.base_url, "/api/webui/memory/query/aggregate?" + urlencode({"query": args.query, "chat_id": args.chat_id, "limit": 5}), token)
            # Report evidence presence without printing recalled private text.
            report["native_http"]["recall"] = {"http_status": status, "summary": summarize_status(payload),
                "expected_text_found": args.expect_text in json.dumps(payload, ensure_ascii=False) if args.expect_text else None}
    report["limits"] = ["Does not start MaiBot, import its runtime, or accept agreements.",
                        "Storage/config checks do not prove Planner selected memory or Replyer used it.",
                        "Verify native chat tool calls and answer against a known synthetic fact separately."]
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", "utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
