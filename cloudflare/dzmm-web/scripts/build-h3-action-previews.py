#!/usr/bin/env python3
"""Download selected MiniMax H3 demo videos and write short muted previews.

Source: https://huggingface.co/EllaPriest45/MinimaxH3_Actions
Weights stay on the Hub. This script only keeps a 4-second preview and a poster.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TREE = Path("/tmp/h3-actions/tree.json")
OUT = ROOT / "public/dzmm/h3-actions"
CACHE = Path("/tmp/h3-preview-src")
REPO = "EllaPriest45/MinimaxH3_Actions"
SELECTION = [
    ("h3-blowjob", "Blowjob (NSFW) - MinimaxH3 - blowjob,sucking penis"),
    ("h3-deepthroat", "Deeper... Hold It. - MinimaxH3 - oralmove1,oraldetail1,0.8str"),
    ("h3-handjob", "Handjob - MinimaxH3"),
    ("h3-titfuck", "Better Titfuck v0.95 - MinimaxH3 - res_multistep+simple,titjob,titfuck"),
    ("h3-cowgirl", "Cowgirl Position (NSFW) REF2V R512 - MinimaxH3 - cowgirl position"),
    ("h3-doggy", "POV Doggy - MinimaxH3 - POV doggystyle sex"),
    ("h3-missionary", "Missionary Sex - POV - MinimaxH3 - having missionary sex"),
    ("h3-spooning", "Spooning Sex Position FL2VA - MinimaxH3 - SPOONLG.,add hmpenis 0.6str,motion booster 0.3-0.4str,10+seconds"),
    ("h3-fingering", "Perfect Fingering - MinimaxH3 - sensual_fingering,fingering her vagina with her two middle fingers, her fingers are sliding in and out of her vagina"),
    ("h3-dildo", "Dildoing - MinimaxH3 - pumping a dildo insider her vagina"),
    ("h3-masturbation", "Hand in Panties Masturbation  - MinimaxH3 - 0.7str,She has her hand in her panties,She slides her hand in her panties.She rubs her vagina"),
    ("h3-footjob", "H3 Footjob v0 - MinimaxH3 - a photoealistic video depicting a woman sitting in front of the viewer.the camera angle is a male pov.the viewer's penis is exposed.the woman is performing a footjob.h3fj"),
    ("h3-ahegao", "Ahegao Face - MinimaxH3 - She is making the ahegao face - eyes rolled back and tongue hanging out"),
    ("h3-breast-bounce", "Bouncing Boobs REF2V v0.7 - MinimaxH3 - her breast is bouncing up and down,her breast is bouncing from left to right"),
    ("h3-twerk", "Slop Twerk v0.2 Epoch6 - MinimaxH3 - twerks causing her ass to jiggle and shake,0.5-1str,0.5 STR if you don't want Asians in T2V"),
    ("h3-cumshot", "Epic Cumshots vAlpha I2V-R2V - MinimaxH3 - CUMSH0T"),
    ("h3-facial", "Facial CumShot REF2VA - MinimaxH3 - cmst,0.75-0.85str"),
    ("h3-spank", "SpankMe - MiniMaxH3 - spa_nk"),
    ("h3-bound", "All Tied Up - MinimaxH3 - 0.8str"),
    ("h3-bikini", "Micro Bikini v5.0 - MinimaxH3 - bikini,0.9str"),
    ("h3-blowjob-v3", "Blowjob v3.0 - MinimaxH3 - bl0w_j0b"),
    ("h3-blowjob-thong", "Blowjob wearing Thong - MinimaxH3 - blowjob_wearing_thong"),
    ("h3-softsuck", "Softsuck Blowjob - MinimaxH3 - She takes the glans into her mouth and begins soft,rhythmic suction,her head moving in small controlled forward-and-back motions,0.7-0.8str"),
    ("h3-closeup-blowjob", "Extreme Close-up Blowjob Top Down POV - MinimaxH3 - 0.8str,female giving a handjob to a man, the camera zooms in on the penis in her mouth"),
    ("h3-messy-blowjob", "Messy Blowjob - MinimaxH3 - ME$$Y,have penis in startup image or penis reference"),
    ("h3-oral-creampie", "CIMLG - The Oral Creampie v2.0 - MinimaxH3 - CUMOUF,0.4str,use eros max beta6,10seconds videos"),
    ("h3-cum-swallow", "Cum Swallow - MinimaxH3 - TADAA,0.4str"),
    ("h3-cunnilingus", "Cunnilingus v2.0 - MinimaxH3 - She performs cunnilingus on her.She licks her pussy"),
    ("h3-lesbian-oral", "Lesbian Cunnilingus v3.0 - MinimaxH3"),
    ("h3-auto-oral", "Auto-Cunnilingus - MinimaxH3 - She performs oral sex on herself.She licks her vulva"),
    ("h3-lick-penis", "Licking Penis and Testicles (NSFW) v1.2 - MinimaxH3 - licking penis,licking testicles,licking penis tip,Only works if penis and testicles are in view"),
    ("h3-deepthroat-side", "Daring's Deepthroat FL2VA v0.2 - MinimaxH3 - can do 15 seconds"),
    ("h3-throat", "Throat Time v2.0 - MinimaxH3 - thr0at,6-8steps for turbo,20steps for normal"),
    ("h3-sixtynine", "Ultimate DeepThroat + Frenulum 69 v1.1 - MinimaxH3"),
    ("h3-handjob-duo", "2 Girls 2-Handed Twisting Handjob Frontal - MinimaxH3 - 1str"),
    ("h3-jerk", "Jerking Off - MinimaxH3 - he-she is jerking off"),
    ("h3-paizuri", "Paizuri - Titfuck (With Thrusting + Squeeze) FL2VA - MinimaxH3 - she gathers her breasts around the penis"),
    ("h3-titfuck-side", "Titfuck Sideview I2V on FL2VA - MinimaxH3 - titfuck_sideview,cut,transition,add penis lora low str"),
    ("h3-nipple-play", "Nipple Play v2.0 - MinimaxH3 - fingertip teasing,flicking on the nipple,sucking nipples"),
    ("h3-nipple-suck", "Nipple Sucking - MinimaxH3 - He-she sucks her nipple"),
    ("h3-cowgirl-behind", "Cowgirl - Behind - MinimaxH3 - rear view cowgirl sex,riding a man, straddling him"),
    ("h3-cowgirl-side", "Side Riding Cowgirl v2.0 - MiniMaxH3 - riding a man,straddling his hips,side view cowgirl sex,facing the man"),
    ("h3-riding-pov", "Riding pov I2V - MinimaxH3 - front-back view,female,futa,0.6-1str"),
    ("h3-doggy-leg", "Doggy Style - Leg Up - MinimaxH3 - doggystyle leg up sex"),
    ("h3-doggy-side", "Doggystyle Sex Side-Rear View - MinimaxH3 - 0.5-0.7 t2va-ref2va,0.8-1str fl2va"),
    ("h3-prone", "Prone Bone - MinimaxH3"),
    ("h3-lotus", "Lotus Sex Position - MinimaxH3 - They are having sex in the lotus position"),
    ("h3-side-fuck", "Side Fuck R2V - MinimaxH3 - 0.75-0.85str"),
    ("h3-grind", "Grindtime - MinimaxH3 - grindtime,a woman performing continuous rhythmic gyrating hip motion while having sex,front-rear-side view"),
    ("h3-pillow", "Pillow Humping v3.1 (hip thrusting, humping, grinding enhancer) - MinimaxH3 - She is straddling a pillow. She is humping the pillow"),
    ("h3-facesit", "Sit on my face - MinimaxH3REF2V - facesitting on the viewer,looking upward,above the viewer,She is thrusting her hips back and forth,The camera is placed between her legs,very wide angle with a fisheye"),
    ("h3-scissor", "Scissoring - Tribbing v2.0 - MinimaxH3 - They are scissoring,Their legs are intertwined,can use pillow humping lora at low str"),
    ("h3-fingering-v4", "Fingering v4.0 - MinimaxH3 - She slides two fingers into her vagina. She moves her fingers in and out of her vagina"),
    ("h3-anal-finger", "Self Anal Finger - MinimaxH3"),
    ("h3-rimjob", "Rimjob_ass licking_anal - MinimaxH3 - rjvideo,POV,side view,side-rear view,lying on the back,0.75-1str"),
    ("h3-dildo-ride", "Dildo Ride - MinimaxH3 - She rides a dildo, moving her body up and down as the dildo slides in and out of her vagina.viewed from the front,viewed from behind,viewed from a high angle,viewed from a low angle"),
    ("h3-dildo-solo", "Dildo Masturbation v2.0 - MinimaxH3 - She slide a dildo in and out of her pussy"),
    ("h3-wand", "Hitachi Magic Wand Vibrator - MinimaxH3 - using a Hitachi Magic Wand vibrator"),
    ("h3-sybian", "Simply Sybian - Bouncing Edition - MinimaxH3 - riding a Sybian"),
    ("h3-squirt", "Vibrator & Squirting - MinimaxH3 - 0.7-0.8str,720x1280,15-30steps"),
    ("h3-strapon", "Strapon Dildo v0.1 - MinimaxH3 - She is wearing a strapon dildo"),
    ("h3-cum-shots", "Cum Shots - MinimaxH3 - He ejaculates,Spurts of semen land on her BODY PART"),
    ("h3-ahegao-v3", "Ahegao Face v3.0 - MinimaxH3 - he crosses her eyes,opens her mouth,and sticks out her tongue,making the ahegao face.A single drop of clear saliva drips from her tongue"),
    ("h3-kiss", "Passionate Kissing - MinimaxH3 - They kiss passionately,1str"),
    ("h3-breast-play", "Breast Play & Jiggle v2.0 FL2V+REF - MinimaxH3 - turbo8steps,res_2s+beta57,causing her breasts to jiggle side to side,bounce up and down,woman slaps her breasts,grabs,squeezes her breasts together with her hands,0.7-0"),
    ("h3-ass-jiggle", "Ass jiggle (I2V) - FL2VA & I2V - MinimaxH3 - 0.8-1str"),
    ("h3-twerk-pro", "Icy Twerk Pro MAX v2.0 - MinimaxH3 - icytwerk"),
    ("h3-bend", "Bend Over & Spread v8400s - MinimaxH3"),
    ("h3-tied-sit", "Tied Sitting - MinimaxH3 - 0.9str,in a tied sitting pose"),
    ("h3-spreadeagle", "Tied Spreadeagle - MiniMaxH3 - tied supine spread-eagle pose"),
    ("h3-lingerie-blue", "Bluebella Nova Lingerie - MinimaxH3 - She is wearing COLOR Bluebella Nova Lingerie"),
    ("h3-latex", "Latex clothes - MinimaxH3 - Latex"),
    ("h3-thong", "Thong Panties - MinimaxH3 - She is wearing thong panties"),
    ("h3-micro-bikini", "Microbikini and Sling Bikini - MinimaxH3 - She is wearing a microbikini-sling bikini"),
    ("h3-massage", "Sexy Massage - MinimaxH3 - getting a sexy massage,0.9str"),
    ("h3-hip-dance", "Hip Sway Dance - MinimaxH3 - dancing with arms in front"),
    ("h3-spread", "Pussy spread v0.2 - MinimaxH3 - spread,her hands have the vulva held open and centered,her vulva becomes exposed between the opened legs"),
    ("h3-pegging", "Pegging T2V-I2V - MinimaxH3 - 0.5-0.8str"),
    ("h3-double", "Doublefuck T2V-I2V - MinimaxH3 - doublefuck"),
    ("h3-final-thrust", "Climax Final Thrust - MinimaxH3 - This video depicts part of sexual intercourse climax, the male character performs powerful, intense thrusts with his penis inside female and cums inside of her"),
    ("h3-pussyjob", "PJSLIDE - Pussyjob - MinimaxH3 - 0.5str,PJSLIDE,add HMPenis lora at 0.5str"),
    ("h3-orgasm", "Female Masturbation-Orgasmic Contractions v1.4 - MinimaxH3"),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(stem: str, destination: Path) -> None:
    name = f"{stem}.mp4"
    url = f"https://huggingface.co/{REPO}/resolve/main/{urllib.parse.quote(name)}"
    request = urllib.request.Request(url, headers={"User-Agent": "xumeng-h3-preview"})
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def run(command: list[str]) -> str:
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return f"{completed.stdout}\n{completed.stderr}"


def inspect(path: Path) -> tuple[int, int, float]:
    text = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    size = re.search(r"Video: .*?(\d{2,4})x(\d{2,4})", text)
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not size or not duration:
        raise RuntimeError(f"无法读取预览参数：{path}")
    width, height = int(size.group(1)), int(size.group(2))
    seconds = int(duration.group(1)) * 3600 + int(duration.group(2)) * 60 + float(duration.group(3))
    return width, height, round(seconds, 3)


def transcode(source: Path, video: Path, poster: Path) -> None:
    from PIL import Image
    for crf, fps in (("30", "12"), ("34", "8"), ("36", "8")):
        run([
            "ffmpeg", "-y", "-i", str(source), "-an", "-t", "4",
            "-vf", f"scale=480:-2,fps={fps}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-crf", crf, "-movflags", "+faststart", str(video),
        ])
        if video.stat().st_size <= 1_500_000:
            break
    else:
        raise RuntimeError(f"预览仍然过大：{video}")
    frame = poster.with_suffix(".png")
    run(["ffmpeg", "-y", "-i", str(video), "-frames:v", "1", str(frame)])
    image = Image.open(frame).convert("RGB")
    image.save(poster, "WEBP", quality=68, method=4)
    if poster.stat().st_size > 400_000:
        image.thumbnail((320, 320))
        image.save(poster, "WEBP", quality=50, method=4)
    frame.unlink()
    if poster.stat().st_size > 400_000:
        raise RuntimeError(f"海报仍然过大：{poster}")


def ready(video: Path, poster: Path) -> bool:
    if not video.is_file() or not poster.is_file():
        return False
    if video.stat().st_size < 32 or poster.stat().st_size < 32:
        return False
    return video.read_bytes()[4:8] == b"ftyp" and poster.read_bytes()[:4] == b"RIFF"


def main() -> None:
    if shutil.which("ffmpeg") is None:
        raise SystemExit("需要 ffmpeg")
    if not TREE.is_file():
        TREE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(
            f"https://huggingface.co/api/models/{REPO}",
            headers={"User-Agent": "xumeng-h3-preview"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
        TREE.write_text(json.dumps([{"path": item["rfilename"]} for item in payload.get("siblings") or []]))
    known = {item["path"] for item in json.loads(TREE.read_text())}
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    assets = []
    for identifier, stem in SELECTION:
        if f"{stem}.mp4" not in known or f"{stem}.safetensors" not in known:
            print(f"skip missing {identifier}", flush=True)
            continue
        source = CACHE / f"{identifier}.mp4"
        video = OUT / f"{identifier}.mp4"
        poster = OUT / f"{identifier}.webp"
        if ready(video, poster):
            print(f"keep {identifier}", flush=True)
        else:
            print(f"download {identifier}", flush=True)
            try:
                download(stem, source)
                transcode(source, video, poster)
            except Exception as error:
                print(f"fail {identifier}: {error}", flush=True)
                continue
            finally:
                if source.exists():
                    source.unlink()
        width, height, seconds = inspect(video)
        assets.append({
            "id": identifier,
            "sourceFile": f"{stem}.mp4",
            "video": {
                "path": f"/dzmm/h3-actions/{identifier}.mp4",
                "sha256": digest(video),
                "bytes": video.stat().st_size,
                "mimeType": "video/mp4",
                "width": width,
                "height": height,
                "durationSeconds": seconds,
                "audio": False,
            },
            "poster": {
                "path": f"/dzmm/h3-actions/{identifier}.webp",
                "sha256": digest(poster),
                "bytes": poster.stat().st_size,
                "mimeType": "image/webp",
                "width": width,
                "height": height,
            },
        })
        print(f"  {video.stat().st_size} {poster.stat().st_size} {width}x{height} {seconds}s", flush=True)
    manifest = {
        "schemaVersion": 1,
        "provenance": {
            "kind": "third-party-minimax-h3-demo",
            "repo": REPO,
            "revision": "main",
            "modelOutput": False,
            "thirdPartyAssets": True,
            "weightsBundled": False,
            "note": "Four-second muted previews transcoded from published demo videos. LoRA weights are not included.",
        },
        "assets": assets,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(assets)} previews")


if __name__ == "__main__":
    main()
