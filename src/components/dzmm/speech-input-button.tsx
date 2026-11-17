import { useEffect, useRef, useState } from "react";
import { SPEECH_INPUT_MAX_MS, SPEECH_INPUT_PATH, speechTranscript } from "@/lib/dzmm-speech-input";
import { openSpeechRecorder, type SpeechRecorder } from "./speech-recorder";
import type { XumengPageCopy } from "@/lib/xumeng-page-copy";
import Icon from "./icons";
import styles from "./tavern.module.css";

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
  const [phase, setPhase] = useState<"idle" | "recording" | "working">("idle");
  const recorder = useRef<SpeechRecorder | null>(null);
  const insertRef = useRef(insert);
  const noticeRef = useRef(notice);
  const copyRef = useRef(copy);
  insertRef.current = insert;
  noticeRef.current = notice;
  copyRef.current = copy;

  useEffect(() => () => { recorder.current?.cancel(); recorder.current = null; }, []);

  async function finish() {
    const current = recorder.current;
    recorder.current = null;
    if (!current) return;
    setPhase("working");
    try {
      const wav = await current.stop();
      const textCopy = copyRef.current;
      if (!wav) { noticeRef.current(textCopy.voiceInputShort); return; }
      const audio = new ArrayBuffer(wav.byteLength);
      new Uint8Array(audio).set(wav);
      const response = await fetch(SPEECH_INPUT_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "audio/wav" },
        body: new Blob([audio], { type: "audio/wav" }),
      });
      const payload = await response.json().catch(() => null);
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
      noticeRef.current(copyRef.current.voiceInputFailed);
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    const textCopy = copyRef.current;
    if (!signedIn) { noticeRef.current(textCopy.voiceInputLogin); return; }
    try {
      recorder.current = await openSpeechRecorder(SPEECH_INPUT_MAX_MS, () => { void finish(); });
      setPhase("recording");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : error instanceof Error ? error.message : "";
      noticeRef.current(name === "unsupported" ? textCopy.voiceInputUnsupported : name === "NotAllowedError" || name === "SecurityError" ? textCopy.voiceInputDenied : textCopy.voiceInputFailed);
    }
  }

  const recording = phase === "recording";
  const label = phase === "working" ? copy.voiceInputWorking : recording ? copy.voiceInputStop : copy.voiceInput;
  return (
    <button
      type="button"
      className={styles.micButton}
      aria-pressed={recording}
      aria-label={label}
      title={label}
      disabled={disabled || phase === "working"}
      onClick={() => { if (recording) void finish(); else void start(); }}
    >
      <Icon name={recording ? "stop" : "mic"} size={16} />
    </button>
  );
}
