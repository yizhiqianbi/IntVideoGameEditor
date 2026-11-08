#!/usr/bin/env python3
"""Build crawler-facing character covers and the share index.

X does not run JavaScript and does not read a URL hash. Each listed character
gets a real 1200×630 JPEG and a title/description the worker can print into
the first HTML response.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
WEB = Path(__file__).resolve().parents[1]
EXPORTED = ROOT / "src/lib/xumeng-exported-cards-2026-10-21.json"
USER_PROVIDED = ROOT / "src/lib/xumeng-user-provided-cards-2026-10-24.json"
RETIRED = ROOT / "src/lib/xumeng-retired-cards.json"
COVERS = ROOT / "public/dzmm/exported-cards"
INDEX = WEB / "src/character-share-index.ts"
SHARE_DIR = WEB / "dist/assets/xumeng/share"
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,119}$")
TAG = re.compile(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>|<[^>]+>", re.I)
SUFFIX = " - AI角色聊天"


def story_text(text: str) -> str:
    flat = re.sub(r"\s+", " ", text).strip()
    parts = [part.strip() for part in re.split(r"(?<=[。！？])\s*", flat) if part.strip()]
    kept = [part for part in parts if not re.match(r"^(?:第一次|v\d|\d+[、.．]|完成了|注意积分|修复了|修改了|顺带)", part)]
    long = next((index for index, part in enumerate(kept) if len(part) >= 24), 0)
    return "".join(kept[long:]) or flat


def blurb(raw: str) -> str:
    text = TAG.sub(" ", raw).replace("&nbsp;", " ")
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    labeled = re.search(r"简介[:：]\s*([^\n]{8,220})", text)
    bracket = re.search(r"【简介】\s*([\s\S]{8,500}?)(?=\n\s*\n|【|$)", text)
    chosen = labeled.group(1) if labeled else bracket.group(1) if bracket else story_text(text)
    chosen = re.sub(r"\s+", " ", chosen).strip()
    chosen = re.sub(r"^【[^】]{0,40}】\s*", "", chosen)
    if not chosen:
        return "在叙梦里和这个角色聊天。"
    chars = list(chosen)
    if len(chars) <= 150:
        return chosen
    cut = "".join(chars[:150])
    for mark in ("。", "！", "？"):
        index = cut.rfind(mark)
        if index >= 40:
            return cut[: index + 1]
    return "".join(chars[:149]).rstrip("，、；： ") + "…"


def title_for(name: str) -> str:
    name = re.sub(r"\s+", " ", name).strip() or "叙梦角色"
    if name.endswith(SUFFIX):
        return "".join(list(name)[:70])
    room = 70 - len(SUFFIX)
    chars = list(name)
    if len(chars) > room:
        name = "".join(chars[: room - 1]).rstrip() + "…"
    return name + SUFFIX


def crop(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    width, height = image.size
    if width < 2 or height < 2:
        raise ValueError("cover is too small")
    target = 1200 / 630
    if width / height > target:
        kept = int(round(height * target))
        left = max(0, (width - kept) // 2)
        image = image.crop((left, 0, left + kept, height))
    else:
        kept = int(round(width / target))
        extra = max(0, height - kept)
        top = min(extra, int(round(extra * 0.15)))
        image = image.crop((0, top, width, top + kept))
    framed = image.resize((1200, 630), Image.Resampling.LANCZOS)
    framed.load()
    return framed


def save_jpeg(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=82, optimize=True, progressive=True)
    with Image.open(destination) as check:
        if check.size != (1200, 630) or check.format != "JPEG":
            raise RuntimeError(f"{destination.name} is not a 1200×630 JPEG")


def main() -> int:
    exported = json.loads(EXPORTED.read_text())
    user_provided = json.loads(USER_PROVIDED.read_text())
    retired = set(json.loads(RETIRED.read_text())["ids"])
    cards: list[dict[str, str]] = []

    for card in exported:
        character_id = str(card["id"])
        if character_id in retired:
            continue
        slug = str(card["slug"])
        if not ID.fullmatch(character_id):
            raise SystemExit(f"exported id is not a share path: {character_id}")
        source = COVERS / f"foreverse-{slug}-cover.png"
        if not source.is_file():
            raise SystemExit(f"missing cover: {source}")
        with Image.open(source) as image:
            framed = crop(image)
        save_jpeg(framed, SHARE_DIR / f"{character_id}.jpg")
        data = card["card"]["data"]
        cards.append({
            "id": character_id,
            "title": title_for(str(data["name"])),
            "description": blurb(str(data.get("description") or "")),
        })

    for card in user_provided:
        character_id = str(card["id"])
        if character_id in retired:
            continue
        slug = str(card["slug"])
        if not ID.fullmatch(character_id) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", slug):
            raise SystemExit("user-provided id is not a share path")
        source = ROOT / "public/dzmm/user-cards/20261024" / f"{slug}.png"
        if not source.is_file() or source.is_symlink():
            raise SystemExit("missing user-provided cover")
        with Image.open(source) as image:
            framed = crop(image)
        save_jpeg(framed, SHARE_DIR / f"{character_id}.jpg")
        raw = card["card"]
        data = raw["data"] if raw.get("spec") == "chara_card_v2" else raw
        cards.append({
            "id": character_id,
            "title": title_for(str(data["name"])),
            "description": blurb(str(data.get("description") or "")),
        })

    listed_ids = [str(card["id"]) for card in exported] + [str(card["id"]) for card in user_provided]
    expected = 18 + len(user_provided) - len(retired.intersection(listed_ids))
    if len(cards) != expected or len({card["id"] for card in cards}) != expected:
        raise SystemExit(f"expected {expected} unique listed characters, built {len(cards)}")
    body = ",\n".join(
        "  " + json.dumps(card, ensure_ascii=False, separators=(", ", ": "))
        for card in cards
    )
    INDEX.write_text(
        "/** Generated by scripts/build-character-share.py. Do not edit by hand. */\n"
        "export type CharacterShareRecord = { id: string; title: string; description: string };\n"
        f"export const CHARACTER_SHARE_INDEX: readonly CharacterShareRecord[] = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"character share: {len(cards)} cards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
