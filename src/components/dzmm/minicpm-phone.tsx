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
type Capture = { context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; sink: GainNode };

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
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionEpoch = useRef(0);
  const statusAbort = useRef<AbortController | null>(null);
  const handshakeTimer = useRef<number | null>(null);
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

  function clearHandshakeTimer() {
    if (handshakeTimer.current !== null) {
      window.clearTimeout(handshakeTimer.current);
      handshakeTimer.current = null;
    }
  }
  function flushPlayback() {
    for (const source of activeSources.current) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    activeSources.current.clear();
    playbackAt.current = 0;
  }
  function unlockPlaybackAudio() {
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    if (!playback.current || playback.current.state === "closed") playback.current = new AudioCtor();
    const context = playback.current;
    void context.resume().catch(() => undefined);
    try {
      const silent = context.createBuffer(1, 1, 24000);
      const source = context.createBufferSource();
      source.buffer = silent;
      source.connect(context.destination);
      source.start(0);
    } catch { /* Ignore audio unlock errors on restricted devices. */ }
  }
  function micErrorText(failure: unknown): string {
    if (failure instanceof DOMException) {
      if (failure.name === "NotAllowedError" || failure.name === "PermissionDeniedError") return "未获得麦克风权限，请在浏览器设置中允许使用麦克风后重试。";
      if (failure.name === "NotFoundError" || failure.name === "DevicesNotFoundError") return "未检测到可用麦克风设备，请检查连接后重试。";
      if (failure.name === "NotReadableError") return "麦克风正被其他应用占用，请关闭占用后重试。";
    }
    return failure instanceof Error && failure.message.trim() ? failure.message : "麦克风启动失败，请检查设备与权限。";
  }

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

  async function startCapture(epoch: number) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持语音采集。");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!mounted.current || sessionEpoch.current !== epoch) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    const context = new AudioContext();
    await context.resume();
    if (!mounted.current || sessionEpoch.current !== epoch) {
      stream.getTracks().forEach(track => track.stop());
      void context.close();
      return;
    }
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;
    processor.onaudioprocess = event => appendInput(resample(event.inputBuffer.getChannelData(0), context.sampleRate));
    source.connect(processor); processor.connect(sink); sink.connect(context.destination);
    capture.current = { context, stream, source, processor, sink };
  }
  function stopCapture() {
    const current = capture.current; capture.current = null;
    if (!current) return;
    current.processor.disconnect(); current.source.disconnect(); current.sink.disconnect(); current.stream.getTracks().forEach(track => track.stop()); void current.context.close(); inputBuffer.current = new Float32Array();
  }
  function playAudio(encoded: string) {
    try {
      const raw = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const context = playback.current && playback.current.state !== "closed" ? playback.current : (playback.current = new AudioContext());
      void context.resume().catch(() => undefined);
      const buffer = context.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      activeSources.current.add(source);
      source.onended = () => {
        activeSources.current.delete(source);
        try { source.disconnect(); } catch {}
      };
      const at = Math.max(context.currentTime + 0.02, playbackAt.current); source.start(at); playbackAt.current = at + buffer.duration;
    } catch { /* A malformed audio delta should not tear down the call. */ }
  }
  function cleanupSocket(sendClose = true) {
    clearHandshakeTimer();
    statusAbort.current?.abort(); statusAbort.current = null;
    stopCapture(); flushPlayback();
    const ws = socket.current; socket.current = null;
    if (ws && sendClose && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: "session.close", reason: "user_stop" })); } catch {} }
    try { ws?.close(); } catch {}
    if (playback.current) { void playback.current.close().catch(() => undefined); playback.current = null; }
    playbackAt.current = 0;
  }
  async function start() {
    if (isGuest || !userId) { onRequireAccount(); return; }
    if (active) return;
    const epoch = ++sessionEpoch.current;
    // Unlock playback AudioContext synchronously within the click gesture (required on iOS Safari).
    unlockPlaybackAudio();
    muted.current = false; setMutedOn(false); setError(""); setCaption(""); setStatus("connecting"); setElapsed(0); onBusyChange?.(true);
    const controller = new AbortController();
    statusAbort.current = controller;
    const statusTimeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const statusResponse = await fetch("/api/phone/status", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      window.clearTimeout(statusTimeout);
      if (statusAbort.current === controller) statusAbort.current = null;
      if (!mounted.current || sessionEpoch.current !== epoch) return;
      const available = await statusResponse.json() as { available?: boolean; error?: string };
      if (!statusResponse.ok || !available.available) throw new Error(available.error || "MiniCPM 电话服务尚未配置。");
      if (!mounted.current || sessionEpoch.current !== epoch) return;
      const ws = new WebSocket(wsUrl()); socket.current = ws;
      let opened = false;
      handshakeTimer.current = window.setTimeout(() => {
        if (!opened && sessionEpoch.current === epoch) {
          setError("语音接通超时，请检查网络后再拨一次。");
          cleanupSocket(false);
          if (mounted.current) { setStatus("ended"); onBusyChange?.(false); }
        }
      }, 15_000);
      ws.onmessage = event => {
        if (sessionEpoch.current !== epoch) return;
        let message: SocketMessage; try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === "session.queue_done") {
          ws.send(JSON.stringify({ type: "session.init", payload: { system_prompt: systemPrompt, config: { length_penalty: 1.1 } } }));
        } else if (message.type === "session.created") {
          opened = true; clearHandshakeTimer(); setStatus("connected");
          void startCapture(epoch).catch(failure => {
            if (!mounted.current || sessionEpoch.current !== epoch) return;
            setError(micErrorText(failure));
            cleanupSocket(true);
            setStatus("ended"); onBusyChange?.(false);
          });
        } else if (message.type === "response.output.delta") {
          if (message.kind === "text" && message.text) setCaption(previous => `${previous}${message.text}`.slice(-1000));
          if (message.kind === "audio" && message.audio) playAudio(message.audio);
          if (message.kind === "listen") { flushPlayback(); setCaption(""); }
        } else if (message.type === "error") setError(failureText(message));
      };
      ws.onerror = () => {
        if (sessionEpoch.current === epoch) setError(current => current || "MiniCPM 电话连接失败，请稍后重试。");
      };
      ws.onclose = () => {
        if (sessionEpoch.current !== epoch) return;
        cleanupSocket(false);
        if (!mounted.current) return;
        if (!opened) setError(current => current || "语音线路没有接通，请再拨一次。");
        setStatus("ended"); onBusyChange?.(false);
      };
      startedAt.current = Date.now();
    } catch (failure) {
      window.clearTimeout(statusTimeout);
      if (sessionEpoch.current !== epoch) return;
      cleanupSocket(false); setStatus("idle");
      const message = failure instanceof DOMException && failure.name === "AbortError"
        ? "语音服务响应超时，请稍后再试。"
        : failure instanceof Error ? failure.message : "电话服务暂时不可用。";
      setError(message); onBusyChange?.(false);
    }
  }
  function stop() { sessionEpoch.current++; muted.current = false; setMutedOn(false); cleanupSocket(); setStatus("ended"); onBusyChange?.(false); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sessionEpoch.current++; cleanupSocket(false); }; }, []);
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
