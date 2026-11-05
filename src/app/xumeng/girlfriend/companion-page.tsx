"use client";

/* eslint-disable @next/next/no-img-element -- Media URLs are emitted by the authenticated companion gateway. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./companion.module.css";
import { CompanionSender, CompanionTranscript, type CompanionSenderHandle, type CompanionTranscriptItem } from "./companion-thread";
import { applyCompanionSession, mergeCompanionMessages, openingPreface, pickCompanionSession, type PrefaceLatch } from "./companion-thread-items";
import { CLASSIC_LINES, CLASSIC_STYLE, type CompanionStyle } from "./companion-style";
import { INTIMATE_LINES, INTIMATE_STYLE } from "./intimate-style";
import { clearPersonTranscript, dropUnscopedCompanionCache, markChatSeen, publishCompanionTranscript, readInbox, readPersonTranscript } from "./companion-inbox";
import { SALES_CUES, SALES_LINES, SALES_NUDGE, SALES_OPEN, SALES_STYLE } from "./sales-style";
import type { CompanionProfile } from "./companion-profiles";
import type { GirlfriendCast } from "./cast";
import { useGirlfriendPhotos } from "./companion-photos";
import { companionVisualScene } from "./companion-moment";
import { assistantRepliedAfter, generationStillOpen, nextCompanionPollDelay, nextHealthRetryDelay, nextSendRetryDelay, quietSessionPoll, REPLY_GRACE_MS, recoveryFacts, retryAfterMs, sendAttemptLimit, shouldWakeParked } from "./companion-poll";
import { stripXumengMomentTails } from "../../../lib/xumeng-moment-status";
import { XUMENG_CALLS_ENABLED } from "../../../lib/xumeng-feature-availability";
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
type Health = { runtime?: string; ready?: boolean; parked?: boolean; clientScope?: string; reason?: string; phase?: BootPhase; snapshotVerified?: boolean; deliveryAmbiguous?: boolean };
type BillingOverview = { enabled: boolean; creditsPerMessage: 2; balance: number; reservedCredits: number };
type CompanionVariant = "classic" | "intimate" | "custom" | "sales" | "cast";
const API = "/api/xumeng/companion/api";
const INTIMATE_API = "/api/xumeng/companion-intimate/api";
const SALES_API = "/api/xumeng/companion-sales/api";
const SALES_COVER = "/assets/xumeng/exported-cards/foreverse-songzhixia-cover.png";
const apiBase = { current: API };
const REPLY_NUDGE_MS = REPLY_GRACE_MS;
const RETRYABLE_SEND_CODES = new Set([
  "ACCOUNT_UNAVAILABLE", "BILLING_UNAVAILABLE", "COMPANION_UNAVAILABLE", "CONTAINER_STARTING", "GATEWAY_ERROR",
  "NATIVE_NOT_READY", "NATIVE_START_FAILED", "POOL_FULL", "SEND_RATE_LIMIT", "STYLE_UNAVAILABLE",
]);
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
  return value
    .replace(/^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n?/, "")
    .replace(/\[XUMENG_OPENING v1\][\s\S]*?\[\/XUMENG_OPENING\]\n?/g, "");
}

function recoveryNotice(health: Health | null): string {
  if (health?.deliveryAmbiguous) return "有一条消息的送达还没确认。重新开始不会补回那一句，本机这段记录也会清掉。";
  if (health?.snapshotVerified === false) return "这次中断没有留下可装回的存盘。重新开始会清掉中断标记，本机这段记录也会清掉。";
  return "这段聊天中断了，重建后才能继续说。";
}

function displayTitle(title: string | undefined, person: string, intimate: boolean) {
  const value = title?.trim() || "";
  if (!value || value.includes("[XUMENG_PRIVATE_STYLE")) return `和${person}的聊天`;
  if (["和 Yume 的聊天", "和Yume的聊天", "和晚宁的聊天", "和沈盼的聊天", "和乔晚的聊天", "和唐棠的聊天", "和裴婉的聊天"].includes(value)) return `和${person}的聊天`;
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

function messageIsVisible(message: { role?: string; text?: string; media?: unknown[]; attachments?: unknown[]; segments?: unknown[] }): boolean {
  if (message.role === "user" && SALES_CUES.has((message.text || "").trim())) return false;
  const text = stripXumengMomentTails(stripStyle(message.text || "")).trim();
  return Boolean(text) || normalizeMedia(message as Message).length > 0;
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
      <img src={item.url} alt={item.alt || item.label || "她发来的照片"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      {item.label && <figcaption>{item.label}</figcaption>}
    </figure>;
  }
  if (item.kind === "emoji") {
    return <span className={styles.sticker}><img src={item.url} alt={item.alt || item.label || "表情包"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></span>;
  }
  return <div className={styles.voice}>
    <div className={styles.voiceTitle}><span aria-hidden="true">♫</span><span>{item.label || "她的语音"}</span></div>
    <audio ref={audio} src={item.url} controls preload="metadata" aria-label={item.label || "她的语音消息"}
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

function ignoreReplyNudge() {}

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
  let data: { error?: string; code?: string; phase?: BootPhase; snapshotVerified?: boolean; deliveryAmbiguous?: boolean } | null = null;
  try { data = await response.json(); }
  catch (failure) {
    if (signal?.aborted || aborted(failure)) throw failure;
    throw Object.assign(new Error("聊天服务暂时不可用，请稍后重试。"), { code: "COMPANION_UNAVAILABLE" });
  }
  if (!response.ok) throw Object.assign(new Error(data?.error || "暂时连接不上，请稍后重试。"), { code: data?.code, phase: data?.phase, status: response.status, retryAfterMs: retryAfterMs(response.headers.get("retry-after")), ...recoveryFacts(data) });
  return data as T;
}

function holdKey(accountId: string, lane: string) {
  return `xumeng-companion-hold:${accountId}:${lane}`;
}

function readHold(accountId: string | undefined, lane: string): { draft: string; queued: Pending[] } {
  if (!accountId) return { draft: "", queued: [] };
  try {
    const value = JSON.parse(localStorage.getItem(holdKey(accountId, lane)) || "null");
    const queued = Array.isArray(value?.queued) ? restorePendingItems(value.queued) : [];
    const draft = typeof value?.draft === "string" ? value.draft.slice(0, 4000) : "";
    return { draft, queued };
  } catch {
    return { draft: "", queued: [] };
  }
}

function writeHold(accountId: string | undefined, lane: string, hold: { draft: string; queued: Pending[] }) {
  if (!accountId) return;
  localStorage.setItem(holdKey(accountId, lane), JSON.stringify({ draft: hold.draft, queued: hold.queued }));
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

function cachedConversation(accountId: string | undefined, lane: string, title: string): Conversation | null {
  if (!accountId) return null;
  const cached = readPersonTranscript(accountId, lane);
  if (!cached.messages.length) return null;
  return { id: cached.sessionId || `local:${lane}`, title, messages: cached.messages };
}

export default function CompanionPage({ onBack, onLogin, onVoiceCall, onVideoCall, variant = "classic", avatar, profile, cast, accountId }: { onBack?: () => void; onLogin?: () => void; onVoiceCall?: () => void; onVideoCall?: () => void; variant?: CompanionVariant; avatar?: string; profile?: CompanionProfile; cast?: GirlfriendCast; accountId?: string }) {
  const intimate = variant === "intimate";
  const sales = variant === "sales";
  const lane = cast ? `cast-${cast.id}` : sales ? "sales" : intimate ? "intimate" : "classic";
  const name = cast?.name || profile?.name || (sales ? "Eva" : intimate ? "宁宁" : "林幺");
  const reservedLines = cast?.lines ?? (sales ? SALES_LINES : intimate ? INTIMATE_LINES : profile ? undefined : CLASSIC_LINES);
  const avatarUrl = avatar || cast?.cover || profile?.cover || (sales ? SALES_COVER : intimate ? "/assets/xumeng/content-covers/wanning.jpg" : "/assets/xumeng/content-covers/yume.jpg");
  apiBase.current = cast ? `/api/xumeng/companion-cast/${cast.id}/api` : sales ? SALES_API : intimate ? INTIMATE_API : API;
  const [health, setHealth] = useState<Health | null>(null);
  const [pollPaused, setPollPaused] = useState(false);
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  useLayoutEffect(() => {
    const cached = cachedConversation(accountId, lane, name);
    if (!cached) return;
    setConversation(previous => previous?.messages?.length ? previous : cached);
  }, [accountId, lane, name]);
  const [draft, setDraft] = useState(() => readHold(accountId, lane).draft);
  const [held, setHeld] = useState<Pending[]>(() => readHold(accountId, lane).queued);
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [creating, setCreating] = useState(false);
  const presetStyle = cast?.style || (sales ? SALES_STYLE : profile?.style || (intimate ? INTIMATE_STYLE : CLASSIC_STYLE));
  const openingSales = useRef(false);
  const nudgeFails = useRef(0);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [boot, setBoot] = useState(0);
  const [sessionsKnown, setSessionsKnown] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [mediaTrayOpen, setMediaTrayOpen] = useState(false);
  const prefaceLatch = useRef<PrefaceLatch | null>(null);
  const prefaceAnchor = useRef(0);
  const prefaceLines = useRef<readonly string[]>([]);
  const [laneHasHistory, setLaneHasHistory] = useState(true);
  const [, setBootStartedAt] = useState<number | null>(null);
  const inFlight = useRef(new Set<string>());
  const sendRetries = useRef(new Map<string, number>());
  const retryableSends = useRef(new Map<string, string>());
  const retryTimers = useRef(new Map<string, number>());
  const unansweredRef = useRef(false);
  const pendingRef = useRef<Record<string, Pending[]>>({});
  const senderRef = useRef<CompanionSenderHandle>(null);
  const wakeStarted = useRef(false);
  const wakeContainer = useCallback(() => {
    if (!shouldWakeParked(health?.parked, wakeStarted.current)) return;
    wakeStarted.current = true;
    setHealth(current => current?.parked ? { ...current, parked: false } : current);
    // Reopening the existing session starts the engine and does not send a line.
    void request("/sessions", { characterId: "yume" }).catch(() => {});
  }, [health?.parked]);
  // Drafts wait for the signed-in account. The transcript itself comes from the companion service.
  const scope = health?.clientScope;
  const storage = scope ? `xumeng-maibot:${scope}` : null;
  const ready = health?.ready === true;
  const pendingKey = active && storage ? `${storage}:${active}` : null;

  const updatePending = useCallback((key: string, update: (items: Pending[]) => Pending[]) => {
    const current = pendingRef.current[key] || [];
    const next = update(current);
    const same = current.length === next.length && current.every((item, index) => item.requestId === next[index]?.requestId && item.state === next[index]?.state && item.text === next[index]?.text && item.createdAt === next[index]?.createdAt);
    if (same) return true;
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
    setSessionsKnown(false);
    const controller = new AbortController();
    (async () => {
      const deadline = Date.now() + BOOT_DEADLINE_MS;
      let healthAttempt = 0;
      try {
        for (;;) {
          try {
            const status = await request<Health>("/health", undefined, controller.signal);
            if (status.runtime !== "maibot-native") throw Object.assign(new Error("聊天服务暂时不可用，请稍后重试。"), { code: "COMPANION_UNAVAILABLE" });
            if (!status.ready) {
              if (Date.now() > deadline) throw Object.assign(new Error("聊天服务启动时间过长，请稍后重试。"), { code: "CONTAINER_STARTING" });
              setHealth({ ...status, reason: status.reason || "starting" });
              setError("");
              healthAttempt += 1;
              await sleep(nextHealthRetryDelay(healthAttempt), controller.signal);
              continue;
            }
            setError("");
            const [overview, result] = await Promise.all([
              request<BillingOverview>("/billing", undefined, controller.signal).catch(() => null),
              request<{ sessions: Conversation[] }>("/sessions", undefined, controller.signal),
            ]);
            if (overview) setBilling(overview);
            dropUnscopedCompanionCache(lane);
            if (intimate && status.clientScope) for (const item of result.sessions) rememberIntimateSession(status.clientScope, item.id);
            const saved = localStorage.getItem(`xumeng-maibot:${status.clientScope}:${intimate ? "intimate-active" : "active"}`);
            // The list can describe a session before its native record is open.
            // Read the recent ones so a short new chat does not hide the longer record.
            const ranked = result.sessions.slice(0, 6);
            const opened = await Promise.all(ranked.map(async item => {
              try {
                const full = await request<{ session: Conversation }>(`/sessions/${item.id}`, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
                return full.session?.id ? { ...item, ...full.session, messages: full.session.messages ?? item.messages } : item;
              } catch { return item; }
            }));
            const openedById = new Map(opened.map(item => [item.id, item]));
            if (controller.signal.aborted) return;
            const cachedMessages = accountId ? readPersonTranscript(accountId, lane).messages : [];
            const sessions = result.sessions.map(item => {
              const opened = openedById.get(item.id) ?? item;
              if (!cachedMessages.length) return opened;
              return { ...opened, messages: mergeCompanionMessages<Message>(cachedMessages, opened.messages ?? []) };
            });
            const chosenSession = pickCompanionSession(sessions, saved);
            // Ready and the session list have to land together. Marking the
            // service ready before the list arrives rendered an empty chat,
            // and the auto-create effect then opened a new session on every visit.
            setSessions(sessions);
            setActive(chosenSession?.id ?? null);
            if (chosenSession) setConversation(previous => applyCompanionSession(previous ?? cachedConversation(accountId, lane, name), { ...chosenSession, messages: chosenSession.messages ?? [] }));
            setSessionsKnown(true);
            setHealth(status);
            setBootStartedAt(null);
            setError("");
            break;
          } catch (failure) {
            const code = errorCode(failure);
            if (!controller.signal.aborted && code && TRANSIENT_HEALTH_CODES.has(code) && Date.now() < deadline) {
              setHealth({ ready: false, reason: "starting", phase: bootPhase(failure) });
              setError("");
              healthAttempt += 1;
              await sleep(nextHealthRetryDelay(healthAttempt), controller.signal);
              continue;
            }
            throw failure;
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setBootStartedAt(previous => previous ?? Date.now());
          const code = errorCode(failure);
          setHealth({ ready: false, reason: code || "unavailable", ...recoveryFacts(failure) });
        }
      }
    })();
    return () => controller.abort();
  }, [accountId, boot, lane]);

  useEffect(() => {
    if (!active || !storage) return;
    const key = `${storage}:${active}`;
    try {
      localStorage.setItem(intimate ? `${storage}:intimate-active` : `${storage}:active`, active);
      if (!pendingRef.current[key]) updatePending(key, () => restorePending(key));
      const heldNow = readHold(accountId, lane);
      if (heldNow.queued.length) {
        updatePending(key, items => {
          const ids = new Set(items.map(item => item.requestId));
          return [...items, ...heldNow.queued.filter(item => !ids.has(item.requestId))];
        });
        writeHold(accountId, lane, { draft: "", queued: [] });
        setHeld([]);
      }
      setDraft(localStorage.getItem(`${key}:draft`) || heldNow.draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法读取本机草稿。");
    }
    // A failed health check must not wipe the transcript already stored on this device.
    if (!ready) return;
    setConversation(previous => {
      const cached = accountId ? readPersonTranscript(accountId, lane).messages : [];
      if (previous?.id === active && (previous.messages?.length || !cached.length)) return previous;
      if (previous?.messages?.length) return { ...previous, id: active, messages: mergeCompanionMessages(previous.messages, cached) };
      return cached.length ? { id: active, title: name, messages: cached } : null;
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let retryHint: number | undefined;
    const poll = async () => {
      let thinking = false;
      try {
        const result = await request<{ session: Conversation }>(`/sessions/${active}`, undefined, controller.signal);
        thinking = result.session.status === "thinking";
        failures = 0;
        retryHint = undefined;
        if (!controller.signal.aborted) {
          setPollPaused(previous => previous ? false : previous);
          setConversation(previous => applyCompanionSession(previous, result.session));
          setSyncError("");
          setSessions(previous => {
            const title = displayTitle(result.session.title, name, intimate);
            const current = previous.find(item => item.id === active);
            if (!current || current.title === title) return previous;
            return previous.map(item => item.id === active ? { ...item, title } : item);
          });
          updatePending(key, items => items.flatMap(item => {
            const messages = result.session.messages ?? [];
            // The user line landing is not the reply. Drop the wait only after
            // an assistant message follows it, so a slow generation is not nudged twice.
            if (assistantRepliedAfter(messages, item.requestId)) return [];
            const receipt = result.session.receipts?.find(value => value.requestId === item.requestId);
            if (receipt?.status === "accepted" || receipt?.status === "complete" || receipt?.confirmed) return [{ ...item, state: "accepted" }];
            if (receipt?.status === "uncertain") return [{ ...item, state: "uncertain" }];
            return [item];
          }));
          const stillUncertain = (pendingRef.current[key] || []).some(item => item.state === "uncertain");
          if (!stillUncertain) setError(current => current.includes("送达") ? "" : current);
        }
      } catch (failure) {
        if (!controller.signal.aborted && !aborted(failure)) {
          failures += 1;
          const hinted = failure && typeof failure === "object" && "retryAfterMs" in failure ? failure.retryAfterMs : undefined;
          retryHint = typeof hinted === "number" ? hinted : undefined;
          if (quietSessionPoll(errorCode(failure))) {
            setSyncError("");
          } else {
            setPollPaused(true);
            setSyncError(failure instanceof Error ? failure.message : "读取消息失败。");
          }
        }
      } finally {
        const pendingLeft = (pendingRef.current[key] || []).some(item => item.state === "sending" || item.state === "accepted" || item.state === "uncertain");
        const followUp = pendingLeft || thinking || unansweredRef.current;
        if (!controller.signal.aborted) timer = setTimeout(poll, nextCompanionPollDelay({
          failures, followUp, visible: document.visibilityState === "visible", retryAfterMs: failures > 0 ? retryHint : undefined,
        }));
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [accountId, active, intimate, lane, name, ready, storage, updatePending]);

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

  useEffect(() => {
    if (!accountId || !active) return;
    publishCompanionTranscript(accountId, lane, active, visibleMessages.flatMap(message => (
      message.id && message.createdAt && (message.role === "user" || message.role === "assistant") && message.text?.trim()
        ? [{ id: message.id, role: message.role, text: message.text, createdAt: message.createdAt }]
        : []
    )));
  }, [accountId, active, lane, visibleMessages]);

  const lanePhotoKey = accountId ? `xumeng-companion-photos:${accountId}:${lane}` : `xumeng-companion-photos:unsigned:${lane}`;
  const photoKey = pendingKey ? `${pendingKey}:photos` : lanePhotoKey;
  const photos = useGirlfriendPhotos(photoKey, pendingKey ? lanePhotoKey : null, "yume");
  useEffect(() => { markChatSeen(accountId, lane); }, [accountId, lane, photos.photos]);
  const scene = companionVisualScene({ situation: cast?.situation || profile?.situation, messages: visibleMessages });

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

  const latestVisible = visibleMessages[visibleMessages.length - 1];
  const unanswered = Boolean(ready && latestVisible?.role === "user" && latestVisible.pendingState !== "queued" && latestVisible.pendingState !== "sending" && latestVisible.pendingState !== "failed" && latestVisible.pendingState !== "uncertain");
  unansweredRef.current = unanswered;
  const send = useCallback(async (sessionId: string, item: Pending, key: string): Promise<boolean> => {
    if (inFlight.current.has(item.requestId)) return false;
    if (!updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "sending" } : existing))) return false;
    inFlight.current.add(item.requestId);
    try {
      await request(`/sessions/${sessionId}/messages`, {
        text: item.text,
        requestId: item.requestId,
        ...(prefaceLines.current.length ? { opening: [...prefaceLines.current] } : {}),
      });
      retryableSends.current.delete(item.requestId);
      const pendingTimer = retryTimers.current.get(item.requestId);
      if (pendingTimer) window.clearTimeout(pendingTimer);
      retryTimers.current.delete(item.requestId);
      if (updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "accepted" } : existing))) setError("");
      return true;
      // Keep the optimistic bubble until native history has the original ID.
      // A timeout never automatically resends a possibly accepted message.
    } catch (failure) {
      const code = failure && typeof failure === "object" && "code" in failure ? failure.code : undefined;
      const codeText = typeof code === "string" ? code : undefined;
      const attempts = sendRetries.current.get(item.requestId) || 0;
      const uncertain = !code || ["DELIVERY_UNCERTAIN", "NATIVE_ACK_TIMEOUT", "NATIVE_OFFLINE"].includes(String(code));
      const starting = codeText === "CONTAINER_STARTING" || codeText === "NATIVE_NOT_READY";
      const retryable = Boolean(codeText && RETRYABLE_SEND_CODES.has(codeText) && attempts < sendAttemptLimit(codeText));
      if (retryable && codeText) retryableSends.current.set(item.requestId, codeText);
      else {
        retryableSends.current.delete(item.requestId);
        if (!uncertain) sendRetries.current.set(item.requestId, sendAttemptLimit(codeText));
      }
      if (retryable && starting && codeText) {
        const pendingTimer = retryTimers.current.get(item.requestId);
        if (pendingTimer) window.clearTimeout(pendingTimer);
        retryTimers.current.set(item.requestId, window.setTimeout(() => {
          retryTimers.current.delete(item.requestId);
          if (retryableSends.current.get(item.requestId) !== codeText) return;
          sendRetries.current.set(item.requestId, attempts + 1);
          void send(sessionId, item, key);
        }, nextSendRetryDelay(codeText, attempts)));
      }
      // A booting engine has not accepted the line. Keep it pending instead of
      // showing a failure while the next attempt is already scheduled.
      updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: uncertain ? "uncertain" : retryable && starting ? "sending" : "failed" } : existing));
      if (!retryable) setError(failure instanceof Error ? failure.message : "消息没能送达。");
      return false;
    } finally { inFlight.current.delete(item.requestId); }
  }, [updatePending]);

  useEffect(() => {
    if (sales || !ready || !active || !pendingKey) return;
    const failed = pendingItems.filter(item => {
      if (item.state !== "failed") return false;
      const attempts = sendRetries.current.get(item.requestId) || 0;
      if (attempts >= sendAttemptLimit(retryableSends.current.get(item.requestId))) return false;
      return retryableSends.current.has(item.requestId) || !sendRetries.current.has(item.requestId);
    });
    if (!failed.length) return;
    const delay = Math.min(...failed.map(item => nextSendRetryDelay(retryableSends.current.get(item.requestId), sendRetries.current.get(item.requestId) || 0)));
    const timer = window.setTimeout(() => {
      for (const item of failed) {
        sendRetries.current.set(item.requestId, (sendRetries.current.get(item.requestId) || 0) + 1);
        void send(active, item, pendingKey);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, pendingItems, pendingKey, ready, sales, send]);

  useEffect(() => () => {
    for (const timer of retryTimers.current.values()) window.clearTimeout(timer);
  }, []);

  const nudgeAttempts = useRef(new Map<string, number>());
  useEffect(() => {
    if (sales || pollPaused || !ready || !active || !unanswered || !latestVisible?.id || conversation?.status === "thinking") return;
    if (generationStillOpen(pendingItems, Date.now())) return;
    const messageId = latestVisible.id;
    if ((nudgeAttempts.current.get(messageId) || 0) >= 1) return;
    const age = Date.now() - Date.parse(latestVisible.createdAt);
    const wait = Math.max(0, REPLY_NUDGE_MS - (Number.isFinite(age) ? age : 0));
    let cancelled = false;
    let retryTimer: number | undefined;
    const nudge = () => request(`/sessions/${active}/proactive`, {
      userMessageId: messageId,
      intent: "用户刚发的一句还没有回复。请只接这一句，按你现在的说话习惯回一条短消息，不要重复上一轮，不要质问。",
      reason: "private_chat_reply_missing",
      metadata: { sessionId: active, source: "xumeng-girlfriend" },
    });
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      nudgeAttempts.current.set(messageId, 1);
      void nudge().catch(() => {
        if (cancelled) return;
        retryTimer = window.setTimeout(() => {
          if (cancelled || (nudgeAttempts.current.get(messageId) || 0) >= 2) return;
          nudgeAttempts.current.set(messageId, 2);
          void nudge().catch(() => {});
        }, 60_000);
      });
    }, wait);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearTimeout(retryTimer); };
  }, [active, conversation?.status, latestVisible?.createdAt, latestVisible?.id, pendingItems, pollPaused, ready, sales, unanswered]);

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
      setConversation(previous => applyCompanionSession(previous, result.session));
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
      setSessions([result.session]);
      setActive(result.session.id);
      setConversation(previous => applyCompanionSession(previous, { ...result.session, messages: result.session.messages ?? [] }));
      setError("");
      senderRef.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "暂时无法开始聊天。"); }
    finally { setCreating(false); }
  }

  useEffect(() => {
    if (!sessionsKnown || !ready || active || sessions.length || creating || openingSales.current) return;
    if (health?.reason === LOGIN_REQUIRED_CODE || health?.reason === RECOVERY_REVIEW_CODE || health?.reason === PREVIEW_UNAVAILABLE_CODE) return;
    openingSales.current = true;
    void createConversation();
  }, [active, creating, health?.reason, ready, sessions.length, sessionsKnown]);

  async function abandonAndRebuild() {
    if (!window.confirm(`这会放弃当前异常的${name}实例并开始一段空白聊天。旧审计记录会保留，但当前聊天内容不会自动恢复。继续吗？`)) return;
    setResetting(true); setError("");
    try {
      await request("/reset", { confirmation: "discard-current-instance" });
      if (accountId) clearPersonTranscript(accountId, lane);
      setSessions([]); setActive(null); setConversation(null); setHealth({ ready: false, reason: "starting" });
      setBoot(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `暂时无法重建${name}。`);
    } finally { setResetting(false); }
  }

  function queueLocally(text: string) {
    const item: Pending = { requestId: crypto.randomUUID(), text, createdAt: new Date().toISOString(), state: "queued" };
    const next = [...readHold(accountId, lane).queued, item];
    try { writeHold(accountId, lane, { draft: "", queued: next }); }
    catch { setError("这条消息暂时无法保存在本机，请保留输入内容后重试。"); return; }
    setHeld(next);
    setDraft("");
    senderRef.current?.focus();
  }

  function submit(next = draft) {
    if (health?.reason === LOGIN_REQUIRED_CODE) { onLogin?.(); return; }
    if (!next.trim() || deliveryBlocked || health?.reason === RECOVERY_REVIEW_CODE) {
      if (deliveryBlocked) setError("已有消息的送达结果尚未确认，请先检查聊天记录，暂勿重复发送。");
      return;
    }
    const text = next.trim();
    if (!active || !pendingKey) { queueLocally(text); return; }
    // While she is waking up the message waits locally; it has never left the
    // browser, so sending it later cannot duplicate a delivery.
    const item: Pending = { requestId: crypto.randomUUID(), text, createdAt: new Date().toISOString(), state: ready ? "sending" : "queued" };
    if (!updatePending(pendingKey, items => [...items, item])) return;
    setDraft("");
    if (storage) localStorage.removeItem(`${storage}:${active}:draft`);
    if (ready) void send(active, item, pendingKey);
    senderRef.current?.focus();
  }

  useEffect(() => {
    setLaneHasHistory(accountId ? readInbox(accountId, lane).at !== null : false);
  }, [accountId, lane]);

  if (!prefaceAnchor.current) prefaceAnchor.current = Date.now();
  const loadedSession = active && conversation?.id === active ? conversation : null;
  const prefaceDecision = openingPreface(
    reservedLines,
    active,
    loadedSession,
    sessionsKnown || !laneHasHistory,
    prefaceLatch.current,
    prefaceAnchor.current,
    messageIsVisible,
  );
  prefaceLatch.current = prefaceDecision.latch;
  prefaceLines.current = prefaceDecision.lines;

  const transcriptItems = useMemo<CompanionTranscriptItem[]>(() => {
    const items: CompanionTranscriptItem[] = [];
    for (const message of visibleMessages) {
      if (message.role === "user" && SALES_CUES.has((message.text || "").trim())) continue;
      const text = stripXumengMomentTails(stripStyle(message.text || "")).trim();
      const media = normalizeMedia(message);
      if (!text && media.length === 0) continue;
      const pendingItem = message.pendingState && message.requestId && typeof message.text === "string"
        ? { requestId: message.requestId, text: message.text, createdAt: message.createdAt, state: message.pendingState } satisfies Pending
        : null;
      items.push({
        id: message.id,
        createdAt: message.createdAt,
        kind: "message",
        bubble: message.role === "user" ? "user" : "assistant",
        pending: Boolean(message.pendingState && message.pendingState !== "uncertain" && message.pendingState !== "failed"),
        content: <div>
          {text && <p className={styles.bubbleText}>{text}</p>}
          {media.length > 0 && <MessageMediaView items={media} />}
          {(message.pendingState === "uncertain" || message.pendingState === "failed") && active && <small className={styles.delivery}>{message.pendingState === "uncertain"
            ? <button type="button" disabled={!pendingItem} onClick={() => pendingKey && pendingItem && void checkDelivery(active, pendingItem, pendingKey)}>送达待确认 · 检查记录</button>
            : <button type="button" disabled={!pendingItem} onClick={() => pendingKey && pendingItem && void send(active, pendingItem, pendingKey)}>发送失败 · 重试</button>}</small>}
        </div>,
      });
    }
    for (const photo of photos.photos) {
      items.push({
        id: photo.id,
        createdAt: photo.createdAt,
        kind: "photo",
        bubble: "assistant",
        content: <figure className={styles.picture}><img src={photo.url} alt={`${name}发来的照片`} /></figure>,
      });
    }
    items.sort((left, right) => (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0) || left.id.localeCompare(right.id));
    return items;
  }, [active, checkDelivery, name, pendingKey, photos.photos, send, visibleMessages]);
  function rememberDraft(value: string) {
    setDraft(value);
    if (storage && active) localStorage.setItem(`${storage}:${active}:draft`, value);
    else {
      const current = readHold(accountId, lane);
      try { writeHold(accountId, lane, { ...current, draft: value }); } catch { /* A full disk still leaves the draft on screen. */ }
    }
  }
  const recovering = health?.reason === RECOVERY_REVIEW_CODE;
  const placeholder = health?.reason === LOGIN_REQUIRED_CODE ? "先登录，再跟她说" : recovering ? "重建后才能继续说" : cast?.placeholder || (sales ? "回她一句，或者让她继续说…" : intimate ? "想靠近，就直接说…" : "想说什么，就发给她…");
  const stageStyle = { "--companion-cover": `url(${JSON.stringify(avatarUrl)})` } as CSSProperties;
  return <section className={`${styles.chat} ${styles.chatStage}`} style={stageStyle} aria-label={`与${name}聊天`}>
        <header className={styles.chatHeader}>
          {onBack && <button className={styles.mobileBack} aria-label="返回聊天列表" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>}
          <div className={styles.identity}><h1>{name}</h1></div>
          <div className={styles.headerActions}>
            {XUMENG_CALLS_ENABLED && onVoiceCall && <button type="button" className={styles.headerAction} aria-label={`和${name}语音通话`} onClick={onVoiceCall}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 3.8h2.2l1 2.5-1.5 1a12.5 12.5 0 0 0 5.5 5.5l1-1.5 2.5 1V18a1.6 1.6 0 0 1-1.7 1.6A15.2 15.2 0 0 1 4.4 6.5 1.6 1.6 0 0 1 6 4.8" strokeLinejoin="round" /></svg>
              语音
            </button>}
            {XUMENG_CALLS_ENABLED && onVideoCall && <button type="button" className={styles.headerAction} aria-label={`和${name}视频通话`} onClick={onVideoCall}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="6.5" width="11" height="11" rx="2" /><path d="m14.5 10.2 6-3.2v10l-6-3.2z" strokeLinejoin="round" /></svg>
              视频
            </button>}
            <button type="button" className={styles.headerAction} aria-pressed={mediaTrayOpen} onClick={() => setMediaTrayOpen(value => !value)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="m4 16 4.2-3.4a1 1 0 0 1 1.3.05L13 15.5l1.6-1.3a1 1 0 0 1 1.3.02L20.5 17" /></svg>
              相册
            </button>
          </div>
        </header>
        <CompanionTranscript
          items={transcriptItems}
          name={name}
          avatarUrl={avatarUrl}
          typing={conversation?.status === "thinking" || generationStillOpen(pendingItems, Date.now())}
          stalled={false}
          emptyText={cast?.emptyDetail || profile?.situation || "想说的，直接发给她。"}
          onNudge={ignoreReplyNudge}
        />
        {conversation?.error && <div className={styles.error} role="alert">{conversation.error}</div>}
        {(syncError || (error && (health?.ready || Boolean(conversation?.messages?.length)))) && <div className={styles.error} role="alert">{error || syncError}<button aria-label="关闭提示" onClick={() => { setError(""); setSyncError(""); }}>×</button></div>}
        <>
          {mediaTrayOpen && <div className={styles.mediaTray} role="status">
            <div className={styles.mediaTrayHead}><strong>相册</strong><span>按她现在的状态出一张，用封面当参考。一张 {STUDIO_STILL_CREDITS} Credit。</span></div>
            {photos.photos.length > 0 && <div className={styles.stillGrid}>{photos.photos.map(photo => <img key={photo.id} src={photo.url} alt={`${name}发来的照片`} />)}</div>}
            {photos.note && <p>{photos.note}</p>}
            <div className={styles.mediaTrayActions}>
              <button type="button" disabled={photos.busy || health?.reason === LOGIN_REQUIRED_CODE} onClick={() => void photos.shoot(avatarUrl, scene)}>{photos.busy ? "正在出图…" : "让她发一张"}</button>
              <button type="button" onClick={() => setMediaTrayOpen(false)}>收起</button>
            </div>
          </div>}
          {recovering && <div className={styles.recovery} role="status">
            <p>{recoveryNotice(health)}</p>
            <button type="button" disabled={resetting} onClick={() => void abandonAndRebuild()}>{resetting ? "正在重建…" : "重新开始"}</button>
          </div>}
          <CompanionSender
            ref={senderRef}
            value={draft}
            placeholder={placeholder}
            disabled={recovering}
            login={health?.reason === LOGIN_REQUIRED_CODE}
            onChange={rememberDraft}
            onSubmit={submit}
            onFocus={wakeContainer}
            onLogin={onLogin}
          />
          {deliveryBlocked && <div className={styles.composerHint}><span>有一条消息的送达结果待确认，请先检查记录</span></div>}
        </>
      </section>;
}
