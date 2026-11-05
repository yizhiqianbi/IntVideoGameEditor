import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

class PackageTests(unittest.TestCase):
    def test_official_empty_prepare_from_read_only_cwd_writes_only_temporary_instance(self):
        source = ROOT.parents[2] / "experiments/maibot-native/upstream"
        python = source / ".venv/bin/python"
        if not python.is_file():
            self.skipTest("Official local virtual environment is not available")
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            self.skipTest("Read-only cwd regression must run as a non-root user")
        with tempfile.TemporaryDirectory(prefix="companion-readonly-cwd-") as temporary:
            base = Path(temporary)
            readonly = base / "readonly-code"
            readonly.mkdir(mode=0o555)
            target = base / "state/instance"
            env = {"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1",
                   "MAIBOT_SOURCE_DIR": str(source), "COMPANION_AGREEMENTS_ACCEPTED": "1",
                   "COMPANION_ACCOUNT_ID": "21bca2ed-2168-4c01-b153-735ad267a35d",
                   "COMPANION_OPENROUTER_API_KEY": "offline-dummy-no-model-calls",
                   "COMPANION_CHAT_MODEL": "offline/dummy-chat",
                   "COMPANION_FAST_MODEL": "offline/dummy-fast",
                   "COMPANION_EMBEDDING_MODEL": "offline/dummy-embedding",
                   "COMPANION_EMBEDDING_DIMENSION": "4096"}
            for document, key in (("EULA.md", "COMPANION_EULA_MD5"), ("PRIVACY.md", "COMPANION_PRIVACY_MD5")):
                env[key] = hashlib.md5((source / document).read_bytes()).hexdigest()
            try:
                self.assertFalse(os.access(readonly, os.W_OK))
                result = subprocess.run([str(python), str(ROOT / "prepare-instance.py"), "--directory", str(target)],
                                        cwd=readonly, env=env, capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, "Official empty preparation failed from a read-only cwd")
                self.assertEqual(list(readonly.iterdir()), [])
                self.assertTrue((target / "logs").is_dir())
                self.assertTrue((target / "config/bot_config.toml").is_file())
                config = (target / "config/bot_config.toml").read_text()
                self.assertIn('nickname = "林幺"', config)
                self.assertIn("发发便利店", config)
                self.assertNotIn("麦麦", config)
                self.assertNotIn("大二女大学生", config)
                self.assertIn('"persona": "classic"', (target / "container-instance.json").read_text())
                identity = json.loads((target / "container-instance.json").read_text())
                self.assertFalse(identity["runtimeStarted"])
                self.assertFalse(identity["durabilityReady"])
                self.assertEqual(identity["accountId"], env["COMPANION_ACCOUNT_ID"])
            finally:
                readonly.chmod(0o700)

    def test_context_inside_parent_repository_applies_real_scope_patch(self):
        prepare = module("prepare-context").prepare
        workspace = ROOT.parents[2]
        with tempfile.TemporaryDirectory(prefix=".context-test-", dir=ROOT) as temporary:
            target = Path(temporary) / "context"
            result = prepare(target, workspace)
            self.assertFalse(result["runtimeStateCopied"])
            scope = (target / "upstream/src/A_memorix/core/runtime/services/search_hit_processing_service.py").read_text()
            self.assertIn("raw_metadata = json.loads(raw_metadata)", scope)
            self.assertIn("metadata = coerce_metadata_dict(raw_metadata)", scope)
            self.assertFalse((target / "upstream/pytests").exists())
            self.assertEqual((target / "runtime/lifecycle.mjs").read_bytes(), (ROOT / "lifecycle.mjs").read_bytes())
            self.assertEqual((target / "runtime/personas.json").read_bytes(), (ROOT / "personas.json").read_bytes())

    def test_build_allowlist_excludes_runtime_data_and_secrets(self):
        allowed = module("prepare-context").allowed
        for path in ("src/config/config.py", "uv.lock", "LICENSE", "prompts/reply.prompt"):
            self.assertTrue(allowed(path), path)
        for path in ("instance/data/MaiBot.db", ".env.local", "src/.env.production", "src/.data/key", "src/logs/runtime.log", "src/a.pem", "src/../secret", "src/.venv/key", "src/__pycache__/x.pyc", "data/webui.json", "src/instance/history.json"):
            self.assertFalse(allowed(path), path)

    def test_missing_agreement_gate_has_no_filesystem_side_effect(self):
        prepare = module("prepare-instance").prepare
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "instance"
            with self.assertRaises(ValueError):
                prepare(target, Path(temporary) / "source", {})
            self.assertFalse(target.exists())

    def test_unknown_persona_is_rejected(self):
        persona = module("prepare-instance").persona_name
        with self.assertRaises(ValueError):
            persona({"COMPANION_PERSONA": "cast-nope"})
        self.assertEqual(persona({}), "classic")

    def test_mismatched_agreement_fails_without_accepting_any_document(self):
        read = module("prepare-instance").inputs
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            (source / "EULA.md").write_text("Synthetic fixture, not an actual agreement")
            with self.assertRaises(ValueError):
                read({"COMPANION_AGREEMENTS_ACCEPTED": "1", "COMPANION_EULA_MD5": "incorrect"}, source)
            self.assertFalse((source / "eula.confirmed").exists())

    def test_existing_instance_is_rebound_to_its_slot_directory_and_ports(self):
        try:
            import tomlkit  # noqa: F401
        except ImportError:
            self.skipTest("tomlkit is only available in the native virtual environment")
        rebind = module("prepare-instance").rebind_existing
        with tempfile.TemporaryDirectory() as temporary:
            instance = Path(temporary) / "tenants/abc/instance"
            (instance / "config").mkdir(parents=True)
            config = instance / "config/bot_config.toml"
            config.write_text('[bot]\nnickname = "Yume"\nalias_names = ["Yume"]\nplatform = "webui"\nqq_account = ""\nplatforms = []\n'
                              '[personality]\npersonality = "old"\nbehavior_style = "old"\nreply_style = "old"\n'
                              'multiple_reply_style = []\nmultiple_probability = 0\n'
                              '[chat.reply_style]\nprivate_chat_prompts = "old"\n'
                              '[a_memorix.storage]\ndata_dir = "/var/lib/xumeng-companion/instance/data/a-memorix" # keep comment\n'
                              '[webui]\nport = 18001\n[maim_message]\nws_server_port = 8095\napi_server_port = 8096\nauth_token = ["keep-me"]\n')
            config.chmod(0o600)
            identity = instance / "container-instance.json"
            identity.write_text('{"accountId": "21bca2ed-2168-4c01-b153-735ad267a35d", "persona": "classic"}')
            model = instance / "config/model_config.toml"
            model.write_text('[[models]]\nname = "xumeng-chat"\nmodel_identifier = "deepseek/deepseek-v4.1-flash"\n'
                              '[[models]]\nname = "xumeng-fast"\nmodel_identifier = "deepseek/deepseek-v4.1-flash"\nextra_params = { reasoning = { effort = "low", exclude = true } }\n'
                              '[[models]]\nname = "xumeng-embedding"\nmodel_identifier = "qwen/qwen3-embedding-8b"\n'
                              '[model_task_config.replyer]\nmodel_list = ["xumeng-chat"]\n'
                              '[model_task_config.planner]\nmodel_list = ["xumeng-chat"]\n'
                              '[model_task_config.memory]\nmodel_list = ["xumeng-chat"]\n')
            info = instance / "runtime-info.json"
            info.write_text('{"provider": {"model": "deepseek/deepseek-v4.1-flash"}}')
            previous = os.environ.get("COMPANION_CHAT_MODEL")
            previous_fast = os.environ.get("COMPANION_FAST_MODEL")
            os.environ["COMPANION_CHAT_MODEL"] = "deepseek/deepseek-v4.1-flash"
            os.environ["COMPANION_FAST_MODEL"] = "deepseek/deepseek-v4.1-flash"
            try:
                rebind(instance, {"webui": 20011, "ws_server": 20013, "api_server": 20014}, "intimate")
            finally:
                if previous is None:
                    os.environ.pop("COMPANION_CHAT_MODEL", None)
                else:
                    os.environ["COMPANION_CHAT_MODEL"] = previous
                if previous_fast is None:
                    os.environ.pop("COMPANION_FAST_MODEL", None)
                else:
                    os.environ["COMPANION_FAST_MODEL"] = previous_fast
            text = config.read_text()
            self.assertIn(f'data_dir = "{instance}/data/a-memorix"', text)
            self.assertIn("keep comment", text)
            self.assertIn("port = 20011", text)
            self.assertIn("ws_server_port = 20013", text)
            self.assertIn("api_server_port = 20014", text)
            self.assertIn('nickname = "宁宁"', text)
            self.assertIn("你是宁宁，对方的老婆", text)
            self.assertNotIn("麦麦", text)
            self.assertNotIn("大二女大学生", text)
            self.assertNotIn("今天想你了", text)
            self.assertNotIn("过来点，我在这边等你", text)
            self.assertNotIn('nickname = "Yume"', text)
            self.assertIn("keep-me", text)
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertIn('"persona": "intimate"', identity.read_text())
            rebound = model.read_text()
            parsed = tomlkit.parse(rebound)
            slots = {item["name"]: item for item in parsed["models"]}
            self.assertEqual(slots["xumeng-chat"]["model_identifier"], "deepseek/deepseek-v4.1-flash")
            self.assertNotIn("reasoning", slots["xumeng-chat"].get("extra_params") or {})
            self.assertEqual(slots["xumeng-fast"]["model_identifier"], "deepseek/deepseek-v4.1-flash")
            self.assertNotIn("reasoning", slots["xumeng-fast"].get("extra_params") or {})
            self.assertEqual(list(parsed["model_task_config"]["replyer"]["model_list"]), ["xumeng-chat"])
            self.assertEqual(list(parsed["model_task_config"]["planner"]["model_list"]), ["xumeng-fast"])
            self.assertEqual(list(parsed["model_task_config"]["memory"]["model_list"]), ["xumeng-fast"])
            self.assertEqual(rebound.count('effort = "low"'), 0)
            self.assertNotIn("medium", rebound)
            self.assertIn("qwen/qwen3-embedding-8b", rebound)
            self.assertIn("deepseek/deepseek-v4.1-flash", info.read_text())

if __name__ == "__main__":
    unittest.main()
