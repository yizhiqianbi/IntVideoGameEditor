"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./trim-preview.module.css";
import type { TrimRange } from "./project";

type TrimPreviewProps = {
  src?: string;
  poster?: string;
  trim: TrimRange;
  onTrimChange: (trim: TrimRange) => void;
};

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function TrimPreview({
  src,
  poster,
  trim,
  onTrimChange,
}: TrimPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !src) {
      return;
    }

    const endMs = trim.endMs ?? durationMs;

    function handleTimeUpdate() {
      const activeVideo = videoRef.current;

      if (!activeVideo) {
        return;
      }

      if (!endMs || endMs <= trim.startMs) {
        return;
      }

      if (activeVideo.currentTime * 1000 >= endMs) {
        activeVideo.currentTime = trim.startMs / 1000;
        void activeVideo.play().catch(() => undefined);
      }
    }

    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [durationMs, src, trim.endMs, trim.startMs]);

  if (!src) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>暂无可裁剪的视频</p>
        <p className={styles.emptyBody}>
          绑定本地视频或等待生成任务完成后，这里会出现裁剪预览。
        </p>
      </div>
    );
  }

  const resolvedEndMs =
    trim.endMs && trim.endMs > trim.startMs ? trim.endMs : durationMs;
  const sliderMax = Math.max(durationMs, 1000);

  return (
    <div className={styles.wrap}>
      <div className={styles.playerShell}>
        <video
          ref={videoRef}
          key={src}
          className={styles.video}
          src={src}
          poster={poster}
          controls
          muted
          playsInline
          onLoadedMetadata={(event) => {
            const nextDurationMs = Math.max(
              1000,
              Math.floor(event.currentTarget.duration * 1000),
            );
            setDurationMs(nextDurationMs);

            onTrimChange({
              startMs: Math.min(trim.startMs, nextDurationMs - 200),
              endMs:
                trim.endMs && trim.endMs <= nextDurationMs
                  ? trim.endMs
                  : nextDurationMs,
            });
          }}
        />
      </div>

      <div className={styles.timeline}>
        <div className={styles.rangeHead}>
          <span>入点</span>
          <strong>{formatTime(trim.startMs)}</strong>
        </div>
        <input
          className={styles.range}
          type="range"
          min={0}
          max={sliderMax}
          step={100}
          value={Math.min(trim.startMs, Math.max(0, sliderMax - 200))}
          onChange={(event) => {
            const nextStartMs = Math.min(
              Number(event.target.value),
              Math.max(0, (resolvedEndMs || sliderMax) - 200),
            );

            onTrimChange({
              startMs: nextStartMs,
              endMs: resolvedEndMs || sliderMax,
            });
          }}
        />
      </div>

      <div className={styles.timeline}>
        <div className={styles.rangeHead}>
          <span>出点</span>
          <strong>{formatTime(resolvedEndMs || sliderMax)}</strong>
        </div>
        <input
          className={styles.range}
          type="range"
          min={0}
          max={sliderMax}
          step={100}
          value={Math.max(resolvedEndMs || sliderMax, trim.startMs + 200)}
          onChange={(event) => {
            const nextEndMs = Math.max(
              Number(event.target.value),
              trim.startMs + 200,
            );

            onTrimChange({
              startMs: trim.startMs,
              endMs: nextEndMs,
            });
          }}
        />
      </div>

      <div className={styles.meta}>
        <span>片段长度</span>
        <strong>
          {formatTime(
            Math.max((resolvedEndMs || sliderMax) - trim.startMs, 0),
          )}
        </strong>
      </div>
    </div>
  );
}
