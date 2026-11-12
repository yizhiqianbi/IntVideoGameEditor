"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { showcaseCover } from "@/lib/showcase-covers";
import { findWorkTool, toolCover, type MediaId } from "@/lib/workbench";

const ASSETS = "https://xumengchat.top";
const FEATURED: Record<MediaId, readonly string[]> = {
  image: ["template-image", "image-edit", "text-image", "scene-image"],
  video: ["template-video", "image-video", "text-video", "frames-video"],
  audio: ["speech", "voice-clone", "dub-video"],
  text: ["novel", "novel-continue", "prompt-writer"],
};

type Slide = { id: string; label: string; detail: string; image: string; tone: MediaId };

function slides(media: MediaId): Slide[] {
  const items: Slide[] = [];
  for (const id of FEATURED[media]) {
    const tool = findWorkTool(id);
    if (!tool) continue;
    const cover = toolCover(id);
    const folder = cover.kind === "video" ? "h3-actions" : "krea2-actions";
    const local = showcaseCover(id);
    items.push({
      id,
      label: tool.label,
      detail: tool.detail,
      image: local || (cover.kind === "poster" ? "" : `${ASSETS}/assets/xumeng/${folder}/${cover.id}.webp`),
      tone: tool.media,
    });
  }
  return items;
}

export default function AdBanner({ media }: { media: MediaId }) {
  const items = slides(media);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const startX = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);
  const count = items.length;
  const current = count === 0 ? 0 : index % count;

  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setIndex(value => (value + 1) % count);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [count, paused, current]);

  useEffect(() => {
    setIndex(0);
  }, [media]);

  function step(delta: number) {
    if (count < 2) return;
    setIndex(value => (value + delta + count) % count);
  }

  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = true;
    moved.current = false;
    startX.current = event.clientX;
  }

  function pointerUp(event: PointerEvent<HTMLElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    const delta = event.clientX - startX.current;
    if (Math.abs(delta) < 48) return;
    moved.current = true;
    step(delta > 0 ? -1 : 1);
  }

  function blur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
  }

  if (count === 0) return null;
  const slide = items[current];
  if (!slide) return null;

  return <section
    className="banner"
    id="top"
    aria-roledescription="carousel"
    aria-label="广告"
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)}
    onBlurCapture={blur}
    onPointerDown={pointerDown}
    onPointerUp={pointerUp}
    onPointerCancel={() => { dragging.current = false; }}
    onKeyDown={event => {
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    }}
    onClickCapture={event => {
      if (!moved.current) return;
      event.preventDefault();
      event.stopPropagation();
      moved.current = false;
    }}
  >
    <div className="banner-track" style={{ transform: `translateX(-${current * 100}%)` }}>
      {items.map((item, itemIndex) => <Link
        className="banner-slide"
        key={item.id}
        href={`/t/${item.id}`}
        aria-hidden={itemIndex === current ? undefined : true}
        tabIndex={itemIndex === current ? 0 : -1}
      >
        {item.image ? <img src={item.image} alt="" /> : <div className={`banner-fill tone-${item.tone}`} />}
        <span className="banner-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
      </Link>)}
    </div>
    {count > 1 && <>
      <button type="button" className="banner-nav prev" aria-label="上一则广告" onClick={() => step(-1)}>‹</button>
      <button type="button" className="banner-nav next" aria-label="下一则广告" onClick={() => step(1)}>›</button>
      <div className="banner-dots">
        {items.map((item, itemIndex) => <button
          type="button"
          key={item.id}
          aria-label={`第 ${itemIndex + 1} 则，${item.label}`}
          aria-current={itemIndex === current ? "true" : undefined}
          onClick={() => setIndex(itemIndex)}
        />)}
      </div>
    </>}
  </section>;
}
