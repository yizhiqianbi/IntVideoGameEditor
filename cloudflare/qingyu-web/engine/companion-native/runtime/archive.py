#!/usr/bin/env python3
"""Stopped-instance snapshot/restore. No model, network, or native runtime imports."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile
import uuid

FORMAT = "qingyu-companion-instance"
VERSION = 1
MAX_FILES = 100_000
MAX_TOTAL = 1024 * 1024 * 1024
MAX_MANIFEST = 16 * 1024 * 1024
CHUNK = 1024 * 1024

def account_id(value):
    return str(uuid.UUID(value))

def safe_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Invalid path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("Invalid path")
    if path.as_posix() != value or ":" in value:
        raise ValueError("Invalid path")
    return path

def excluded(value):
    path = safe_path(value)
    return "logs" in path.parts or any(part.endswith(".log") or ".log." in part for part in path.parts)

def hash_file(path):
    digest = hashlib.sha256()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("Nonregular file")
        for chunk in iter(lambda: source.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()

def verify_identity(root, account):
    path = root / "container-instance.json"
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing identity")
    if json.loads(path.read_text()).get("accountId") != account:
        raise ValueError("Account mismatch")

class CheckedReader:
    def __init__(self, stream):
        self.stream, self.hash = stream, hashlib.sha256()
    def read(self, size=-1):
        chunk = self.stream.read(size)
        self.hash.update(chunk)
        return chunk

def snapshot(instance, archive, account):
    account = account_id(account)
    if instance.is_symlink() or not instance.is_dir() or archive.exists():
        raise ValueError("Invalid source or existing archive")
    verify_identity(instance, account)
    files, directories, total = {}, [], 0
    for current, names, filenames in os.walk(instance, followlinks=False):
        root = Path(current)
        for name in list(names):
            path = root / name
            relative = path.relative_to(instance).as_posix()
            if path.is_symlink():
                raise ValueError("Symlink is not allowed")
            if excluded(relative):
                names.remove(name)
            else:
                directories.append(relative)
                if len(directories) > MAX_FILES:
                    raise ValueError("Snapshot directory limit exceeded")
        for name in filenames:
            path = root / name
            relative = path.relative_to(instance).as_posix()
            if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError("Nonregular file")
            if excluded(relative):
                continue
            size = path.stat().st_size
            total += size
            if total > MAX_TOTAL or len(files) >= MAX_FILES:
                raise ValueError("Snapshot limit exceeded")
            files[relative] = {"size": size, "sha256": hash_file(path), "mode": 0o700 if path.stat().st_mode & 0o100 else 0o600}
    manifest = {"format": FORMAT, "version": VERSION, "accountId": account, "files": files,
                "directories": sorted(directories), "totalBytes": total, "excluded": ["logs", "*.log", "*.log.*"]}
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > MAX_MANIFEST:
        raise ValueError("Manifest limit exceeded")
    descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as destination, tarfile.open(fileobj=destination, mode="w:gz") as output:
            info = tarfile.TarInfo("manifest.json")
            info.size, info.mode = len(encoded), 0o600
            output.addfile(info, io.BytesIO(encoded))
            for relative in sorted(files):
                metadata = files[relative]
                path = instance / relative
                descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(descriptor, "rb") as stream:
                    current = os.fstat(stream.fileno())
                    if not stat.S_ISREG(current.st_mode) or current.st_size != metadata["size"]:
                        raise ValueError("Snapshot source changed")
                    reader = CheckedReader(stream)
                    info = tarfile.TarInfo("instance/" + relative)
                    info.size, info.mode = metadata["size"], metadata["mode"]
                    output.addfile(info, reader)
                    if reader.hash.hexdigest() != metadata["sha256"]:
                        raise ValueError("Snapshot source changed")
        return {"accountId": account, "fileCount": len(files), "totalBytes": total, "sha256": hash_file(archive)}
    except BaseException:
        archive.unlink(missing_ok=True)
        raise

def restore(archive, instance, account):
    account = account_id(account)
    if instance.exists() or instance.is_symlink():
        raise ValueError("Restore target must not exist")
    instance.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = Path(tempfile.mkdtemp(prefix=".restore-", dir=instance.parent))
    try:
        with tarfile.open(archive, "r|gz") as source:
            first = source.next()
            if first is None or first.name != "manifest.json" or not first.isfile() or first.size > MAX_MANIFEST:
                raise ValueError("Manifest must be first")
            manifest = json.loads(source.extractfile(first).read())
            if manifest.get("format") != FORMAT or manifest.get("version") != VERSION or manifest.get("accountId") != account:
                raise ValueError("Snapshot format or account mismatch")
            files = manifest.get("files")
            directories = manifest.get("directories")
            if not isinstance(files, dict) or not isinstance(directories, list) or len(files) > MAX_FILES or len(directories) > MAX_FILES:
                raise ValueError("Invalid manifest")
            total = 0
            for name, metadata in files.items():
                safe_path(name)
                if excluded(name) or not isinstance(metadata, dict):
                    raise ValueError("Invalid manifest entry")
                size, digest = metadata.get("size"), metadata.get("sha256")
                if not isinstance(size, int) or isinstance(size, bool) or size < 0 or not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                    raise ValueError("Invalid manifest entry")
                total += size
                if total > MAX_TOTAL or metadata.get("mode") not in {0o600, 0o700}:
                    raise ValueError("Snapshot limit or mode invalid")
            if manifest.get("totalBytes") != total:
                raise ValueError("Snapshot size mismatch")
            for directory in directories:
                safe_path(directory)
                if excluded(directory) or directory in files:
                    raise ValueError("Invalid directory")
                (stage / directory).mkdir(parents=True, exist_ok=True, mode=0o700)
            seen = set()
            for member in source:
                if member.name == "manifest.json":
                    if member is first:
                        continue
                    raise ValueError("Duplicate manifest")
                safe_path(member.name)
                if not member.name.startswith("instance/") or not member.isfile():
                    raise ValueError("Nonregular or unexpected tar entry")
                name = member.name.removeprefix("instance/")
                if name in seen or name not in files or member.size != files[name]["size"]:
                    raise ValueError("Unexpected or duplicate file")
                seen.add(name)
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), files[name]["mode"])
                digest = hashlib.sha256()
                with os.fdopen(descriptor, "wb") as destination, source.extractfile(member) as data:
                    for chunk in iter(lambda: data.read(CHUNK), b""):
                        destination.write(chunk)
                        digest.update(chunk)
                if digest.hexdigest() != files[name]["sha256"]:
                    raise ValueError("File hash mismatch")
            if seen != set(files):
                raise ValueError("Snapshot files missing")
        verify_identity(stage, account)
        stage.rename(instance)
        return {"accountId": account, "fileCount": len(files), "totalBytes": total, "restored": True}
    except BaseException:
        shutil.rmtree(stage)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("snapshot", "restore"))
    parser.add_argument("--instance", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--account", required=True)
    args = parser.parse_args()
    try:
        if args.operation == "snapshot":
            result = snapshot(args.instance, args.archive, args.account)
        else:
            result = restore(args.archive, args.instance, args.account)
    except Exception:
        print(json.dumps({"error": "Snapshot operation failed integrity or lifecycle checks"}))
        return 1
    print(json.dumps(result))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
