"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import s from "./voice-note.module.css";

function hintedSeconds(durationMs: number | undefined) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(30 * 60, durationMs / 1000);
}

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "···";
  const whole = Math.min(3599, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function slotWidth(seconds: number) {
  const length = Math.min(60, Math.max(1, seconds || 5));
  return Math.min(280, Math.round(96 + length * 7));
}

export function VoiceNote({ src, label, assetId, durationMs, onError }: {
  src: string; label: string; assetId: string; durationMs?: number; onError?: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const retries = useRef(0);
  const wantPlay = useRef(false);
  const ignoreError = useRef(false);
  const live = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const [attached, setAttached] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(() => hintedSeconds(durationMs));
  const [time, setTime] = useState(0);
  const known = duration > 0;

  useEffect(() => {
    setDuration(hintedSeconds(durationMs));
  }, [durationMs]);

  useEffect(() => {
    setAttached(false);
    setFailed(false);
    setPlaying(false);
    setTime(0);
    retries.current = 0;
    if (!src) return;
    const frame = requestAnimationFrame(() => setAttached(true));
    return () => cancelAnimationFrame(frame);
  }, [src]);

  useEffect(() => () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); }, []);
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !attached || !src) return;
    const ticket = ++live.current;
    ignoreError.current = false;
    audio.src = src;
    audio.load();
    return () => {
      if (live.current === ticket) live.current += 1;
      ignoreError.current = true;
      audio.pause();
      audio.removeAttribute("src");
    };
  }, [attached, src]);

  useEffect(() => {
    const pause = (event: Event) => { if ((event as CustomEvent).detail !== assetId) ref.current?.pause(); };
    document.addEventListener("xumeng-audio-play", pause);
    return () => document.removeEventListener("xumeng-audio-play", pause);
  }, [assetId]);

  function playWhenReady() {
    const audio = ref.current;
    if (!audio || !wantPlay.current) return;
    wantPlay.current = false;
    void audio.play().catch(() => { wantPlay.current = true; });
  }

  function reload(autoplay: boolean) {
    const audio = ref.current;
    if (!audio || !src) return;
    if (autoplay) wantPlay.current = true;
    const ticket = ++live.current;
    ignoreError.current = true;
    audio.pause();
    audio.removeAttribute("src");
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      if (live.current !== ticket || ref.current !== audio) return;
      ignoreError.current = false;
      audio.src = src;
      audio.load();
    }, 280);
  }

  function toggle() {
    const audio = ref.current;
    if (!src) return;
    if (failed) { retries.current = 0; setFailed(false); reload(true); return; }
    if (!audio || !attached) { wantPlay.current = true; return; }
    if (audio.paused) {
      wantPlay.current = true;
      playWhenReady();
    } else audio.pause();
  }

  function fail() {
    const audio = ref.current;
    if (ignoreError.current || !audio?.getAttribute("src")) return;
    if (retries.current < 2) {
      retries.current += 1;
      reload(wantPlay.current);
      return;
    }
    setPlaying(false);
    setFailed(true);
    onError?.();
  }

  const shown = playing || time > 0 ? time : duration;
  const progress = known && shown > 0 ? Math.min(1, (playing || time > 0 ? time : 0) / duration) : 0;
  return <div className={s.slot} data-playing={playing ? "true" : "false"} data-failed={failed ? "true" : "false"} style={{ width: slotWidth(duration) }}>
    <button type="button" className={s.note} aria-busy={!attached || (!known && !failed)} aria-label={failed ? `${label}加载失败，重试` : playing ? `暂停${label}` : `播放${label}`} onClick={toggle}>
      <span className={s.body}>
        <Icon name={playing ? "pause" : "play"} size={14} />
        <span className={s.waves} aria-hidden="true"><i /><i /><i /></span>
        <span className={s.time}>{failed ? "重试" : clock(shown)}</span>
      </span>
      <span className={s.progress} aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></span>
    </button>
    <audio ref={ref} className={s.clip} preload="auto" aria-label={label}
      onPlay={() => { setPlaying(true); document.dispatchEvent(new CustomEvent("xumeng-audio-play", { detail: assetId })); }}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setTime(0); }}
      onTimeUpdate={() => { if (ref.current) setTime(ref.current.currentTime); }}
      onLoadedMetadata={() => {
        const audio = ref.current;
        if (audio && Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      }}
      onCanPlay={playWhenReady}
      onError={fail} />
  </div>;
}
