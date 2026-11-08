#!/usr/bin/env python3
"""Turn public Krea2 preview stills into small NSFW posters and a catalog.

Weights are not downloaded. Style, camera, hair, and ordinary clothing previews
are skipped. Minor-coded names, school uniforms, and non-consent wording are skipped.
"""

from __future__ import annotations

import hashlib
import http.client
import io
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

REPO = "EllaPriest45/Krea2_actions"
ROOT = Path(__file__).resolve().parents[3]
TREE = Path("/tmp/krea2-tree.json")
OUT = ROOT / "public" / "dzmm" / "krea2-actions"
CATALOG = ROOT / "src" / "lib" / "xumeng-krea2-stills.ts"
PROGRESS = Path("/tmp/krea2-build-progress.jsonl")
USER_AGENT = "Mozilla/5.0"
WORKERS = 4

BLOCK_NEEDLES = (
    "loli", "shota", "lolicon", "shotacon", "schoolgirl", "school girl", "gothic lolita",
    "teenikini", "teenage", "tinkerbell", "spider-gwen", "spider gwen", "batgirl",
    "marie rose", "two young women", "unwanted situation", "cumhater", "decapitation",
    "character_design_4-view", "nexblend", "trad goth", "scooby", "velma", "old school",
    "guro", "snuff",
)
# These names are the template itself, not a side tag on an adult sex pose.
TITLE_BLOCK_NEEDLES = ("flat chest", "tiny tits", "tiny breasts")

NSFW = re.compile(
    r"nsfw|blow\s?job|bl0_?wjob|hand\s?job|foot\s?job|titty?\s?f?uck|titjob|paizuri|deep\s?throat|"
    r"doggystyle|doggy style|\bdoggy\b|missionary|cowgirl|reverse cowgirl|\bamazon\b|sixtynine|sixty nine|\b69\b|six9|"
    r"fingering|\bdildo\b|masturb|creampie|cumshot|cumming|\bcum\b|ahegao|\bahgo\b|"
    r"bondage|\bbdsm\b|\bspank|twerk|\bnude\b|\bnaked\b|pussy|penis|\bcock\b|\bdick\b|vagina|"
    r"\banus\b|asshole|\banal\b|nipples?|areola|\bgape\b|orgasm|squirt|penetrat|"
    r"topless|bottomless|labia|\bclit|bukkake|facesit|rimjob|cunnilingus|fellatio|"
    r"pegging|fisting|gangbang|threesome|\borgy\b|cameltoe|panties|\bthong\b|lingerie|\bbikini\b|"
    r"see-?through|crotch|vibrator|sybian|tail\s?plug|face\s?fuck|throat|\bfuck\b|\bslut|"
    r"\bpawg\b|playboy|bunnysuit|babydoll|fishnet|nip\s?slip|pubic|vulva|\berect|"
    r"glory\s?hole|full nelson|mating press|prone bone|spitroast|"
    r"\bxxx\b|self suck|wrong hole|ponygirl|pony girl|quartercup|undress|remove clothes|"
    r"\bsex\b|sexual|\blewd\b|erotic|stripper|pole danc|showing underwear|pants pulled|unzipped|"
    r"tan\s?lines?|sideboob|underboob|cleavage|\bbreasts?\b|\bboobs?\b|\btits?\b|"
    r"\bass\b|butt(?:ock)?s?|genital|futanari|\bfuta\b|tentacle|succubus|"
    r"oral sex|object insertion|fleshlight|on glass|ball gag|pillory|frottage|\bblacked\b|"
    r"blowbang|open cup|\bnudity\b|38dd|clitoris|landingstrip|\bbush\b|lactat|hucow|milking|"
    r"\bcollar\b|shibari|handcuf|straitjacket|bodysuit|\bteddy\b|\bpvc\b|\blatex\b|"
    r"presenting|worship|\bbulge\b|grinding|suck(?:ing)?|insertion|inside her|"
    r"wet clothing|only towel|oversized load|chipmunk|hairy|mons pubis|banana tit|fat[_\s]ass|"
    r"bubbly bum|bustfx|\bharness\b|dropseat|shirt lift|genitals|testic|scrotum|"
    r"squirting|breeding|womb|cervix|gagging|reverse cow|vaginal|cum ?on|"
    r"tongue out|tied up|hogtied|kissing|french kiss|lip bite|biting lips|"
    r"whaletail|panty peek|strained shirt|bursting out|thicc|thick body|milf|"
    r"nudius|thecock|tittyfuck|side profile bj|tribbing|anilingus|lotus tied|tied to bed|"
    r"getting gagged|gyno|rough stuff|porn recording|amateur pov|back shots|aroundback|"
    r"bolted on bimbo|bob's bobs|lace me up|suspender|t-girl|t-swimsuit|transparent clothes|"
    r"wet babe|zoom in on",
    re.I,
)

PAIRS = [
    ("reverse cowgirl", "反向女上位"),
    ("doggy style", "后入"),
    ("doggystyle", "后入"),
    ("full nelson", "折叠抱"),
    ("mating press", "压紧体位"),
    ("prone bone", "趴伏体位"),
    ("french kiss", "舌吻"),
    ("deep throat", "深喉"),
    ("deepthroat", "深喉"),
    ("blowjob", "口交"),
    ("handjob", "手交"),
    ("footjob", "足交"),
    ("tittyfuck", "乳交"),
    ("titfuck", "乳交"),
    ("titjob", "乳交"),
    ("paizuri", "乳交"),
    ("thigh job", "腿交"),
    ("thighjob", "腿交"),
    ("sixtynine", "六九"),
    ("sixty nine", "六九"),
    ("missionary", "传教士"),
    ("cowgirl", "女上位"),
    ("fingering", "指交"),
    ("masturbation", "自慰"),
    ("creampie", "内射"),
    ("cumshot", "射精"),
    ("cumming", "射精"),
    ("ahegao", "翻白眼"),
    ("facesitting", "坐脸"),
    ("facesit", "坐脸"),
    ("anilingus", "舔肛"),
    ("cunnilingus", "舔阴"),
    ("fellatio", "口交"),
    ("rimjob", "舔肛"),
    ("glory hole", "墙洞"),
    ("gloryhole", "墙洞"),
    ("object insertion", "异物插入"),
    ("ball gag", "口塞"),
    ("tailplug", "尾塞"),
    ("tail plug", "尾塞"),
    ("facefuck", "深喉"),
    ("face fuck", "深喉"),
    ("nip slip", "走光"),
    ("sideboob", "侧乳"),
    ("underboob", "下乳"),
    ("open cup", "开杯"),
    ("quartercup", "浅杯"),
    ("remove clothes", "脱掉衣服"),
    ("showing underwear", "露出内衣"),
    ("pants pulled", "褪下裤子"),
    ("wet clothing", "湿衣服"),
    ("only towel", "只围毛巾"),
    ("panty peek", "内裤边缘"),
    ("shirt lift", "掀起上衣"),
    ("landing strip", "一条阴毛"),
    ("landingstrip", "一条阴毛"),
    ("mons pubis", "阴阜"),
    ("banana tits", "细长胸部"),
    ("bubbly bum", "圆臀"),
    ("oral sex", "口交"),
    ("on glass", "贴在玻璃上"),
    ("tied up", "绑住"),
    ("hogtied", "捆绑"),
    ("tongue out", "伸舌"),
    ("lip bite", "咬唇"),
    ("biting lips", "咬唇"),
    ("french kiss", "舌吻"),
    ("kissing", "接吻"),
    ("bondage", "捆绑"),
    ("lingerie", "内衣"),
    ("panties", "内裤"),
    ("panty", "内裤"),
    ("thong", "丁字裤"),
    ("bikini", "比基尼"),
    ("babydoll", "情趣短裙"),
    ("fishnet", "网袜"),
    ("stockings", "丝袜"),
    ("bodysuit", "紧身衣"),
    ("cleavage", "乳沟"),
    ("nipples", "乳头"),
    ("nipple", "乳头"),
    ("areola", "乳晕"),
    ("breasts", "胸部"),
    ("breast", "胸部"),
    ("boobs", "胸部"),
    ("boob", "胸部"),
    ("tits", "胸部"),
    ("buttocks", "臀部"),
    ("butt", "臀部"),
    ("futanari", "双性"),
    ("vagina", "阴道"),
    ("penis", "阴茎"),
    ("pussy", "阴部"),
    ("clitoris", "阴蒂"),
    ("testicles", "睾丸"),
    ("scrotum", "阴囊"),
    ("genitals", "生殖器"),
    ("topless", "上身裸露"),
    ("bottomless", "下身裸露"),
    ("naked", "裸体"),
    ("nude", "裸体"),
    ("nudity", "裸体"),
    ("orgasm", "高潮"),
    ("squirting", "潮吹"),
    ("squirt", "潮吹"),
    ("creampie", "内射"),
    ("bukkake", "多次颜射"),
    ("gangbang", "群交"),
    ("threesome", "三人"),
    ("pegging", "女攻"),
    ("fisting", "拳交"),
    ("vibrator", "振动棒"),
    ("fleshlight", "飞机杯"),
    ("dildo", "假阳具"),
    ("sybian", "骑乘器具"),
    ("straitjacket", "拘束衣"),
    ("pillory", "颈手枷"),
    ("handcuffs", "手铐"),
    ("harness", "束带"),
    ("collar", "项圈"),
    ("latex", "乳胶"),
    ("spank", "拍臀"),
    ("twerk", "扭臀"),
    ("gape", "张开"),
    ("anal", "肛交"),
    ("anus", "肛门"),
    ("cameltoe", "骆驼趾"),
    ("pubic", "阴毛"),
    ("hairy", "体毛"),
    ("bush", "阴毛"),
    ("lactation", "泌乳"),
    ("milking", "挤奶"),
    ("tentacle", "触手"),
    ("succubus", "魅魔"),
    ("presenting", "展示"),
    ("worship", "贴近"),
    ("grinding", "磨蹭"),
    ("sucking", "吮吸"),
    ("insertion", "插入"),
    ("penetration", "插入"),
    ("riding", "骑乘"),
    ("kneeling", "跪着"),
    ("standing", "站着"),
    ("sitting", "坐着"),
    ("lying", "躺着"),
    ("spread", "张开"),
    ("close-up", "特写"),
    ("closeup", "特写"),
    ("selfie", "自拍"),
    ("oiled", "涂油"),
    ("wet", "湿身"),
    ("micro", "极小"),
    ("saggy", "下垂"),
    ("floppy", "下垂"),
    ("huge", "很大"),
    ("giant", "很大"),
    ("thick", "丰满"),
    ("curvy", "曲线"),
    ("milf", "熟女"),
    ("bimbo", "夸张身材"),
    ("lesbian", "女女"),
    ("futa", "双性"),
    ("bdsm", "绳缚"),
    ("cum", "精液"),
    ("ass", "臀部"),
    ("tit", "胸"),
    ("sex", "交合"),
    ("oral", "口"),
    ("pose", "姿势"),
    ("posing", "姿势"),
    ("expression", "表情"),
    ("tongue", "舌"),
    ("kiss", "接吻"),
    ("bra", "胸罩"),
    ("skirt", "短裙"),
    ("dress", "裙子"),
    ("heels", "高跟鞋"),
    ("amateur", "业余"),
    ("realistic", "写实"),
    ("from behind", "从后面"),
    ("pov", "主观视角"),
    ("doggy", "后入"),
    ("amazon", "压制体位"),
    ("bound", "缚住"),
    ("tied", "绑住"),
    ("gagged", "口塞"),
    ("gag", "口塞"),
    ("cock", "阴茎"),
    ("dick", "阴茎"),
    ("slut", "放荡"),
    ("xxx", "成人"),
    ("69", "六九"),
    ("sexual", "交合"),
    ("lewd", "色情"),
    ("erotic", "情色"),
    ("orgy", "群交"),
    ("stripper", "脱衣"),
    ("breeding", "内射"),
    ("womb", "子宫"),
    ("cervix", "宫口"),
    ("undress", "脱衣"),
    ("crotch", "胯部"),
    ("teddy", "连体内衣"),
    ("pvc", "透明塑胶"),
    ("bulge", "隆起"),
    ("erect", "勃起"),
    ("vulva", "外阴"),
    ("labia", "阴唇"),
    ("facial", "颜射"),
    ("blacked", "深色性交"),
    ("blowbang", "多人口交"),
    ("whaletail", "丁字裤边缘"),
    ("tribbing", "相互磨蹭"),
    ("nudius", "裸体"),
    ("thicc", "丰满"),
    ("zoom", "拉近"),
    ("rough", "激烈"),
    ("recording", "拍摄"),
    ("transparent", "透明"),
    ("clothes", "衣服"),
    ("swimsuit", "泳装"),
    ("suspender", "吊袜"),
    ("lace", "蕾丝"),
    ("bra", "胸罩"),
]


# First matching group wins. Title is checked before the long trigger text, so a
# clothing LoRA does not get pulled into an act just because the trigger mentions it.
IMAGE_GROUPS = (
    ("sixty-nine", "六九", "两名成年人互相口交。", (r"\b69\b", r"six9", r"sixtynine", r"sixty[\s-]?nine")),
    ("foot", "足交", "她用脚夹住并摩擦阴茎。", (r"foot\s?job",)),
    ("tit", "乳交", "她用胸部夹住阴茎上下抽动。", (r"tit(?:ty)?\s?f?uck", r"titjob", r"paizuri", r"boobjob")),
    ("hand", "手交", "她用手握住阴茎上下套弄。", (r"hand\s?job", r"dickjob")),
    ("thigh", "腿交", "她用大腿夹住阴茎摩擦。", (r"thigh\s?job",)),
    ("oral", "口交", "她用嘴含住阴茎来回吮吸。", (r"blow\s?job", r"bl0_?wjob", r"deep\s?throat", r"fellatio", r"cunnilingus", r"\boral\b", r"face\s?fuck", r"facesit", r"blowbang", r"\bbj\b", r"\bsuck", r"\blick(?:ing)?\b", r"throat", r"biting penis", r"gloryhole", r"fuck face")),
    ("anal", "肛交", "阴茎插入她的肛门抽送。", (r"\banal\b", r"\banus\b", r"anilingus", r"rim\s?job", r"pegging")),
    ("cowgirl", "女上位", "她跨坐在对方身上上下骑乘。", (r"cowgirl", r"\bamazon\b", r"\briding\b")),
    ("doggy", "后入", "她趴好，从后方插入抽送。", (r"dogg(?:y|ie|ystyle)", r"back\s?shots?", r"prone\s?bone", r"aroundback")),
    ("missionary", "传教士", "她仰卧，对方以传教士体位抽送。", (r"missionary", r"mating\s?press", r"full\s?nelson")),
    ("finger", "指交", "手指插入阴道来回抽送。", (r"fingering",)),
    ("toy", "玩具", "她使用成人玩具。", (r"\bdildo\b", r"vibrator", r"sybian", r"fleshlight", r"masturb", r"tail\s?plug", r"\bplug\b", r"fisting", r"fuck machine", r"object insertion")),
    ("cum", "射精", "精液射在成年人物身上。", (r"cumshot", r"creampie", r"cumming", r"\bcum\b", r"\bfacial\b", r"bukkake", r"semen", r"chipmunk", r"squirt", r"oversized load")),
    ("bound", "捆绑", "她保持自愿的捆绑姿态。", (r"bondage", r"\bbdsm\b", r"shibari", r"hogtie", r"\btied\b", r"\bgag(?:ged|ging)?\b", r"pillory", r"handcuff", r"\brope\b", r"straitjacket", r"spank", r"\bbound\b", r"restrained", r"\bcollar\b", r"ponygirl")),
    ("face", "表情", "她做出成年人性高潮时的表情。", (r"ahegao", r"\bahgo\b", r"orgasm", r"lip\s?bite", r"biting\s?lips", r"tongue\s?out", r"wrong hole")),
    ("kiss", "接吻", "两名成年人接吻。", (r"kissing", r"french\s?kiss")),
    ("group", "多人", "多名成年人一起进行性行为。", (r"gangbang", r"threesome", r"\borgy\b", r"\blesbian\b", r"tribbing")),
    ("futa", "双性", "画面中的成年人物同时有阴茎和阴道。", (r"futanari", r"\bfuta\b", r"shemale", r"femboy", r"t girl")),
    ("chest", "胸部", "镜头对准成年人物的胸部。", (r"breasts?", r"\bboobs?\b", r"\bbobs\b", r"\btits?\b", r"nipples?", r"areola", r"cleavage", r"underboob", r"sideboob", r"\d+dd", r"\bbust", r"hucow", r"milking", r"bursting")),
    ("rear", "臀部", "镜头对准成年人物的臀部。", (r"\bass\b", r"butt", r"\bbum\b", r"pawg", r"twerk")),
    ("groin", "阴部", "镜头对准成年人物的阴部。", (r"pussy", r"vagina", r"cameltoe", r"clitoris", r"pubic", r"labia", r"\bmons\b", r"landing\s?strip", r"\bbush\b", r"\bbean\b", r"\bbulge\b")),
    ("nude", "裸体", "成年人物全身裸体。", (r"nudes?", r"\bnaked\b", r"nudity", r"undress", r"tan\s?lines?", r"only towel")),
    ("penis", "阴茎", "镜头对准成年人物的阴茎。", (r"\bpenis\b", r"\bcock\b", r"\bdick\b", r"uncircumcised", r"\buncut\b", r"thecock")),
    ("lingerie", "内衣", "她穿着成人内衣或情趣服装。", (r"lingerie", r"\bthong\b", r"bikini", r"babydoll", r"\bteddy\b", r"fishnet", r"bodysuit", r"\bbras?\b", r"pant(?:y|ies)\b", r"\bharness\b", r"\blatex\b", r"\bpvc\b", r"swimsuit", r"bunny", r"underwear", r"pantyhose", r"stockings?", r"playboy", r"wet clothing", r"pulled down", r"unzipped", r"nip slip", r"open cup", r"quartercup", r"idol", r"\bdress\b", r"miniskirt", r"\boutfit\b", r"uniform", r"\bclothes\b", r"pajamas", r"whaletail", r"low\s?rise", r"bustier", r"lace me up")),
    ("figure", "身材", "成年人物的身体曲线被强调。", (r"\bmilf\b", r"\bthicc\b", r"thick body", r"nice body", r"bimbo", r"proportions")),
    ("sex", "性交", "两名成年人正在性交。", (r"\bsex\b", r"\bhardcore\b", r"penetration", r"frottage", r"grinding", r"blacked", r"rough stuff", r"on glass")),
    ("other", "其他", "按这张模板图呈现成年人物的姿势与服装。", ()),
)


def title_of(path: str) -> str:
    name = re.sub(r"\.(png|jpe?g|webp|safetensors)$", "", path.rsplit("/", 1)[-1], flags=re.I)
    return re.split(r"\s+-\s+Krea2(?:T|E)?(?:\s+-\s+|$)", name, maxsplit=1)[0].strip()


def ensure_tree() -> list[dict]:
    if TREE.exists() and TREE.stat().st_size > 1000:
        return json.loads(TREE.read_text())
    items: list[dict] = []
    url = f"https://huggingface.co/api/models/{REPO}/tree/main?recursive=1&limit=1000"
    while url:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            items.extend(json.load(response))
            link = response.headers.get("Link") or ""
        url = ""
        for part in link.split(","):
            if 'rel="next"' in part:
                url = part.split(";")[0].strip().strip("<>")
    TREE.write_text(json.dumps(items))
    return items


def readable(value: str) -> str:
    return re.sub(r"[_\-]+", " ", value)


def classify(title: str, source: str) -> tuple[str, str, str]:
    title = readable(title)
    source = readable(source)
    for group_id, label, frame, patterns in IMAGE_GROUPS:
        if patterns and any(re.search(pattern, title, flags=re.I) for pattern in patterns):
            return group_id, label, frame
    return "other", "其他", "按这张模板图呈现成年人物的姿势与服装。"


def trigger_of(path: str, title: str) -> str:
    name = re.sub(r"\.(png|jpe?g|webp|safetensors)$", "", path.rsplit("/", 1)[-1], flags=re.I)
    parts = re.split(r"\s+-\s+Krea2(?:T|E)?\s+-\s+", name, maxsplit=1)
    raw = parts[1] if len(parts) > 1 else title
    raw = re.sub(r"\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*str", " ", raw, flags=re.I)
    raw = re.sub(r"\s+", " ", raw).strip(" ,")
    return (raw or title).strip()[:240]


def strength_of(path: str) -> str:
    match = re.search(r"(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*str\b", path, flags=re.I)
    return match.group(1) if match else "1"


def weight_index(items: list[dict]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for item in items:
        path = item.get("path") or ""
        if not path.lower().endswith(".safetensors"):
            continue
        grouped.setdefault(title_of(path).lower(), []).append(path.rsplit("/", 1)[-1])
    return grouped


def match_weight(title: str, source: str, weights: dict[str, list[str]]) -> str:
    title_key = title.lower()
    candidates = list(weights.get(title_key, []))
    if not candidates and len(title_key) >= 8:
        for key, files in weights.items():
            if key.startswith(title_key) or title_key.startswith(key):
                candidates.extend(files)
    if not candidates:
        return ""
    source_key = source.lower()

    def score(filename: str) -> int:
        shared = 0
        for left, right in zip(source_key, filename.lower()):
            if left != right:
                break
            shared += 1
        return shared

    return max(candidates, key=score)


def blocked(title: str, path: str) -> bool:
    blob = f"{title}\n{path}".lower()
    if any(needle in blob for needle in BLOCK_NEEDLES):
        return True
    if any(needle in title.lower() for needle in TITLE_BLOCK_NEEDLES):
        return True
    if re.search(r"(^|[^a-z])teen([^a-z]|$)", blob):
        return True
    if re.search(r"(^|[^a-z])youth([^a-z]|$)", blob):
        return True
    if "young,mature" in blob.replace(" ", ""):
        return True
    return False


def slugify(title: str, index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:42].strip("-")
    return slug or f"still-{index}"


def translate(title: str) -> str:
    text = title
    for english, chinese in sorted(PAIRS, key=lambda item: len(item[0]), reverse=True):
        text = re.sub(rf"(?<![a-z0-9]){re.escape(english)}(?![a-z0-9])", chinese, text, flags=re.I)
    text = re.sub(r"[A-Za-z0-9_+.'’]+", " ", text)
    text = re.sub(r"[^0-9\u4e00-\u9fff]", "", text)
    return text[:12]


def select_images() -> list[dict]:
    items = json.loads(TREE.read_text())
    chosen = []
    for item in items:
        path = item.get("path") or ""
        if not path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        title = title_of(path)
        if blocked(title, path) or not NSFW.search(f"{title}\n{path}"):
            continue
        chosen.append({"source": path, "title": title, "bytes": item.get("size") or 0})
    chosen.sort(key=lambda item: item["source"].lower())
    used: set[str] = set()
    for index, item in enumerate(chosen, start=1):
        base = slugify(item["title"], index)
        candidate = f"krea2-{base}"
        number = 2
        while candidate in used or not re.fullmatch(r"krea2(?:-[a-z0-9]+)+", candidate):
            candidate = f"krea2-still-{index}" if number > 20 else f"krea2-{base}-{number}"
            number += 1
        used.add(candidate)
        item["id"] = candidate
    return chosen


def load_progress() -> dict[str, dict]:
    if not PROGRESS.exists():
        return {}
    done = {}
    for line in PROGRESS.read_text().splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        done[item["id"]] = item
    return done


def fetch(path: str) -> bytes:
    url = f"https://huggingface.co/{REPO}/resolve/main/{urllib.parse.quote(path, safe='/')}"
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                chunks = []
                while True:
                    block = response.read(256 * 1024)
                    if not block:
                        break
                    chunks.append(block)
                data = b"".join(chunks)
                expected = response.headers.get("Content-Length")
                if expected and int(expected) != len(data):
                    raise http.client.IncompleteRead(data)
                if len(data) < 1000:
                    raise RuntimeError(f"short response {len(data)}")
                return data
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, RuntimeError) as error:
            last_error = error
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(str(last_error))


def to_webp(raw: bytes) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(raw)) as image:
        image = image.convert("RGB")
        image.thumbnail((480, 640), Image.Resampling.LANCZOS)
        width, height = image.size
        quality = 58
        data = b""
        while quality >= 30:
            buffer = io.BytesIO()
            image.save(buffer, "WEBP", quality=quality, method=4)
            data = buffer.getvalue()
            if len(data) <= 180_000:
                break
            quality -= 8
        if width < 32 or height < 32 or len(data) < 800 or len(data) > 200_000:
            raise RuntimeError(f"bad poster {width}x{height} {len(data)}")
        return data, width, height


def aspect_ratio(width: int, height: int) -> str:
    if width >= height * 1.25:
        return "16:9" if width >= height * 1.6 else "4:3"
    if height >= width * 1.15:
        return "3:4"
    return "1:1"


def catalog_fields(title: str, source: str, weights: dict[str, list[str]]) -> dict:
    group_id, label, frame = classify(title, source)
    weight_file = match_weight(title, source, weights)
    trigger_source = weight_file or source
    english_words = [word for word in re.findall(r"[A-Za-z]{3,}", title) if word.lower() not in {"krea", "the", "and", "with", "for", "from", "version"}][:3]
    tags = ["参考图", "生图", label]
    tags.extend(word.lower() for word in english_words)
    trigger = trigger_of(trigger_source, title)
    if len(trigger) < 2 or trigger in frame:
        trigger = title[:160] or "adult still"
    return {
        "label": label,
        "englishLabel": title[:160] or "Adult still",
        "description": label,
        "tags": tags[:8],
        "frame": frame,
        "group": group_id,
        "weightFile": weight_file,
        "strength": strength_of(trigger_source),
        "trigger": trigger,
    }


def process(item: dict) -> dict:
    raw = fetch(item["source"])
    data, width, height = to_webp(raw)
    destination = OUT / f"{item['id']}.webp"
    destination.write_bytes(data)
    fields = catalog_fields(item["title"], item["source"], item.get("weights") or {})
    return {
        "id": item["id"],
        "source": item["source"],
        "width": width,
        "height": height,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "aspectRatio": aspect_ratio(width, height),
        **fields,
    }


def write_outputs(results: list[dict]) -> None:
    results = sorted(results, key=lambda item: item["id"])
    manifest = {
        "schemaVersion": 1,
        "provenance": {
            "kind": "third-party-krea2-preview",
            "repo": REPO,
            "thirdPartyAssets": True,
            "weightsBundled": False,
            "modelOutput": False,
        },
        "assets": [
            {
                "id": item["id"],
                "source": item["source"],
                "poster": {
                    "path": f"/dzmm/krea2-actions/{item['id']}.webp",
                    "mimeType": "image/webp",
                    "bytes": item["bytes"],
                    "sha256": item["sha256"],
                    "width": item["width"],
                    "height": item["height"],
                },
            }
            for item in results
        ],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    lines = [
        'import type { GenerationTemplate } from "./xumeng-generation-templates";',
        "",
        "const stillPattern = (frame: string) =>",
        "  `以用户上传的参考图作为起始画面。图中人物是自愿的成年人，保持面部、发型和体型，不把人物换成别人。画面：${frame}单张静帧，不要文字或水印。`;",
        "",
        "export const KREA2_IMAGE_GROUPS = [",
    ]
    for group_id, label, _frame, _patterns in IMAGE_GROUPS:
        lines.append(f'  {{ id: "{group_id}", label: "{label}" }},')
    lines += [
        "] as const;",
        "",
        "const sources: readonly { id: string; label: string; englishLabel: string; description: string; tags: readonly string[]; aspectRatio: string; frame: string; group: string; weightFile: string; strength: string; trigger: string }[] = [",
    ]
    for item in results:
        lines.append(
            "  "
            + json.dumps(
                {
                    "id": item["id"],
                    "label": item["label"],
                    "englishLabel": item["englishLabel"],
                    "description": item["description"],
                    "tags": item["tags"],
                    "aspectRatio": item["aspectRatio"],
                    "frame": item["frame"],
                    "group": item["group"],
                    "weightFile": item["weightFile"],
                    "strength": item["strength"],
                    "trigger": item["trigger"],
                },
                ensure_ascii=False,
            )
            + ","
        )
    lines += [
        "];",
        "",
        "export const KREA2_STILL_TEMPLATES: readonly GenerationTemplate[] = sources.map(source => ({",
        '  id: source.id,',
        '  kind: "image",',
        "  label: source.label,",
        "  englishLabel: source.englishLabel,",
        "  description: source.description,",
        '  categories: ["intimate"],',
        "  tags: source.tags,",
        "  aspectRatio: source.aspectRatio,",
        "  fields: [],",
        "  defaultValues: {},",
        "  demoPosterUrl: `/assets/xumeng/krea2-actions/${source.id}.webp`,",
        "  pattern: stillPattern(source.frame),",
        '  imageProvider: "unfiltered-pending",',
        "  krea2Lora: {",
        '    repo: "EllaPriest45/Krea2_actions",',
        "    weightFile: source.weightFile,",
        "    strength: source.strength,",
        "    trigger: source.trigger,",
        "    group: source.group,",
        "  },",
        "}));",
        "",
    ]
    CATALOG.write_text("\n".join(lines))


def relabel() -> None:
    items = ensure_tree()
    weights = weight_index(items)
    manifest = json.loads((OUT / "manifest.json").read_text())
    results = []
    missing_weights = 0
    counts: dict[str, int] = {}
    for asset in manifest["assets"]:
        source = asset["source"]
        title = title_of(source)
        fields = catalog_fields(title, source, weights)
        poster = asset["poster"]
        if not fields["weightFile"]:
            missing_weights += 1
            poster_file = OUT / f"{asset['id']}.webp"
            if poster_file.is_file():
                poster_file.unlink()
            print("no lora", asset["id"], flush=True)
            continue
        counts[fields["label"]] = counts.get(fields["label"], 0) + 1
        results.append({
            "id": asset["id"],
            "source": source,
            "width": poster["width"],
            "height": poster["height"],
            "bytes": poster["bytes"],
            "sha256": poster["sha256"],
            "aspectRatio": aspect_ratio(poster["width"], poster["height"]),
            **fields,
        })
    write_outputs(results)
    print("groups", " ".join(f"{label}:{count}" for label, count in counts.items()), flush=True)
    print(f"relabeled {len(results)} missing-weights {missing_weights}", flush=True)


def main() -> None:
    Image.MAX_IMAGE_PIXELS = 80_000_000
    if "--relabel" in sys.argv:
        relabel()
        return
    ensure_tree()
    selected = select_images()
    chinese = sum(1 for item in selected if translate(item["title"]))
    print(f"selected {len(selected)} chinese-labels {chinese}", flush=True)
    if "--plan" in sys.argv:
        return
    OUT.mkdir(parents=True, exist_ok=True)
    done = load_progress()
    selected_ids = {item["id"] for item in selected}
    # Drop posters that disappeared, and anything no longer in the NSFW selection.
    done = {key: value for key, value in done.items() if key in selected_ids and (OUT / f"{key}.webp").is_file()}
    todo = [item for item in selected if item["id"] not in done]
    print(f"resume {len(done)} remaining {len(todo)}", flush=True)
    lock = threading.Lock()
    results = list(done.values())
    failures = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(process, item): item for item in todo}
        finished = 0
        for future in as_completed(futures):
            item = futures[future]
            finished += 1
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001 - keep going through the public set
                failures.append(f"{item['id']}: {error}")
                print(f"fail {item['id']} {error}", flush=True)
                continue
            with lock:
                with PROGRESS.open("a") as handle:
                    handle.write(json.dumps(result, ensure_ascii=False) + "\n")
            results.append(result)
            if finished % 25 == 0 or finished == len(todo):
                print(f"done {finished}/{len(todo)} kept {len(results)}", flush=True)
    if len(results) < 100:
        raise SystemExit(f"too few posters: {len(results)} failures {len(failures)}")
    write_outputs(results)
    print(f"wrote {len(results)} posters, failures {len(failures)}", flush=True)


if __name__ == "__main__":
    main()
