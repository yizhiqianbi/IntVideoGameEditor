"use client";

/* eslint-disable @next/next/no-img-element -- Media URLs are emitted by the authenticated companion gateway. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./companion.module.css";
import { companionClockLabel, companionClockVisible } from "./companion-clock";
import { CLASSIC_STYLE, type CompanionStyle } from "./companion-style";
import { INTIMATE_STYLE } from "./intimate-style";
import { markChatSeen } from "./companion-inbox";
import { SALES_CUES, SALES_NUDGE, SALES_OPEN, SALES_STYLE } from "./sales-style";
import type { CompanionProfile } from "./companion-profiles";
import type { GirlfriendCast } from "./cast";
import { useGirlfriendPhotos } from "./companion-photos";
import { companionVisualScene } from "./companion-moment";
import { stripXumengMomentTails } from "../../../lib/xumeng-moment-status";
import { STUDIO_STILL_CREDITS } from "../../../lib/xumeng-studio-still-billing";

type MediaKind = "image" | "audio" | "emoji";
type MessageMedia = { kind: MediaKind; url?: string; alt?: string; label?: string; text?: string; mimeType?: string; durationMs?: number };
type Message = { id: string; role: "user" | "assistant"; text?: string; createdAt: string; requestId?: string; media?: unknown[]; attachments?: unknown[]; segments?: unknown[] };
type Receipt = { requestId: string; status: "sending" | "pending" | "accepted" | "complete" | "uncertain"; confirmed?: boolean };
type DeliveryReceipt = { requestId: string; sessionId: string; status: "pending" | "complete" | "uncertain"; confirmed?: boolean; billingStatus?: string };
type Conversation = { id: string; title: string; messages?: Message[]; receipts?: Receipt[]; connection?: string; status?: string; error?: string; style?: CompanionStyle };
type Pending = { requestId: string; text: string; createdAt: string; state: "queued" | "sending" | "accepted" | "failed" | "uncertain" };
type DisplayMessage = Message & { pendingState?: Pending["state"] };
type BootPhase = "container" | "controller" | "restore" | "native";
type Health = { runtime?: string; ready?: boolean; clientScope?: string; reason?: string; phase?: BootPhase };
type BillingOverview = { enabled: boolean; creditsPerMessage: 2; balance: number; reservedCredits: number };
type CompanionVariant = "classic" | "intimate" | "custom" | "sales" | "cast";
const API = "/api/xumeng/companion/api";
const INTIMATE_API = "/api/xumeng/companion-intimate/api";
const SALES_API = "/api/xumeng/companion-sales/api";
const SALES_COVER = "/assets/xumeng/exported-cards/foreverse-songzhixia-cover.png";
const apiBase = { current: API };
const PROACTIVE_IDLE_MS = 45_000;
const SALES_NUDGE_MS = 14_000;
const SALES_NUDGE_CAP = 4;
const BOOT_DEADLINE_MS = 180_000;
const BOOT_PHASE_TEXT: Record<BootPhase, string> = {
  container: "正在唤醒服务器",
  controller: "正在准备聊天环境",
  restore: "正在找回你们的聊天记忆",
  native: "她正在醒来",
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TRANSIENT_HEALTH_CODES = new Set([
  "ACCOUNT_UNAVAILABLE", "COMPANION_UNAVAILABLE", "CONTAINER_STARTING", "NATIVE_NOT_READY", "NATIVE_START_FAILED", "POOL_FULL",
]);
const RECOVERY_REVIEW_CODE = "RECOVERY_REVIEW_REQUIRED";
const LOGIN_REQUIRED_CODE = "LOGIN_REQUIRED";
const PREVIEW_UNAVAILABLE_CODE = "PREVIEW_UNAVAILABLE";

function stripStyle(value: string) {
  return value.replace(/^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n?/, "");
}

function displayTitle(title: string | undefined, person: string, intimate: boolean) {
  const value = title?.trim() || "";
  if (!value || value.includes("[XUMENG_PRIVATE_STYLE")) return `和${person}的聊天`;
  if ((intimate || person !== "Yume") && (value === "和 Yume 的聊天" || value === "和Yume的聊天")) return `和${person}的聊天`;
  return value;
}

function intimateIdsKey(scope: string) {
  return `xumeng-maibot:${scope}:intimate-sessions`;
}

function readIntimateIds(scope: string) {
  try {
    const value = JSON.parse(localStorage.getItem(intimateIdsKey(scope)) || "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function rememberIntimateSession(scope: string, id: string) {
  const ids = readIntimateIds(scope);
  ids.add(id);
  localStorage.setItem(intimateIdsKey(scope), JSON.stringify([...ids]));
}

type ViewCache = { scope?: string; sessions: Conversation[]; active: string | null; conversation: Conversation | null };

function viewCacheKey(lane: string) {
  return `xumeng-companion-cache:${lane}`;
}

function readViewCache(lane: string): ViewCache | null {
  try {
    const value = JSON.parse(localStorage.getItem(viewCacheKey(lane)) || "null");
    if (!value || typeof value !== "object") return null;
    const sessions = Array.isArray(value.sessions) ? value.sessions.filter((item: Conversation) => item && typeof item.id === "string") : [];
    const conversation = value.conversation && typeof value.conversation.id === "string" ? value.conversation as Conversation : null;
    const active = typeof value.active === "string" ? value.active : conversation?.id ?? sessions[0]?.id ?? null;
    return { scope: typeof value.scope === "string" ? value.scope : undefined, sessions, active, conversation };
  } catch {
    return null;
  }
}

/** Keep media rendering deliberately narrow: the companion service must never
 * turn a model-generated string into an executable URL. Data URLs are useful
 * for local development and are limited to image/audio base64 payloads. */
function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 8_000_000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^data:/i.test(value)) return /^data:(?:image|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value) ? value : null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value, "https://xumeng.local");
    if (url.username || url.password || url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "blob:") return null;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.toString();
    if (url.protocol === "https:" || (url.protocol === "http:" && value.startsWith("/"))) return url.toString();
  } catch { /* Invalid URLs are omitted from the transcript. */ }
  return null;
}

function mediaKind(value: unknown): MediaKind | null {
  const kind = typeof value === "string" ? value.toLowerCase() : "";
  if (["image", "photo", "picture", "img"].includes(kind)) return "image";
  if (["audio", "voice", "sound", "voice_message"].includes(kind)) return "audio";
  if (["emoji", "sticker", "emoticon"].includes(kind)) return "emoji";
  return null;
}

function mediaValue(value: unknown): MessageMedia | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const kind = mediaKind(item.kind ?? item.type ?? item.mediaType ?? item.mimeType?.toString().split("/")[0]);
  if (!kind) return null;
  const data = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : null;
  const base64 = item.base64 ?? data?.base64;
  const mimeType = item.mimeType ?? data?.mimeType;
  const encoded = typeof base64 === "string" && typeof mimeType === "string" ? `data:${mimeType};base64,${base64}` : null;
  const url = safeMediaUrl(item.url ?? item.src ?? item.uri ?? data?.url ?? data?.src ?? encoded ?? (typeof item.data === "string" ? item.data : null));
  const text = typeof item.text === "string" ? item.text : typeof item.emoji === "string" ? item.emoji : typeof data?.text === "string" ? data.text : undefined;
  if (!url && kind !== "emoji" && !text) return null;
  return {
    kind, ...(url ? { url } : {}),
    ...(typeof item.alt === "string" ? { alt: item.alt.slice(0, 240) } : {}),
    ...(typeof item.label === "string" ? { label: item.label.slice(0, 120) } : {}),
    ...(text ? { text: text.slice(0, 240) } : {}),
    ...(typeof mimeType === "string" ? { mimeType: mimeType.slice(0, 80) } : {}),
    ...(typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? { durationMs: item.durationMs } : {}),
  };
}

/** Accept the gateway's compact media array and native rich segments. Keeping
 * this adapter at the UI boundary lets the runtime evolve without changing
 * the transcript component. */
function normalizeMedia(message: Message): MessageMedia[] {
  const values: unknown[] = [...(Array.isArray(message.media) ? message.media : []), ...(Array.isArray(message.attachments) ? message.attachments : [])];
  for (const segment of Array.isArray(message.segments) ? message.segments : []) {
    if (segment && typeof segment === "object") {
      const item = segment as Record<string, unknown>;
      if (mediaKind(item.type) || mediaKind(item.kind) || mediaKind(item.mediaType)) values.push(segment);
    }
  }
  const seen = new Set<string>();
  return values.flatMap(value => {
    const item = mediaValue(value);
    if (!item) return [];
    const key = `${item.kind}:${item.url || item.text || ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [item];
  });
}

function PauseOtherAudio({ audioRef, mediaId }: { audioRef: { current: HTMLAudioElement | null }; mediaId: string }) {
  useEffect(() => {
    const pause = (event: Event) => {
      if ((event as CustomEvent).detail !== mediaId) audioRef.current?.pause();
    };
    document.addEventListener("xumeng-companion-audio-play", pause);
    return () => document.removeEventListener("xumeng-companion-audio-play", pause);
  }, [audioRef, mediaId]);
  return null;
}

function MessageMediaView({ items }: { items: MessageMedia[] }) {
  return <div className={styles.mediaList} aria-label="消息附件">
    {items.map((item, index) => <MessageMediaItem key={`${item.kind}:${item.url || item.text || index}`} item={item} index={index} />)}
  </div>;
}

function MessageMediaItem({ item, index }: { item: MessageMedia; index: number }) {
  const mediaId = `${item.kind}:${item.url || item.text || index}`;
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  if (item.kind === "emoji" && !item.url) {
    return <span className={styles.emoji} role="img" aria-label={item.label || "表情"}>{item.text || "🙂"}</span>;
  }
  if (!item.url || failed) {
    return <span className={styles.mediaUnavailable} role="status">{item.kind === "audio" ? "语音暂时无法播放" : item.kind === "image" ? "图片暂时无法显示" : "表情暂时无法显示"}</span>;
  }
  if (item.kind === "image") {
    return <figure className={styles.picture}>
      <img src={item.url} alt={item.alt || item.label || "Yume 发来的照片"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      {item.label && <figcaption>{item.label}</figcaption>}
    </figure>;
  }
  if (item.kind === "emoji") {
    return <span className={styles.sticker}><img src={item.url} alt={item.alt || item.label || "表情包"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></span>;
  }
  return <div className={styles.voice}>
    <div className={styles.voiceTitle}><span aria-hidden="true">♫</span><span>{item.label || "Yume 的语音"}</span></div>
    <audio ref={audio} src={item.url} controls preload="metadata" aria-label={item.label || "Yume 的语音消息"}
      onPlay={() => { setFailed(false); document.dispatchEvent(new CustomEvent("xumeng-companion-audio-play", { detail: mediaId })); }}
      onError={() => setFailed(true)} />
    <PauseOtherAudio audioRef={audio} mediaId={mediaId} />
  </div>;
}

function restorePending(key: string): Pending[] {
  const value: unknown = JSON.parse(localStorage.getItem(`${key}:pending`) || "[]");
  if (!Array.isArray(value)) throw new Error("无法读取这段对话的待发送消息，请保留页面后重试。");
  const seen = new Set<string>();
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || !UUID.test(item.requestId || "") || seen.has(item.requestId)
      || typeof item.text !== "string" || !item.text.trim() || item.text.length > 4000
      || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))
      || !["queued", "sending", "accepted", "failed", "uncertain"].includes(item.state)) return [];
    seen.add(item.requestId);
    // Refresh does not prove failure: the previous request may have reached MaiBot.
    return [{ requestId: item.requestId, text: item.text, createdAt: item.createdAt, state: item.state === "sending" ? "uncertain" : item.state } as Pending];
  });
}

function errorCode(value: unknown): string | undefined {
  return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : undefined;
}

function bootPhase(value: unknown): BootPhase | undefined {
  const phase = value && typeof value === "object" && "phase" in value ? value.phase : undefined;
  return typeof phase === "string" && phase in BOOT_PHASE_TEXT ? phase as BootPhase : undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

function aborted(value: unknown) {
  return value instanceof Error && value.name === "AbortError";
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal, method: "POST" | "PUT" = "POST"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase.current}${path}`, {
      method: body === undefined ? "GET" : method, cache: "no-store", signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (failure) {
    if (signal?.aborted || aborted(failure)) throw failure;
    throw Object.assign(new Error("聊天服务暂时不可用，请稍后重试。"), { code: "COMPANION_UNAVAILABLE" });
  }
  let data: { error?: string; code?: string; phase?: BootPhase } | null = null;
  try { data = await response.json(); }
  catch (failure) {
    if (signal?.aborted || aborted(failure)) throw failure;
    throw Object.assign(new Error("聊天服务暂时不可用，请稍后重试。"), { code: "COMPANION_UNAVAILABLE" });
  }
  if (!response.ok) throw Object.assign(new Error(data?.error || "暂时连接不上，请稍后重试。"), { code: data?.code, phase: data?.phase });
  return data as T;
}

function holdKey(lane: string) {
  return `xumeng-companion-hold:${lane}`;
}

function readHold(lane: string): { draft: string; queued: Pending[] } {
  try {
    const value = JSON.parse(localStorage.getItem(holdKey(lane)) || "null");
    const queued = Array.isArray(value?.queued) ? restorePendingItems(value.queued) : [];
    const draft = typeof value?.draft === "string" ? value.draft.slice(0, 4000) : "";
    return { draft, queued };
  } catch {
    return { draft: "", queued: [] };
  }
}

function writeHold(lane: string, hold: { draft: string; queued: Pending[] }) {
  localStorage.setItem(holdKey(lane), JSON.stringify({ draft: hold.draft, queued: hold.queued }));
}

function restorePendingItems(value: unknown): Pending[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || !UUID.test(item.requestId || "") || seen.has(item.requestId)
      || typeof item.text !== "string" || !item.text.trim() || item.text.length > 4000
      || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) return [];
    seen.add(item.requestId);
    return [{ requestId: item.requestId, text: item.text, createdAt: item.createdAt, state: "queued" } satisfies Pending];
  });
}

export default function CompanionPage({ onBack, onLogin, onCall, variant = "classic", avatar, profile, cast }: { onBack?: () => void; onLogin?: () => void; onCall?: () => void; variant?: CompanionVariant; avatar?: string; profile?: CompanionProfile; cast?: GirlfriendCast }) {
  const intimate = variant === "intimate";
  const sales = variant === "sales";
  const lane = cast ? `cast-${cast.id}` : sales ? "sales" : intimate ? "intimate" : "classic";
  const name = cast?.name || profile?.name || (sales ? "沈盼" : intimate ? "晚宁" : "Yume");
  const avatarUrl = avatar || cast?.cover || profile?.cover || (sales ? SALES_COVER : intimate ? "/assets/xumeng/content-covers/wanning.jpg" : "/assets/xumeng/content-covers/yume.jpg");
  apiBase.current = cast ? `/api/xumeng/companion-cast/${cast.id}/api` : sales ? SALES_API : intimate ? INTIMATE_API : API;
  const cachedView = useRef(readViewCache(lane));
  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<Conversation[]>(() => cachedView.current?.sessions ?? []);
  const [active, setActive] = useState<string | null>(() => cachedView.current?.active ?? null);
  const [conversation, setConversation] = useState<Conversation | null>(() => cachedView.current?.conversation ?? null);
  const [draft, setDraft] = useState(() => readHold(lane).draft);
  const [held, setHeld] = useState<Pending[]>(() => readHold(lane).queued);
  const [idleTyping, setIdleTyping] = useState(false);
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const presetStyle = cast?.style || (sales ? SALES_STYLE : profile?.style || (intimate ? INTIMATE_STYLE : CLASSIC_STYLE));
  const openingSales = useRef(false);
  const nudgeFails = useRef(0);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [boot, setBoot] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [mediaTrayOpen, setMediaTrayOpen] = useState(false);
  const [, setBootStartedAt] = useState<number | null>(null);
  const inFlight = useRef(new Set<string>());
  const pendingRef = useRef<Record<string, Pending[]>>({});
  const log = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followBottom = useRef(true);
  // The cached scope lets drafts and queued messages work while she is still waking up.
  const scope = health?.clientScope ?? cachedView.current?.scope;
  const storage = scope ? `xumeng-maibot:${scope}` : null;
  const ready = health?.ready === true;
  const pendingKey = active && storage ? `${storage}:${active}` : null;

  const updatePending = useCallback((key: string, update: (items: Pending[]) => Pending[]) => {
    const next = update(pendingRef.current[key] || []);
    try {
      // Persist before clearing a draft or submitting a request, so a refresh
      // never destroys an unsent segment. Keys include both owner and session.
      localStorage.setItem(`${key}:pending`, JSON.stringify(next));
      pendingRef.current[key] = next;
      setPending(previous => ({ ...previous, [key]: next }));
      return true;
    } catch {
      setError("这条消息暂时无法保存在本机，请保留输入内容后重试。");
      return false;
    }
  }, []);

  useEffect(() => {
    setBootStartedAt(Date.now());
    const controller = new AbortController();
    (async () => {
      const deadline = Date.now() + BOOT_DEADLINE_MS;
      try {
        for (;;) {
          try {
            const status = await request<Health>("/health", undefined, controller.signal);
            if (status.runtime !== "maibot-native") throw Object.assign(new Error("聊天服务暂时不可用，请稍后重试。"), { code: "COMPANION_UNAVAILABLE" });
            if (!status.ready) {
              if (Date.now() > deadline) throw Object.assign(new Error("聊天服务启动时间过长，请稍后重试。"), { code: "CONTAINER_STARTING" });
              setHealth({ ...status, reason: status.reason || "starting" });
              setError("");
              await sleep(1000, controller.signal);
              continue;
            }
            setHealth(status);
            setBootStartedAt(null);
            setError("");
            const [overview, result] = await Promise.all([
              request<BillingOverview>("/billing", undefined, controller.signal).catch(() => null),
              request<{ sessions: Conversation[] }>("/sessions", undefined, controller.signal),
            ]);
            if (overview) setBilling(overview);
            const cached = readViewCache(lane);
            if (cached?.scope && status.clientScope && cached.scope !== status.clientScope) {
              localStorage.removeItem(viewCacheKey(lane));
              setConversation(null);
            }
            if (intimate && status.clientScope) for (const item of result.sessions) rememberIntimateSession(status.clientScope, item.id);
            setSessions(result.sessions);
            const saved = localStorage.getItem(`xumeng-maibot:${status.clientScope}:${intimate ? "intimate-active" : "active"}`);
            const chosen = result.sessions.some(item => item.id === saved) ? saved : result.sessions[0]?.id ?? null;
            const chosenSession = result.sessions.find(item => item.id === chosen);
            setActive(chosen);
            if (chosenSession?.messages?.length) setConversation(previous => previous?.id === chosen && (previous.messages?.length || 0) >= chosenSession.messages!.length ? previous : chosenSession);
            setError("");
            break;
          } catch (failure) {
            const code = errorCode(failure);
            if (!controller.signal.aborted && code && TRANSIENT_HEALTH_CODES.has(code) && Date.now() < deadline) {
              setHealth({ ready: false, reason: "starting", phase: bootPhase(failure) });
              setError("");
              await sleep(1000, controller.signal);
              continue;
            }
            throw failure;
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setBootStartedAt(previous => previous ?? Date.now());
          const code = errorCode(failure);
          setHealth({ ready: false, reason: code || "unavailable" });
        }
      }
    })();
    return () => controller.abort();
  }, [boot, lane]);

  useEffect(() => {
    if (!active || !storage) return;
    const key = `${storage}:${active}`;
    try {
      localStorage.setItem(intimate ? `${storage}:intimate-active` : `${storage}:active`, active);
      if (!pendingRef.current[key]) updatePending(key, () => restorePending(key));
      const heldNow = readHold(lane);
      if (heldNow.queued.length) {
        updatePending(key, items => {
          const ids = new Set(items.map(item => item.requestId));
          return [...items, ...heldNow.queued.filter(item => !ids.has(item.requestId))];
        });
        writeHold(lane, { draft: "", queued: [] });
        setHeld([]);
      }
      setDraft(localStorage.getItem(`${key}:draft`) || heldNow.draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法读取本机草稿。");
    }
    // A failed health check must not wipe the transcript already stored on this device.
    if (!ready) return;
    setConversation(previous => previous?.id === active ? previous : null);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request<{ session: Conversation }>(`/sessions/${active}`, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setConversation(result.session);
          setSyncError("");
          setSessions(previous => previous.map(item => item.id === active ? { ...item, title: displayTitle(result.session.title, name, intimate) } : item));
          updatePending(key, items => items.flatMap(item => {
            if (result.session.messages?.some(message => message.id === item.requestId || message.requestId === item.requestId)) return [];
            const receipt = result.session.receipts?.find(value => value.requestId === item.requestId);
            // Session polling also performs the host's read-only durable
            // receipt reconciliation.  Once the host has positive evidence,
            // remove the optimistic bubble instead of leaving the composer
            // locked in "同步记录中".  The transcript now owns the message;
            // no retry or second Credit hold is involved.
            if (receipt?.status === "complete" || receipt?.confirmed) return [];
            if (receipt?.status === "accepted") return [{ ...item, state: "accepted" }];
            if (receipt?.status === "uncertain") return [{ ...item, state: "uncertain" }];
            return [item];
          }));
          const stillUncertain = (pendingRef.current[key] || []).some(item => item.state === "uncertain");
          if (!stillUncertain) setError(current => current.includes("送达") ? "" : current);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setSyncError(failure instanceof Error ? failure.message : "读取消息失败。");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, document.visibilityState === "visible" ? 1000 : 5000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, intimate, lane, ready, storage, updatePending]);

  useEffect(() => {
    if (!health?.clientScope || (!sessions.length && !conversation)) return;
    try {
      const savedConversation = conversation ? {
        ...conversation,
        messages: (conversation.messages || []).slice(-80).map(({ media, attachments, segments, ...message }) => message),
      } : null;
      localStorage.setItem(viewCacheKey(lane), JSON.stringify({
        scope: health.clientScope,
        sessions: sessions.map(item => ({ id: item.id, title: displayTitle(item.title, name, intimate) })),
        active,
        conversation: savedConversation,
      } satisfies ViewCache));
      markChatSeen(lane);
    } catch { /* A full disk must not block the open transcript. */ }
  }, [active, conversation, health?.clientScope, lane, name, sessions]);

  const pendingItems = useMemo(() => {
    const stored = pendingKey ? pending[pendingKey] || [] : [];
    const ids = new Set(stored.map(item => item.requestId));
    return [...stored, ...held.filter(item => !ids.has(item.requestId))];
  }, [held, pending, pendingKey]);
  const pendingCount = pendingItems.length;
  // Sending is intentionally not a lock.  A person can type three short
  // fragments in a row while the first one is still travelling; the native
  // host serializes those requests and preserves their order.  Only an
  // ambiguous delivery is a hard stop because retrying it could duplicate a
  // charged message.
  const deliveryBlocked = pendingItems.some(item => item.state === "uncertain");
  // Merge optimistic user bubbles into the transcript by time.  Rendering
  // every pending fragment after the latest assistant reply made segmented
  // input look as if the user had sent it out of order.
  const visibleMessages = useMemo<DisplayMessage[]>(() => {
    const existing: DisplayMessage[] = conversation?.messages || [];
    const pendingMessages = pendingItems
      .filter(item => !existing.some(message => message.requestId === item.requestId || message.id === item.requestId))
      .map(item => ({ id: item.requestId, role: "user" as const, text: item.text, createdAt: item.createdAt, requestId: item.requestId, pendingState: item.state } satisfies DisplayMessage));
    return [...existing, ...pendingMessages].sort((left, right) => {
      const time = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return time || left.id.localeCompare(right.id);
    });
  }, [conversation?.messages, pendingItems]);

  const latestUser = useMemo(() => [...visibleMessages].reverse().find(message => message.role === "user" && !message.pendingState), [visibleMessages]);
  const lanePhotoKey = `xumeng-companion-photos:${lane}`;
  const photoKey = pendingKey ? `${pendingKey}:photos` : lanePhotoKey;
  const photos = useGirlfriendPhotos(photoKey, pendingKey ? lanePhotoKey : null);
  useEffect(() => { markChatSeen(lane); }, [lane, photos.photos]);
  const scene = companionVisualScene({ situation: cast?.situation || profile?.situation, messages: visibleMessages });
  const latestUserId = latestUser?.id || null;

  useEffect(() => {
    if (sales || !active || !health?.ready || pendingItems.length > 0) return;
    const nudge = () => {
      void request(`/sessions/${active}/proactive`, {
        ...(latestUserId ? { userMessageId: latestUserId } : {}),
        intent: intimate
          ? "用户在上一轮之后停住了。请查看最近聊天，判断这次是否值得自然主动开口；没有新鲜内容就保持安静。若主动，只发一条符合当前恋人私聊和已发生关系的消息，可以想他、接上一句，或轻轻把话题往亲近处带，但不要突然开始未发生的性行为，不要质问，不要重复上一轮。对方刚说过停、忙、晚安或不想，就保持安静。"
          : "用户在上一轮之后停住了。请查看最近聊天和关系状态，判断这次是否值得自然主动开口；如果没有新鲜且合适的内容就保持安静。若主动，只发一条带新信息的分享、想念、轻撒娇或对上一句的自然延续，不要质问，不要使用‘你怎么不理我’，不要重复上一轮，也要尊重用户刚说过的忙、晚安或需要空间。",
        reason: "private_chat_quiet_window",
        metadata: { sessionId: active, source: "xumeng-girlfriend" },
      }).catch(() => { /* A failed native nudge must never surface as a fake message. */ });
    };
    const timer = window.setInterval(nudge, PROACTIVE_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [active, health?.ready, intimate, pendingItems.length, latestUserId, sales]);

  const deskOn = Boolean(health) && health?.reason !== LOGIN_REQUIRED_CODE;
  useEffect(() => {
    if (!deskOn) return;
    const pull = () => {
      if (document.visibilityState === "hidden") return;
      void request("/presence", {}).catch(() => {});
    };
    pull();
    const timer = window.setInterval(pull, 60_000);
    const onShow = () => { if (document.visibilityState === "visible") pull(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [deskOn, lane]);

  const waitingReply = ready && pendingItems.some(item => item.state === "sending" || item.state === "accepted");
  const waitingReplyRef = useRef(false);
  waitingReplyRef.current = waitingReply;
  const showTyping = ready && (waitingReply || idleTyping);
  useEffect(() => {
    if (!ready) { setIdleTyping(false); return; }
    let cancelled = false;
    let waitTimer = 0;
    let showTimer = 0;
    const schedule = (first = false) => {
      waitTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState !== "visible" || waitingReplyRef.current || Math.random() > 0.6) { schedule(); return; }
        setIdleTyping(true);
        showTimer = window.setTimeout(() => {
          if (!cancelled) setIdleTyping(false);
          schedule();
        }, 1500 + Math.random() * 1200);
      }, (first ? 7000 : 18000) + Math.random() * (first ? 5000 : 16000));
    };
    schedule(true);
    return () => { cancelled = true; window.clearTimeout(waitTimer); window.clearTimeout(showTimer); };
  }, [ready, active]);
  useEffect(() => {
    if (followBottom.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [conversation?.messages?.length, active, pendingCount, photos.photos.length, showTyping]);

  const send = useCallback(async (sessionId: string, item: Pending, key: string): Promise<boolean> => {
    if (inFlight.current.has(item.requestId)) return false;
    if (!updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "sending" } : existing))) return false;
    inFlight.current.add(item.requestId);
    try {
      await request(`/sessions/${sessionId}/messages`, { text: item.text, requestId: item.requestId });
      if (updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "accepted" } : existing))) setError("");
      return true;
      // Keep the optimistic bubble until native history has the original ID.
      // A timeout never automatically resends a possibly accepted message.
    } catch (failure) {
      const code = failure && typeof failure === "object" && "code" in failure ? failure.code : undefined;
      const uncertain = !code || ["DELIVERY_UNCERTAIN", "NATIVE_ACK_TIMEOUT", "NATIVE_OFFLINE"].includes(String(code));
      updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: uncertain ? "uncertain" : "failed" } : existing));
      setError(failure instanceof Error ? failure.message : "消息没能送达。");
      return false;
    } finally { inFlight.current.delete(item.requestId); }
  }, [updatePending]);

  useEffect(() => {
    if (!sales || !active || !ready || !pendingKey || deliveryBlocked) return;
    const failed = pendingItems.filter(item => SALES_CUES.has(item.text.trim()) && item.state === "failed");
    if (failed.length) {
      nudgeFails.current += 1;
      updatePending(pendingKey, items => items.filter(item => !failed.some(cue => cue.requestId === item.requestId)));
      return;
    }
    if (nudgeFails.current >= 2 || pendingItems.length > 0 || draft.trim()) return;
    const messages = conversation?.messages || [];
    const lastReal = [...messages].reverse().find(message => message.role === "user" && !SALES_CUES.has((message.text || "").trim()));
    if (lastReal && /停|别发|别烦|不买|不用|晚安|先忙|我忙/.test(lastReal.text || "")) return;
    const start = lastReal ? messages.findIndex(message => message.id === lastReal.id) + 1 : 0;
    const cues = messages.slice(start).filter(message => message.role === "user" && SALES_CUES.has((message.text || "").trim())).length;
    if (cues >= SALES_NUDGE_CAP) return;
    const last = messages[messages.length - 1];
    if (messages.length > 0 && last?.role !== "assistant") return;
    const text = messages.length === 0 ? SALES_OPEN : SALES_NUDGE;
    const timer = window.setTimeout(() => {
      const item: Pending = { requestId: crypto.randomUUID(), text, createdAt: new Date().toISOString(), state: "sending" };
      if (!updatePending(pendingKey, items => [...items, item])) return;
      void send(active, item, pendingKey);
    }, messages.length === 0 ? 800 : SALES_NUDGE_MS);
    return () => window.clearTimeout(timer);
  }, [active, conversation?.messages, deliveryBlocked, draft, pendingItems, pendingKey, ready, sales, send, updatePending]);

  const flushing = useRef(false);
  useEffect(() => {
    if (!ready || !active || !pendingKey || flushing.current || !pendingItems.some(item => item.state === "queued")) return;
    if (pendingItems.some(item => item.state === "failed" || item.state === "uncertain")) return;
    flushing.current = true;
    void (async () => {
      try {
        // One at a time, oldest first, so queued fragments keep their order;
        // the rest stay queued after a failure instead of overtaking it.
        for (const item of pendingItems.filter(value => value.state === "queued")) {
          if (!await send(active, item, pendingKey)) break;
        }
      } finally { flushing.current = false; }
    })();
  }, [active, pendingItems, pendingKey, ready, send]);

  // An uncertain receipt is durable evidence that the native bridge may have
  // accepted the message. Re-posting the same request id only produces a
  // DELIVERY_UNCERTAIN conflict, so the recovery control must perform a
  // read-only session check first. This keeps the UI aligned with the
  // "暂勿重复发送" warning and avoids another model call or Credit hold.
  const checkDelivery = useCallback(async (sessionId: string, item: Pending, key: string) => {
    const checkKey = `check:${item.requestId}`;
    if (inFlight.current.has(checkKey)) return;
    inFlight.current.add(checkKey);
    try {
      // Read the durable host receipt first. Native history does not always
      // preserve the browser requestId, while this endpoint is account/session
      // scoped and never retries or exposes message text/billing tokens.
      const receipt = (await request<{ receipt: DeliveryReceipt }>(`/sessions/${sessionId}/receipts/${item.requestId}`)).receipt;
      if (receipt.status === "complete" || receipt.confirmed) {
        updatePending(key, items => items.filter(existing => existing.requestId !== item.requestId));
        setError("");
      } else {
        // No positive delivery evidence means the request stays uncertain;
        // never downgrade it to failed or create a new request automatically.
        updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "uncertain" } : existing));
        setError("送达记录仍未确认，请稍后再检查，暂勿重复发送。");
      }
      // Refresh the transcript after the receipt read so a completed request
      // appears as a normal message instead of a stale optimistic bubble.
      const result = await request<{ session: Conversation }>(`/sessions/${sessionId}`);
      setConversation(result.session);
      setSyncError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "聊天记录暂时无法读取，请稍后再检查。");
    } finally { inFlight.current.delete(checkKey); }
  }, [updatePending]);

  async function createConversation() {
    setCreating(true);
    try {
      const result = await request<{ session: Conversation }>("/sessions", { characterId: "yume", requestId: crypto.randomUUID(), style: presetStyle });
      if (intimate && health?.clientScope) rememberIntimateSession(health.clientScope, result.session.id);
      setSessions(previous => [result.session, ...previous]);
      followBottom.current = true;
      setActive(result.session.id); setError(""); setMenuOpen(false);
      composer.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "暂时无法开始聊天。"); }
    finally { setCreating(false); }
  }

  useEffect(() => {
    if (!ready || active || sessions.length || creating || openingSales.current) return;
    if (health?.reason === LOGIN_REQUIRED_CODE || health?.reason === RECOVERY_REVIEW_CODE || health?.reason === PREVIEW_UNAVAILABLE_CODE) return;
    openingSales.current = true;
    void createConversation();
  }, [active, creating, health?.reason, ready, sessions.length]);

  async function abandonAndRebuild() {
    if (!window.confirm(`这会放弃当前异常的${name}实例并开始一段空白聊天。旧审计记录会保留，但当前聊天内容不会自动恢复。继续吗？`)) return;
    setResetting(true); setError("");
    try {
      await request("/reset", { confirmation: "discard-current-instance" });
      setSessions([]); setActive(null); setConversation(null); setHealth({ ready: false, reason: "starting" });
      setBoot(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `暂时无法重建${name}。`);
    } finally { setResetting(false); }
  }

  function queueLocally(text: string) {
    const item: Pending = { requestId: crypto.randomUUID(), text, createdAt: new Date().toISOString(), state: "queued" };
    const next = [...readHold(lane).queued, item];
    try { writeHold(lane, { draft: "", queued: next }); }
    catch { setError("这条消息暂时无法保存在本机，请保留输入内容后重试。"); return; }
    setHeld(next);
    followBottom.current = true;
    setDraft("");
    composer.current?.focus();
  }

  function submit() {
    if (health?.reason === LOGIN_REQUIRED_CODE) { onLogin?.(); return; }
    if (!draft.trim() || deliveryBlocked || health?.reason === RECOVERY_REVIEW_CODE) {
      if (deliveryBlocked) setError("已有消息的送达结果尚未确认，请先检查聊天记录，暂勿重复发送。");
      return;
    }
    const text = draft.trim();
    if (!active || !pendingKey) { queueLocally(text); return; }
    // While she is waking up the message waits locally; it has never left the
    // browser, so sending it later cannot duplicate a delivery.
    const item: Pending = { requestId: crypto.randomUUID(), text, createdAt: new Date().toISOString(), state: ready ? "sending" : "queued" };
    if (!updatePending(pendingKey, items => [...items, item])) return;
    followBottom.current = true;
    setDraft("");
    if (storage) localStorage.removeItem(`${storage}:${active}:draft`);
    if (ready) void send(active, item, pendingKey);
    composer.current?.focus();
  }

  const busy = !ready && health?.reason !== LOGIN_REQUIRED_CODE;
  const presence = showTyping ? "对方正在输入" : busy ? "忙碌中" : "";
  const openingLine = cast?.situation || profile?.situation || (sales ? "她会先发一条。" : "想说的，直接发给她。");
  return <section className={styles.chat} aria-label={`与${name}聊天`}>
        <header className={styles.chatHeader}>
          {onBack && <button className={styles.mobileBack} aria-label="返回聊天列表" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>}
          <div className={styles.identity}><h1>{name}</h1>{presence && <p className={styles.presence}>{presence}</p>}</div>
          <div className={styles.menuWrap}>
            <button type="button" className={styles.menuButton} aria-label="更多" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
            </button>
            {menuOpen && <><button type="button" className={styles.menuBackdrop} aria-label="关闭菜单" onClick={() => setMenuOpen(false)} /><div className={styles.menuPanel}>
              <select className={styles.historySelect} aria-label={`选择与${name}的历史对话`} value={active || ""} disabled={!sessions.length} onChange={event => { followBottom.current = true; setActive(event.target.value); setMenuOpen(false); }}>
                {!active && <option value="">聊天记录</option>}
                {sessions.map(item => <option key={item.id} value={item.id}>{displayTitle(item.title, name, intimate)}</option>)}
              </select>
              <button type="button" className={styles.menuItem} disabled={!health?.ready || creating} onClick={() => void createConversation()}>{creating ? "正在开始…" : "新聊天"}</button>
              {health?.reason === RECOVERY_REVIEW_CODE && <button type="button" className={styles.menuItem} disabled={resetting} onClick={() => void abandonAndRebuild()}>{resetting ? "正在重建…" : "放弃这段异常聊天"}</button>}
            </div></>}
          </div>
        </header>
        <div ref={log} className={styles.timeline} role="log" aria-label="聊天消息" aria-live="polite" onScroll={event => { const element = event.currentTarget; followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }}>
          <figure className={styles.coverCard}><img src={avatarUrl} alt="" /></figure>
          {!visibleMessages.length && !photos.photos.length && <p className={styles.startNote}>{openingLine}</p>}
            {[
              ...visibleMessages.filter(message => !(message.role === "user" && SALES_CUES.has((message.text || "").trim()))).map(message => ({ kind: "message" as const, id: message.id, at: Date.parse(message.createdAt) || 0, message })),
              ...photos.photos.map(photo => ({ kind: "photo" as const, id: photo.id, at: Date.parse(photo.createdAt) || 0, photo })),
            ].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)).map((entry, index, shown) => {
              const previous = shown[index - 1];
              const previousAt = previous ? (previous.kind === "photo" ? previous.photo.createdAt : previous.message.createdAt) : undefined;
              const createdAt = entry.kind === "photo" ? entry.photo.createdAt : entry.message.createdAt;
              const stamp = companionClockVisible(createdAt, previousAt) ? companionClockLabel(createdAt) : "";
              if (entry.kind === "photo") {
                return <Fragment key={entry.id}>
                  {stamp && <p className={styles.stamp}><time dateTime={createdAt}>{stamp}</time></p>}
                  <article className={`${styles.message} ${styles.hers}`} aria-label={`${name}发来的照片`}>
                    <span className={styles.smallAvatar} aria-hidden="true"><img src={avatarUrl} alt="" /></span>
                    <div><figure className={styles.picture}><img src={entry.photo.url} alt={`${name}发来的照片`} /></figure></div>
                  </article>
                </Fragment>;
              }
              const message = entry.message;
              const media = normalizeMedia(message);
              const pendingItem = message.pendingState && message.requestId && typeof message.text === "string"
                ? { requestId: message.requestId, text: message.text, createdAt: message.createdAt, state: message.pendingState } satisfies Pending
                : null;
              return <Fragment key={message.id}>
                {stamp && <p className={styles.stamp}><time dateTime={createdAt}>{stamp}</time></p>}
                <article className={`${styles.message} ${message.role === "user" ? styles.mine : styles.hers}${message.pendingState && message.pendingState !== "uncertain" && message.pendingState !== "failed" ? ` ${styles.pending}` : ""}`} aria-label={message.role === "user" ? "你的消息" : `${name}的回复`}>
                  {message.role === "assistant" && <span className={styles.smallAvatar} aria-hidden="true"><img src={avatarUrl} alt="" /></span>}
                  <div>{message.text && <p>{stripXumengMomentTails(stripStyle(message.text))}</p>}{media.length > 0 && <MessageMediaView items={media} />}{(message.pendingState === "uncertain" || message.pendingState === "failed") && active && <small className={styles.delivery}>{message.pendingState === "uncertain"
                    ? <button disabled={!pendingItem} onClick={() => pendingKey && pendingItem && void checkDelivery(active, pendingItem, pendingKey)}>送达待确认 · 检查记录</button>
                    : <button disabled={!pendingItem} onClick={() => pendingKey && pendingItem && void send(active, pendingItem, pendingKey)}>发送失败 · 重试</button>}</small>}</div>
                </article>
              </Fragment>;
            })}
            {showTyping && <article className={`${styles.message} ${styles.hers}`} aria-label="对方正在输入">
              <span className={styles.smallAvatar} aria-hidden="true"><img src={avatarUrl} alt="" /></span>
              <div><p className={styles.typingBubble}><span /><span /><span /></p></div>
            </article>}
            {conversation?.error && <div className={styles.error} role="alert">{conversation.error}</div>}
          <div ref={bottom} />
        </div>
        {(syncError || (error && (health?.ready || Boolean(conversation?.messages?.length)))) && <div className={styles.error} role="alert">{error || syncError}<button aria-label="关闭提示" onClick={() => { setError(""); setSyncError(""); }}>×</button></div>}
        <>
          <div className={styles.dock}>
            <button type="button" aria-pressed={mediaTrayOpen} onClick={() => setMediaTrayOpen(value => !value)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="m4 16 4.2-3.4a1 1 0 0 1 1.3.05L13 15.5l1.6-1.3a1 1 0 0 1 1.3.02L20.5 17" /></svg>
              相册
            </button>
            <button type="button" disabled={!onCall} onClick={onCall}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 10.5v3M7.5 8v8M11 5.5v13M14.5 8v8M18 10.5v3" strokeLinecap="round" /></svg>
              听听
            </button>
            <button type="button" onClick={() => log.current?.scrollTo({ top: 0, behavior: "smooth" })}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5.5 19.5c1.2-3 3.5-4.5 6.5-4.5s5.3 1.5 6.5 4.5" strokeLinecap="round" /></svg>
              个人
            </button>
          </div>
          {mediaTrayOpen && <div className={styles.mediaTray} role="status">
            <div className={styles.mediaTrayHead}><strong>相册</strong><span>按她现在的状态出一张，用封面当参考。一张 {STUDIO_STILL_CREDITS} Credit。</span></div>
            {photos.photos.length > 0 && <div className={styles.stillGrid}>{photos.photos.map(photo => <img key={photo.id} src={photo.url} alt={`${name}发来的照片`} />)}</div>}
            {photos.note && <p>{photos.note}</p>}
            <div className={styles.mediaTrayActions}>
              <button type="button" disabled={photos.busy || health?.reason === LOGIN_REQUIRED_CODE} onClick={() => void photos.shoot(avatarUrl, scene)}>{photos.busy ? "正在出图…" : "让她发一张"}</button>
              <button type="button" onClick={() => setMediaTrayOpen(false)}>收起</button>
            </div>
          </div>}
          <form className={styles.composer} onSubmit={event => { event.preventDefault(); submit(); }}>
            <div className={styles.composerBox}><textarea ref={composer} aria-label="消息" placeholder={health?.reason === LOGIN_REQUIRED_CODE ? "先登录，再跟她说" : health?.reason === RECOVERY_REVIEW_CODE ? "她这会儿忙" : cast?.placeholder || (sales ? "回她一句，或者让她继续说…" : intimate ? "想靠近，就直接说…" : "想说什么，就发给她…")} maxLength={4000} rows={1} value={draft} disabled={health?.reason === RECOVERY_REVIEW_CODE}
              onChange={event => {
                setDraft(event.target.value);
                if (storage && active) localStorage.setItem(`${storage}:${active}:draft`, event.target.value);
                else { const current = readHold(lane); try { writeHold(lane, { ...current, draft: event.target.value }); } catch { /* A full disk still leaves the draft on screen. */ } }
              }}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
            <button className={styles.send} type="submit" disabled={health?.reason === LOGIN_REQUIRED_CODE ? false : !draft.trim() || deliveryBlocked || health?.reason === RECOVERY_REVIEW_CODE}>{health?.reason === LOGIN_REQUIRED_CODE ? "登录" : deliveryBlocked ? "待确认" : "发送"}</button></div>
            {deliveryBlocked && <div className={styles.composerHint}><span>有一条消息的送达结果待确认，请先检查记录</span></div>}
          </form>
        </>
      </section>;
}
