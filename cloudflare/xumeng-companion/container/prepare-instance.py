#!/usr/bin/env python3
"""Prepare a NEW empty native instance from runtime environment; never run AI.

No .env file is read. Existing instances are never overwritten. Only an
authenticated start invokes this helper; the default image entrypoint does not.
"""
from datetime import datetime, timezone
from contextlib import contextmanager
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import uuid


def inputs(env, source):
    if env.get("COMPANION_AGREEMENTS_ACCEPTED") != "1":
        raise ValueError("Explicit acceptance of the bundled EULA and privacy document is required")
    agreements = {}
    for document, name in (("EULA.md", "COMPANION_EULA_MD5"), ("PRIVACY.md", "COMPANION_PRIVACY_MD5")):
        expected = hashlib.md5((source / document).read_bytes()).hexdigest()
        if env.get(name) != expected:
            raise ValueError("The accepted agreement fingerprint does not match this image")
        agreements[document] = expected
    account = str(uuid.UUID(env.get("COMPANION_ACCOUNT_ID", "")))
    api_key = env.get("COMPANION_OPENROUTER_API_KEY", "")
    if not api_key or "\n" in api_key or "\r" in api_key:
        raise ValueError("A runtime provider secret is required")
    model = env.get("COMPANION_CHAT_MODEL", "").strip()
    fast_model = env.get("COMPANION_FAST_MODEL", "").strip()
    embedding = env.get("COMPANION_EMBEDDING_MODEL", "").strip()
    dimension = int(env.get("COMPANION_EMBEDDING_DIMENSION", "0"))
    if not model or not fast_model or not embedding or dimension < 1 or dimension > 65536:
        raise ValueError("Explicit chat model, fast model, embedding model, and dimension are required")
    return {"account": account, "api_key": api_key, "model": model, "fast_model": fast_model, "embedding": embedding, "dimension": dimension,
            "agreements": agreements, "persona": persona_name(env)}


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(content)


@contextmanager
def instance_working_directory(directory):
    # Native logger initialization uses a relative logs path. Match the official
    # CLI's chdir-before-import behavior without making image code writable.
    previous = os.open(".", os.O_RDONLY)
    try:
        os.chdir(directory)
        yield
    finally:
        os.fchdir(previous)
        os.close(previous)


DEFAULT_PORTS = {"webui": 18001, "ws_server": 8095, "api_server": 8096}
PERSONA_FIELDS = ("nickname", "personality", "behavior_style", "reply_style", "private_chat_prompts")


def load_personas():
    catalog = json.loads(Path(__file__).with_name("personas.json").read_text())
    if not isinstance(catalog, dict) or "classic" not in catalog:
        raise ValueError("Persona catalog is incomplete")
    for person in catalog.values():
        if not isinstance(person, dict):
            raise ValueError("Persona catalog is incomplete")
        if any(not isinstance(person.get(field), str) or not person[field].strip() for field in PERSONA_FIELDS):
            raise ValueError("Persona catalog is incomplete")
        aliases = person.get("alias_names")
        lines = person.get("lines")
        if not isinstance(aliases, list) or not aliases or any(not isinstance(alias, str) or not alias.strip() for alias in aliases):
            raise ValueError("Persona catalog is incomplete")
        if not isinstance(lines, list) or not 1 <= len(lines) <= 2 or any(not isinstance(line, str) or not line.strip() for line in lines):
            raise ValueError("Persona catalog is incomplete")
    return catalog


PERSONAS = load_personas()


def persona_name(env):
    name = str(env.get("COMPANION_PERSONA", "classic")).strip() or "classic"
    if name not in PERSONAS:
        raise ValueError("Unknown companion persona")
    return name


def apply_layout(bot, destination, ports):
    """Bind instance-specific locations so one snapshot can run in any slot."""
    bot["a_memorix"]["storage"]["data_dir"] = str(destination / "data/a-memorix")
    bot["webui"]["port"] = ports["webui"]
    bot["maim_message"]["ws_server_port"] = ports["ws_server"]
    bot["maim_message"]["api_server_port"] = ports["api_server"]


def apply_persona(bot, persona):
    """Write this slot's personalized template. Secrets, memory, and ports stay put."""
    if persona not in PERSONAS:
        raise ValueError("Unknown companion persona")
    person = PERSONAS[persona]
    bot["bot"].update(nickname=person["nickname"], alias_names=list(person["alias_names"]), platform="webui", qq_account="", platforms=[])
    bot["personality"].update(personality=person["personality"], behavior_style=person["behavior_style"], reply_style=person["reply_style"],
        multiple_reply_style=[], multiple_probability=0)
    bot["chat"]["reply_style"]["private_chat_prompts"] = person["private_chat_prompts"]


def rewrite_private(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix=".cfg-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def stamp_persona(destination, persona):
    path = destination / "container-instance.json"
    if not path.is_file():
        return
    identity = json.loads(path.read_text())
    if identity.get("persona") == persona:
        return
    identity["persona"] = persona
    rewrite_private(path, json.dumps(identity))


def clear_fast_reasoning(item):
    """Planner and memory models answer directly. A reasoning field here is rejected or wasted."""
    extra = item.get("extra_params")
    if extra is None or not hasattr(extra, "pop") or "reasoning" not in extra:
        return False
    extra.pop("reasoning", None)
    return True


def uses_grok_reasoning(model):
    return "grok" in str(model or "").lower()


def configure_model_reasoning(item, model):
    """Grok 4.7 requires a thinking effort. DeepSeek answers directly, and its endpoint rejects that field."""
    if uses_grok_reasoning(model):
        return disable_chat_reasoning(item)
    return clear_fast_reasoning(item)


def disable_chat_reasoning(item):
    """Grok 4.7 rejects effort none and requires thinking. Low is its shortest allowed effort."""
    extra = item.get("extra_params")
    if extra is None or not hasattr(extra, "get"):
        item["extra_params"] = {"reasoning": {"effort": "low", "exclude": True}}
        return True
    reasoning = extra.get("reasoning")
    if reasoning is None or not hasattr(reasoning, "get"):
        extra["reasoning"] = {"effort": "low", "exclude": True}
        return True
    changed = False
    if reasoning.get("effort") != "low":
        reasoning["effort"] = "low"
        changed = True
    if reasoning.get("exclude") is not True:
        reasoning["exclude"] = True
        changed = True
    return changed


FAST_TASKS = ("planner", "memory", "mid_memory", "utils", "learner", "fast_model")


def apply_chat_model(destination, model, fast_model=""):
    """The spoken reply stays on the chat model. Planning, memory, and chores use the fast model."""
    model = str(model or "").strip()
    fast_model = str(fast_model or "").strip()
    import tomlkit
    path = destination / "config/model_config.toml"
    if not path.is_file():
        return
    parsed = tomlkit.parse(path.read_text())
    changed = False
    for item in parsed.get("models", []):
        name = item.get("name")
        if name == "xumeng-chat":
            if model and item.get("model_identifier") != model:
                item["model_identifier"] = model
                changed = True
            if configure_model_reasoning(item, model):
                changed = True
        elif name == "xumeng-fast" and fast_model:
            if item.get("model_identifier") != fast_model:
                item["model_identifier"] = fast_model
                changed = True
            if clear_fast_reasoning(item):
                changed = True
    tasks = parsed.get("model_task_config")
    if fast_model and tasks is not None and hasattr(tasks, "get"):
        for task_name, slot in (("replyer", "xumeng-chat"), *((task, "xumeng-fast") for task in FAST_TASKS)):
            task = tasks.get(task_name)
            if task is None or not hasattr(task, "__setitem__"):
                continue
            if list(task.get("model_list") or []) != [slot]:
                task["model_list"] = [slot]
                changed = True
    if changed:
        rewrite_private(path, tomlkit.dumps(parsed))
    info_path = destination / "runtime-info.json"
    if not info_path.is_file():
        return
    try:
        info = json.loads(info_path.read_text())
    except json.JSONDecodeError:
        return
    provider = info.get("provider") if isinstance(info, dict) else None
    if isinstance(provider, dict) and provider.get("model") != model:
        provider["model"] = model
        rewrite_private(info_path, json.dumps(info))


def refresh_template_secrets(destination, source):
    """A factory disk carries a placeholder key and shared local tokens. Replace both before the process starts."""
    identity_path = destination / "container-instance.json"
    identity = json.loads(identity_path.read_text())
    if identity.get("template") is not True:
        return
    settings = inputs(dict(os.environ), source)
    if settings["api_key"] == "xumeng-template-placeholder":
        raise ValueError("A runtime provider secret is required")
    import tomlkit
    model_path = destination / "config/model_config.toml"
    models = tomlkit.parse(model_path.read_text())
    replaced = False
    for provider in models.get("api_providers", []):
        if isinstance(provider, dict) and provider.get("name") == "OpenRouter":
            provider["api_key"] = settings["api_key"]
            replaced = True
    if not replaced:
        raise ValueError("Missing native configuration")
    rewrite_private(model_path, tomlkit.dumps(models))
    bot_path = destination / "config/bot_config.toml"
    bot = tomlkit.parse(bot_path.read_text())
    bot["maim_message"]["auth_token"] = [secrets.token_urlsafe(32)]
    bot["maim_message"]["api_server_allowed_api_keys"] = [secrets.token_urlsafe(32)]
    rewrite_private(bot_path, tomlkit.dumps(bot))
    webui = destination / "data/webui.json"
    if webui.is_file():
        data = json.loads(webui.read_text())
        if isinstance(data, dict):
            data["access_token"] = secrets.token_urlsafe(48)
            rewrite_private(webui, json.dumps(data))
    identity.pop("template", None)
    rewrite_private(identity_path, json.dumps(identity))


def rebind_existing(destination, ports, persona="classic"):
    import tomlkit
    path = destination / "config/bot_config.toml"
    original = path.read_text()
    bot = tomlkit.parse(original)
    name = persona_name({"COMPANION_PERSONA": persona})
    apply_layout(bot, destination, ports)
    apply_persona(bot, name)
    updated = tomlkit.dumps(bot)
    if updated != original:
        rewrite_private(path, updated)
    stamp_persona(destination, name)
    apply_chat_model(destination, os.environ.get("COMPANION_CHAT_MODEL", ""), os.environ.get("COMPANION_FAST_MODEL", ""))
    refresh_template_secrets(destination, Path(os.environ.get("MAIBOT_SOURCE_DIR", "/opt/maibot")).resolve())


def prepare(destination, source, env, ports=None):
    ports = ports or DEFAULT_PORTS
    settings = inputs(env, source)
    if destination.exists():
        raise ValueError("Existing instance refused; restored instances must use check-existing")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = Path(tempfile.mkdtemp(prefix=".new-instance-", dir=destination.parent))
    try:
        child_env = {**env, "MAIBOT_INSTANCE_DIR": str(stage), "MAIBOT_INITIALIZE_ONLY": "1"}
        # Official init only creates templates; no runner, model, or plugin starts.
        subprocess.run([str(source / ".venv/bin/maibot"), "init", "--directory", str(stage)],
                       cwd=stage, env=child_env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        plugin_source = Path(env.get("COMPANION_MEDIA_PLUGIN") or "/opt/companion/plugins/xumeng_media")
        if not (plugin_source / "plugin.py").is_file() or not (plugin_source / "_manifest.json").is_file():
            raise ValueError("XUMENG media plugin is missing from the image")
        plugin_target = stage / "plugins" / "xumeng_media"
        plugin_target.mkdir(parents=True, exist_ok=True)
        for plugin_name in ("__init__.py", "plugin.py", "_manifest.json"):
            shutil.copyfile(plugin_source / plugin_name, plugin_target / plugin_name)
            (plugin_target / plugin_name).chmod(0o600)
        import tomlkit
        bot_path, model_path = stage / "config/bot_config.toml", stage / "config/model_config.toml"
        bot, models = tomlkit.parse(bot_path.read_text()), tomlkit.parse(model_path.read_text())
        apply_persona(bot, settings["persona"])
        bot["chat"]["enable_reply_at"] = False
        bot["experimental"]["planner_message_steering"] = True
        bot["experimental"]["planner_optimized_prompt"] = True
        bot["experimental"]["planner_unsent_reply_retry"] = True
        memory = bot["a_memorix"]
        memory["plugin"]["enabled"] = True
        memory["embedding"].update(model_name="auto", dimension=settings["dimension"], dimension_request_mode="never")
        memory["integration"].update(heuristic_memory_recall_enabled=True, heuristic_memory_recall_window_size=8,
            heuristic_memory_recall_min_new_messages=8, heuristic_memory_recall_min_interval_seconds=60,
            heuristic_memory_cross_chat_enabled=False, heuristic_memory_group_to_private_enabled=False,
            heuristic_memory_private_to_group_enabled=False)
        memory["global_memory_sharing_enabled"] = False
        memory["shared_memory_groups"] = []
        bot["telemetry"]["enable"] = False
        bot["mcp"].update(enable=False, servers=[])
        bot["debug"].update(enable_console_input=False, show_maisaka_thinking=False)
        bot["maim_message"].update(ws_server_host="127.0.0.1",
            enable_api_server=True, api_server_host="127.0.0.1",
            auth_token=[secrets.token_urlsafe(32)], api_server_allowed_api_keys=[secrets.token_urlsafe(32)])
        bot["webui"].update(enabled=True, host=["127.0.0.1"], allowed_ips="127.0.0.1", mode="production")
        apply_layout(bot, destination, ports)
        bot["plugin_runtime"]["enabled"] = True
        bot["plugin_runtime"]["render"]["auto_download_chromium"] = False
        models["api_providers"] = [{"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
            "api_key": settings["api_key"], "client_type": "openai", "auth_type": "bearer", "max_retry": 2, "timeout": 120, "retry_interval": 2}]
        chat_slot = {"name": "xumeng-chat", "model_identifier": settings["model"], "model_type": "llm", "api_provider": "OpenRouter", "send_temperature": True, "visual": False}
        if uses_grok_reasoning(settings["model"]):
            chat_slot["extra_params"] = {"reasoning": {"effort": "low", "exclude": True}}
        models["models"] = [
            chat_slot,
            {"name": "xumeng-fast", "model_identifier": settings["fast_model"], "model_type": "llm", "api_provider": "OpenRouter", "send_temperature": True, "visual": False},
            {"name": "xumeng-embedding", "model_identifier": settings["embedding"], "model_type": "embedding", "api_provider": "OpenRouter", "send_temperature": False, "visual": False},
        ]
        for task in ("replyer", "planner", "memory", "mid_memory", "utils", "learner", "fast_model"):
            models["model_task_config"][task]["model_list"] = ["xumeng-chat" if task == "replyer" else "xumeng-fast"]
        models["model_task_config"]["embedding"]["model_list"] = ["xumeng-embedding"]
        for task in ("emoji", "vlm", "voice", "image_embedding"):
            models["model_task_config"][task]["model_list"] = []
        os.environ["MAIBOT_INSTANCE_DIR"] = str(stage)
        os.environ["MAIBOT_INITIALIZE_ONLY"] = "1"
        sys.path.insert(0, str(source))
        bot_validation, model_validation = bot.unwrap(), models.unwrap()
        bot_validation.pop("inner", None)
        model_validation.pop("inner", None)
        bot_validation["a_memorix"]["web"]["import_config"] = bot_validation["a_memorix"]["web"].pop("import")
        with instance_working_directory(stage):
            from src.config.config import Config, ModelConfig
            Config.model_validate(bot_validation)
            ModelConfig.model_validate(model_validation)
        # Replace only files created by this invocation inside its private stage.
        bot_path.unlink(); model_path.unlink()
        private_write(bot_path, tomlkit.dumps(bot))
        private_write(model_path, tomlkit.dumps(models))
        timestamp = datetime.now(timezone.utc).isoformat()
        private_write(stage / "data/webui.json", json.dumps({"access_token": secrets.token_urlsafe(48),
            "token_source": "configured", "created_at": timestamp, "updated_at": timestamp, "first_setup_completed": True}))
        for document, marker in (("EULA.md", "eula.confirmed"), ("PRIVACY.md", "privacy.confirmed")):
            private_write(stage / marker, settings["agreements"][document])
        private_write(stage / "container-instance.json", json.dumps({"accountId": settings["account"], "persona": settings["persona"],
            "newEmptyInstance": True, "runtimeStarted": False, "durabilityReady": False}))
        private_write(stage / "runtime-info.json", json.dumps({"version": "1.3.9",
            "provider": {"configured": True, "name": "OpenRouter", "model": settings["model"]},
            "memory": {"enabled": True, "implementation": "A_Memorix"}, "plugins": {"enabled": True}}))
        stage.rename(destination)
        return {"prepared": True, "runtimeStarted": False, "ready": False}
    except BaseException:
        shutil.rmtree(stage)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(os.environ.get("COMPANION_INSTANCE_DIR", "/var/lib/xumeng-companion/instance")))
    parser.add_argument("--check-existing", action="store_true")
    parser.add_argument("--webui-port", type=int, default=DEFAULT_PORTS["webui"])
    parser.add_argument("--ws-port", type=int, default=DEFAULT_PORTS["ws_server"])
    parser.add_argument("--api-port", type=int, default=DEFAULT_PORTS["api_server"])
    args = parser.parse_args()
    source = Path(os.environ.get("MAIBOT_SOURCE_DIR", "/opt/maibot")).resolve()
    ports = {"webui": args.webui_port, "ws_server": args.ws_port, "api_server": args.api_port}
    try:
        if any(port < 1024 or port > 65535 for port in ports.values()):
            raise ValueError("Invalid port")
        destination = args.directory.expanduser().resolve()
        if args.check_existing:
            settings = inputs(dict(os.environ), source)
            identity = json.loads((destination / "container-instance.json").read_text())
            if identity.get("accountId") != settings["account"]:
                raise ValueError("Account mismatch")
            for document, marker in (("EULA.md", "eula.confirmed"), ("PRIVACY.md", "privacy.confirmed")):
                if (destination / marker).read_text().strip() != settings["agreements"][document]:
                    raise ValueError("Agreement mismatch")
            for filename in ("bot_config.toml", "model_config.toml"):
                if not (destination / "config" / filename).is_file():
                    raise ValueError("Missing native configuration")
            rebind_existing(destination, ports, settings["persona"])
            result = {"validated": True, "runtimeStarted": False, "ready": False}
        else:
            result = prepare(destination, source, dict(os.environ), ports)
    except Exception:
        # Configuration validators and subprocess errors may contain secret input.
        print("Empty instance preparation failed; verify required runtime inputs and agreement fingerprints. No runtime was started.", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
