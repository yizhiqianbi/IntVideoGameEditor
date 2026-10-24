"""Call only Qingyu's media adapter. Never start MaiBot, load old accounts, or accept native agreements."""
import base64
import importlib
import json
from pathlib import Path
import sys
import types

plugin_directory = Path(__file__).parent.parent / "engine/companion-native/plugins/xumeng_media"
package = types.ModuleType("qingyu_live_media")
package.__path__ = [str(plugin_directory)]
sys.modules[package.__name__] = package
sdk = types.ModuleType("maibot_sdk")
sdk.Action = lambda *args, **kwargs: lambda function: function
sdk.MaiBotPlugin = type("MaiBotPlugin", (), {})
sdk_types = types.ModuleType("maibot_sdk.types")
sdk_types.ActivationType = types.SimpleNamespace(ALWAYS="always")
sys.modules["maibot_sdk"], sys.modules["maibot_sdk.types"] = sdk, sdk_types
plugin = importlib.import_module("qingyu_live_media.plugin")
try:
    mime, encoded = plugin.generate_speech("海边的风小了。今天的小事，也可以慢慢说给我听。")
    raw = base64.b64decode(encoded)
    Path(sys.argv[1]).write_bytes(raw)
    print(json.dumps({"mime": mime, "bytes": len(raw)}))
except Exception as error:
    print(json.dumps({"error": str(error)}, ensure_ascii=False))
    sys.exit(1)
