#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "placeholder-videos"
TMP_DIR = ROOT / ".tmp-video-gen"
WIDTH = 1280
HEIGHT = 720
FPS = 24
DURATION_SECONDS = 5


@dataclass(frozen=True)
class PlaceholderSpec:
    filename: str
    title: str
    subtitle: str
    accent_bgr: tuple[int, int, int]
    background_top_bgr: tuple[int, int, int]
    background_bottom_bgr: tuple[int, int, int]


SPECS = [
    PlaceholderSpec(
        filename="scene_intro.mp4",
        title="INTRO SCENE",
        subtitle="Opening shot placeholder",
        accent_bgr=(102, 164, 255),
        background_top_bgr=(58, 38, 22),
        background_bottom_bgr=(20, 14, 10),
    ),
    PlaceholderSpec(
        filename="scene_dialog.mp4",
        title="DIALOG SCENE",
        subtitle="Conversation branch placeholder",
        accent_bgr=(120, 224, 160),
        background_top_bgr=(34, 49, 40),
        background_bottom_bgr=(14, 18, 16),
    ),
    PlaceholderSpec(
        filename="scene_choice.mp4",
        title="CHOICE SCENE",
        subtitle="Decision point placeholder",
        accent_bgr=(255, 196, 82),
        background_top_bgr=(48, 42, 18),
        background_bottom_bgr=(19, 17, 8),
    ),
    PlaceholderSpec(
        filename="scene_tension.mp4",
        title="TENSION SCENE",
        subtitle="Conflict beat placeholder",
        accent_bgr=(104, 122, 255),
        background_top_bgr=(40, 30, 56),
        background_bottom_bgr=(15, 12, 22),
    ),
    PlaceholderSpec(
        filename="scene_ending.mp4",
        title="ENDING SCENE",
        subtitle="Ending or result placeholder",
        accent_bgr=(122, 228, 236),
        background_top_bgr=(24, 56, 60),
        background_bottom_bgr=(8, 22, 24),
    ),
]


def ensure_clean_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def make_gradient_frame(
    top_color: tuple[int, int, int],
    bottom_color: tuple[int, int, int],
) -> np.ndarray:
    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)

    for row in range(HEIGHT):
        mix = row / max(HEIGHT - 1, 1)
        color = [
            int(top_color[channel] * (1 - mix) + bottom_color[channel] * mix)
            for channel in range(3)
        ]
        frame[row, :, :] = color

    return frame


def draw_spec_frame(spec: PlaceholderSpec, frame_index: int) -> np.ndarray:
    frame = make_gradient_frame(spec.background_top_bgr, spec.background_bottom_bgr)
    progress = frame_index / max(FPS * DURATION_SECONDS - 1, 1)

    glow_center_x = int(180 + progress * 920)
    glow_center_y = int(190 + np.sin(progress * np.pi * 2) * 35)
    cv2.circle(frame, (glow_center_x, glow_center_y), 170, spec.accent_bgr, -1)
    frame = cv2.addWeighted(frame, 0.82, make_gradient_frame((0, 0, 0), (0, 0, 0)), 0.0, 0)

    overlay = frame.copy()
    cv2.rectangle(overlay, (88, 84), (1192, 636), (255, 255, 255), -1)
    cv2.addWeighted(overlay, 0.06, frame, 0.94, 0, frame)
    cv2.rectangle(frame, (88, 84), (1192, 636), (255, 255, 255), 2)

    cv2.putText(
        frame,
        spec.title,
        (132, 218),
        cv2.FONT_HERSHEY_SIMPLEX,
        2.0,
        (245, 245, 245),
        4,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        spec.subtitle,
        (136, 282),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.95,
        (220, 220, 220),
        2,
        cv2.LINE_AA,
    )

    cv2.putText(
        frame,
        "Interactive Film Placeholder",
        (136, 122),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        spec.accent_bgr,
        2,
        cv2.LINE_AA,
    )

    bar_left = 136
    bar_top = 510
    bar_width = 1008
    bar_height = 34
    cv2.rectangle(
        frame,
        (bar_left, bar_top),
        (bar_left + bar_width, bar_top + bar_height),
        (255, 255, 255),
        2,
    )
    fill_width = max(10, int(bar_width * progress))
    cv2.rectangle(
        frame,
        (bar_left + 4, bar_top + 4),
        (bar_left + fill_width, bar_top + bar_height - 4),
        spec.accent_bgr,
        -1,
    )

    pulse_width = 180
    pulse_x = int(bar_left + progress * (bar_width - pulse_width))
    pulse_overlay = frame.copy()
    cv2.rectangle(
        pulse_overlay,
        (pulse_x, 348),
        (pulse_x + pulse_width, 462),
        (255, 255, 255),
        -1,
    )
    cv2.addWeighted(pulse_overlay, 0.08, frame, 0.92, 0, frame)

    cv2.putText(
        frame,
        f"scene_progress = {progress:0.2f}",
        (136, 594),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.85,
        (230, 230, 230),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        "Use as temporary video material for node preview.",
        (136, 632),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        (180, 180, 180),
        2,
        cv2.LINE_AA,
    )

    return frame


def render_source_video(spec: PlaceholderSpec) -> Path:
    ensure_clean_dir(TMP_DIR)
    source_path = TMP_DIR / f"{Path(spec.filename).stem}_source.mp4"
    writer = cv2.VideoWriter(
        str(source_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        FPS,
        (WIDTH, HEIGHT),
    )

    if not writer.isOpened():
        raise RuntimeError(f"Failed to open video writer for {source_path}")

    for frame_index in range(FPS * DURATION_SECONDS):
        writer.write(draw_spec_frame(spec, frame_index))

    writer.release()
    return source_path


def convert_to_h264(source_path: Path, output_path: Path) -> None:
    command = [
        "avconvert",
        "--source",
        str(source_path),
        "--output",
        str(output_path),
        "--preset",
        "Preset1280x720",
        "--replace",
    ]
    subprocess.run(command, check=True)


def main() -> None:
    ensure_clean_dir(OUTPUT_DIR)

    for spec in SPECS:
        source_path = render_source_video(spec)
        output_path = OUTPUT_DIR / spec.filename
        convert_to_h264(source_path, output_path)
        print(output_path)

    shutil.rmtree(TMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
