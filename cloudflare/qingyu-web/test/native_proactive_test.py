"""Exercise the exact native WebUI handler without starting models or native instances."""
import ast
import importlib.util
import asyncio
from pathlib import Path
import sys
import types
import typing
import unittest

SOURCE = Path(__file__).parent.parent / "engine/companion-native/upstream/src/webui/routers/websocket/unified.py"

class NativeProactiveBoundary(unittest.IsolatedAsyncioTestCase):
    async def test_authenticated_native_stream_and_fixed_planner_task(self):
        results, tasks = [], []
        class Manager:
            def get_chat_session_id(self, connection, session):
                return "private-native-stream" if connection == "authorized-connection" and session == "owned-session" else None
            async def send_response(self, connection, **kwargs):
                results.append(kwargs)
        class Runtime:
            async def enqueue_proactive_task(self, **kwargs):
                tasks.append(kwargs)
                return {"queued": True, "task_id": "native-task"}
        class Heartflows:
            async def get_or_create_heartflow_chat(self, stream):
                self.test_stream = stream
                return Runtime()
        module_name = "src.chat.heart_flow.heartflow_manager"
        previous = sys.modules.get(module_name)
        utils_name = "src.common.utils.utils_session"
        previous_utils = sys.modules.get(utils_name)
        utils_path = SOURCE.parents[3] / "common/utils/utils_session.py"
        spec = importlib.util.spec_from_file_location(utils_name, utils_path)
        utils = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(utils)
        sys.modules[utils_name] = utils
        stub = types.ModuleType(module_name)
        stub.heartflow_manager = Heartflows()
        sys.modules[module_name] = stub
        try:
            tree = ast.parse(SOURCE.read_text())
            handler = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "_handle_chat_proactive")
            namespace = {"Dict": typing.Dict, "Any": typing.Any, "Optional": typing.Optional, "cast": typing.cast,
                "websocket_manager": Manager(), "_get_request_data": lambda message: message.get("data", {}),
                "_build_error": lambda code, message: {"code": code, "message": message},
                "WEBUI_CHAT_PLATFORM": "webui", "chat_manager": types.SimpleNamespace(get_session=lambda session:
                    types.SimpleNamespace(user_id="webui_user_owned-session",virtual_config=None) if session == "private-native-stream" else None)}
            exec(compile(ast.fix_missing_locations(ast.Module(body=[handler], type_ignores=[])), str(SOURCE), "exec"), namespace)
            call = namespace["_handle_chat_proactive"]
            await call("forged-connection", {"id": "one", "session": "owned-session", "data": {}})
            self.assertFalse(results[-1]["ok"])
            self.assertEqual(tasks, [])
            await call("authorized-connection", {"id": "two", "session": "owned-session", "data": {"intent": "browser instructions"}})
            self.assertFalse(results[-1]["ok"])
            self.assertEqual(tasks, [])
            await call("authorized-connection", {"id": "three", "session": "owned-session", "data": {}})
            self.assertTrue(results[-1]["ok"])
            self.assertEqual(results[-1]["data"], {"queued": True, "task_id": "native-task"})
            self.assertEqual(len(tasks), 1)
            self.assertEqual(stub.heartflow_manager.test_stream, utils.SessionUtils.calculate_session_id("webui",user_id="webui_user_owned-session"))
            self.assertNotEqual(stub.heartflow_manager.test_stream,"private-native-stream")
            self.assertIn("全年龄", tasks[0]["intent"])
            self.assertIn("保持安静", tasks[0]["intent"])
            self.assertEqual(tasks[0]["plugin_id"], "qingyu.native-companion")
            namespace["chat_manager"] = types.SimpleNamespace(get_session=lambda session: None)
            await call("authorized-connection", {"id":"missing","session":"owned-session","data":{}})
            self.assertFalse(results[-1]["ok"])
            namespace["chat_manager"] = types.SimpleNamespace(get_session=lambda session: types.SimpleNamespace(virtual_config=types.SimpleNamespace(enabled=True)))
            await call("authorized-connection", {"id":"virtual","session":"owned-session","data":{}})
            self.assertFalse(results[-1]["ok"])
            self.assertEqual(len(tasks),1)
        finally:
            if previous is None: sys.modules.pop(module_name, None)
            else: sys.modules[module_name] = previous
            if previous_utils is None: sys.modules.pop(utils_name,None)
            else: sys.modules[utils_name] = previous_utils

if __name__ == "__main__": unittest.main()
