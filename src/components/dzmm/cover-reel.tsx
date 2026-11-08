"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getDzmmCharacterMedia } from "@/lib/dzmm-character-media";
import type { Character } from "@/lib/dzmm-characters";
import { xumengCoverFrames } from "@/lib/xumeng-cover-frames";
import { xumengCardCoverUrl, xumengCoverMissUrl, xumengImageUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import Icon from "./icons";
import s from "./cover-reel.module.css";

const ADVANCE_MS = 4000;

function characterCoverFrames(character: Character): string[] {
  const stored = (character as Character & { gallery?: unknown }).gallery;
  const own = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
  const media = getDzmmCharacterMedia(character)?.gallery.map((image) => image.path) ?? [];
  return xumengCoverFrames(character.cover, own.length ? own : media);
}

export function CoverReel({
  character,
  className,
  onOpen,
  count = "top",
  children,
}: {
  character: Character;
  className?: string;
  onOpen: () => void;
  count?: "top" | "corner";
  children?: ReactNode;
}) {
  const frames = characterCoverFrames(character);
  const frameKey = frames.join("\n");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(0);
  const [near, setNear] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; swiped: boolean } | null>(null);
  const safeIndex = frames.length ? ((index % frames.length) + frames.length) % frames.length : 0;
  const original = xumengImageUrl(frames[safeIndex] || character.cover || XUMENG_FALLBACK_COVER);
  const src = xumengCardCoverUrl(original);

  useEffect(() => { setIndex(0); }, [character.id, frameKey]);

  useEffect(() => {
    const node = root.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setNear(true);
    }, { rootMargin: "200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    const node = root.current;
    if (!node || frames.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let start = 0;
    const stop = () => { window.clearTimeout(start); window.clearInterval(timer); };
    const arm = () => {
      stop();
      const delay = [...character.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 1600;
      start = window.setTimeout(() => {
        timer = window.setInterval(() => {
          if (document.visibilityState !== "visible") return;
          setIndex((current) => (current + 1) % frames.length);
        }, ADVANCE_MS);
      }, delay);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) arm();
      else stop();
    }, { threshold: 0.45 });
    observer.observe(node);
    return () => { observer.disconnect(); stop(); };
  }, [character.id, frameKey, frames.length, paused, manual]);

  const move = (delta: number) => {
    setIndex((current) => (current + delta + frames.length) % frames.length);
    setManual((value) => value + 1);
  };
  const step = (delta: number) => (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    move(delta);
  };

  return (
    <div
      className={className}
      data-cover-count={frames.length}
      ref={root}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setPaused(true); }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") setPaused(false); }}
    >
      <button
        type="button"
        className={s.open}
        aria-label={`查看 ${character.name}`}
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, swiped: false }; }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || frames.length < 2) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.2) start.swiped = true;
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (!start?.swiped || frames.length < 2) return;
          move(event.clientX < start.x ? 1 : -1);
        }}
        onKeyDown={(event) => {
          if (frames.length < 2) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }}
        onClick={() => {
          if (drag.current?.swiped) { drag.current = null; return; }
          onOpen();
        }}
      >
        {near && (
          <img
            src={src}
            alt=""
            decoding="async"
            onError={(event) => {
              const image = event.currentTarget;
              const next = xumengCoverMissUrl(image.currentSrc || image.src, original);
              image.onerror = () => { image.onerror = null; image.src = XUMENG_FALLBACK_COVER; };
              if (next === XUMENG_FALLBACK_COVER) image.onerror = null;
              image.src = next;
            }}
          />
        )}
        {children}
      </button>
      {frames.length > 1 && <>
        <button type="button" className={`${s.step} ${s.previous}`} aria-label={`上一张 ${character.name} 封面`} onClick={step(-1)}><Icon name="chevron" size={16} /></button>
        <button type="button" className={`${s.step} ${s.next}`} aria-label={`下一张 ${character.name} 封面`} onClick={step(1)}><Icon name="chevron" size={16} /></button>
        <span className={`${s.count} ${count === "corner" ? s.corner : s.top}`} aria-live="polite">{safeIndex + 1} / {frames.length}</span>
      </>}
    </div>
  );
}
