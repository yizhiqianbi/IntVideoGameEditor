"use client";

/* eslint-disable @next/next/no-img-element -- Private generated media is served by the authenticated Worker. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchDzmmChatMedia, fingerprintDzmmChatMedia, generateDzmmChatIllustration, generateDzmmChatMedia, resolveDzmmChatMediaResult, DzmmChatMediaError,
  type DzmmChatMediaAsset, type DzmmChatMediaKind, type DzmmChatMediaOverview, type DzmmChatMediaTarget } from "../../lib/dzmm-chat-media";
import type { DzmmIllustrationDraft } from "../../lib/dzmm-illustration";
import { dzmmCloudRequest } from "../../lib/dzmm-cloud";
import { fetchDzmmPaymentWallet } from "../../lib/dzmm-payments";
import type { DzmmSavedMessage } from "../../lib/dzmm-storage";
import Icon from "./icons";
import s from "./chat-message-media.module.css";
import { XUMENG_GENERATION_WORKSPACE_ENABLED, XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import XumengMomentStatusCard, { type MomentField, type MomentSection } from "./xumeng-moment-status";
import { VoiceNote } from "./voice-note";

const MEDIA_CREDIT_COST = { audio: 20, image: 100 } as const;
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
  overview: DzmmChatMediaOverview | null;
  credits: number | null;
  generation: { messageId: string; kind: DzmmChatMediaKind } | null;
  error: DzmmChatMediaTarget & { text: string; credits: boolean; recovery?: boolean } | null;
  unconfirmed: DzmmChatMediaTarget[];
  reading: boolean;
  readError: string | null;
  reload: () => Promise<boolean>;
  generate: (messageId: string, kind: DzmmChatMediaKind, sourceText: string, draft?: DzmmIllustrationDraft) => Promise<void>;
  requireAccount: () => boolean;
  onRecharge: () => void;
};
const Context = createContext<MediaContext | null>(null);

export function ChatMediaProvider({ accountId, conversationId, isGuest, saveNow, onRequireAccount, onRecharge, onCharged, children }: {
  accountId?: string; conversationId: string; isGuest: boolean; saveNow: () => Promise<void>;
  onRequireAccount: () => void; onRecharge: () => void; onCharged?: () => void; children: ReactNode;
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
  }, [accountId, isGuest]);

  const requireAccount = useCallback(() => {
    if (!accountId || isGuest) { onRequireAccount(); return true; }
    return false;
  }, [accountId, isGuest, onRequireAccount]);
  const generate = useCallback(async (messageId: string, kind: DzmmChatMediaKind, sourceText: string, draft?: DzmmIllustrationDraft) => {
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
        setError({ ...target, text: `当前可用 ${available} Credit，${kind === "audio" ? "生成语音" : "生成图片"}需要 ${cost} Credit。`, credits: true });
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
      if (existing.state === "ready" || existing.state === "pending") return;
      if (kind === "image" && !XUMENG_GENERATION_WORKSPACE_ENABLED) throw new Error("图片生成已暂停开放。");
      if (!current.features[kind]) throw new Error(kind === "audio" ? "语音服务暂时不可用，请稍后重试。" : "图片服务暂时不可用，请稍后重试。");
      submitted = true;
      const asset = kind === "image" && draft
        ? await generateDzmmChatIllustration(accountId, conversationId, messageId, draft, abort.signal)
        : await generateDzmmChatMedia(accountId, conversationId, messageId, kind, abort.signal);
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

  return <Context.Provider value={{ overview, credits, generation, error, unconfirmed, reading, readError, reload, generate, requireAccount, onRecharge }}>
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

function MessagePicture({ asset, reload, onExpand, busy }: {
  asset: DzmmChatMediaAsset; reload: () => Promise<boolean>; onExpand?: () => void; busy: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed) return <div className={`${s.feedback} ${s.pictureFailure}`} role="alert"><p className={s.error}>剧情图片加载失败。</p>
    {busy && <p>正在生成素材，完成后可重新加载。</p>}
    <button type="button" disabled={retrying || busy} onClick={() => {
      setRetrying(true);
      void reload().then(loaded => { if (loaded) { setAttempt(value => value + 1); setFailed(false); } })
        .finally(() => setRetrying(false));
    }}>{retrying ? "正在重新加载…" : "重新加载图片"}</button></div>;
  const picture = <img key={attempt} src={asset.url} alt={onExpand ? "根据这条消息生成的剧情场景" : "剧情场景大图"}
    loading={onExpand ? "lazy" : "eager"} onError={() => setFailed(true)} />;
  return onExpand ? <button type="button" aria-label="放大剧情图片" onClick={onExpand}>{picture}</button> : picture;
}

export function ChatMessageMedia({ message, disabled, onCopy, onEdit, onRegenerate, children, label, moment }: {
  message: DzmmSavedMessage; disabled: boolean; onCopy: () => void; onEdit: () => void;
  onRegenerate?: () => void; children: ReactNode; label: string;
  moment?: { name: string; fields: MomentField[]; sections?: MomentSection[] };
}) {
  const media = useContext(Context);
  const [fingerprint, setFingerprint] = useState<{ text: string; audio: string; image: string } | null>(null);
  const [expanded, setExpanded] = useState<DzmmChatMediaAsset | null>(null);
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
    ]).then(([audio, image]) => { if (active) setFingerprint({ text: message.content, audio, image }); }).catch(() => {});
    return () => { active = false; };
  }, [message.content, hasRecord]);
  useEffect(() => {
    if (!expanded) return;
    const current = dialog.current;
    current?.showModal();
    return () => { current?.close(); };
  }, [expanded]);
  const sameSource = (item: { messageId: string; kind: DzmmChatMediaKind; sourceHash: string }) => {
    if (!fingerprint || fingerprint.text !== message.content) return false;
    return item.messageId === message.id && item.sourceHash === (item.kind === "audio" ? fingerprint.audio : fingerprint.image);
  };
  const assets = fingerprint ? media?.overview?.assets.filter(sameSource) ?? [] : [];
  const pending = fingerprint ? media?.overview?.pending?.filter(sameSource) ?? [] : [];
  const unconfirmed = fingerprint ? media?.unconfirmed.filter(sameSource) ?? [] : [];
  const audio = assets.find(asset => asset.kind === "audio"), image = assets.find(asset => asset.kind === "image");
  const audioPending = !audio && pending.some(item => item.kind === "audio"), imagePending = !image && pending.some(item => item.kind === "image");
  const audioUnconfirmed = !audio && unconfirmed.some(item => item.kind === "audio"), imageUnconfirmed = !image && unconfirmed.some(item => item.kind === "image");
  const generating = media?.generation?.messageId === message.id ? media.generation.kind : null;
  const error = media?.error && fingerprint && sameSource(media.error) ? media.error : null;
  const mediaDisabled = mutationDisabled || Boolean(media?.reading || media?.readError) || !message.content.trim();
  const audioShort = !audio && typeof media?.credits === "number" && media.credits < MEDIA_CREDIT_COST.audio;
  const imageShort = !image && typeof media?.credits === "number" && media.credits < MEDIA_CREDIT_COST.image;
  const audioDisabled = mediaDisabled || audioPending || audioUnconfirmed || audioShort;
  const imageDisabled = mutationDisabled || imagePending || imageUnconfirmed || imageShort || !message.content.trim();
  const audioAction = generating === "audio" || audioPending ? "生成语音中…" : audio ? "播放语音" : audioUnconfirmed ? "语音结果待确认" : "生成语音";
  const imageAction = generating === "image" || imagePending ? "生成图片中…" : image ? "查看图片" : imageUnconfirmed ? "图片结果待确认" : "生成图片";
  const showImageAction = XUMENG_GENERATION_WORKSPACE_ENABLED || Boolean(image || imagePending || imageUnconfirmed);
  const needsCheck = audioPending || imagePending || audioUnconfirmed || imageUnconfirmed;
  function handleAudio() {
    if (audio) refocusAudio(); else void media?.generate(message.id, "audio", message.content);
  }
  function handleImage() {
    if (image) setExpanded(image);
    else void media?.generate(message.id, "image", message.content);
  }
  return <div ref={wrapper} className={s.message} tabIndex={0} aria-label={label}>
    {children}
    {moment && message.role === "assistant" && <XumengMomentStatusCard name={moment.name} fields={moment.fields} sections={moment.sections}
      imageLabel={image ? "查看此刻画面" : imageAction === "生成图片" ? "解锁此刻画面" : imageAction}
      imageHint={image ? "这一轮剧情已经画好" : imageShort ? `可用 Credit 不足，解锁需要 ${MEDIA_CREDIT_COST.image} Credit` : "根据这一轮剧情生成 · 100 Credit"}
      disabled={!showImageAction || imageDisabled} onImage={handleImage}
      slot={image && media ? <figure className={s.picture}><MessagePicture key={`${image.id}:${image.createdAt}`} asset={image} reload={media.reload} busy={Boolean(media.generation)} onExpand={() => setExpanded(image)} /></figure>
        : generating === "image" ? <div className={s.progress} role="status"><span className={s.loader} />正在绘制这一幕…</div> : null} />}
    <div className={s.tools}>
      <button type="button" className={s.action} aria-label={`复制${label}`} onClick={onCopy}>
        <Icon name="copy" size={15} /><span>复制</span></button>
      <button type="button" className={s.action} disabled={mutationDisabled} aria-label={`编辑${label}`} onClick={onEdit}>
        <Icon name="edit" size={15} /><span>编辑</span></button>
      {message.role === "assistant" && onRegenerate && <button type="button" className={s.action} disabled={mutationDisabled}
        aria-label={`重新生成${label}`} onClick={onRegenerate}><Icon name="refresh" size={15} /><span>重新生成</span></button>}
      {message.role === "assistant" && media && <>
        <button type="button" className={s.action} disabled={audioDisabled} onClick={handleAudio}
          title={audioShort ? `可用 Credit 不足，生成语音需要 ${MEDIA_CREDIT_COST.audio} Credit` : undefined}
          aria-label={`${label}${audioAction}`}>
          <Icon name="volume" size={15} /><span>{audioAction}</span>{!audio && <small>20 Credit</small>}</button>
        {showImageAction && !moment && <button type="button" className={s.action} disabled={imageDisabled} onClick={handleImage}
          title={imageShort ? `可用 Credit 不足，生成图片需要 ${MEDIA_CREDIT_COST.image} Credit` : undefined}
          aria-label={`${label}${imageAction}`}>
          <Icon name="image" size={15} /><span>{imageAction}</span>{!image && <small>100 Credit</small>}</button>}
      </>}
    </div>
    {generating && !(moment && generating === "image") && <div className={s.progress} role="status"><span className={s.loader} />{generating === "audio" ? "正在生成角色语音…" : "正在绘制这一幕…"}</div>}
    {needsCheck && media && <div className={s.feedback} role="status">
      {(audioPending || imagePending) && <p>{audioPending && imagePending ? "语音和图片正在生成。" : audioPending ? "角色语音正在生成。" : "剧情图片正在生成。"}稍后可检查结果。</p>}
      {(audioUnconfirmed || imageUnconfirmed) && !error && <p>生成结果暂未确认，请先检查结果。</p>}
      <button type="button" disabled={media.reading || Boolean(media.generation)} onClick={() => { void media.reload(); }}>
        {media.reading ? "正在检查…" : "检查生成结果"}</button>
    </div>}
    {audio && media && <MessageAudio key={`${audio.id}:${audio.createdAt}`} asset={audio} reload={media.reload} busy={Boolean(media.generation)} />}
    {image && media && !moment && <figure className={s.picture}><MessagePicture key={`${image.id}:${image.createdAt}`} asset={image} reload={media.reload} busy={Boolean(media.generation)} onExpand={() => setExpanded(image)} />
      <figcaption><Icon name="image" size={13} />这一幕 · AI 生成</figcaption></figure>}
    {error && media && <div className={s.feedback} role="status"><p>{error.text}</p>{error.credits && XUMENG_PAYMENTS_ENABLED && <button type="button" onClick={media.onRecharge}>充值 Credit<Icon name="chevron" size={14} /></button>}</div>}
    {expanded && media && <dialog ref={dialog} className={s.lightbox} aria-label="剧情图片预览" onClose={() => setExpanded(null)}
      onClick={event => { if (event.target === event.currentTarget) setExpanded(null); }}>
      <button className={s.lightboxClose} type="button" aria-label="关闭图片预览" onClick={() => setExpanded(null)}><Icon name="close" size={22} /></button>
      <MessagePicture key={`${expanded.id}:${expanded.createdAt}`} asset={expanded} reload={media.reload} busy={Boolean(media.generation)} /><p>AI 生成的剧情场景</p>
    </dialog>}
  </div>;

  function refocusAudio() {
    const audioElement = wrapper.current?.querySelector("audio");
    if (audioElement) { audioElement.focus(); if (audioElement.readyState === 0) audioElement.load(); void audioElement.play().catch(() => {}); }
  }
}
