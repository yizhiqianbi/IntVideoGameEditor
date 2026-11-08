#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build original, silent motion illustrations. No model or external media is used.

Requires Pillow and an ffmpeg binary (FFMPEG_BIN or imageio-ffmpeg).
Run from any directory: python3 cloudflare/dzmm-web/scripts/build-action-demos.py
The six MP4s are public examples of template actions, not generated results.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "public/dzmm/action-templates"
EVIDENCE = ROOT / "output/xumeng/action-template-generation-20261010"
WIDTH, HEIGHT, FPS, SECONDS, SCALE = 640, 400, 24, 4, 2
CORAL, TEAL = (246, 124, 131), (73, 198, 181)
SKIN = (247, 208, 180)
INK = (28, 28, 41)
IDS = [
    ("action-high-five", "HIGH FIVE"),
    ("action-handshake", "HANDSHAKE"),
    ("action-hug", "A FRIENDLY HUG"),
    ("action-object-exchange", "PASS AN OBJECT"),
    ("action-side-by-side-walk", "WALK TOGETHER"),
    ("action-paired-dance", "PAIRED DANCE"),
]


def smooth(a, b, value):
    t = max(0.0, min(1.0, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def point(p):
    return tuple(round(v * SCALE) for v in p)


def line(draw, points, color, width):
    draw.line([point(p) for p in points], fill=color, width=round(width * SCALE), joint="curve")
    radius = width / 2
    for x, y in points:
        draw.ellipse(point((x - radius, y - radius)) + point((x + radius, y + radius)), fill=color)


def ellipse(draw, box, fill, outline=None, width=1):
    draw.ellipse(point(box[:2]) + point(box[2:]), fill=fill, outline=outline, width=width * SCALE)


def rounded(draw, box, fill, radius=12):
    draw.rounded_rectangle(point(box[:2]) + point(box[2:]), radius=radius * SCALE, fill=fill)


def actor(x, color, flip=False, lean=0, bob=0, stride=0):
    y = 240 + bob
    facing = -1 if flip else 1
    shoulder = (x + lean * 0.4, y - 30)
    return {
        "x": x, "y": y, "color": color, "flip": flip, "lean": lean,
        "head": (x + lean, y - 79),
        "shoulder": shoulder,
        "outer": [(shoulder[0] - facing * 18, shoulder[1]), (x - facing * 28, y + 5), (x - facing * 22, y + 36)],
        "inner": [(shoulder[0] + facing * 18, shoulder[1]), (x + facing * 28, y + 5), (x + facing * 22, y + 36)],
        "legs": [((x - 10, y + 26), (x - 12 + stride, y + 62), (x - 13 + stride * 1.4, 336)),
                 ((x + 10, y + 26), (x + 12 - stride, y + 62), (x + 13 - stride * 1.4, 336))],
    }


def limb(draw, points, color):
    line(draw, points[:2], color, 12)
    line(draw, points[1:], SKIN, 10)
    ellipse(draw, (points[-1][0] - 5, points[-1][1] - 5, points[-1][0] + 5, points[-1][1] + 5), SKIN)


def body(draw, a):
    x, y, color = a["x"], a["y"], a["color"]
    # Floor shadow, separate legs and shoes make poses readable on a small card.
    ellipse(draw, (x - 37, 331, x + 37, 343), (12, 14, 22))
    for hip, knee, foot in a["legs"]:
        line(draw, [hip, knee, foot], (91, 101, 129), 15)
        rounded(draw, (foot[0] - 11, foot[1] - 6, foot[0] + 16, foot[1] + 5), (216, 220, 231), 4)
    limb(draw, a["outer"], color)
    rounded(draw, (x - 25 + a["lean"] * 0.25, y - 37, x + 25 + a["lean"] * 0.25, y + 30), color, 17)
    line(draw, [(x + a["lean"] * 0.25, y - 25), (x + a["lean"] * 0.25, y + 20)], tuple(round(v * 0.85) for v in color), 2)
    hx, hy = a["head"]
    rounded(draw, (hx - 7, hy + 20, hx + 7, hy + 44), SKIN, 5)
    ellipse(draw, (hx - 23, hy - 22, hx + 23, hy + 26), SKIN)
    # Two original stylized hairstyles, eyes and a quiet smile.
    draw.pieslice(point((hx - 24, hy - 25)) + point((hx + 24, hy + 20)), 180, 350, fill=INK)
    if a["flip"]:
        ellipse(draw, (hx + 10, hy - 24, hx + 31, hy - 3), INK)
    eye_x = hx - 7 if a["flip"] else hx + 7
    ellipse(draw, (eye_x - 1.6, hy + 4, eye_x + 1.6, hy + 8), INK)
    draw.arc(point((hx - 7, hy + 7)) + point((hx + 7, hy + 18)), 20, 160, fill=(161, 91, 85), width=2 * SCALE)


def frame(identifier, title, index, t):
    img = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE))
    draw = ImageDraw.Draw(img)
    for y in range(HEIGHT * SCALE):
        ratio = y / (HEIGHT * SCALE)
        draw.line([(0, y), (WIDTH * SCALE, y)], fill=(round(23 + ratio * 10), round(25 + ratio * 8), round(39 + ratio * 10)))
    # Dark studio alcove and a restrained theatrical floor.
    rounded(draw, (34, 24, 606, 346), (34, 37, 55), 25)
    rounded(draw, (47, 37, 593, 335), (30, 33, 48), 18)
    ellipse(draw, (95, 289, 545, 372), (39, 44, 64))
    for y in (319, 335, 352):
        line(draw, [(78, y), (562, y)], (47, 53, 72), 1)
    for x in (128, 224, 320, 416, 512):
        line(draw, [(320 + (x - 320) * 0.58, 288), (x, 364)], (47, 53, 72), 1)
    font = ImageFont.load_default(size=24 * SCALE)
    small = ImageFont.load_default(size=11 * SCALE)
    draw.text(point((56, 56)), f"0{index + 1}", fill=TEAL, font=small)
    draw.text(point((83, 50)), title, fill=(226, 229, 240), font=font)
    draw.text(point((56, 82)), "ORIGINAL MOTION ILLUSTRATION", fill=(130, 141, 166), font=small)
    left, right = actor(226, CORAL), actor(414, TEAL, True)
    meet = smooth(0.45, 1.7, t) * (1 - smooth(2.8, 3.7, t))
    spark = False
    prop = None
    if identifier == "action-high-five":
        for a, target in [(left, ((279, 163), (318, 132))), (right, ((361, 163), (322, 132)))]:
            a["inner"][1] = lerp(a["inner"][1], target[0], meet)
            a["inner"][2] = lerp(a["inner"][2], target[1], meet)
        spark = 1.8 < t < 2.7
    elif identifier == "action-handshake":
        left, right = actor(240, CORAL), actor(400, TEAL, True)
        shake = math.sin(t * math.pi * 4) * 7 * meet
        for a, elbow, wrist in [(left, (282, 244 + shake), (319, 250 + shake)), (right, (358, 244 + shake), (321, 250 + shake))]:
            a["inner"][1] = lerp(a["inner"][1], elbow, meet)
            a["inner"][2] = lerp(a["inner"][2], wrist, meet)
    elif identifier == "action-hug":
        left = actor(226 + 58 * meet, CORAL, lean=8 * meet)
        right = actor(414 - 58 * meet, TEAL, True, lean=-8 * meet)
        for a, elbow, wrist in [(left, (327, 218), (379, 223)), (right, (313, 238), (261, 232))]:
            a["inner"][1] = lerp(a["inner"][1], elbow, meet)
            a["inner"][2] = lerp(a["inner"][2], wrist, meet)
    elif identifier == "action-object-exchange":
        reach = smooth(0.3, 1.5, t) * (1 - smooth(2.65, 3.65, t))
        transfer = smooth(1.65, 2.45, t)
        for a, elbow, wrist in [(left, (275, 236), (315, 246)), (right, (365, 236), (325, 246))]:
            a["inner"][1] = lerp(a["inner"][1], elbow, reach)
            a["inner"][2] = lerp(a["inner"][2], wrist, reach)
        prop = lerp(left["inner"][2], right["inner"][2], transfer)
    elif identifier == "action-side-by-side-walk":
        travel = smooth(0.35, 3.65, t) * 92
        phase = math.sin(t * math.pi * 3)
        left = actor(192 + travel, CORAL, stride=phase * 17, bob=abs(phase) * -3)
        right = actor(352 + travel, TEAL, stride=phase * 17, bob=abs(phase) * -3)
        for a in (left, right):
            for name, sign in (("inner", 1), ("outer", -1)):
                a[name][1] = (a["x"] + sign * (27 + phase * 13), a["y"] + 7)
                a[name][2] = (a["x"] + sign * (22 + phase * 20), a["y"] + 32)
        line(draw, [(489, 274), (525, 274), (518, 267)], (93, 125, 143), 3)
        line(draw, [(525, 274), (518, 281)], (93, 125, 143), 3)
    elif identifier == "action-paired-dance":
        wave = math.sin((t - 0.4) * math.pi * 1.5) * smooth(0.1, 0.55, t)
        left = actor(246 + wave * 12, CORAL, lean=wave * 8, bob=-abs(wave) * 5, stride=wave * 11)
        right = actor(394 + wave * 12, TEAL, True, lean=wave * 8, bob=-abs(wave) * 5, stride=-wave * 11)
        for a, side in ((left, -1), (right, 1)):
            a["inner"][1] = (a["x"] - side * 43, 225 + wave * 6)
            a["inner"][2] = (320 + wave * 12, 225 + wave * 6)
            a["outer"][1] = (a["x"] + side * 43, 183 - wave * 9)
            a["outer"][2] = (a["x"] + side * 57, 159 - wave * 17)
    body(draw, left)
    body(draw, right)
    limb(draw, left["inner"], CORAL)
    limb(draw, right["inner"], TEAL)
    if prop:
        px, py = prop
        rounded(draw, (px - 12, py - 18, px + 12, py + 3), (235, 193, 114), 4)
        line(draw, [(px, py - 17), (px, py + 2)], (183, 139, 76), 2)
    if spark:
        for angle in (-120, -60, 0, 60, 120, 180):
            rad = math.radians(angle)
            line(draw, [(320 + math.cos(rad) * 17, 131 + math.sin(rad) * 17), (320 + math.cos(rad) * 25, 131 + math.sin(rad) * 25)], (240, 206, 139), 2)
    rounded(draw, (48, 377, 592, 381), (58, 63, 82), 2)
    rounded(draw, (48, 377, 48 + 544 * max(0.01, t / SECONDS), 381), TEAL, 2)
    return img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ffmpeg = os.environ.get("FFMPEG_BIN")
    if not ffmpeg:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    OUT.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    samples = []
    assets = []
    for index, (identifier, title) in enumerate(IDS):
        video, poster = OUT / f"{identifier}.mp4", OUT / f"{identifier}.png"
        command = [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", str(FPS), "-i", "pipe:0", "-an", "-c:v", "libx264", "-threads", "1", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", str(video)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE)
        try:
            for number in range(FPS * SECONDS):
                process.stdin.write(frame(identifier, title, index, number / FPS).tobytes())
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError(f"ffmpeg failed: {identifier}")
        except BaseException:
            process.kill()
            process.wait()
            raise
        frame(identifier, title, index, 2.15).save(poster, optimize=True)
        samples.append([frame(identifier, title, index, t) for t in (0.3, 2.15, 3.65)])
        assets.append({
            "id": identifier, "provenance": "original-procedural-animation",
            "video": {"path": f"/dzmm/action-templates/{video.name}", "sha256": digest(video), "bytes": video.stat().st_size, "mimeType": "video/mp4", "codec": "h264", "pixelFormat": "yuv420p", "fps": FPS, "durationSeconds": SECONDS, "width": WIDTH, "height": HEIGHT, "audio": False},
            "poster": {"path": f"/dzmm/action-templates/{poster.name}", "sha256": digest(poster), "bytes": poster.stat().st_size, "mimeType": "image/png", "width": WIDTH, "height": HEIGHT},
        })
    manifest = {
        "schemaVersion": 1,
        "provenance": {"kind": "original-procedural-animation", "modelOutput": False, "thirdPartyAssets": False, "description": "Original silent motion illustrations drawn with Pillow; not model-generated demonstrations or evidence of output quality."},
        "source": {"path": "cloudflare/dzmm-web/scripts/build-action-demos.py", "sha256": digest(Path(__file__))},
        "canvas": {"width": WIDTH, "height": HEIGHT},
        "assets": assets,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sheet = Image.new("RGB", (960, 6 * 216), (23, 25, 39))
    for row, frames in enumerate(samples):
        for column, im in enumerate(frames):
            sheet.paste(im.resize((312, 195), Image.Resampling.LANCZOS), (column * 320 + 4, row * 216 + 7))
    sheet.save(EVIDENCE / "action-demo-contact-sheet.png", optimize=True)
    print(json.dumps({"assets": len(assets), "videoBytes": sum(a["video"]["bytes"] for a in assets), "posterBytes": sum(a["poster"]["bytes"] for a in assets), "contactSheet": str(EVIDENCE / "action-demo-contact-sheet.png")}))


if __name__ == "__main__":
    main()
