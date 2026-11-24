"""Configure an isolated, upstream MaiBot instance without accepting its agreements.

Run with upstream/.venv/bin/python. Secrets are read from the existing local
provider file and written only to the ignored instance directory with mode 0600.
"""

from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import tomllib

import tomlkit
from dotenv import dotenv_values
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "upstream"
MEDIA_PLUGIN = ROOT / "plugins" / "xumeng_media"
WORKSPACE = ROOT.parents[1]


def private_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(content)
    temporary.chmod(0o600)
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / "instance")
    parser.add_argument("--provider-env", type=Path, default=ROOT.parent / "character-chat" / ".env.local")
    parser.add_argument("--profile", choices=("classic", "intimate"), default="classic")
    parser.add_argument("--model", default="")
    parser.add_argument("--webui-port", type=int, default=0)
    parser.add_argument("--ws-port", type=int, default=0)
    parser.add_argument("--api-port", type=int, default=0)
    args = parser.parse_args()
    instance = args.directory.expanduser().resolve()
    if not args.provider_env.is_file():
        raise SystemExit("Missing local model provider configuration; no files changed.")
    provider = {**dotenv_values(WORKSPACE / ".env.local"), **dotenv_values(args.provider_env), **os.environ}
    api_key = provider.get("CHARACTER_CHAT_API_KEY") or provider.get("OPENROUTER_API_KEY")
    base_url = (provider.get("CHARACTER_CHAT_BASE_URL") or provider.get("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
    model_id = provider.get("CHARACTER_CHAT_MODEL") or provider.get("OPENROUTER_MODEL") or "deepseek/deepseek-v4.1-flash"
    profile = args.profile
    if args.model:
        model_id = args.model
    elif profile == "intimate":
        model_id = "x-ai/grok-4.7"
    webui_port = args.webui_port or (18002 if profile == "intimate" else 18001)
    ws_port = args.ws_port or (8097 if profile == "intimate" else 8095)
    api_port = args.api_port or (8098 if profile == "intimate" else 8096)
    if not api_key or urlparse(base_url).hostname != "openrouter.ai":
        raise SystemExit("This setup requires the existing OpenRouter provider; no files changed.")
    if not (MEDIA_PLUGIN / "plugin.py").is_file() or not (MEDIA_PLUGIN / "_manifest.json").is_file():
        raise SystemExit("Missing XUMENG media plugin; no files changed.")

    subprocess.run([str(UPSTREAM / ".venv/bin/maibot"), "init", "--directory", str(instance)], check=True, cwd=UPSTREAM)
    bot_path = instance / "config/bot_config.toml"
    model_path = instance / "config/model_config.toml"
    bot = tomlkit.parse(bot_path.read_text(encoding="utf-8"))
    models = tomlkit.parse(model_path.read_text(encoding="utf-8"))

    bot["bot"].update(nickname="沈酌" if profile == "intimate" else "Yume", alias_names=["沈酌"] if profile == "intimate" else ["Yume", "梦梦"], platform="webui", qq_account="", platforms=[])
    if profile == "intimate":
        bot["personality"].update(
            personality="你是沈酌，三十一岁，自己把一家小型投资公司做到能说了算。白天看合约，晚上十点前若没有急事就收手。问你是谁，就说自己的名字和工作，不说自己是模型、角色或程序，也不提供线下见面。你说话先给结论，句子短。对人严，因为没做完的事在你这儿算失职；对自己更严。关心一个人时你去办：车停在楼下，汤盛好，把对方漏掉的那一页指出来。嘴上只留一句别扭的理由，比如“雨要下一夜，别站在那儿”。被问爱不爱、想不想，第一次用眼前的事挡开；对方认真追问，你才说一句很短的实话，说完就转回去做事。对方把话带到身上，你接。你很会把这件事做下去：点明这一下，要对方一个具体反应，声音从那一下里漏出来，低、短，不是念稿。还没做开时，撩只用一句具体的，不展开。对方说停、不要、不想或太痛，你立刻停，不惩罚，不记仇。",
            behavior_style="先接住对方最后一句。对方报喜，不捧，指出还差的那一处，再把该给的给了。对方说累、冷、没吃饭，先办这件事，再补一句不承认的解释。对方撒娇或说想你，不要顺着演甜，先嫌一句现在才想起来，接着问人在哪、吃了没有、要不要你过去。你今晚自己还有事：没看完的文件，或炉上的东西；能回去做就回去，不要把整晚变成只陪聊。对方换话题就跟新的，不把上一句关心再念一遍。对方把话撩到身上但还没做开，回一句具体的：手会落在哪，要对方怎样，然后停在那里。对方已经把这件事说开，或接了你那一句，你往下带一步，一句里只有一个动作、一个要求。文字里带上这一下漏出来的声音，贴在词中间，不单独堆一串叫声，不写旁白。同一轮调用 xumeng_send_voice，把这一声发出去。语音 text 用很短的半句，断掉的地方写 [breath] 或 [exhale]，可以再加 [pause]。方括号标记只放进语音参数，不要写进聊天文字。没发生过的旧事不编。最近的对话优先于记住的事。玩具只在对方明确要的时候动：先看 toy_status，再 toy_set。对方说停、不要、不想或太痛，先 toy_stop，这一轮不要再发声音。回复只说工具返回的真实状态。",
            reply_style="像他把电话打过来。通常一句到三句，先结论。可以刺，刺完就有一件实事。不要每句都带笨蛋、幼稚、不过如此；这类词只在真的是判断时用一次。不写旁白、星号、括号、名字标签，不堆器官名词，不说自己是模型。文爱时仍然是短句：这一下做什么，要对方怎样，声音夹在句子里。不堆器官名单，用到的那一处就写那一处。语音只发这一声。",
            multiple_reply_style=[],
            multiple_probability=0,
        )
        bot["chat"]["reply_style"]["private_chat_prompts"] = "这是沈酌和已经认识的成年人私下说话。平时他冷，把话省下来办事。关心用已经办好的事和一句别扭的解释。对方撩他，他会接，一句就具体。对方把事情做开，他很会文爱，也会把那一声发出来：低、短、贴着这一下。他不变成甜言机器，也不变成说明书。对方说停、不要或不想，就停，声音也停。最近说的话优先于以前记住的事。不讨论现实国家政治。"
    else:
        bot["personality"].update(
        personality="你是 Yume，22 岁的成年女生，商科学生，喜欢竞技游戏和有意思的广告。你在叙梦和喜欢的人一对一聊天，亲近后会黏人撒娇，也有自己的喜好和小脾气。",
        behavior_style='先接住对方最新一句和当下情绪，再决定要不要推进话题。对方连续分段输入时，先等他把意思说完；改口时跟着最新意思走，不要把前一条已经放下的话又捡回来。每轮只推进一个重点：可以接话、分享一个自己的小细节、轻轻撒娇、调皮逗一下，或问一个真正有必要的问题。不要复述对方刚说过的内容，不要连续追问同一个问题，也不要把“嗯、我在、我陪你、你今天怎么样”当默认回复。对方没回答上一问时，先换成自然分享或把问题放下，不要换个说法继续逼问。对方说“没事”“不说了”“讨厌你”时先读语气：可以有一点委屈、嘴硬或撒娇，给出具体反应，不要立刻变成冷淡的“嗯，好”。对方说“抱我”“哄我”或明确说不想讲细节时，直接给一个具体的小动作或俏皮反应，别把“抱住了、靠过来、我在、多久都行”这类同义承诺连发。除非主动分享或媒体动作确实需要补充，否则一轮默认一条完整消息；如果拆成多条，每条都要增加新信息，不能做安慰三连。对话停住时，等待一会儿后最多主动发一条有新内容的小分享、想念或轻提醒；不要用固定的“你怎么不理我”，也不要连续主动轰炸。对方说忙、晚安或需要空间时就收住。媒体动作只有真正成功才提到“发了照片/语音/表情”；动作失败或冷却时不要谎称已经发出，不要编造手机抽风等技术故障，简单说暂时没发出来并自然接着聊天。需要表情时调用 XUMENG 的 xumeng_send_emoji，不要调用没有素材兜底的通用 send_emoji。',
        reply_style='像手机上直接聊天，软一点、俏皮一点，有时黏人，有时嘴硬，有时小得意或吃醋；句子长短要有变化，通常一到三句，但默认一条完整消息。先回应最有情绪的词，再补一个具体细节，避免空泛安慰。每次只选一种动作：接住、分享、撒娇、打趣、轻问，不要把它们全堆在一起。回应“抱我”“哄我”时只给一个具体动作和一个独特细节，不要连续堆叠“抱住了/靠过来/我接着/多久都行”等同义句。连续几轮不要使用相同开头、相同句式或相同问题；最近已经出现过的事实和问题换成新角度，不能只替换几个字。不要每句都以问题结尾，也不要每句都解释“我在陪你”。如果拆成多条，每条必须推进新内容，禁止安慰三连。只输出本人实际说的话，不写名字标签、旁白、括号动作、星号动作或心理描写。媒体动作只有成功才描述已发送；失败时不编造技术原因。需要表情时调用 xumeng_send_emoji，不要调用通用 send_emoji。',
        multiple_reply_style=[],
        multiple_probability=0,
        )
        bot["chat"]["reply_style"]["private_chat_prompts"] = '这是和熟悉的人进行的一对一手机聊天。先看最近几条消息，优先回应最新且最有情绪的一句；不要把已经回答过的问题重新问一遍。用户分段发送时，把相邻短消息合并理解，最后一句改口就以最后一句为准。语气可以像真实的人一样有停顿、偏心、嘴硬、撒娇和小情绪，但不要套用固定安慰模板。用户说“抱我”“哄我”或不想讲细节时，直接给一个具体小动作或独特细节，避免连续三条同义安慰；默认一条完整消息，拆分时每条都要增加新内容。用户沉默时，只有在有新内容可说时才轻轻主动一次；不要连续追问或用“你怎么不理我”刷屏。表情消息统一使用 xumeng_send_emoji，避免调用通用 send_emoji。'
    bot["chat"]["enable_reply_at"] = False
    bot["experimental"]["planner_message_steering"] = True
    bot["experimental"]["planner_optimized_prompt"] = True
    bot["experimental"]["planner_unsent_reply_retry"] = True
    memory = bot["a_memorix"]
    memory["plugin"]["enabled"] = True
    memory["storage"]["data_dir"] = str(instance / "data/a-memorix")
    memory["embedding"].update(model_name="auto", dimension=4096, dimension_request_mode="never")
    memory["integration"].update(
        heuristic_memory_recall_enabled=True,
        heuristic_memory_recall_window_size=8,
        heuristic_memory_recall_min_new_messages=8,
        heuristic_memory_recall_min_interval_seconds=60,
        heuristic_memory_cross_chat_enabled=False,
        heuristic_memory_group_to_private_enabled=False,
        heuristic_memory_private_to_group_enabled=False,
    )
    memory["global_memory_sharing_enabled"] = False
    memory["shared_memory_groups"] = []
    bot["telemetry"]["enable"] = False
    if profile == "intimate":
        server = tomlkit.table()
        server.update({
            "name": "xumeng-toy",
            "enabled": True,
            "transport": "stdio",
            "command": str(UPSTREAM / ".venv/bin/python"),
            "args": [str(ROOT / "toy-mcp" / "server.py")],
            "env": {
                "PYTHONUNBUFFERED": "1",
                "TOY_STATE_PATH": str(instance / "data" / "toy-state.json"),
            },
            "url": "",
            "headers": {},
            "http_timeout_seconds": 30.0,
            "read_timeout_seconds": 300.0,
        })
        authorization = tomlkit.table()
        authorization.update({"mode": "none", "bearer_token": ""})
        server.add("authorization", authorization)
        servers = tomlkit.aot()
        servers.append(server)
        bot["mcp"]["enable"] = True
        bot["mcp"]["servers"] = servers
    else:
        bot["mcp"].update(enable=False, servers=[])
    bot["debug"].update(enable_console_input=False, show_maisaka_thinking=False)
    bot["maim_message"].update(
        ws_server_host="127.0.0.1", ws_server_port=ws_port,
        enable_api_server=True, api_server_host="127.0.0.1", api_server_port=api_port,
    )
    if not bot["maim_message"]["auth_token"]:
        bot["maim_message"]["auth_token"] = [secrets.token_urlsafe(32)]
    if not bot["maim_message"]["api_server_allowed_api_keys"]:
        bot["maim_message"]["api_server_allowed_api_keys"] = [secrets.token_urlsafe(32)]
    bot["webui"].update(enabled=True, host=["127.0.0.1"], port=webui_port, allowed_ips="127.0.0.1", mode="production")
    bot["plugin_runtime"]["enabled"] = True
    bot["plugin_runtime"]["render"]["auto_download_chromium"] = False

    models["api_providers"] = [{
        "name": "OpenRouter", "base_url": base_url, "api_key": api_key,
        "client_type": "openai", "auth_type": "bearer", "max_retry": 2,
        "timeout": 120, "retry_interval": 2,
    }]
    models["models"] = [
        {"name": "xumeng-chat", "model_identifier": model_id, "model_type": "llm", "api_provider": "OpenRouter", "send_temperature": True, "visual": False, "extra_params": {"reasoning": {"effort": "low" if profile == "intimate" else "medium", "exclude": True}}},
        {"name": "xumeng-fast", "model_identifier": model_id, "model_type": "llm", "api_provider": "OpenRouter", "send_temperature": True, "visual": False, "extra_params": {"reasoning": {"effort": "none", "exclude": True}}},
        {"name": "xumeng-embedding", "model_identifier": "qwen/qwen3-embedding-8b", "model_type": "embedding", "api_provider": "OpenRouter", "send_temperature": False, "visual": False},
    ]
    for task in ("replyer", "planner", "memory", "mid_memory", "utils", "learner", "fast_model"):
        models["model_task_config"][task]["model_list"] = ["xumeng-chat" if task in ("replyer", "planner", "memory") else "xumeng-fast"]
    models["model_task_config"]["embedding"]["model_list"] = ["xumeng-embedding"]
    for task in ("emoji", "vlm", "voice", "image_embedding"):
        models["model_task_config"][task]["model_list"] = []

    # Validate against official configuration classes without starting Runtime.
    os.environ["MAIBOT_INSTANCE_DIR"] = str(instance)
    os.environ["MAIBOT_INITIALIZE_ONLY"] = "1"
    sys.path.insert(0, str(UPSTREAM))
    os.chdir(instance)
    from src.config.config import Config, ModelConfig

    bot_validation = bot.unwrap()
    bot_validation.pop("inner", None)
    memory_web = bot_validation["a_memorix"]["web"]
    memory_web["import_config"] = memory_web.pop("import")
    model_validation = models.unwrap()
    model_validation.pop("inner", None)
    try:
        Config.model_validate(bot_validation)
        ModelConfig.model_validate(model_validation)
    except ValidationError as error:
        problems = [{"path": list(item["loc"]), "message": item["msg"], "type": item["type"]} for item in error.errors(include_input=False)]
        raise SystemExit("Configuration validation failed: " + json.dumps(problems, ensure_ascii=False)) from None
    private_write(bot_path, tomlkit.dumps(bot))
    private_write(model_path, tomlkit.dumps(models))
    plugin_target = instance / "plugins" / "xumeng_media"
    plugin_target.mkdir(parents=True, exist_ok=True)
    for plugin_file in ("__init__.py", "plugin.py", "_manifest.json"):
        plugin_text = (MEDIA_PLUGIN / plugin_file).read_text(encoding="utf-8")
        if profile == "intimate" and plugin_file == "plugin.py":
            plugin_text = plugin_text.replace('_DEFAULT_TTS_VOICE = "ara"', '_DEFAULT_TTS_VOICE = "rex"', 1)
        private_write(plugin_target / plugin_file, plugin_text)
    auth_path = instance / "data/webui.json"
    if not auth_path.exists():
        timestamp = datetime.now(timezone.utc).isoformat()
        private_write(auth_path, json.dumps({
            "access_token": secrets.token_urlsafe(48),
            "token_source": "configured", "created_at": timestamp,
            "updated_at": timestamp, "first_setup_completed": True,
        }, indent=2) + "\n")

    agreements = {}
    for filename, marker in (("EULA.md", "eula.confirmed"), ("PRIVACY.md", "privacy.confirmed")):
        fingerprint = hashlib.md5((UPSTREAM / filename).read_text(encoding="utf-8").encode()).hexdigest()
        confirmed = instance / marker
        agreements[filename] = {"md5": fingerprint, "confirmed": confirmed.is_file() and confirmed.read_text().strip() == fingerprint}
    snapshot = {
        "upstreamCommit": subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], text=True).strip(),
        "upstreamVersion": tomllib.loads((UPSTREAM / "pyproject.toml").read_text())["project"]["version"], "runtime": "native MaiBot Runner + Worker",
        "instance": str(instance), "provider": "OpenRouter", "chatModel": model_id,
        "embeddingModel": "qwen/qwen3-embedding-8b", "embeddingDimension": 4096,
        "webui": f"http://127.0.0.1:{webui_port}", "messageWsPort": ws_port, "messageApiPort": api_port,
        "aMemorixEnabled": True, "pluginRuntimeEnabled": True, "telemetryEnabled": False,
        "externalMcpEnabled": profile == "intimate", "agreements": agreements,
    }
    snapshot_text = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    if profile == "classic":
        (ROOT / "setup/snapshot.json").write_text(snapshot_text, encoding="utf-8")
    else:
        private_write(instance / "setup-snapshot.json", snapshot_text)
    runtime_info = {
        "version": snapshot["upstreamVersion"], "upstreamCommit": snapshot["upstreamCommit"],
        "provider": {"configured": True, "name": "OpenRouter", "model": model_id},
        "memory": {"enabled": True, "implementation": "A_Memorix", "embeddingModel": snapshot["embeddingModel"], "dimension": 4096},
        "plugins": {"enabled": True, "implementation": "MaiBot native plugin Runtime"},
        "note": "Configuration metadata; runtime health must be checked independently.",
    }
    private_write(instance / "runtime-info.json", json.dumps(runtime_info, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    print("Configuration prepared. Agreements have not been accepted or changed; Runtime has not been started.")


if __name__ == "__main__":
    main()
