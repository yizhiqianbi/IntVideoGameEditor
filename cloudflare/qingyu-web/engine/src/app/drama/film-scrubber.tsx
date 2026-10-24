"use client";

import { useRef, useState, type PointerEvent } from "react";
import styles from "./studio.module.css";

export function formatClock(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function FilmScrubber({
  min,
  max,
  value,
  disabled,
  marks = [],
  ariaLabel,
  onChange,
  onScrub,
}: {
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  marks?: number[];
  ariaLabel: string;
  onChange: (value: number) => void;
  onScrub?: (value: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  const ceiling = Math.max(1, max);
  const percent = Math.min(1, Math.max(0, shown / ceiling));

  function valueFromClientX(clientX: number) {
    const node = track.current;
    if (!node) return shown;
    const rect = node.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(Math.min(max, Math.max(min, t * ceiling)));
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    dragging.current = true;
    const first = valueFromClientX(event.clientX);
    setLive(first);
    onScrub?.(first);
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault();
      const nextValue = valueFromClientX(next.clientX);
      setLive(nextValue);
      onScrub?.(nextValue);
    };
    const up = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragging.current = false;
      const nextValue = valueFromClientX(next.clientX);
      setLive(null);
      onChange(nextValue);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div
      className={styles.scrubber}
      data-disabled={disabled || undefined}
      data-dragging={live !== null || undefined}
    >
      <strong>{formatClock(shown)}</strong>
      <div
        ref={track}
        className={styles.scrubberTrack}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={`${formatClock(shown)} / ${formatClock(max)}`}
        aria-disabled={disabled || undefined}
        onPointerDown={begin}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowRight" || event.key === "ArrowUp")
            onChange(Math.min(max, shown + 1));
          if (event.key === "ArrowLeft" || event.key === "ArrowDown")
            onChange(Math.max(min, shown - 1));
        }}
      >
        <i className={styles.scrubberFill} style={{ width: `${percent * 100}%` }} />
        {marks.map((mark) => (
          <b
            key={mark}
            className={styles.scrubberMark}
            style={{ left: `${(mark / ceiling) * 100}%` }}
          />
        ))}
        <em className={styles.scrubberThumb} style={{ left: `${percent * 100}%` }} />
      </div>
      <span>{formatClock(max)}</span>
    </div>
  );
}
