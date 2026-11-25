"use client";

import { useEffect, useRef, useState } from "react";
import { claimXumengAudioFocus, subscribeXumengAudioFocus } from "@/lib/xumeng-audio-mutex";
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
  const loadedSrc = useRef("");
  const live = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(() => hintedSeconds(durationMs));
  const [time, setTime] = useState(0);
  const known = duration > 0;

  useEffect(() => {
    setDuration(hintedSeconds(durationMs));
  }, [durationMs]);

  useEffect(() => {
    const audio = ref.current;
    live.current += 1;
    wantPlay.current = false;
    loadedSrc.current = "";
    retries.current = 0;
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setFailed(false);
    setPlaying(false);
    setLoading(false);
    setTime(0);
    if (audio) {
      ignoreError.current = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    return () => {
      live.current += 1;
      wantPlay.current = false;
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      if (audio) {
        ignoreError.current = true;
        audio.pause();
        audio.removeAttribute("src");
      }
    };
  }, [src]);

  useEffect(() => {
    return subscribeXumengAudioFocus(assetId, () => {
      live.current += 1;
      wantPlay.current = false;
      setLoading(false);
      ref.current?.pause();
    });
  }, [assetId]);

  function ensureAttached(audio: HTMLAudioElement): boolean {
    if (!src) return false;
    if (loadedSrc.current === src && audio.getAttribute("src")) return true;
    ignoreError.current = false;
    loadedSrc.current = src;
    audio.src = src;
    audio.load();
    return true;
  }

  function playWhenReady() {
    const audio = ref.current;
    if (!audio || !wantPlay.current) return;
    const ticket = live.current;
    wantPlay.current = false;
    void audio.play().catch((error: unknown) => {
      if (live.current !== ticket) return;
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      if (!blocked && audio.readyState < 2 && !audio.error) {
        wantPlay.current = true;
        setLoading(true);
        return;
      }
      wantPlay.current = false;
      setLoading(false);
      setPlaying(false);
    });
  }

  function reload(autoplay: boolean) {
    const audio = ref.current;
    if (!audio || !src) return;
    const ticket = ++live.current;
    wantPlay.current = autoplay;
    setLoading(autoplay);
    ignoreError.current = true;
    loadedSrc.current = "";
    audio.pause();
    audio.removeAttribute("src");
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      if (live.current !== ticket || ref.current !== audio) return;
      ignoreError.current = false;
      loadedSrc.current = src;
      audio.src = src;
      audio.load();
      if (wantPlay.current) playWhenReady();
    }, 280);
  }

  function toggle() {
    const audio = ref.current;
    if (!src || !audio) return;
    if (failed) {
      retries.current = 0;
      setFailed(false);
      claimXumengAudioFocus(assetId);
      reload(true);
      return;
    }
    if (playing || loading || wantPlay.current) {
      live.current += 1;
      wantPlay.current = false;
      setLoading(false);
      audio.pause();
      return;
    }
    live.current += 1;
    claimXumengAudioFocus(assetId);
    ensureAttached(audio);
    wantPlay.current = true;
    setLoading(audio.readyState < 2);
    playWhenReady();
  }

  function fail() {
    const audio = ref.current;
    if (ignoreError.current || !audio?.getAttribute("src")) return;
    if (retries.current < 2) {
      retries.current += 1;
      reload(wantPlay.current);
      return;
    }
    wantPlay.current = false;
    setLoading(false);
    setPlaying(false);
    setFailed(true);
    onError?.();
  }

  const shown = playing || time > 0 ? time : duration;
  const progress = known && shown > 0 ? Math.min(1, (playing || time > 0 ? time : 0) / duration) : 0;
  return <div className={s.slot} data-playing={playing ? "true" : "false"} data-loading={loading ? "true" : "false"} data-failed={failed ? "true" : "false"} style={{ width: slotWidth(duration) }}>
    <button type="button" className={s.note} aria-busy={loading} aria-label={failed ? `${label}加载失败，重试` : playing ? `暂停${label}` : loading ? `取消加载${label}` : `播放${label}`} onClick={toggle}>
      <span className={s.body}>
        <Icon name={playing ? "pause" : loading ? "refresh" : "play"} size={14} />
        <span className={s.waves} aria-hidden="true"><i /><i /><i /></span>
        <span className={s.time}>{failed ? "重试" : loading ? "缓冲…" : clock(shown)}</span>
      </span>
      <span className={s.progress} aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></span>
    </button>
    <audio ref={ref} className={s.clip} preload="none" aria-label={label}
      onPlay={() => { wantPlay.current = false; setLoading(false); setPlaying(true); claimXumengAudioFocus(assetId); }}
      onPlaying={() => { setLoading(false); setPlaying(true); }}
      onWaiting={() => { if (!ref.current?.paused) setLoading(true); }}
      onPause={() => { setPlaying(false); setLoading(false); }}
      onEnded={() => { wantPlay.current = false; setPlaying(false); setLoading(false); setTime(0); }}
      onTimeUpdate={() => { if (ref.current) setTime(ref.current.currentTime); }}
      onLoadedMetadata={() => {
        const audio = ref.current;
        if (audio && Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      }}
      onCanPlay={playWhenReady}
      onError={fail} />
  </div>;
}
