"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { XumengPerformanceCharacter } from "@/lib/xumeng-performance-character";
import { buildXumengLivePersona } from "@/lib/xumeng-performance-character";
import { buildXumengMiniCpmPrompt } from "@/lib/xumeng-minicpm-phone";
import Icon from "./icons";
import s from "./minicpm-phone.module.css";

type Props = {
  userId?: string;
  isGuest: boolean;
  characters?: XumengPerformanceCharacter[];
  initialCharacter?: XumengPerformanceCharacter;
  onPick?: (character: XumengPerformanceCharacter) => void;
  userName?: string;
  onRequireAccount: () => void;
  onBack: () => void;
  onVideo: () => void;
  onBusyChange?: (busy: boolean) => void;
};
type SocketMessage = { type?: string; kind?: string; text?: string; audio?: string; message?: string; error?: string | { message?: string } };

function failureText(message: SocketMessage): string {
  if (typeof message.error === "string" && message.error.trim()) return message.error;
  if (message.error && typeof message.error === "object" && message.error.message?.trim()) return message.error.message;
  if (message.message?.trim()) return message.message;
  return "MiniCPM 电话连接失败。";
}
type Capture = { context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode };

const bytes = (data: ArrayBuffer) => {
  const view = new Uint8Array(data); let binary = "";
  for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return btoa(binary);
};
function resample(input: Float32Array, from: number, to = 16000) {
  if (from === to) return input;
  const length = Math.max(1, Math.round(input.length * to / from));
  const output = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const position = i * ratio, left = Math.floor(position), right = Math.min(input.length - 1, left + 1);
    const weight = position - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}
function wsUrl() {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/phone/ws`;
}

export default function MiniCpmPhone({ userId, isGuest, characters = [], initialCharacter, onPick, userName, onRequireAccount, onBack, onVideo, onBusyChange }: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended">("idle");
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [mutedOn, setMutedOn] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const capture = useRef<Capture | null>(null);
  const inputBuffer = useRef<Float32Array>(new Float32Array());
  const muted = useRef(false);
  const playback = useRef<AudioContext | null>(null);
  const playbackAt = useRef(0);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const characterName = initialCharacter?.name || "小玥";
  const systemPrompt = useMemo(() => {
    const persona = initialCharacter
      ? buildXumengLivePersona(initialCharacter, userName)
      : `你是${characterName}。先接住刚刚那句，再按你现在的处境往下说。不知道的事就说不知道。`;
    return buildXumengMiniCpmPrompt(persona, characterName, initialCharacter?.scene?.situation || "").slice(0, 5000);
  }, [characterName, initialCharacter, userName]);
  const active = status === "connecting" || status === "connected";

  function appendInput(samples: Float32Array) {
    const audible = muted.current ? new Float32Array(samples.length) : samples;
    const previous = inputBuffer.current;
    const next = new Float32Array(previous.length + audible.length); next.set(previous); next.set(audible, previous.length);
    inputBuffer.current = next;
    const block = 16000;
    while (inputBuffer.current.length >= block) {
      const chunk = inputBuffer.current.slice(0, block); inputBuffer.current = inputBuffer.current.slice(block);
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input.append", input: { audio: bytes(chunk.buffer), force_listen: false, max_slice_nums: 1 } }));
    }
  }

  async function startCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const context = new AudioContext(); await context.resume();
    const source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = event => appendInput(resample(event.inputBuffer.getChannelData(0), context.sampleRate));
    source.connect(processor); processor.connect(context.destination);
    capture.current = { context, stream, source, processor };
  }
  function stopCapture() {
    const current = capture.current; capture.current = null;
    if (!current) return;
    current.processor.disconnect(); current.source.disconnect(); current.stream.getTracks().forEach(track => track.stop()); void current.context.close(); inputBuffer.current = new Float32Array();
  }
  function playAudio(encoded: string) {
    try {
      const raw = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const context = playback.current ?? (playback.current = new AudioContext()); void context.resume();
      const buffer = context.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      const at = Math.max(context.currentTime + 0.02, playbackAt.current); source.start(at); playbackAt.current = at + buffer.duration;
    } catch { /* A malformed audio delta should not tear down the call. */ }
  }
  function cleanupSocket(sendClose = true) {
    stopCapture(); const ws = socket.current; socket.current = null;
    if (ws && sendClose && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: "session.close", reason: "user_stop" })); } catch {} }
    try { ws?.close(); } catch {}
    if (playback.current) { void playback.current.close(); playback.current = null; }
    playbackAt.current = 0;
  }
  async function start() {
    if (isGuest || !userId) { onRequireAccount(); return; }
    if (active) return;
    muted.current = false; setMutedOn(false); setError(""); setCaption(""); setStatus("connecting"); setElapsed(0); onBusyChange?.(true);
    try {
      const statusResponse = await fetch("/api/phone/status", { credentials: "same-origin", cache: "no-store" });
      const available = await statusResponse.json() as { available?: boolean; error?: string };
      if (!statusResponse.ok || !available.available) throw new Error(available.error || "MiniCPM 电话服务尚未配置。");
      const ws = new WebSocket(wsUrl()); socket.current = ws;
      let opened = false;
      ws.onmessage = event => {
        let message: SocketMessage; try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === "session.queue_done") {
          ws.send(JSON.stringify({ type: "session.init", payload: { system_prompt: systemPrompt, config: { length_penalty: 1.1 } } }));
        } else if (message.type === "session.created") {
          opened = true; setStatus("connected"); void startCapture();
        } else if (message.type === "response.output.delta") {
          if (message.kind === "text" && message.text) setCaption(previous => `${previous}${message.text}`.slice(-1000));
          if (message.kind === "audio" && message.audio) playAudio(message.audio);
          if (message.kind === "listen") setCaption("");
        } else if (message.type === "error") setError(failureText(message));
      };
      ws.onerror = () => setError(current => current || "MiniCPM 电话连接失败，请稍后重试。");
      ws.onclose = () => {
        stopCapture();
        if (!mounted.current) return;
        if (!opened) setError(current => current || "语音线路没有接通，请再拨一次。");
        setStatus("ended"); onBusyChange?.(false);
      };
      startedAt.current = Date.now();
    } catch (failure) { cleanupSocket(false); setStatus("idle"); setError(failure instanceof Error ? failure.message : "电话服务暂时不可用。"); onBusyChange?.(false); }
  }
  function stop() { muted.current = false; setMutedOn(false); cleanupSocket(); setStatus("ended"); onBusyChange?.(false); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cleanupSocket(false); }; }, []);
  useEffect(() => { const timer = window.setInterval(() => { if (active && startedAt.current) setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)); }, 1000); return () => window.clearInterval(timer); }, [active]);

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const stateLabel = status === "connected" ? (mutedOn ? `${clock} · 已静音` : clock) : status === "connecting" ? "正在接通" : status === "ended" ? "通话结束" : "语音通话";
  return <section className={s.page} aria-label="语音通话">
    <header className={s.top}>
      <button className={s.ghost} onClick={active ? stop : onBack}>{active ? "挂断" : "返回"}</button>
      <span>语音</span>
      <button className={s.ghost} onClick={onVideo} disabled={active}>视频</button>
    </header>
    <div className={s.stage}>
      <div className={`${s.portrait} ${status === "connected" || status === "connecting" ? s.live : ""}`}>{initialCharacter?.avatar ? <img src={initialCharacter.avatar} alt="" /> : <span>{characterName.slice(0, 1)}</span>}</div>
      <h1>{characterName}</h1>
      <p className={s.state}>{stateLabel}</p>
      <p className={s.line} aria-live="polite">{status === "connected" ? (caption || "可以说话，也可以随时打断") : (initialCharacter?.scenario || "")}</p>
      {error && <p className={s.error} role="alert">{error}</p>}
    </div>
    {!active && characters.length > 0 && <div className={s.people} role="listbox" aria-label="通话人物">{characters.map(item => <button type="button" key={item.key} className={item.key === initialCharacter?.key ? s.personOn : s.person} aria-pressed={item.key === initialCharacter?.key} onClick={() => onPick?.(item)}><span>{item.avatar ? <img src={item.avatar} alt="" /> : item.name.slice(0, 1)}</span><small>{item.name}</small></button>)}</div>}
    <div className={s.dock}>
      <button type="button" className={s.round} disabled={!active} aria-pressed={mutedOn} onClick={() => { muted.current = !muted.current; setMutedOn(muted.current); }}><span><Icon name="volume" size={24} /></span><small>{mutedOn ? "已静音" : "静音"}</small></button>
      <button type="button" className={active ? s.hang : s.dial} onClick={active ? stop : () => void start()}><span><Icon name="phone" size={28} /></span><small>{active ? "挂断" : isGuest ? "登录" : status === "ended" ? "重拨" : "拨打"}</small></button>
      <button type="button" className={s.round} onClick={onVideo} disabled={active}><span><Icon name="video" size={24} /></span><small>视频</small></button>
    </div>
  </section>;
}
