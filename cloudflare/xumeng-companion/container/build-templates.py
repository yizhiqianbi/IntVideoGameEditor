#!/usr/bin/env python3
"""Build one empty-memory factory disk per companion persona.

The disk is stamped with a sentinel account and a placeholder provider key.
Restoring it rewrites the account and the running instance replaces the key.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PACKAGE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get("MAIBOT_SOURCE_DIR", "/opt/maibot")).resolve()
PYTHON = Path(os.environ.get("COMPANION_PYTHON", SOURCE / ".venv/bin/python"))
PLUGIN = Path(os.environ.get("COMPANION_MEDIA_PLUGIN", "/opt/companion/plugins/xumeng_media")).resolve()
TEMPLATE_ACCOUNT = "00000000-0000-4000-8000-0000000000aa"
PLACEHOLDER_KEY = "xumeng-template-placeholder"
PERSONAS = ("classic", "intimate", "sales", "cast-qiaowan", "cast-tangtang", "cast-peiwan")


def agreement(name):
    return hashlib.md5((SOURCE / name).read_bytes()).hexdigest()


def build(persona, destination):
    env = os.environ.copy()
    env.update({
        "MAIBOT_SOURCE_DIR": str(SOURCE),
        "COMPANION_MEDIA_PLUGIN": str(PLUGIN),
        "COMPANION_ACCOUNT_ID": TEMPLATE_ACCOUNT,
        "COMPANION_OPENROUTER_API_KEY": PLACEHOLDER_KEY,
        "COMPANION_PERSONA": persona,
        "COMPANION_CHAT_MODEL": env.get("COMPANION_CHAT_MODEL", "deepseek/deepseek-v4.1-flash"),
        "COMPANION_FAST_MODEL": env.get("COMPANION_FAST_MODEL", "deepseek/deepseek-v4.1-flash"),
        "COMPANION_EMBEDDING_MODEL": env.get("COMPANION_EMBEDDING_MODEL", "qwen/qwen3-embedding-8b"),
        "COMPANION_EMBEDDING_DIMENSION": env.get("COMPANION_EMBEDDING_DIMENSION", "4096"),
        "COMPANION_AGREEMENTS_ACCEPTED": "1",
        "COMPANION_EULA_MD5": agreement("EULA.md"),
        "COMPANION_PRIVACY_MD5": agreement("PRIVACY.md"),
    })
    with tempfile.TemporaryDirectory(prefix=f"companion-template-{persona}-") as temporary:
        root = Path(temporary)
        instance = root / "instance"
        archive = root / f"{persona}.tar.gz"
        prepared = subprocess.run([str(PYTHON), str(PACKAGE / "prepare-instance.py"), "--directory", str(instance)],
                                  env=env, capture_output=True, text=True, timeout=180)
        if prepared.returncode != 0:
            detail = (prepared.stderr or "").replace(PLACEHOLDER_KEY, "[redacted]")
            raise SystemExit(f"{persona} prepare failed\n{detail[-800:]}")
        saved = subprocess.run([sys.executable, str(PACKAGE / "archive.py"), "snapshot", "--instance", str(instance),
                                "--archive", str(archive), "--account", TEMPLATE_ACCOUNT, "--template", persona],
                               capture_output=True, text=True, timeout=60)
        if saved.returncode != 0:
            raise SystemExit(f"{persona} snapshot failed")
        raw = b"".join(path.read_bytes() for path in instance.rglob("*") if path.is_file())
        if PLACEHOLDER_KEY.encode() not in raw or b"sk-or-" in raw:
            raise SystemExit(f"{persona} disk has the wrong provider secret")
        blob = archive.read_bytes()
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_disk = destination.with_suffix(".tar.gz.partial")
        temporary_disk.write_bytes(blob)
        temporary_disk.chmod(0o644)
        os.replace(temporary_disk, destination)
        print(json.dumps({"persona": persona, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}))


def main():
    output = PACKAGE / "templates"
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(mode=0o755)
    for persona in PERSONAS:
        build(persona, output / f"{persona}.tar.gz")


if __name__ == "__main__":
    main()
