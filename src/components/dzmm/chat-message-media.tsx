"use client";

/* eslint-disable @next/next/no-img-element -- Private generated media is served by the authenticated Worker. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchDzmmChatMedia, fingerprintDzmmChatMedia, generateDzmmChatIllustration, generateDzmmChatMedia, resolveDzmmChatMediaResult, DzmmChatMediaError,
  type DzmmChatMediaAsset, type DzmmChatMediaGenerateKind, type DzmmChatMediaKind, type DzmmChatMediaOverview, type DzmmChatMediaTarget } from "../../lib/dzmm-chat-media";
import type { DzmmIllustrationDraft } from "../../lib/dzmm-illustration";
import { dzmmCloudRequest } from "../../lib/dzmm-cloud";
import { fetchDzmmPaymentWallet } from "../../lib/dzmm-payments";
import type { DzmmSavedMessage } from "../../lib/dzmm-storage";
import Icon from "./icons";
import s from "./chat-message-media.module.css";
import { xumengPage, xumengPageFill } from "../../lib/xumeng-page-copy";
import { XUMENG_DEFAULT_LOCALE, type XumengLocale } from "../../lib/xumeng-i18n";
import { XUMENG_GENERATION_WORKSPACE_ENABLED, XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import { CHAT_SEGMENT_VIDEO_CREDITS, CHAT_SEGMENT_VIDEO_SECONDS } from "../../lib/xumeng-canvas-billing";
import XumengMomentStatusCard, { type MomentField, type MomentSection } from "./xumeng-moment-status";
import { VoiceNote } from "./voice-note";

const MEDIA_CREDIT_COST = { audio: 20, image: 100 } as const;
const SEGMENT_VIDEO_SECONDS = CHAT_SEGMENT_VIDEO_SECONDS;
const SEGMENT_VIDEO_CREDITS = CHAT_SEGMENT_VIDEO_CREDITS;
const SEGMENT_BLOCKED = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b/i;

function segmentVideoPrompt(text: string): string | null {
  const body = text.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (!body || SEGMENT_BLOCKED.test(body)) return null;
  return body;
}

async function referenceDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("角色封面没有读到，暂时不能生成视频。");
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) throw new Error("角色封面需要是 PNG、JPG 或 WebP，才能生成视频。");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("角色封面没有读到。"));
    reader.onerror = () => reject(new Error("角色封面没有读到。"));
    reader.readAsDataURL(blob);
  });
}
const chatPhotoPreviewCache = new Map<string, string>();
const chatPhotoPreviewInflight = new Map<string, Promise<string>>();

function chatPhotoPreview(url: string, refresh = false): Promise<string> {
  if (refresh) chatPhotoPreviewCache.delete(url);
  else {
    const cached = chatPhotoPreviewCache.get(url);
    if (cached) return Promise.resolve(cached);
    const pending = chatPhotoPreviewInflight.get(url);
    if (pending) return pending;
  }
  const job = (async () => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("image");
    const blob = await response.blob();
    const original = URL.createObjectURL(blob);
    const keepOriginal = () => { chatPhotoPreviewCache.set(url, original); return original; };
    if (blob.size < 180_000 || typeof createImageBitmap !== "function") return keepOriginal();
    try {
      const bitmap = await createImageBitmap(blob);
      const longest = Math.max(bitmap.width, bitmap.height);
      const scale = longest > 960 ? 960 / longest : 1;
      if (scale === 1 && blob.size < 700_000) { bitmap.close(); return keepOriginal(); }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) { bitmap.close(); return keepOriginal(); }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const compact = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!compact || compact.size >= blob.size) return keepOriginal();
      URL.revokeObjectURL(original);
      const preview = URL.createObjectURL(compact);
      chatPhotoPreviewCache.set(url, preview);
      return preview;
    } catch {
      return keepOriginal();
    }
  })().finally(() => { chatPhotoPreviewInflight.delete(url); });
  chatPhotoPreviewInflight.set(url, job);
  return job;
}
const mediaOverviewCache = new Map<string, DzmmChatMediaOverview>();
const mediaOverviewKey = (accountId: string, conversationId: string) => `${accountId}\n${conversationId}`;
function rememberMediaOverview(accountId: string, conversationId: string, value: DzmmChatMediaOverview) {
  if (value.accountId !== accountId || value.conversationId !== conversationId) return;
  const key = mediaOverviewKey(accountId, conversationId);
  mediaOverviewCache.delete(key);
  mediaOverviewCache.set(key, value);
  while (mediaOverviewCache.size > 20) {
    const oldest = mediaOverviewCache.keys().next().value;
    if (oldest === undefined) break;
    mediaOverviewCache.delete(oldest);
  }
}

type MediaContext = {
  conversationId: string;
  overview: DzmmChatMediaOverview | null;
  credits: number | null;
  generation: { messageId: string; kind: DzmmChatMediaGenerateKind } | null;
  error: DzmmChatMediaTarget & { text: string; credits: boolean; recovery?: boolean } | null;
  unconfirmed: DzmmChatMediaTarget[];
  reading: boolean;
  readError: string | null;
  reload: () => Promise<boolean>;
  saveNow: () => Promise<void>;
  refreshCredits: () => void;
  generate: (messageId: string, kind: DzmmChatMediaGenerateKind, sourceText: string, draft?: DzmmIllustrationDraft, regenerate?: boolean) => Promise<void>;
  requireAccount: () => boolean;
  onRecharge: (reason?: string) => void;
};
const Context = createContext<MediaContext | null>(null);

function latestSceneImage(overview: DzmmChatMediaOverview | null): string | null {
  let best: DzmmChatMediaAsset | null = null;
  for (const asset of overview?.assets ?? []) {
    if (asset.kind !== "image") continue;
    if (!best || asset.createdAt > best.createdAt || (asset.createdAt === best.createdAt && asset.id > best.id)) best = asset;
  }
  return best?.url ?? null;
}

export function ChatMediaProvider({ accountId, conversationId, isGuest, refreshKey = 0, saveNow, onRequireAccount, onRecharge, onCharged, onSceneImage, imageTemplate, children }: {
  accountId?: string; conversationId: string; isGuest: boolean; refreshKey?: number; saveNow: () => Promise<void>;
  onRequireAccount: () => void; onRecharge: (reason?: string) => void; onCharged?: () => void;
  onSceneImage?: (conversationId: string, url: string | null) => void;
  /** SillyTavern-style image generation templates (undefined disables them). */
  imageTemplate?: unknown; children: ReactNode;
}) {
  const [overview, setOverview] = useState<DzmmChatMediaOverview | null>(() =>
    accountId ? mediaOverviewCache.get(mediaOverviewKey(accountId, conversationId)) ?? null : null);
  const [credits, setCredits] = useState<number | null>(null);
  const creditsRef = useRef<number | null>(null);
  const [generation, setGeneration] = useState<MediaContext["generation"]>(null);
  const [error, setError] = useState<MediaContext["error"]>(null);
  const [unconfirmed, setUnconfirmed] = useState<DzmmChatMediaTarget[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const generating = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const initialRead = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const readSequence = useRef(0);
  const scope = useRef({ accountId, conversationId });
  scope.current = { accountId, conversationId };
  const reportScene = useRef(onSceneImage);
  reportScene.current = onSceneImage;
  useEffect(() => {
    reportScene.current?.(conversationId, latestSceneImage(overview));
  }, [conversationId, overview]);

  const acceptOverview = useCallback((value: DzmmChatMediaOverview) => {
    if (accountId) rememberMediaOverview(accountId, conversationId, value);
    setOverview(value);
    setReadError(null);
    setUnconfirmed(previous => previous.filter(target => resolveDzmmChatMediaResult(value, target).state === "unknown"));
    setError(previous => {
      if (!previous) return null;
      const result = resolveDzmmChatMediaResult(value, previous);
      if (result.state === "ready" || result.state === "pending") return null;
      return result.state === "absent" && previous.recovery
        ? { ...previous, text: "没有找到已完成或进行中的素材，可以重新生成。", recovery: false } : previous;
    });
  }, [accountId, conversationId]);

  const read = useCallback(async (ignoreUnsaved = false) => {
    if (!accountId || generating.current) return false;
    initialRead.current?.abort();
    const abort = new AbortController();
    initialRead.current = abort;
    const sequence = ++readSequence.current;
    const active = () => !abort.signal.aborted && sequence === readSequence.current
      && scope.current.accountId === accountId && scope.current.conversationId === conversationId;
    setReading(true);
    setReadError(null);
    try {
      const value = await fetchDzmmChatMedia(accountId, conversationId, abort.signal);
      if (!active()) return false;
      acceptOverview(value);
      return true;
    } catch (failure) {
      // Only a new unsaved conversation's initial 404 is expected. Never hide
      // network failures or mistake unavailable cached media for new content.
      if (active() && !(ignoreUnsaved && failure instanceof DzmmChatMediaError && failure.status === 404))
        setReadError("会话素材加载失败，请重新加载。");
      return false;
    } finally {
      if (active()) setReading(false);
    }
  }, [accountId, conversationId, acceptOverview]);
  const reload = useCallback(() => read(), [read]);
  useEffect(() => {
    setOverview(accountId ? mediaOverviewCache.get(mediaOverviewKey(accountId, conversationId)) ?? null : null);
    setError(null); setUnconfirmed([]); setGeneration(null);
    generating.current = false;
    void read(true);
    return () => { initialRead.current?.abort(); controller.current?.abort(); operation.current++; readSequence.current++; };
  }, [read]);
  useEffect(() => {
    if (!accountId || isGuest) { creditsRef.current = null; setCredits(null); return; }
    const abort = new AbortController();
    void fetchDzmmPaymentWallet(abort.signal).then(wallet => {
      if (abort.signal.aborted || wallet.accountId !== accountId) return;
      creditsRef.current = wallet.balance;
      setCredits(wallet.balance);
    }).catch(() => { if (!abort.signal.aborted) { creditsRef.current = null; setCredits(null); } });
    return () => abort.abort();
  }, [accountId, isGuest, refreshKey]);

  const requireAccount = useCallback(() => {
    if (!accountId || isGuest) { onRequireAccount(); return true; }
    return false;
  }, [accountId, isGuest, onRequireAccount]);
  const refreshCredits = useCallback(() => {
    if (!accountId || isGuest) return;
    void fetchDzmmPaymentWallet().then(wallet => {
      if (wallet.accountId !== accountId) return;
      creditsRef.current = wallet.balance;
      setCredits(wallet.balance);
      onCharged?.();
    }).catch(() => {});
  }, [accountId, isGuest, onCharged]);
  const generate = useCallback(async (messageId: string, kind: DzmmChatMediaGenerateKind, sourceText: string, draft?: DzmmIllustrationDraft, regenerate = false) => {
    if (!accountId || isGuest) { onRequireAccount(); return; }
    if (generating.current) return;
    generating.current = true;
    // An older initial read must not replace newly generated assets or usage.
    initialRead.current?.abort();
    readSequence.current++;
    setReading(false);
    const abort = new AbortController();
    controller.current = abort;
    const serial = ++operation.current;
    const active = () => !abort.signal.aborted && operation.current === serial
      && scope.current.accountId === accountId && scope.current.conversationId === conversationId;
    let target: DzmmChatMediaTarget | null = null;
    let submitted = false;
    setError(null);
    setGeneration({ messageId, kind });
    try {
      target = { messageId, kind, sourceHash: await fingerprintDzmmChatMedia(sourceText, kind) };
      if (!active()) return;
      const cost = MEDIA_CREDIT_COST[kind];
      let available = creditsRef.current;
      if (available === null) {
        const wallet = await fetchDzmmPaymentWallet(abort.signal);
        if (!active()) return;
        if (wallet.accountId !== accountId) throw new Error("账户已切换，请刷新后再试。");
        available = wallet.balance;
        creditsRef.current = available;
        setCredits(available);
      }
      if (available < cost) {
        setError({ ...target, text: `当前可用 ${available} 金币，${kind === "audio" ? "生成语音" : "生成图片"}需要 ${cost} 金币。`, credits: true });
        return;
      }
      try {
        await saveNow();
      } catch (syncError) {
        const stored = await dzmmCloudRequest<{ conversation?: { messages?: { id?: string; content?: string }[] } }>(`/conversations/${encodeURIComponent(conversationId)}`).catch(() => null);
        const same = stored?.conversation?.messages?.some(item => item.id === messageId && item.content === sourceText) ?? false;
        if (!same) throw syncError;
      }
      if (!active()) return;
      const current = await fetchDzmmChatMedia(accountId, conversationId, abort.signal);
      if (!active()) return;
      acceptOverview(current);
      const existing = resolveDzmmChatMediaResult(current, target);
      if (existing.state === "pending" || (existing.state === "ready" && !regenerate)) return;
      if (kind === "image" && !XUMENG_GENERATION_WORKSPACE_ENABLED) throw new Error("图片生成已暂停开放。");
      if (!current.features[kind]) throw new Error(kind === "audio" ? "语音服务暂时不可用，请稍后重试。" : "图片服务暂时不可用，请稍后重试。");
      submitted = true;
      const asset = kind === "image" && draft
        ? await generateDzmmChatIllustration(accountId, conversationId, messageId, draft, abort.signal)
        : await generateDzmmChatMedia(accountId, conversationId, messageId, kind, abort.signal, regenerate, imageTemplate);
      if (!active()) return;
      if (asset.sourceHash !== target.sourceHash) throw new DzmmChatMediaError(502, "消息正文已经变化，请检查当前消息的素材。");
      const completed = target;
      setOverview(previous => previous ? { ...previous, assets: [...previous.assets.filter(item => item.id !== asset.id), asset],
        ...(previous.pending !== undefined ? { pending: previous.pending.filter(item => item.id !== asset.id) } : {}) } : previous);
      setUnconfirmed(previous => previous.filter(item => !sameTarget(item, completed)));
      const updated = await fetchDzmmChatMedia(accountId, conversationId, abort.signal).catch(() => null);
      if (updated && active()) acceptOverview(updated);
      const wallet = await fetchDzmmPaymentWallet(abort.signal).catch(() => null);
      if (wallet && active() && wallet.accountId === accountId) { creditsRef.current = wallet.balance; setCredits(wallet.balance); onCharged?.(); }
    } catch (failure) {
      if (!active() || !target) return;
      const failedTarget = target;
      setError({ ...failedTarget, text: failure instanceof Error ? failure.message : "生成失败，请稍后重试。",
        credits: failure instanceof DzmmChatMediaError && failure.status === 402 });
      if (submitted) {
        // A failed response can follow a committed result. Recovery is GET-only;
        // never submit another job to discover whether the first one completed.
        try {
          const recovered = await fetchDzmmChatMedia(accountId, conversationId, abort.signal);
          if (!active()) return;
          acceptOverview(recovered);
          if (resolveDzmmChatMediaResult(recovered, failedTarget).state !== "unknown") return;
        } catch {
          if (!active()) return;
          setReadError("会话素材加载失败，请检查生成结果。");
        }
        setUnconfirmed(previous => [...previous.filter(item => !sameTarget(item, failedTarget)), failedTarget]);
        setError({ ...failedTarget, text: "生成结果暂未确认，请检查结果后再试。", credits: false, recovery: true });
      }
    } finally {
      if (operation.current === serial) generating.current = false;
      if (active()) setGeneration(null);
    }
  }, [accountId, conversationId, isGuest, onRequireAccount, onCharged, saveNow, acceptOverview]);

  return <Context.Provider value={{ conversationId, overview, credits, generation, error, unconfirmed, reading, readError, reload, saveNow, refreshCredits, generate, requireAccount, onRecharge }}>
    {readError && <div className={`${s.feedback} ${s.readNotice}`} role="alert"><p>{readError}</p>
      <button type="button" disabled={reading || Boolean(generation)} onClick={() => { void reload(); }}>重新加载素材</button></div>}
    {reading && <div className={`${s.progress} ${s.readNotice}`} role="status">正在加载会话素材…</div>}
    {children}
  </Context.Provider>;
}

const sameTarget = (left: DzmmChatMediaTarget, right: DzmmChatMediaTarget) => left.messageId === right.messageId
  && left.kind === right.kind && left.sourceHash === right.sourceHash;

function MessageAudio({ asset, reload, busy }: { asset: DzmmChatMediaAsset; reload: () => Promise<boolean>; busy: boolean }) {
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const partial = asset.audioTextChars !== undefined && asset.totalTextChars !== undefined && asset.audioTextChars < asset.totalTextChars;
  return <div className={s.voice}>
    <VoiceNote key={attempt} src={asset.url} label="角色语音" assetId={asset.id} onError={() => setFailed(true)} />
    {partial && <small className={s.partial}>本段朗读前 {asset.audioTextChars?.toLocaleString("zh-CN")} 字</small>}
    {failed && <div className={s.feedback} role="alert"><p className={s.error}>语音加载失败。</p>
      {busy && <p>正在生成素材，完成后可重新加载。</p>}
      <button type="button" disabled={retrying || busy} onClick={() => {
        setRetrying(true);
        void reload().then(loaded => { if (loaded) { setFailed(false); setAttempt(value => value + 1); } })
          .finally(() => setRetrying(false));
      }}>{retrying ? "正在重新加载…" : "重新加载语音"}</button></div>}
  </div>;
}

function MessagePicture({ asset, reload, onExpand, busy, original = false }: {
  asset: DzmmChatMediaAsset; reload: () => Promise<boolean>; onExpand?: () => void; busy: boolean; original?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{ url: string; attempt: number; src: string } | null>(null);
  const cachedNow = !original && attempt === 0 ? chatPhotoPreviewCache.get(asset.url) ?? null : null;
  const displayUrl = original
    ? (attempt > 0 ? `${asset.url}?r=${attempt}` : asset.url)
    : (preview && preview.url === asset.url && preview.attempt === attempt ? preview.src : cachedNow);
  useEffect(() => {
    if (original) return;
    if (attempt === 0 && chatPhotoPreviewCache.get(asset.url)) return;
    let active = true;
    void chatPhotoPreview(asset.url, attempt > 0).then(next => {
      if (active) setPreview({ url: asset.url, attempt, src: next });
    }).catch(() => { if (active) setPreview({ url: asset.url, attempt, src: asset.url }); });
    return () => { active = false; };
  }, [asset.url, attempt, original]);
  if (failed) return <div className={`${s.feedback} ${s.pictureFailure}`} role="alert"><p className={s.error}>剧情图片加载失败。</p>
    {busy && <p>正在生成素材，完成后可重新加载。</p>}
    <button type="button" disabled={retrying || busy} onClick={() => {
      setRetrying(true);
      void reload().then(loaded => { if (loaded) { setAttempt(value => value + 1); setFailed(false); } })
        .finally(() => setRetrying(false));
    }}>{retrying ? "正在重新加载…" : "重新加载图片"}</button></div>;
  if (!displayUrl) return <div className={s.progress} role="status"><span className={s.loader} />正在整理画面…</div>;
  const picture = <img key={`${original ? "orig" : "thumb"}:${attempt}:${displayUrl}`} src={displayUrl} alt={onExpand ? "根据这条消息生成的剧情场景" : "剧情场景 2K 原图"}
    decoding="async" loading={onExpand ? "lazy" : "eager"} onError={() => setFailed(true)} />;
  return onExpand ? <button type="button" aria-label="放大查看 2K 原图" onClick={onExpand}>{picture}</button> : picture;
}

export function ChatMessageMedia({ message, disabled, onCopy, onEdit, onRegenerate, onSwipe, autoGenerate, onAutoGenerated, autoVideo, onAutoVideoDone, recentContext, children, label, moment, referenceImage, locale = XUMENG_DEFAULT_LOCALE, extra }: {
  message: DzmmSavedMessage; disabled: boolean; onCopy: () => void; onEdit: () => void;
  onRegenerate?: () => void; onSwipe?: (direction: -1 | 1) => void;
  autoGenerate?: boolean; onAutoGenerated?: (messageId: string) => void;
  autoVideo?: boolean; onAutoVideoDone?: (messageId: string) => void;
  recentContext?: string;
  children: ReactNode; label: string;
  moment?: { name: string; fields: MomentField[]; sections?: MomentSection[]; open?: boolean; pending?: boolean };
  referenceImage?: string;
  locale?: XumengLocale; extra?: ReactNode;
}) {
  const media = useContext(Context);
  const [fingerprint, setFingerprint] = useState<{ text: string; audio: string; image: string; video: string } | null>(null);
  const [expanded, setExpanded] = useState<DzmmChatMediaAsset | null>(null);
  const [segmentUrl, setSegmentUrl] = useState<string | null>(null);
  const [segmentSource, setSegmentSource] = useState<"scene" | "cover" | null>(null);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const hasRecord = Boolean(media?.overview?.assets.some(asset => asset.messageId === message.id)
    || media?.overview?.pending?.some(item => item.messageId === message.id)
    || media?.unconfirmed.some(item => item.messageId === message.id) || media?.error?.messageId === message.id);
  const mutationDisabled = disabled || Boolean(media?.generation);
  useEffect(() => {
    if (expanded && media?.overview && !media.reading && !media.readError && fingerprint?.text === message.content
      && !media.overview.assets.some(asset => asset.id === expanded.id && asset.sourceHash === fingerprint.image)) setExpanded(null);
  }, [expanded, media?.overview, media?.reading, media?.readError, fingerprint, message.content]);
  useEffect(() => {
    if (!hasRecord) return;
    let active = true;
    void Promise.all([
      fingerprintDzmmChatMedia(message.content, "audio"),
      fingerprintDzmmChatMedia(message.content, "image"),
      fingerprintDzmmChatMedia(message.content, "video"),
    ]).then(([audio, image, video]) => { if (active) setFingerprint({ text: message.content, audio, image, video }); }).catch(() => {});
    return () => { active = false; };
  }, [message.content, hasRecord]);
  useEffect(() => () => { if (segmentUrl) URL.revokeObjectURL(segmentUrl); }, [segmentUrl]);
  useEffect(() => {
    if (!expanded) return;
    const current = dialog.current;
    current?.showModal();
    return () => { current?.close(); };
  }, [expanded]);
  const sameSource = (item: { messageId: string; kind: DzmmChatMediaKind; sourceHash: string }) => {
    if (!fingerprint || fingerprint.text !== message.content) return false;
    const expected = item.kind === "audio" ? fingerprint.audio : item.kind === "video" ? fingerprint.video : fingerprint.image;
    return item.messageId === message.id && item.sourceHash === expected;
  };
  const assets = fingerprint ? media?.overview?.assets.filter(sameSource) ?? [] : [];
  const pending = fingerprint ? media?.overview?.pending?.filter(sameSource) ?? [] : [];
  const unconfirmed = fingerprint ? media?.unconfirmed.filter(sameSource) ?? [] : [];
  const audio = assets.find(asset => asset.kind === "audio"), image = assets.find(asset => asset.kind === "image"), video = assets.find(asset => asset.kind === "video");
  const audioPending = !audio && pending.some(item => item.kind === "audio"), imagePending = !image && pending.some(item => item.kind === "image");
  const audioUnconfirmed = !audio && unconfirmed.some(item => item.kind === "audio"), imageUnconfirmed = !image && unconfirmed.some(item => item.kind === "image");
  const generating = media?.generation?.messageId === message.id ? media.generation.kind : null;
  const error = media?.error && fingerprint && sameSource(media.error) ? media.error : null;
  const mediaDisabled = mutationDisabled || Boolean(media?.reading || media?.readError) || !message.content.trim();
  const audioShort = !audio && typeof media?.credits === "number" && media.credits < MEDIA_CREDIT_COST.audio;
  const imageShort = !image && typeof media?.credits === "number" && media.credits < MEDIA_CREDIT_COST.image;
  const audioDisabled = mediaDisabled || audioPending || audioUnconfirmed;
  const imageDisabled = mutationDisabled || imagePending || imageUnconfirmed || !message.content.trim();
  const copy = xumengPage(locale);
  const credits = (cost: number) => xumengPageFill(copy.msgCredit, { cost });
  const voiceCost = MEDIA_CREDIT_COST.audio;
  const imageCost = MEDIA_CREDIT_COST.image;
  const audioAction = generating === "audio" || audioPending ? copy.msgVoiceBusy : audio ? copy.msgVoicePlay : audioUnconfirmed ? copy.msgVoiceHold : copy.msgVoice;
  const imageAction = generating === "image" || imagePending ? copy.msgImageBusy : image ? copy.msgImageView : imageUnconfirmed ? copy.msgImageHold : copy.msgImage;
  const showImageAction = XUMENG_GENERATION_WORKSPACE_ENABLED || Boolean(image || imagePending || imageUnconfirmed);
  const autoImageRef = useRef(false);
  const autoVideoRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoImageRef.current || message.role !== "assistant" || !media) return;
    if (!message.content.trim() || image || imagePending || generating) return;
    autoImageRef.current = true;
    if (imageShort) {
      media.onRecharge(`当前可用 ${media.credits ?? 0} 金币，生成此刻剧情画面需要 ${MEDIA_CREDIT_COST.image} 金币。原位充值后即可继续。`);
      onAutoGenerated?.(message.id);
      return;
    }
    void media.generate(message.id, "image", message.content).finally(() => onAutoGenerated?.(message.id));
  }, [autoGenerate, message.id, message.role, message.content, image, imagePending, imageShort, generating, media, onAutoGenerated]);
  const needsCheck = audioPending || imagePending || audioUnconfirmed || imageUnconfirmed;
  function handleAudio() {
    if (audio) { refocusAudio(); return; }
    if (audioShort && media) {
      media.onRecharge(`当前可用 ${media.credits ?? 0} 金币，生成角色语音需要 ${MEDIA_CREDIT_COST.audio} 金币。充值后立即继续。`);
      return;
    }
    void media?.generate(message.id, "audio", message.content);
  }
  function handleImage(regenerate = false) {
    if (image && !regenerate) { setExpanded(image); return; }
    if ((imageShort || (regenerate && typeof media?.credits === "number" && media.credits < MEDIA_CREDIT_COST.image)) && media) {
      media.onRecharge(`当前可用 ${media.credits ?? 0} 金币，${regenerate ? "重新绘制此刻画面" : "解锁此刻剧情画面"}需要 ${MEDIA_CREDIT_COST.image} 金币。充值后立即继续。`);
      return;
    }
    if (regenerate) setExpanded(null);
    void media?.generate(message.id, "image", message.content, undefined, regenerate);
  }
  const handleSegmentVideo = useCallback(async () => {
    if (!media || media.requireAccount() || segmentBusy || mutationDisabled) return;
    const prompt = segmentVideoPrompt(message.content);
    if (!prompt) { setSegmentError("这一段不能生成视频。"); return; }
    const firstFrameHref = image?.url || referenceImage;
    const usedSceneImage = Boolean(image?.url);
    if (!firstFrameHref) { setSegmentError("需要剧情图或角色封面才能生成视频。"); return; }
    if (typeof media.credits === "number" && media.credits < SEGMENT_VIDEO_CREDITS) {
      const reason = `当前可用 ${media.credits} 金币，生成此刻 5 秒动态视频需要 ${SEGMENT_VIDEO_CREDITS} 金币。`;
      setSegmentError(reason);
      if (XUMENG_PAYMENTS_ENABLED) media.onRecharge(`${reason}原位充值后即可生成。`);
      return;
    }
    setSegmentError(null);
    setSegmentBusy(true);
    setSegmentSource(usedSceneImage ? "scene" : "cover");
    try {
      await media.saveNow().catch(() => undefined);
      let frameDataUrl: string;
      try {
        frameDataUrl = await referenceDataUrl(firstFrameHref);
      } catch (frameErr) {
        if (usedSceneImage && referenceImage) {
          setSegmentSource("cover");
          frameDataUrl = await referenceDataUrl(referenceImage);
        } else {
          throw frameErr;
        }
      }
      const response = await fetch("/api/h3/canvas", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          image: frameDataUrl,
          seconds: SEGMENT_VIDEO_SECONDS,
          conversationId: media.conversationId,
          messageId: message.id,
          ...(recentContext ? { recentContext } : {}),
        }),
      });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("video/mp4")) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof payload?.error === "string" ? payload.error : "视频没有完成。");
      }
      const persistedUrl = response.headers.get("X-Chat-Media-Asset-Url");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setSegmentUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
      media.refreshCredits();
      if (persistedUrl) {
        void media.reload();
      }
    } catch (failure) {
      setSegmentError(failure instanceof Error ? failure.message : "视频没有完成。");
    } finally {
      setSegmentBusy(false);
    }
  }, [media, segmentBusy, mutationDisabled, message.content, message.id, image?.url, referenceImage, recentContext]);
  useEffect(() => {
    if (!autoVideo) { autoVideoRef.current = false; return; }
    if (autoVideoRef.current || message.role !== "assistant" || !media) return;
    autoVideoRef.current = true;
    void handleSegmentVideo().finally(() => onAutoVideoDone?.(message.id));
  }, [autoVideo, message.role, message.id, media, handleSegmentVideo, onAutoVideoDone]);
  const activeVideoSrc = video?.url ?? segmentUrl;
  const videoPersisted = Boolean(video?.url);
  return <div ref={wrapper} className={s.message} tabIndex={0} aria-label={label}>
    {children}
    {moment && message.role === "assistant" && <XumengMomentStatusCard name={moment.name} fields={moment.fields} sections={moment.sections} defaultOpen={false} pending={moment.pending} inlineActions
      imageLabel={image ? "查看此刻画面" : imageAction === copy.msgImage ? "解锁此刻画面" : imageAction}
      imageHint={image ? "这一轮剧情已经画好" : imageShort ? `可用 金币 不足，解锁需要 ${MEDIA_CREDIT_COST.image} 金币` : "根据这一轮剧情生成 · 100 金币"}
      disabled={!showImageAction || imageDisabled} onImage={handleImage}
      slot={image && media ? <figure className={s.picture}>
          <MessagePicture key={`${image.id}:${image.createdAt}`} asset={image} reload={media.reload} busy={Boolean(media.generation)} onExpand={() => setExpanded(image)} />
          <figcaption className={s.pictureBar}>
            <span><Icon name="image" size={13} />这一幕 · 2K 原图可放大</span>
            <div className={s.pictureActions}>
              <button type="button" className={s.pictureChip} disabled={mutationDisabled || segmentBusy} onClick={() => void handleSegmentVideo()} title={`以这张剧情图为首帧生成 5 秒带原声视频 · ${credits(SEGMENT_VIDEO_CREDITS)}`}>
                <Icon name="video" size={12} />{segmentBusy ? "生成视频中…" : "动起来"}
              </button>
              <button type="button" className={s.pictureChip} disabled={imageDisabled || segmentBusy} onClick={() => handleImage(true)} title={`重新绘制一版 · ${credits(imageCost)}`}>
                <Icon name="refresh" size={12} />换一版
              </button>
            </div>
          </figcaption>
        </figure>
        : generating === "image" ? <div className={s.progress} role="status"><span className={s.loader} />正在绘制这一幕…</div> : null} />}
    {message.role === "assistant" && message.swipes && message.swipes.length > 1 && onSwipe && (
      <div className={s.swipes} role="group" aria-label={label}>
        <button type="button" className={s.swipeButton} disabled={mutationDisabled} onClick={() => onSwipe(-1)} aria-label="上一个版本">‹</button>
        <span aria-live="polite">{(message.swipeIndex ?? 0) + 1}/{message.swipes.length}</span>
        <button type="button" className={s.swipeButton} disabled={mutationDisabled} onClick={() => onSwipe(1)} aria-label="下一个版本">›</button>
      </div>
    )}
    <div className={message.role === "user" ? `${s.tools} ${s.userTools}` : s.tools}>
      {message.role === "assistant" && <>
        <button type="button" className={s.action} disabled={!showImageAction || imageDisabled || segmentBusy}
          title={image ? "查看 2K 剧情原图" : `生成此刻剧情图 · ${credits(imageCost)}`}
          aria-label={`${label}${image ? "查看剧情原图" : "生成此刻剧情图"}`}
          onClick={() => handleImage()}><Icon name="image" size={15} /></button>
        <button type="button" className={s.action} disabled={mutationDisabled || segmentBusy || !message.content.trim()}
          title={segmentBusy ? "正在用 MiniMax H3 生成 5 秒动态视频…" : `${image ? "以当前剧情图为首帧" : "以角色封面为首帧"}生成 5 秒带原声视频 · MiniMax H3 · ${credits(SEGMENT_VIDEO_CREDITS)}`}
          aria-label={`${label}生成动态视频`}
          onClick={() => void handleSegmentVideo()}><Icon name="video" size={15} /></button>
      </>}
      <button type="button" className={s.action} title={copy.msgCopy} aria-label={`${copy.msgCopy}${label}`} onClick={onCopy}>
        <Icon name="copy" size={15} /></button>
      <button type="button" className={s.action} disabled={mutationDisabled} title={copy.msgEdit} aria-label={`${copy.msgEdit}${label}`} onClick={onEdit}>
        <Icon name="edit" size={15} /></button>
      {message.role === "assistant" && onRegenerate && <button type="button" className={s.action} disabled={mutationDisabled}
        title={copy.msgRegenerate} aria-label={`${copy.msgRegenerate}${label}`} onClick={onRegenerate}><Icon name="refresh" size={15} /></button>}
      {message.role === "assistant" && media && <>
        <button type="button" className={!audio ? `${s.action} ${s.priced}` : s.action} disabled={audioDisabled} onClick={handleAudio}
          title={audioShort ? xumengPageFill(copy.msgVoiceShort, { cost: voiceCost }) : audioAction === copy.msgVoice ? `${audioAction} · ${credits(voiceCost)}` : audioAction}
          aria-label={`${label}${audioAction}`}>
          <Icon name="volume" size={15} />{!audio && <small>{credits(voiceCost)}</small>}</button>
      </>}
      {extra}
    </div>
    {generating && !(moment && generating === "image") && <div className={s.progress} role="status"><span className={s.loader} />{generating === "audio" ? "正在生成角色语音…" : "正在绘制这一幕…"}</div>}
    {needsCheck && media && <div className={s.feedback} role="status">
      {(audioPending || imagePending) && <p>{audioPending && imagePending ? "语音和图片正在生成。" : audioPending ? "角色语音正在生成。" : "剧情图片正在生成。"}稍后可检查结果。</p>}
      {(audioUnconfirmed || imageUnconfirmed) && !error && <p>生成结果暂未确认，请先检查结果。</p>}
      <button type="button" disabled={media.reading || Boolean(media.generation)} onClick={() => { void media.reload(); }}>
        {media.reading ? "正在检查…" : "检查生成结果"}</button>
    </div>}
    {audio && media && <MessageAudio key={`${audio.id}:${audio.createdAt}`} asset={audio} reload={media.reload} busy={Boolean(media.generation)} />}
    {image && media && !moment && <figure className={s.picture}>
      <MessagePicture key={`${image.id}:${image.createdAt}`} asset={image} reload={media.reload} busy={Boolean(media.generation)} onExpand={() => setExpanded(image)} />
      <figcaption className={s.pictureBar}>
        <span><Icon name="image" size={13} />这一幕 · AI 2K 剧情图</span>
        <div className={s.pictureActions}>
          <button type="button" className={s.pictureChip} disabled={mutationDisabled || segmentBusy} onClick={() => void handleSegmentVideo()} title={`以这张剧情图为首帧生成 5 秒带原声视频 · ${credits(SEGMENT_VIDEO_CREDITS)}`}>
            <Icon name="video" size={12} />{segmentBusy ? "生成中…" : "让这一幕动起来"}
          </button>
          <button type="button" className={s.pictureChip} disabled={imageDisabled || segmentBusy} onClick={() => handleImage(true)} title={`重新绘制一版 · ${credits(imageCost)}`}>
            <Icon name="refresh" size={12} />换一版
          </button>
        </div>
      </figcaption>
    </figure>}
    {segmentBusy && <div className={s.progress} role="status"><span className={s.loader} />{segmentSource === "scene" ? "正在以当前剧情图为首帧，用 MiniMax H3 生成 5 秒带原声视频…" : "正在用 MiniMax H3 生成 5 秒带原声视频…"}</div>}
    {activeVideoSrc && <figure className={s.clip}>
      <video key={activeVideoSrc} src={activeVideoSrc} controls playsInline preload="metadata" />
      <figcaption className={s.clipBar}>
        <span><Icon name="video" size={12} />{videoPersisted ? "已云端保存 · MiniMax H3 5s" : "这一幕 · MiniMax H3 5s"}</span>
        <div className={s.pictureActions}>
          <a className={s.pictureChip} href={activeVideoSrc} download={`xumeng-${message.id.slice(0, 8)}.mp4`}>下载</a>
          <button type="button" className={s.pictureChip} disabled={mutationDisabled || segmentBusy} onClick={() => void handleSegmentVideo()} title={`重新生成 5 秒视频 · ${credits(SEGMENT_VIDEO_CREDITS)}`}>
            <Icon name="refresh" size={12} />重生成
          </button>
        </div>
      </figcaption>
    </figure>}
    {segmentError && <div className={s.feedback} role="status"><p>{segmentError}</p>{segmentError.includes("金币") && media && XUMENG_PAYMENTS_ENABLED && <button type="button" onClick={() => media.onRecharge(segmentError)}>快捷充值<Icon name="chevron" size={14} /></button>}</div>}
    {error && media && <div className={s.feedback} role="status"><p>{error.text}</p>{error.credits && XUMENG_PAYMENTS_ENABLED && <button type="button" onClick={() => media.onRecharge(error.text)}>充值 金币<Icon name="chevron" size={14} /></button>}</div>}
    {expanded && media && <dialog ref={dialog} className={s.lightbox} aria-label="剧情原图预览" onClose={() => setExpanded(null)}
      onClick={event => { if (event.target === event.currentTarget) setExpanded(null); }}>
      <button className={s.lightboxClose} type="button" aria-label="关闭图片预览" onClick={() => setExpanded(null)}><Icon name="close" size={22} /></button>
      <MessagePicture original key={`${expanded.id}:${expanded.createdAt}`} asset={expanded} reload={media.reload} busy={Boolean(media.generation)} />
      <div className={s.lightboxFooter}>
        <p>AI 生成的 2K 剧情原图</p>
        <div className={s.pictureActions}>
          <button type="button" className={s.pictureChip} disabled={mutationDisabled || segmentBusy} onClick={() => { setExpanded(null); void handleSegmentVideo(); }}>
            <Icon name="video" size={12} />让这一幕动起来（{credits(SEGMENT_VIDEO_CREDITS)}）
          </button>
          <button type="button" className={s.pictureChip} disabled={imageDisabled || segmentBusy} onClick={() => handleImage(true)}>
            <Icon name="refresh" size={12} />换一版（{credits(imageCost)}）
          </button>
          <a className={s.pictureChip} href={expanded.url} download={`xumeng-${expanded.id.slice(0, 8)}.jpg`}>下载原图</a>
        </div>
      </div>
    </dialog>}
  </div>;

  function refocusAudio() {
    const audioElement = wrapper.current?.querySelector("audio");
    if (audioElement) { audioElement.focus(); if (audioElement.readyState === 0) audioElement.load(); void audioElement.play().catch(() => {}); }
  }
}
