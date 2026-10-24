import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

path = Path(__file__).parent.parent / "engine/companion-native/upstream/src/maisaka/qingyu_reply_policy.py"
spec = importlib.util.spec_from_file_location("qingyu_reply_policy", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeReplyPolicy(unittest.TestCase):
    def test_delivery_stops_continuation_but_failed_reply_can_retry(self):
        for profile in ("classic", "intimate", "traveler"):
            delivered = SimpleNamespace(success=True, stop_after_execution=False)
            module.finish_qingyu_reply(delivered, "reply", profile)
            self.assertTrue(delivered.stop_after_execution)
            failed = SimpleNamespace(success=False, stop_after_execution=False)
            module.finish_qingyu_reply(failed, "reply", profile)
            self.assertFalse(failed.stop_after_execution)
        for tool in ("xumeng_send_voice", "xumeng_send_image", "xumeng_send_emoji"):
            delivered = SimpleNamespace(success=True, stop_after_execution=False)
            module.finish_qingyu_reply(delivered, tool, "classic")
            self.assertTrue(delivered.stop_after_execution)

    def test_memory_and_media_tools_keep_native_execution_contract(self):
        for tool, profile in (("memory", "classic"), ("voice", "traveler"), ("reply", None)):
            result = SimpleNamespace(success=True, stop_after_execution=False)
            module.finish_qingyu_reply(result, tool, profile)
            self.assertFalse(result.stop_after_execution)


if __name__ == "__main__":
    unittest.main()
