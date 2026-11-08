"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import s from "./voice-note.module.css";

const WAVE = [28, 46, 72, 40, 88, 54, 34, 76, 48, 92, 42, 68, 32, 80, 56, 38, 74, 50, 86, 44, 64, 36, 78, 52];

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.min(3599, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function VoiceNote({ src, label, assetId, onError }: {
  src: string; label: string; assetId: string; onError?: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const audio = ref.current;
    return () => { audio?.pause(); };
  }, [src]);
  useEffect(() => {
    const pause = (event: Event) => { if ((event as CustomEvent).detail !== assetId) ref.current?.pause(); };
    document.addEventListener("xumeng-audio-play", pause);
    return () => document.removeEventListener("xumeng-audio-play", pause);
  }, [assetId]);
  function toggle() {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => onError?.());
    else audio.pause();
  }
  function seek(clientX: number, width: number, left: number) {
    const audio = ref.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0 || width <= 0) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, (clientX - left) / width * audio.duration));
  }
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  return <div className={s.note}>
    <button type="button" className={s.play} aria-label={playing ? `暂停${label}` : `播放${label}`} onClick={toggle}>
      <Icon name={playing ? "pause" : "play"} size={16} />
    </button>
    <div className={s.track} role="slider" tabIndex={0} aria-label={`${label}进度`}
      aria-valuemin={0} aria-valuemax={Math.round(duration) || 0} aria-valuenow={Math.round(time)}
      onClick={event => { const box = event.currentTarget.getBoundingClientRect(); seek(event.clientX, box.width, box.left); }}
      onKeyDown={event => {
        const audio = ref.current;
        if (!audio || !duration) return;
        if (event.key === "ArrowRight") audio.currentTime = Math.min(duration, audio.currentTime + 2);
        if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 2);
      }}>
      {WAVE.map((height, index) => <span key={index} className={index / WAVE.length < progress ? s.barOn : s.bar} style={{ height: `${height}%` }} />)}
    </div>
    <span className={s.time}>{clock(playing || time > 0 ? time : duration)}</span>
    <audio ref={ref} src={src} preload="metadata" hidden aria-label={label}
      onPlay={() => { setPlaying(true); document.dispatchEvent(new CustomEvent("xumeng-audio-play", { detail: assetId })); }}
      onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setTime(0); }}
      onTimeUpdate={() => { if (ref.current) setTime(ref.current.currentTime); }}
      onLoadedMetadata={() => { if (ref.current && Number.isFinite(ref.current.duration)) setDuration(ref.current.duration); }}
      onError={() => { setPlaying(false); onError?.(); }} />
  </div>;
}
