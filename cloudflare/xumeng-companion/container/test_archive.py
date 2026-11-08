import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("companion_archive", Path(__file__).with_name("archive.py"))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)
ACCOUNT = "21bca2ed-2168-4c01-b153-735ad267a35d"
OTHER = "cd5739bb-cfd7-46c1-9807-bb387707327a"

class ArchiveTests(unittest.TestCase):
    def fixture(self, root):
        source = root / "source"
        (source / "data").mkdir(parents=True)
        (source / "gateway-sessions").mkdir()
        (source / "logs").mkdir()
        (source / "container-instance.json").write_text(json.dumps({"accountId": ACCOUNT}))
        (source / "data/MaiBot.db").write_bytes(b"synthetic database bytes")
        (source / "data/MaiBot.db-wal").write_bytes(b"synthetic WAL")
        (source / "gateway-sessions/synthetic.json").write_text('{"receipt":"accepted"}')
        (source / "logs/private.log").write_text("synthetic log excluded")
        (source / "data/native.log.1").write_text("another excluded log")
        return source

    def test_real_cli_snapshot_and_restore_roundtrip(self):
        with tempfile.TemporaryDirectory(prefix="companion-archive-cli-") as temporary:
            root = Path(temporary); source = self.fixture(root)
            snapshot = root / "snapshot.tar.gz"; restored = root / "restored"
            script = str(Path(__file__).with_name("archive.py").resolve())
            def command(operation, instance):
                return subprocess.run([sys.executable, script, operation, "--instance", str(instance),
                                       "--archive", str(snapshot), "--account", ACCOUNT],
                                      capture_output=True, text=True, timeout=20)
            saved = command("snapshot", source)
            self.assertEqual(saved.returncode, 0, saved.stdout)
            before_sha = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            self.assertEqual(json.loads(saved.stdout)["sha256"], before_sha)
            loaded = command("restore", restored)
            self.assertEqual(loaded.returncode, 0, loaded.stdout)
            self.assertTrue(json.loads(loaded.stdout)["restored"])
            for name in ("container-instance.json", "data/MaiBot.db", "data/MaiBot.db-wal", "gateway-sessions/synthetic.json"):
                self.assertEqual((restored / name).read_bytes(), (source / name).read_bytes())
            self.assertEqual(hashlib.sha256(snapshot.read_bytes()).hexdigest(), before_sha)
            self.assertFalse((restored / "logs").exists())
            self.assertEqual(command("restore", restored).returncode, 1)

    def test_complete_snapshot_roundtrip_and_logs_excluded(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = self.fixture(root); path = root / "snapshot.tar.gz"
            result = archive.snapshot(source, path, ACCOUNT)
            self.assertEqual(result["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            restored = root / "restored"
            archive.restore(path, restored, ACCOUNT)
            for name in ("container-instance.json", "data/MaiBot.db", "data/MaiBot.db-wal", "gateway-sessions/synthetic.json"):
                self.assertEqual((restored / name).read_bytes(), (source / name).read_bytes())
            self.assertFalse((restored / "logs").exists())
            self.assertFalse((restored / "data/native.log.1").exists())
            with self.assertRaises(ValueError): archive.restore(path, restored, ACCOUNT)

    def test_template_restore_rewrites_the_account_and_personal_snapshots_stay_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = self.fixture(root)
            identity = json.loads((source / "container-instance.json").read_text())
            identity["accountId"] = archive.TEMPLATE_ACCOUNT
            (source / "container-instance.json").write_text(json.dumps(identity))
            path = root / "template.tar.gz"
            archive.snapshot(source, path, archive.TEMPLATE_ACCOUNT, "classic")
            restored = root / "restored"
            archive.restore(path, restored, OTHER, "classic")
            claimed = json.loads((restored / "container-instance.json").read_text())
            self.assertEqual(claimed["accountId"], OTHER)
            self.assertIs(claimed["template"], True)
            with self.assertRaises(ValueError):
                archive.restore(path, root / "plain", OTHER)
            self.assertFalse((root / "plain").exists())

    def test_cross_account_restore_is_rejected_and_target_stays_absent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = self.fixture(root); path = root / "snapshot.tar.gz"
            archive.snapshot(source, path, ACCOUNT)
            with self.assertRaises(ValueError): archive.restore(path, root / "other", OTHER)
            self.assertFalse((root / "other").exists())

    def test_symlink_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = self.fixture(root)
            (source / "data/link").symlink_to(root / "elsewhere")
            with self.assertRaises(ValueError): archive.snapshot(source, root / "snapshot.tar.gz", ACCOUNT)

    def malicious(self, root, member_name, member_type=tarfile.REGTYPE, hash_override=None):
        name = member_name.removeprefix("instance/")
        value = b"malicious synthetic data"
        manifest = {"format": archive.FORMAT, "version": 1, "accountId": ACCOUNT,
            "files": {name: {"size": len(value), "sha256": hash_override or hashlib.sha256(value).hexdigest(), "mode": 0o600}},
            "directories": [], "totalBytes": len(value)}
        path = root / "malicious.tar.gz"
        with tarfile.open(path, "w:gz") as output:
            encoded = json.dumps(manifest).encode()
            info = tarfile.TarInfo("manifest.json"); info.size = len(encoded)
            output.addfile(info, io.BytesIO(encoded))
            info = tarfile.TarInfo(member_name); info.type = member_type
            info.linkname = "../../outside" if member_type != tarfile.REGTYPE else ""
            info.size = len(value) if member_type == tarfile.REGTYPE else 0
            output.addfile(info, io.BytesIO(value) if member_type == tarfile.REGTYPE else None)
        return path

    def test_traversal_symlink_hardlink_and_hash_corruption_are_rejected(self):
        for name, kind, digest in (("instance/../../outside", tarfile.REGTYPE, None),
                ("instance/data/link", tarfile.SYMTYPE, None), ("instance/data/hard", tarfile.LNKTYPE, None),
                ("instance/data/bad", tarfile.REGTYPE, "0" * 64)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); path = self.malicious(root, name, kind, digest)
                with self.assertRaises(ValueError): archive.restore(path, root / "restored", ACCOUNT)
                self.assertFalse((root / "restored").exists())
                self.assertFalse((root / "outside").exists())

if __name__ == "__main__": unittest.main()
