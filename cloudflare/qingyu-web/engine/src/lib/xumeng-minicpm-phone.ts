/**
 * Browser-side client for the XUMENG MiniCPM-o phone.
 *
 * The phone is an audio-only, full-duplex path.  The browser sends one-second
 * 16 kHz mono PCM16 chunks and receives MiniCPM's text/audio events.  The
 * authenticated WebSocket endpoint is same-origin by default so the provider
 * credential never reaches the browser.
 */

export type XumengMiniCpmEvent = {
  type: string;
  epoch?: number;
  text?: string;
  audio_seconds?: number;
  message?: string;
  phase?: string;
  [key: string]: unknown;
};

export type XumengMiniCpmPhoneOptions = {
  endpoint?: string;
  systemPrompt: string;
  onEvent?: (event: XumengMiniCpmEvent) => void;
  onLevel?: (rms: number) => void;
};

const CAPTURE_ASSET = "/assets/qingyu/live/minicpm-capture.js";

function toWebSocketUrl(endpoint = "/api/phone/ws"): string {
  const value = endpoint.trim();
  if (!value) throw new Error("MiniCPM 电话地址为空。");
  const url = new URL(value, window.location.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("MiniCPM 电话地址必须使用 WebSocket。");
  if (url.username || url.password || url.hash) throw new Error("MiniCPM 电话地址无效。");
  return url.href;
}

function audioBase64(values: Float32Array): string {
  const pcm = new Int16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const sample = Math.max(-1, Math.min(1, values[i]));
    pcm[i] = Math.round(sample * 32767);
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, bytes.length)));
  }
  return btoa(binary);
}

function parsedEvent(value: unknown): XumengMiniCpmEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" ? record as XumengMiniCpmEvent : null;
}

export class XumengMiniCpmPhone {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private muted = false;
  private closed = false;

  constructor(private readonly options: XumengMiniCpmPhoneOptions) {}

  get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  async start(): Promise<void> {
    if (this.socket || this.stream) throw new Error("MiniCPM 电话已经在通话中。");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风。");
    this.closed = false;
    const socket = new WebSocket(toWebSocketUrl(this.options.endpoint));
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { socket.close(); reject(error); };
      socket.onerror = () => fail(new Error("MiniCPM 电话连接失败，请稍后重试。"));
      socket.onopen = () => resolve();
    });
    if (this.closed) return;
    socket.onmessage = event => {
      try {
        const value = typeof event.data === "string" ? JSON.parse(event.data) : null;
        const parsed = parsedEvent(value);
        if (parsed) this.options.onEvent?.(parsed);
      } catch { this.options.onEvent?.({ type: "error", message: "MiniCPM 返回了无法识别的事件。" }); }
    };
    socket.onclose = () => { if (!this.closed) this.options.onEvent?.({ type: "closed" }); };
    socket.onerror = () => { if (!this.closed) this.options.onEvent?.({ type: "error", message: "MiniCPM 电话连接中断。" }); };
    this.send({ type: "init", system_prompt: this.options.systemPrompt.slice(0, 5000) });

    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.stream = stream;
    const context = new AudioContext({ sampleRate: 16000 });
    this.context = context;
    await context.resume();
    await context.audioWorklet.addModule(CAPTURE_ASSET);
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "qingyu-minicpm-capture");
    const sink = context.createGain(); sink.gain.value = 0;
    this.source = source; this.capture = capture; this.sink = sink;
    source.connect(capture); capture.connect(sink); sink.connect(context.destination);
    capture.port.onmessage = event => {
      const value = event.data as { audio?: Float32Array; rms?: number };
      if (typeof value.rms === "number") this.options.onLevel?.(value.rms);
      if (value.audio && this.connected && socket.bufferedAmount < 256_000) {
        this.send({ type: "audio", format: "pcm16", audio: audioBase64(value.audio) });
      }
    };
  }

  mute(value = !this.muted): void {
    this.muted = value;
    this.capture?.port.postMessage({ muted: value });
    this.send({ type: "speech", active: false });
  }

  interrupt(): void { this.send({ type: "interrupt" }); }

  stop(): void {
    this.closed = true;
    this.send({ type: "end" });
    const socket = this.socket; this.socket = null;
    try { socket?.close(1000, "user_stop"); } catch {}
    this.capture?.disconnect(); this.source?.disconnect(); this.sink?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.capture = null; this.source = null; this.sink = null; this.stream = null;
    const context = this.context; this.context = null;
    if (context && context.state !== "closed") void context.close();
  }

  private send(value: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }
}

export async function fetchXumengMiniCpmStatus(): Promise<{ available: boolean; configured: boolean; provider?: string }> {
  const response = await fetch("/api/phone/status", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return { available: false, configured: false };
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) return { available: false, configured: false };
  const record = value as Record<string, unknown>;
  return { available: record.available === true, configured: record.configured === true, provider: typeof record.provider === "string" ? record.provider : undefined };
}

export function buildXumengMiniCpmPrompt(persona: string, name: string, scene: string): string {
  const who = name.trim().slice(0, 40);
  return [
    who ? `你是${who}。电话已经接通，用自己的口吻把下一句说出来。` : "电话已经接通，用自己的口吻把下一句说出来。",
    persona.trim() ? persona.slice(0, 2200) : "",
    scene.trim() ? `此刻：${scene.slice(0, 400)}` : "",
    "只说你会说出口的话。不说自己是模型，不输出旁白、括号或系统说明。对方插话就停，听新的那句。一次只说一两句。",
  ].filter(Boolean).join("\n");
}

