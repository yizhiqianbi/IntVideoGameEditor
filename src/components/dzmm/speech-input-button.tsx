import { useEffect, useRef, useState } from "react";
import { SPEECH_INPUT_MAX_MS, SPEECH_INPUT_PATH, speechTranscript } from "@/lib/dzmm-speech-input";
import { claimXumengAudioFocus } from "@/lib/xumeng-audio-mutex";
import { openSpeechRecorder, type SpeechRecorder } from "./speech-recorder";
import type { XumengPageCopy } from "@/lib/xumeng-page-copy";
import Icon from "./icons";
import styles from "./tavern.module.css";

const SPEECH_ASR_TIMEOUT_MS = 25_000;

export function SpeechInputButton({
  disabled,
  signedIn,
  copy,
  insert,
  notice,
}: {
  disabled: boolean;
  signedIn: boolean;
  copy: XumengPageCopy;
  insert: (text: string, caret: number) => void;
  notice: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "working">("idle");
  const [level, setLevel] = useState(0);
  const [remainingSec, setRemainingSec] = useState(() => Math.ceil(SPEECH_INPUT_MAX_MS / 1000));
  const recorder = useRef<SpeechRecorder | null>(null);
  const asrController = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef(0);
  const insertRef = useRef(insert);
  const noticeRef = useRef(notice);
  const copyRef = useRef(copy);
  insertRef.current = insert;
  noticeRef.current = notice;
  copyRef.current = copy;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      recorder.current?.cancel();
      recorder.current = null;
      asrController.current?.abort();
      asrController.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    setRemainingSec(Math.ceil(SPEECH_INPUT_MAX_MS / 1000));
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((SPEECH_INPUT_MAX_MS - (Date.now() - startedAt)) / 1000));
      setRemainingSec(left);
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  function cancelRecording() {
    sessionRef.current += 1;
    recorder.current?.cancel();
    recorder.current = null;
    asrController.current?.abort();
    asrController.current = null;
    setLevel(0);
    setPhase("idle");
  }

  async function finish(expectedSession?: number) {
    if (expectedSession !== undefined && sessionRef.current !== expectedSession) return;
    const current = recorder.current;
    recorder.current = null;
    if (!current) return;
    const session = sessionRef.current;
    setLevel(0);
    setPhase("working");
    const controller = new AbortController();
    asrController.current?.abort();
    asrController.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SPEECH_ASR_TIMEOUT_MS);
    try {
      const wav = await current.stop();
      if (!mountedRef.current || sessionRef.current !== session) return;
      const textCopy = copyRef.current;
      if (!wav) { noticeRef.current(textCopy.voiceInputShort); return; }
      const audio = new ArrayBuffer(wav.byteLength);
      new Uint8Array(audio).set(wav);
      const response = await fetch(SPEECH_INPUT_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "audio/wav" },
        body: new Blob([audio], { type: "audio/wav" }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!mountedRef.current || sessionRef.current !== session) return;
      if (!response.ok) {
        const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : textCopy.voiceInputFailed;
        noticeRef.current(message);
        return;
      }
      const text = speechTranscript(payload);
      if (!text) { noticeRef.current(textCopy.voiceInputEmpty); return; }
      insertRef.current(`${text} `, text.length + 1);
    } catch {
      if (!mountedRef.current || sessionRef.current !== session) return;
      noticeRef.current(timedOut ? "语音识别超时，请重试。" : copyRef.current.voiceInputFailed);
    } finally {
      window.clearTimeout(timeoutId);
      if (asrController.current === controller) asrController.current = null;
      if (mountedRef.current && sessionRef.current === session) setPhase("idle");
    }
  }

  async function start() {
    if (phase !== "idle") return;
    const textCopy = copyRef.current;
    if (!signedIn) { noticeRef.current(textCopy.voiceInputLogin); return; }
    const session = ++sessionRef.current;
    setPhase("starting");
    claimXumengAudioFocus("speech-input");
    try {
      const rec = await openSpeechRecorder(
        SPEECH_INPUT_MAX_MS,
        () => { void finish(session); },
        (nextLevel) => { if (mountedRef.current && sessionRef.current === session) setLevel(nextLevel); },
      );
      if (!mountedRef.current || sessionRef.current !== session) {
        rec.cancel();
        return;
      }
      recorder.current = rec;
      setPhase("recording");
    } catch (error) {
      if (!mountedRef.current || sessionRef.current !== session) return;
      setPhase("idle");
      const name = error instanceof DOMException ? error.name : error instanceof Error ? error.message : "";
      noticeRef.current(name === "unsupported" ? textCopy.voiceInputUnsupported : name === "NotAllowedError" || name === "SecurityError" ? textCopy.voiceInputDenied : textCopy.voiceInputFailed);
    }
  }

  const recording = phase === "recording";
  const label = phase === "working" ? copy.voiceInputWorking : phase === "starting" ? "正在打开麦克风…" : recording ? copy.voiceInputStop : copy.voiceInput;

  if (recording) {
    const bar1 = Math.max(22, Math.round(level * 92));
    const bar2 = Math.max(30, Math.round(Math.min(1, level * 1.15) * 100));
    const bar3 = Math.max(20, Math.round(level * 82));
    return (
      <div className={styles.micHud} role="group" aria-label="正在录音">
        <span className={styles.micMeter} aria-hidden="true">
          <i style={{ height: `${bar1}%` }} />
          <i style={{ height: `${bar2}%` }} />
          <i style={{ height: `${bar3}%` }} />
        </span>
        <span className={styles.micCountdown}>{remainingSec}s</span>
        <button
          type="button"
          className={styles.micCancel}
          aria-label="取消录音"
          title="取消录音"
          onClick={cancelRecording}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.micButton}
          aria-pressed={true}
          aria-label={label}
          title={label}
          onClick={() => { void finish(); }}
        >
          <Icon name="stop" size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.micButton}
      aria-pressed={false}
      aria-label={label}
      title={label}
      disabled={disabled || phase === "working" || phase === "starting"}
      onClick={() => { void start(); }}
    >
      <Icon name={phase === "working" || phase === "starting" ? "refresh" : "mic"} size={16} />
    </button>
  );
}
