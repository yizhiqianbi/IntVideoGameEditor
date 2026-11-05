#!/usr/bin/env python3
"""Emit a new, audited build context from Git objects, never runtime directories."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile

REVISION = "ac6ed61b7b9c971ad94921de3b16fa6f63c36a20"
EPOCH = 0
ROOT_FILES = {"pyproject.toml", "uv.lock", "setup.py", "MANIFEST.in", "bot.py", "README.md", "LICENSE", "EULA.md", "PRIVACY.md"}
PREFIXES = ("src/", "plugins/", "prompts/", "locales/", "changelogs/", "depends-data/")
FORBIDDEN_PARTS = {"instance", ".data", ".env", ".git", ".venv", "__pycache__", "logs", "node_modules"}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def allowed(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and ".." not in path.parts
            and not any(part in FORBIDDEN_PARTS or part.startswith(".env") for part in path.parts)
            and not name.endswith((".pem", ".key", "-wal", "-shm", ".pyc"))
            and (name in ROOT_FILES or name.startswith(PREFIXES)))

def git(source, *args, data=None):
    return subprocess.check_output(["git", "-C", str(source), *args], input=data)

def write(root, name, data, mode=0o644):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    target.chmod(mode)
    os.utime(target, (EPOCH, EPOCH))

def prepare(destination, workspace):
    package = Path(__file__).resolve().parent
    source = workspace / "experiments/maibot-native/upstream"
    patch = workspace / "experiments/maibot-native/patches/0001-metadata-json-scope.patch"
    gateway = workspace / "experiments/maibot-native/gateway.mjs"
    if destination.exists():
        raise ValueError("Destination must not exist; existing files are never replaced")
    head = git(source, "rev-parse", "HEAD").decode().strip()
    if head != REVISION:
        raise ValueError("Unexpected upstream checkout revision")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".companion-context-", dir=destination.parent))
    try:
        records = git(source, "ls-tree", "-rz", REVISION).split(b"\0")
        for record in filter(None, records):
            metadata, raw_name = record.split(b"\t", 1)
            mode, kind, object_id = metadata.decode().split()
            name = raw_name.decode("utf-8")
            if not allowed(name):
                continue
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise ValueError("Symlinks/submodules are not allowed in the runtime context")
            write(stage, "upstream/" + name, git(source, "cat-file", "blob", object_id), 0o755 if mode == "100755" else 0o644)
        # XUMENG's media action is an explicit, reviewed third-party plugin. Keep
        # it outside the pinned upstream Git tree and copy only its audited files
        # into the image context so the native Runtime can load it per instance.
        media_plugin = workspace / "experiments/maibot-native/plugins/xumeng_media"
        for plugin_name in ("__init__.py", "plugin.py", "_manifest.json"):
            plugin_file = media_plugin / plugin_name
            if not plugin_file.is_file():
                raise ValueError("XUMENG media plugin is incomplete")
            write(stage, "plugins/xumeng_media/" + plugin_name, plugin_file.read_bytes())
        # Apply the reviewed patch to pristine Git data, not the mutable checkout.
        # Its synthetic test file is audited but removed from the runtime context.
        patch_data = patch.read_bytes()
        expected_paths = {"src/A_memorix/core/runtime/services/search_hit_processing_service.py", "pytests/A_memorix_test/test_person_fact_json_scope.py"}
        patch_paths = {line.split(" b/", 1)[1] for line in patch_data.decode().splitlines() if line.startswith("diff --git ")}
        if patch_paths != expected_paths:
            raise ValueError("Unexpected paths in compatibility patch")
        # A context may be emitted inside the workspace repository. Prevent Git
        # discovering that parent, which otherwise silently filters patch paths.
        patch_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        patch_env.update(GIT_CEILING_DIRECTORIES=str(stage.resolve()), GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        def apply(*arguments):
            subprocess.run(["git", "apply", *arguments, str(patch)], cwd=stage / "upstream", env=patch_env,
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        apply("--check")
        apply()
        apply("--reverse", "--check")
        scope = (stage / "upstream/src/A_memorix/core/runtime/services/search_hit_processing_service.py").read_text()
        if "raw_metadata = json.loads(raw_metadata)" not in scope or "metadata = coerce_metadata_dict(raw_metadata)" not in scope:
            raise ValueError("Required metadata scope patch was not applied")
        if not (stage / "upstream/pytests/A_memorix_test/test_person_fact_json_scope.py").is_file():
            raise ValueError("Compatibility patch test was not created")
        shutil.rmtree(stage / "upstream/pytests")
        write(stage, "licenses/0001-metadata-json-scope.patch", patch_data)
        for name in ("Dockerfile", ".dockerignore"):
            write(stage, name, (package / name).read_bytes())
        for name in ("control.mjs", "lifecycle.mjs", "prepare-instance.py", "archive.py", "personas.json"):
            write(stage, "runtime/" + name, (package / name).read_bytes())
        gateway_data = gateway.read_bytes()
        write(stage, "runtime/gateway.mjs", gateway_data)
        files = {}
        for path in sorted(stage.rglob("*")):
            if path.is_symlink():
                raise ValueError("Unexpected symlink in prepared context")
            if path.is_file():
                path.chmod(0o644 if not os.access(path, os.X_OK) else 0o755)
                os.utime(path, (EPOCH, EPOCH))
                files[path.relative_to(stage).as_posix()] = digest(path.read_bytes())
        manifest = {
            "upstreamCommit": REVISION, "upstreamVersion": "1.3.9", "files": files,
            "patchSha256": digest(patch_data), "gatewaySha256": digest(gateway_data),
            "source": "pinned Git objects plus explicit compatibility patch and XUMENG media plugin",
            "runtimeStateCopied": False, "ready": False,
        }
        write(stage, "build-manifest.json", (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode())
        stage.rename(destination)
        return {"context": str(destination), "fileCount": len(files) + 1, "upstreamCommit": REVISION, "runtimeStateCopied": False, "ready": False}
    except BaseException:
        shutil.rmtree(stage)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    workspace = Path(__file__).resolve().parents[3]
    result = prepare(args.destination.expanduser().resolve(), workspace)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
