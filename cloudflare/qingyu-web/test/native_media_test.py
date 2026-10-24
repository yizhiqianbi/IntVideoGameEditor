import base64
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

DIRECTORY = Path(__file__).parent.parent / "engine/companion-native/plugins/xumeng_media"
# Only our media adapter executes. No native MaiBot process or model runtime starts.
package = types.ModuleType("qingyu_media_fixture")
package.__path__ = [str(DIRECTORY)]
sys.modules[package.__name__] = package
sdk = types.ModuleType("maibot_sdk")
sdk.Action = lambda *args, **kwargs: lambda function: function
sdk.MaiBotPlugin = type("MaiBotPlugin", (), {})
sdk_types = types.ModuleType("maibot_sdk.types")
sdk_types.ActivationType = types.SimpleNamespace(ALWAYS="always")
sys.modules.setdefault("maibot_sdk", sdk)
sys.modules.setdefault("maibot_sdk.types", sdk_types)
plugin = importlib.import_module("qingyu_media_fixture.plugin")
review = importlib.import_module("qingyu_media_fixture.review")

def verdict(decision="allowed", categories=None):
    return {}, json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"decision": decision, "categories": categories or []})}}]}).encode()

class NativeMediaBoundary(unittest.TestCase):
    def test_source_is_reviewed_before_tts_and_private_proof_binds_audio_owner_and_character(self):
        with tempfile.TemporaryDirectory(prefix="qingyu-speech-") as directory, patch.dict(os.environ, {
            "MAIBOT_INSTANCE_DIR": directory, "COMPANION_ACCOUNT_ID": "00000000-0000-4000-8000-000000000001",
            "COMPANION_PROFILE": "traveler", "COMPANION_MEDIA_REVIEW_SECRET": "isolated-fixture-secret-" * 2,
        }):
            calls = []
            def post(path, body, **kwargs):
                calls.append((path, body))
                return verdict() if path == "/chat/completions" else ({"content-type": "audio/mpeg"}, b"ID3-fixture-audio")
            with patch.object(plugin, "_post_json", post):
                mime, encoded = plugin.generate_speech("今天也想听听你的故事。")
            self.assertEqual([path for path, _ in calls], ["/chat/completions", "/audio/speech"])
            self.assertEqual(calls[1][1]["input"], "今天也想听听你的故事。")
            proof = json.loads(next((Path(directory) / "data/qingyu-reviewed-speech").glob("*.json")).read_text())
            self.assertEqual(proof["profile"], "traveler")
            self.assertEqual(proof["text"], calls[1][1]["input"])
            self.assertEqual(mime, "audio/mpeg")
            self.assertEqual(base64.b64decode(encoded), b"ID3-fixture-audio")

    def test_rejected_or_uncertain_source_never_calls_tts(self):
        for decision in ("blocked", "uncertain"):
            with patch.object(plugin, "speech_review_scope", lambda: None), patch.object(plugin, "_post_json", return_value=verdict(decision)) as post:
                with self.assertRaises(RuntimeError): plugin.generate_speech("fixture content")
                self.assertEqual(post.call_count, 1)
                self.assertEqual(post.call_args.args[0], "/chat/completions")

    def test_generated_image_is_checked_after_generation_before_return(self):
        calls = []
        def post(path, body, **kwargs):
            calls.append(path)
            if path == "/images": return {}, json.dumps({"data": [{"b64_json": base64.b64encode(b"\x89PNGfixture").decode()}]}).encode()
            return verdict("blocked" if len(calls) == 3 else "allowed")
        with patch.object(plugin, "_post_json", post):
            with self.assertRaises(RuntimeError): plugin.generate_image("一束花")
        self.assertEqual(calls, ["/chat/completions", "/images", "/chat/completions"])

    def test_provider_origin_and_source_proof_configuration_fail_closed(self):
        for url in ("http://openrouter.ai/api/v1", "https://openrouter.ai.evil.test/api/v1", "https://user:pass@openrouter.ai/api/v1", "https://openrouter.ai/api/v1?key=value"):
            with patch.dict(os.environ, {"COMPANION_OPENROUTER_BASE_URL": url}):
                with self.assertRaises(RuntimeError): plugin._base_url()
        with patch.dict(os.environ, {"COMPANION_MEDIA_REVIEW_SECRET": ""}):
            with self.assertRaises(RuntimeError): review.speech_review_scope()

if __name__ == "__main__": unittest.main()
