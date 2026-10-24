"use client";

/* eslint-disable @next/next/no-img-element -- Media URLs are emitted by the authenticated companion gateway. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./companion.module.css";
import { normalizeMedia, type MessageMedia } from "../../../lib/qingyu-companion-media";
import { CLASSIC_STYLE, TRAVELER_STYLE, type CompanionStyle } from "./companion-style";
import { INTIMATE_STYLE } from "./intimate-style";

type Message = { id: string; role: "user" | "assistant"; text?: string; createdAt: string; requestId?: string; media?: unknown[]; attachments?: unknown[]; segments?: unknown[] };
type Receipt = { requestId: string; status: "sending" | "pending" | "accepted" | "complete" | "uncertain"; confirmed?: boolean };
type DeliveryReceipt = { requestId: string; sessionId: string; status: "pending" | "complete" | "uncertain"; confirmed?: boolean; billingStatus?: string };
type Conversation = { id: string; title: string; messages?: Message[]; receipts?: Receipt[]; connection?: string; status?: string; error?: string; style?: CompanionStyle };
type Pending = { requestId: string; text: string; createdAt: string; state: "sending" | "accepted" | "failed" | "uncertain" };
type DisplayMessage = Message & { pendingState?: Pending["state"] };
type Health = { runtime?: string; ready?: boolean; clientScope?: string; reason?: string };
type BillingOverview = { enabled: boolean; creditsPerMessage: 2; balance: number; reservedCredits: number };
type CompanionVariant = "classic" | "intimate" | "traveler";
const API = "/api/qingyu/companion/api";
const INTIMATE_API = "/api/qingyu/companion-intimate/api";
const TRAVELER_API = "/api/qingyu/companion-traveler/api";
const PROACTIVE_IDLE_MS = 45_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TRANSIENT_HEALTH_CODES = new Set([
  "ACCOUNT_UNAVAILABLE", "COMPANION_UNAVAILABLE", "CONTAINER_STARTING", "NATIVE_NOT_READY", "NATIVE_START_FAILED",
]);
const RECOVERY_REVIEW_CODE = "RECOVERY_REVIEW_REQUIRED";

function stripStyle(value: string) {
  return value.replace(/^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n?/, "");
}

function displayTitle(title: string | undefined, person: string, intimate: boolean) {
  const value = title?.trim() || "";
  if (!value || value.includes("[XUMENG_PRIVATE_STYLE")) return `和${person}的聊天`;
  if (intimate && (value === "和 陆时予 的聊天" || value === "和陆时予的聊天")) return `和${person}的聊天`;
  return value;
}

function intimateIdsKey(scope: string) {
  return `qingyu-maibot:${scope}:intimate-sessions`;
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

function viewCacheKey(variant: CompanionVariant) {
  return `qingyu-companion-cache:${variant}`;
}

function readViewCache(variant: CompanionVariant): ViewCache | null {
  try {
    const value = JSON.parse(localStorage.getItem(viewCacheKey(variant)) || "null");
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
function PauseOtherAudio({ audioRef, mediaId }: { audioRef: { current: HTMLAudioElement | null }; mediaId: string }) {
  useEffect(() => {
    const pause = (event: Event) => {
      if ((event as CustomEvent).detail !== mediaId) audioRef.current?.pause();
    };
    document.addEventListener("qingyu-companion-audio-play", pause);
    return () => document.removeEventListener("qingyu-companion-audio-play", pause);
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
      <img src={item.url} alt={item.alt || item.label || "对方发来的照片"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      {item.label && <figcaption>{item.label}</figcaption>}
    </figure>;
  }
  if (item.kind === "emoji") {
    return <span className={styles.sticker}><img src={item.url} alt={item.alt || item.label || "表情包"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></span>;
  }
  return <div className={styles.voice}>
    <div className={styles.voiceTitle}><span aria-hidden="true">♫</span><span>{item.label || "对方的语音"}</span></div>
    <audio ref={audio} src={item.url} controls preload="metadata" aria-label={item.label || "对方的语音消息"}
      onPlay={() => { setFailed(false); document.dispatchEvent(new CustomEvent("qingyu-companion-audio-play", { detail: mediaId })); }}
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
      || !["sending", "accepted", "failed", "uncertain"].includes(item.state)) return [];
    seen.add(item.requestId);
    // Refresh does not prove failure: the previous request may have reached MaiBot.
    return [{ requestId: item.requestId, text: item.text, createdAt: item.createdAt, state: item.state === "sending" ? "uncertain" : item.state } as Pending];
  });
}

function errorCode(value: unknown): string | undefined {
  return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

async function requestAt<T>(base: string, path: string, body?: unknown, signal?: AbortSignal, method: "POST" | "PUT" = "POST"): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : method, cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "暂时连接不上，请稍后重试。"), { code: data.code });
  return data;
}

export default function CompanionPage({ onBack, variant = "classic" }: { onBack?: () => void; variant?: CompanionVariant }) {
  const intimate = variant === "intimate";
  const name = variant === "traveler" ? "季临川" : intimate ? "沈聿" : "陆时予";
  const portrait = `/art/${variant === "traveler" ? "linchuan" : intimate ? "shen" : "shiyu"}.webp`;
  const base = variant === "traveler" ? TRAVELER_API : intimate ? INTIMATE_API : API;
  const request = useCallback(<T,>(path: string, body?: unknown, signal?: AbortSignal, method: "POST" | "PUT" = "POST") => requestAt<T>(base, path, body, signal, method), [base]);
  const cachedView = useRef(readViewCache(variant));
  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<Conversation[]>(() => cachedView.current?.sessions ?? []);
  const [active, setActive] = useState<string | null>(() => cachedView.current?.active ?? null);
  const [conversation, setConversation] = useState<Conversation | null>(() => cachedView.current?.conversation ?? null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draftMode, setDraftMode] = useState<"new" | "current">("new");
  const [style, setStyle] = useState<CompanionStyle>(variant === "traveler" ? TRAVELER_STYLE : intimate ? INTIMATE_STYLE : CLASSIC_STYLE);
  const presetStyle = variant === "traveler" ? TRAVELER_STYLE : intimate ? INTIMATE_STYLE : CLASSIC_STYLE;
  useEffect(() => {
    if (showCreate) return;
    const incoming = conversation?.style?.version === 1 ? conversation.style : presetStyle;
    setStyle(current => current.personality === incoming.personality && current.speakingStyle === incoming.speakingStyle && current.relationshipStyle === incoming.relationshipStyle ? current : incoming);
  }, [conversation?.id, conversation?.style, presetStyle, showCreate]);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [boot, setBoot] = useState(0);
  const [resetting, setResetting] = useState(false);
  const inFlight = useRef(new Set<string>());
  const pendingRef = useRef<Record<string, Pending[]>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followBottom = useRef(true);
  const proactiveForUser = useRef<string | null>(null);
  const storage = health?.clientScope ? `qingyu-maibot:${health.clientScope}` : null;
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
    const controller = new AbortController();
    (async () => {
      let attempts = 0;
      try {
        for (;;) {
          try {
            const status = await request<Health>("/health", undefined, controller.signal);
            if (status.runtime !== "maibot-native") throw Object.assign(new Error("聊天服务暂时不可用，请稍后重试。"), { code: "COMPANION_UNAVAILABLE" });
            if (!status.ready) {
              if (attempts >= 20) throw Object.assign(new Error("聊天服务启动时间过长，请稍后重试。"), { code: "CONTAINER_STARTING" });
              setHealth({ ...status, reason: status.reason || "starting" });
              setError("");
              attempts += 1;
              await sleep(1000, controller.signal);
              continue;
            }
            setHealth(status);
            setError("");
            try { setBilling(await request<BillingOverview>("/billing", undefined, controller.signal)); } catch { /* billing is optional while rollout is closed */ }
            const result = await request<{ sessions: Conversation[] }>("/sessions", undefined, controller.signal);
            const cached = readViewCache(variant);
            if (cached?.scope && status.clientScope && cached.scope !== status.clientScope) {
              localStorage.removeItem(viewCacheKey(variant));
              setConversation(null);
            }
            if (intimate && status.clientScope) for (const item of result.sessions) rememberIntimateSession(status.clientScope, item.id);
            setSessions(result.sessions);
            const saved = localStorage.getItem(`qingyu-maibot:${status.clientScope}:${`${variant}-active`}`);
            const chosen = result.sessions.some(item => item.id === saved) ? saved : result.sessions[0]?.id ?? null;
            const chosenSession = result.sessions.find(item => item.id === chosen);
            setActive(chosen);
            if (chosenSession?.messages?.length) setConversation(previous => previous?.id === chosen && (previous.messages?.length || 0) >= chosenSession.messages!.length ? previous : chosenSession);
            setError("");
            break;
          } catch (failure) {
            const code = errorCode(failure);
            if (!controller.signal.aborted && code && TRANSIENT_HEALTH_CODES.has(code) && attempts < 20) {
              setHealth({ ready: false, reason: "starting" });
              setError("");
              attempts += 1;
              await sleep(1000, controller.signal);
              continue;
            }
            throw failure;
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          const code = errorCode(failure);
          setHealth({ ready: false, reason: code || "unavailable" });
          setError(failure instanceof Error ? failure.message : "连接失败。");
        }
      }
    })();
    return () => controller.abort();
  }, [boot, variant, request]);

  useEffect(() => {
    if (!active || !storage) return;
    const key = `${storage}:${active}`;
    try {
      localStorage.setItem(`${storage}:${variant}-active`, active);
      setDraft(localStorage.getItem(`${key}:draft`) || "");
      if (!pendingRef.current[key]) updatePending(key, () => restorePending(key));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法读取本机草稿。");
    }
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
  }, [active, intimate, storage, updatePending]);

  // A quiet window gets one real Maisaka proactive turn. The trigger is
  // attached to the latest user turn, so an assistant response caused by the
  // nudge cannot recursively schedule another nudge. The native Planner still
  // decides whether there is anything worth saying.
  useEffect(() => {
    proactiveForUser.current = null;
  }, [active]);

  useEffect(() => {
    if (!health?.clientScope || (!sessions.length && !conversation)) return;
    try {
      const savedConversation = conversation ? {
        ...conversation,
        messages: (conversation.messages || []).slice(-80).map(({ media, attachments, segments, ...message }) => message),
      } : null;
      localStorage.setItem(viewCacheKey(variant), JSON.stringify({
        scope: health.clientScope,
        sessions: sessions.map(item => ({ id: item.id, title: displayTitle(item.title, name, intimate) })),
        active,
        conversation: savedConversation,
      } satisfies ViewCache));
    } catch { /* A full disk must not block the open transcript. */ }
  }, [active, conversation, health?.clientScope, variant, name, sessions]);

  const pendingItems = useMemo(() => pendingKey ? pending[pendingKey] || [] : [], [pending, pendingKey]);
  const pendingCount = pendingItems.length;
  // Sending is intentionally not a lock.  A person can type three short
  // fragments in a row while the first one is still travelling; the native
  // host serializes those requests and preserves their order.  Only an
  // ambiguous delivery is a hard stop because retrying it could duplicate a
  // charged message.
  const deliveryBlocked = pendingItems.some(item => item.state === "uncertain");
  const sendingCount = pendingItems.filter(item => item.state === "sending").length;
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
  const latestAssistant = useMemo(() => [...visibleMessages].reverse().find(message => message.role === "assistant"), [visibleMessages]);
  const latestUserId = latestUser?.id || null;
  const latestUserCreatedAt = latestUser?.createdAt || null;
  const latestAssistantId = latestAssistant?.id || null;
  const latestAssistantCreatedAt = latestAssistant?.createdAt || null;

  useEffect(() => {
    if (!active || !health?.ready || pendingItems.length > 0) return;
    if (!latestUserId || !latestAssistantId || !latestUserCreatedAt || !latestAssistantCreatedAt || Date.parse(latestAssistantCreatedAt) < Date.parse(latestUserCreatedAt)) return;
    if (proactiveForUser.current === latestUserId) return;
    const timer = window.setTimeout(() => {
      if (proactiveForUser.current === latestUserId) return;
      proactiveForUser.current = latestUserId;
      void request(`/sessions/${active}/proactive`, {
        userMessageId: latestUserId,

      }).catch(() => { /* A failed nudge must never surface as a fake message. */ });
    }, PROACTIVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, health?.ready, intimate, pendingItems.length, latestUserId, latestUserCreatedAt, latestAssistantId, latestAssistantCreatedAt]);
  useEffect(() => {
    if (followBottom.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [conversation?.messages?.length, active, pendingCount]);

  const send = useCallback(async (sessionId: string, item: Pending, key: string) => {
    if (inFlight.current.has(item.requestId)) return;
    if (!updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "sending" } : existing))) return;
    inFlight.current.add(item.requestId);
    try {
      await request(`/sessions/${sessionId}/messages`, { text: item.text, requestId: item.requestId });
      if (updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "accepted" } : existing))) setError("");
      // Keep the optimistic bubble until native history has the original ID.
      // A timeout never automatically resends a possibly accepted message.
    } catch (failure) {
      const code = failure && typeof failure === "object" && "code" in failure ? failure.code : undefined;
      const uncertain = !code || ["DELIVERY_UNCERTAIN", "NATIVE_ACK_TIMEOUT", "NATIVE_OFFLINE"].includes(String(code));
      updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: uncertain ? "uncertain" : "failed" } : existing));
      setError(failure instanceof Error ? failure.message : "消息没能送达。");
    } finally { inFlight.current.delete(item.requestId); }
  }, [updatePending]);

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
      if (failure && typeof failure === "object" && "code" in failure && failure.code === "RECEIPT_NOT_FOUND") {
        // The durable coordinator writes a receipt before forwarding any send.
        // An authoritative missing receipt means this completed attempt never
        // crossed that boundary. Offer an explicit retry; never resend here.
        updatePending(key, items => items.map(existing => existing.requestId === item.requestId ? { ...existing, state: "failed" } : existing));
        setError("这条消息尚未发送。可以调整内容后重试，或继续输入新消息。");
        return;
      }
      setError(failure instanceof Error ? failure.message : "聊天记录暂时无法读取，请稍后再检查。");
    } finally { inFlight.current.delete(checkKey); }
  }, [updatePending]);

  function openCustomize(mode: "new" | "current") {
    const saved = conversation?.style;
    setStyle(mode === "current" && saved?.version === 1 ? saved : presetStyle);
    setDraftMode(mode);
    setShowCreate(true);
  }

  async function saveCustomize() {
    if (draftMode === "current" && active) {
      setCreating(true);
      try {
        const result = await request<{ style: CompanionStyle }>(`/sessions/${active}/style`, { style }, undefined, "PUT");
        setConversation(previous => previous && previous.id === active ? { ...previous, style: result.style } : previous);
        setShowCreate(false);
        setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "这套设定暂时没能保存。"); }
      finally { setCreating(false); }
      return;
    }
    await createConversation();
  }

  async function createConversation() {
    setCreating(true);
    try {
      const result = await request<{ session: Conversation }>("/sessions", { characterId: "yume", requestId: crypto.randomUUID(), style });
      if (intimate && health?.clientScope) rememberIntimateSession(health.clientScope, result.session.id);
      setSessions(previous => [result.session, ...previous]);
      followBottom.current = true;
      setActive(result.session.id); setError(""); setShowCreate(false);
      composer.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "暂时无法开始聊天。"); }
    finally { setCreating(false); }
  }

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

  function submit() {
    if (!active || !pendingKey || !draft.trim() || !health?.ready || deliveryBlocked) {
      if (deliveryBlocked) setError("已有消息的送达结果尚未确认，请先检查聊天记录，暂勿重复发送。");
      return;
    }
    const item: Pending = { requestId: crypto.randomUUID(), text: draft.trim(), createdAt: new Date().toISOString(), state: "sending" };
    if (!updatePending(pendingKey, items => [...items, item])) return;
    followBottom.current = true;
    setDraft("");
    if (storage) localStorage.removeItem(`${storage}:${active}:draft`);
    void send(active, item, pendingKey);
    composer.current?.focus();
  }

  return <section className={styles.chat} aria-label={`与${name}聊天`}>
        <header className={styles.chatHeader}>
          {onBack && <button className={styles.mobileBack} aria-label="返回聊天列表" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>}
          <span className={styles.avatar} aria-hidden="true"><img src={portrait} alt="" /></span>
          <div className={styles.identity}><h1>{name}</h1><p>{variant === "traveler" ? "旅行摄影师 · 海岸影集" : intimate ? "古籍修复师 · 海上来信" : "钢琴家 · 雨夜音乐会"}</p></div>
          <div className={styles.chatActions}>
            <select className={styles.historySelect} aria-label={`选择与${name}的历史对话`} value={active || ""} disabled={!sessions.length} onChange={event => { followBottom.current = true; setActive(event.target.value); }}>
              {!active && <option value="">聊天记录</option>}
              {sessions.map(item => <option key={item.id} value={item.id}>{displayTitle(item.title, name, intimate)}</option>)}
            </select>
            <button className={`${styles.newChat} ${styles.customize}`} disabled={!active || creating} onClick={() => openCustomize("current")} aria-label={`定制${name}`} title="定制当前聊天">
              <span>定制</span>
            </button>
            <button className={styles.newChat} disabled={!health?.ready || creating} onClick={() => openCustomize("new")} aria-label={`和${name}开始新的聊天`} title="新的聊天">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg><span>新聊天</span>
            </button>
          </div>
        </header>
        <div className={styles.timeline} role="log" aria-label="聊天消息" aria-live="polite" onScroll={event => { const element = event.currentTarget; followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }}>
          {!health?.ready && !conversation?.messages?.length ? <div className={styles.empty}>
            <span aria-hidden="true">♡</span><h2>{health?.reason === "not_configured" ? `${name}暂未开放` : health?.reason === "starting" ? `${name}正在启动` : health?.reason === RECOVERY_REVIEW_CODE ? "聊天需要恢复核查" : health || error ? `暂时连接不上${name}` : `正在连接${name}`}</h2>
            <p>{health?.reason === "not_configured" ? "聊天服务还在准备中，现在暂时无法发送消息。" : health?.reason === "starting" ? "他正在准备见你，通常需要几十秒。" : health?.reason === RECOVERY_REVIEW_CODE ? "已有聊天状态已被保护，暂时不会发送新消息。" : health || error ? "请稍后重新连接。" : "稍等一下。"}</p>
            <button disabled={resetting} onClick={() => setBoot(value => value + 1)}>{health?.reason === "not_configured" ? "检查服务状态" : health?.reason === "starting" ? "立即重试" : health?.reason === RECOVERY_REVIEW_CODE ? "重新检查恢复状态" : "重新连接"}</button>
            {health?.reason === RECOVERY_REVIEW_CODE && !intimate && <button disabled={resetting} onClick={() => void abandonAndRebuild()}>{resetting ? "正在重建…" : "放弃异常聊天并重建"}</button>}
          </div> : !active ? <div className={styles.empty}><span aria-hidden="true">♡</span><h2>{`和${name}说句话`}</h2><p>{intimate ? "想说的可以直接说。" : "今天的小事，也可以慢慢聊。"}</p><button disabled={creating || !health?.ready} onClick={() => openCustomize("new")}>开始聊天</button></div> : <>
            {!health?.ready && <div className={styles.thinking}>记录还在，他正在醒来…</div>}
            {!conversation?.messages?.length && health?.ready && <p className={styles.startNote}>{intimate ? "从一句想说的开始。" : "从一句「你好」开始。"}</p>}
            {visibleMessages.map(message => {
              const media = normalizeMedia(message);
              const pendingItem = message.pendingState && message.requestId && typeof message.text === "string"
                ? { requestId: message.requestId, text: message.text, createdAt: message.createdAt, state: message.pendingState } satisfies Pending
                : null;
              return <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.mine : styles.hers}`} aria-label={message.role === "user" ? "你的消息" : `${name}的回复`}>
                {message.role === "assistant" && <span className={styles.smallAvatar} aria-hidden="true"><img src={portrait} alt="" loading="lazy" /></span>}
                <div>{message.role === "assistant" && <div className={styles.sender}>{name} <time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>}{message.text && <p>{stripStyle(message.text)}</p>}{media.length > 0 && <MessageMediaView items={media} />}{message.pendingState && <small className={styles.delivery}>{message.pendingState === "uncertain"
                  ? <button disabled={!pendingItem} onClick={() => pendingKey && pendingItem && void checkDelivery(active, pendingItem, pendingKey)}>送达待确认 · 检查记录</button>
                  : message.pendingState === "failed"
                    ? <button disabled={!pendingItem} onClick={() => pendingKey && pendingItem && void send(active, pendingItem, pendingKey)}>发送失败 · 重试</button>
                    : message.pendingState === "accepted" ? "已送达 · 同步记录中" : "发送中"}</small>}</div>
              </article>;
            })}
            {conversation?.connection === "offline" && <div className={styles.thinking}>连接暂时中断，正在重连…</div>}
            {conversation?.error && <div className={styles.error} role="alert">{conversation.error}</div>}
          </>}
          <div ref={bottom} />
        </div>
        {(error || syncError) && <div className={styles.error} role="alert">{error || syncError}<button aria-label="关闭提示" onClick={() => { setError(""); setSyncError(""); }}>×</button></div>}
        {active && health?.ready && <form className={styles.composer} onSubmit={event => { event.preventDefault(); submit(); }}>
          {/* Keep drafting available locally, but block a new send while an
           * ambiguous receipt is being checked. */}
          <div className={styles.composerBox}><textarea ref={composer} aria-label="消息" placeholder={intimate ? "想说什么，就慢慢说…" : "想说什么，就发给他…"} maxLength={4000} rows={2} value={draft}
            onChange={event => { setDraft(event.target.value); if (storage) localStorage.setItem(`${storage}:${active}:draft`, event.target.value); }}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
          <button type="submit" disabled={!draft.trim() || deliveryBlocked} aria-label={deliveryBlocked ? "送达待确认，暂不能发送" : "发送消息"}>↑</button></div>
          <div className={styles.composerHint}><span>{deliveryBlocked ? "有一条消息的送达结果待确认，请先检查记录" : <>{sendingCount > 0 ? `正在发送 ${sendingCount} 条 · ` : ""}Enter 发送 · Shift + Enter 换行{billing?.enabled ? ` · 每条 ${billing.creditsPerMessage} Credit` : ""}</>}</span><a className={styles.attribution} href="https://github.com/Mai-with-u/MaiBot" target="_blank" rel="noreferrer">由 MaiBot 驱动 ↗</a></div>
        </form>}
        {showCreate && <div className={styles.createOverlay} role="dialog" aria-modal="true" aria-label={draftMode === "current" && active ? `定制${name}` : `和${name}的新聊天`}>
          <form className={styles.createDialog} onSubmit={event => { event.preventDefault(); void saveCustomize(); }}>
            <h2>{draftMode === "current" && active ? `定制${name}` : `和${name}的新聊天`}</h2>
            <p>{draftMode === "current" && active ? "保存后，从你的下一条消息开始按这套设定说话。已经发出去的话不会改。" : intimate ? "这套设定只给沈聿的这段新对话，不会改 陆时予。" : "这套设定只给这段新对话。"}</p>
            <label>性格<textarea maxLength={600} value={style.personality} onChange={event => setStyle(value => ({ ...value, personality: event.target.value }))} /></label>
            <label>说话风格<textarea maxLength={600} value={style.speakingStyle} onChange={event => setStyle(value => ({ ...value, speakingStyle: event.target.value }))} /></label>
            <label>相处方式<textarea maxLength={600} value={style.relationshipStyle} onChange={event => setStyle(value => ({ ...value, relationshipStyle: event.target.value }))} /></label>
            <div className={styles.createActions}><button type="button" onClick={() => setShowCreate(false)}>取消</button><button type="submit" disabled={creating || !style.personality.trim() || !style.speakingStyle.trim() || !style.relationshipStyle.trim()}>{draftMode === "current" && active ? "保存" : "创建并开始"}</button></div>
          </form>
        </div>}
      </section>;
}
