"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import Icon, { type IconName } from "./icons";
import s from "./spotlight-guide.module.css";

export interface SpotlightStep {
  id: string;
  selector: string;
  title: string;
  body: string;
  icon?: IconName;
  padding?: number;
}

export interface SpotlightGuideProps {
  tourId: string;
  open: boolean;
  steps: readonly SpotlightStep[];
  locale?: XumengLocale;
  onFinish: () => void;
}

const TOUR_STORAGE_PREFIX = "xumeng:spotlight-tour:v1:";

export function isSpotlightTourCompleted(tourId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(`${TOUR_STORAGE_PREFIX}${tourId}`) === "done";
  } catch {
    return false;
  }
}

export function markSpotlightTourCompleted(tourId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${TOUR_STORAGE_PREFIX}${tourId}`, "done");
  } catch {
    // Ignore storage quota errors.
  }
}

export function resetSpotlightTour(tourId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${TOUR_STORAGE_PREFIX}${tourId}`);
  } catch {
    // Ignore storage errors.
  }
}

interface CutoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

function findVisibleTarget(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const matches = document.querySelectorAll<HTMLElement>(selector);
  for (const el of matches) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 4 && rect.height > 4) return el;
  }
  return null;
}

export default function SpotlightGuide({
  tourId,
  open,
  steps,
  locale = "zh-Hans",
  onFinish,
}: SpotlightGuideProps) {
  const maskId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<CutoutRect | null>(null);
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const [cardHeight, setCardHeight] = useState(212);
  const [nudge, setNudge] = useState(false);

  // Filter to steps whose DOM target currently exists & is visible on screen
  const activeSteps = useMemo(() => {
    if (!open || typeof document === "undefined") return steps;
    const found = steps.filter((step) => findVisibleTarget(step.selector) !== null);
    return found.length > 0 ? found : steps;
  }, [open, steps]);

  const current = activeSteps[Math.min(index, activeSteps.length - 1)];

  useEffect(() => {
    if (!open) {
      setIndex(0);
      return;
    }
    setIndex(0);
  }, [open, tourId]);

  useEffect(() => {
    if (!open || !current) return;
    let raf = 0;

    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewport({ w: vw, h: vh });
      const el = findVisibleTarget(current.selector);
      if (!el) {
        setRect(null);
        return;
      }
      const box = el.getBoundingClientRect();
      const pad = current.padding ?? 8;
      const x = Math.max(4, box.left - pad);
      const y = Math.max(4, box.top - pad);
      const w = Math.min(vw - x - 4, box.width + pad * 2);
      const h = Math.min(vh - y - 4, box.height + pad * 2);
      setRect({ x, y, w, h, r: Math.min(18, Math.round(Math.min(w, h) / 3)) });
    };

    const el = findVisibleTarget(current.selector);
    if (el) {
      const box = el.getBoundingClientRect();
      if (box.top < 20 || box.bottom > window.innerHeight - 20) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    measure();
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const timer = window.setTimeout(measure, 240);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        markSpotlightTourCompleted(tourId);
        onFinish();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (index + 1 >= activeSteps.length) {
          markSpotlightTourCompleted(tourId);
          onFinish();
        } else {
          setIndex((prev) => prev + 1);
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, index, activeSteps.length, tourId, onFinish]);

  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const h = cardRef.current.offsetHeight;
    if (h > 40) setCardHeight(h);
  }, [open, index, current, viewport.w]);

  if (!open || !current || typeof document === "undefined") return null;

  const isEn = locale === "en";
  const isLast = index + 1 >= activeSteps.length;

  function complete() {
    markSpotlightTourCompleted(tourId);
    onFinish();
  }

  // Compute smart clamped tooltip position (below or above target) using real measured card height
  const cardWidth = Math.min(348, viewport.w - 24);
  const estimatedHeight = cardHeight;
  let cardLeft = Math.round((viewport.w - cardWidth) / 2);
  let cardTop = Math.round((viewport.h - estimatedHeight) / 2);

  if (rect) {
    const targetCenterX = rect.x + rect.w / 2;
    cardLeft = Math.max(12, Math.min(viewport.w - cardWidth - 12, Math.round(targetCenterX - cardWidth / 2)));
    const spaceBelow = viewport.h - (rect.y + rect.h);
    const spaceAbove = rect.y;
    if (spaceBelow >= estimatedHeight + 18) {
      cardTop = Math.round(rect.y + rect.h + 14);
    } else if (spaceAbove >= estimatedHeight + 18) {
      cardTop = Math.max(12, Math.round(rect.y - estimatedHeight - 14));
    } else {
      cardTop = Math.max(12, Math.min(viewport.h - estimatedHeight - 12, Math.round((viewport.h - estimatedHeight) / 2)));
    }
  }

  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={current.title}>
      <svg
        className={s.maskSvg}
        width={viewport.w}
        height={viewport.h}
        aria-hidden="true"
        onClick={() => {
          setNudge(true);
          window.setTimeout(() => setNudge(false), 360);
        }}
      >
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width={viewport.w} height={viewport.h} fill="white" />
            {rect && (
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                rx={rect.r}
                ry={rect.r}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={viewport.w}
          height={viewport.h}
          fill="rgba(7, 3, 10, 0.76)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {rect && (
        <div
          className={s.spotlightRing}
          style={{
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.w}px`,
            height: `${rect.h}px`,
            borderRadius: `${rect.r}px`,
          }}
          aria-hidden="true"
        />
      )}

      <div
        ref={cardRef}
        className={`${s.card} ${nudge ? s.cardNudge : ""}`}
        style={{
          left: `${cardLeft}px`,
          top: `${cardTop}px`,
          width: `${cardWidth}px`,
        }}
      >
        <div className={s.cardTop}>
          <span className={s.stepPill}>
            <Icon name={current.icon ?? "sparkles"} size={13} />
            {isEn ? `Guide · ${index + 1} / ${activeSteps.length}` : `新手引导 · ${index + 1} / ${activeSteps.length}`}
          </span>
          <button type="button" className={s.skipBtn} onClick={complete}>
            {isEn ? "Skip" : "跳过引导"}
          </button>
        </div>

        <h3 className={s.title}>{current.title}</h3>
        <p className={s.body}>{current.body}</p>

        <div className={s.footer}>
          <div className={s.dots} aria-hidden="true">
            {activeSteps.map((st, idx) => (
              <span key={st.id} className={`${s.dot} ${idx === index ? s.dotActive : ""}`} />
            ))}
          </div>
          <div className={s.navBtns}>
            {index > 0 && (
              <button type="button" className={s.prevBtn} onClick={() => setIndex((prev) => Math.max(0, prev - 1))}>
                {isEn ? "Back" : "上一步"}
              </button>
            )}
            <button
              type="button"
              className={s.nextBtn}
              onClick={() => {
                if (isLast) complete();
                else setIndex((prev) => prev + 1);
              }}
            >
              {isLast ? (isEn ? "Got it" : "开始体验") : isEn ? "Next" : "下一步"}
            </button>
          </div>
        </div>
        <p className={s.keyHint}>{isEn ? "← → Navigate · Esc Skip" : "快捷键：← → 切换 · Esc 跳过"}</p>
      </div>
    </div>,
    document.body,
  );
}
