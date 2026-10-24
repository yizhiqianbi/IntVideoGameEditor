"use client";

/* eslint-disable @next/next/no-img-element -- Private generated media is served by the authenticated Worker. */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fetchDzmmChatMedia, fingerprintDzmmMediaText, generateDzmmChatMedia, resolveDzmmChatMediaResult, DzmmChatMediaError,
  type DzmmChatMediaAsset, type DzmmChatMediaKind, type DzmmChatMediaOverview, type DzmmChatMediaTarget } from "../../lib/dzmm-chat-media";
import type { DzmmSavedMessage } from "../../lib/dzmm-storage";
import Icon from "./icons";
import { ChatMessageTextSelection } from "./chat-message-editor";
import s from "./chat-message-media.module.css";
import { XUMENG_GENERATION_WORKSPACE_ENABLED, XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";

type MediaContext = {
  overview: DzmmChatMediaOverview | null;
  generation: { messageId: string; kind: DzmmChatMediaKind } | null;
  error: DzmmChatMediaTarget & { text: string; membership: boolean; recovery?: boolean } | null;
  unconfirmed: DzmmChatMediaTarget[];
  reading: boolean;
  readError: string | null;
  reload: () => Promise<boolean>;
  generate: (messageId: string, kind: DzmmChatMediaKind, sourceText: string) => Promise<void>;
  onVip: () => void;
};
const Context = createContext<MediaContext | null>(null);

export function ChatMediaProvider({ accountId, conversationId, isGuest, saveNow, onRequireAccount, onVip, children }: {
  accountId?: string; conversationId: string; isGuest: boolean; saveNow: () => Promise<void>;
  onRequireAccount: () => void; onVip: () => void; children: ReactNode;
}) {
  const [overview, setOverview] = useState<DzmmChatMediaOverview | null>(null);
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
  }, []);

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
    setOverview(null); setError(null); setUnconfirmed([]); setGeneration(null);
    generating.current = false;
    void read(true);
    return () => { initialRead.current?.abort(); controller.current?.abort(); operation.current++; readSequence.current++; };
  }, [read]);

  const generate = useCallback(async (messageId: string, kind: DzmmChatMediaKind, sourceText: string) => {
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
      target = { messageId, kind, sourceHash: await fingerprintDzmmMediaText(sourceText) };
      if (!active()) return;
      await saveNow();
      if (!active()) return;
      const current = await fetchDzmmChatMedia(accountId, conversationId, abort.signal);
      if (!active()) return;
      acceptOverview(current);
      const existing = resolveDzmmChatMediaResult(current, target);
      if (existing.state === "ready" || existing.state === "pending") return;
      if (kind === "audio" && !current.vip.active && !current.vip.adminPreview) {
        setError({ ...target, text: "语音素材需要有效 VIP 会员。", membership: true });
        return;
      }
      if (kind === "image" && !XUMENG_GENERATION_WORKSPACE_ENABLED) throw new Error("图片生成已暂停开放。");
      if (!current.features[kind]) throw new Error(kind === "audio" ? "语音服务暂时不可用，请稍后重试。" : "图片服务暂时不可用，请稍后重试。");
      submitted = true;
      const asset = await generateDzmmChatMedia(accountId, conversationId, messageId, kind, abort.signal);
      if (!active()) return;
      if (asset.sourceHash !== target.sourceHash) throw new DzmmChatMediaError(502, "消息正文已经变化，请检查当前消息的素材。");
      const completed = target;
      setOverview(previous => previous ? { ...previous, assets: [...previous.assets.filter(item => item.id !== asset.id), asset],
        ...(previous.pending !== undefined ? { pending: previous.pending.filter(item => item.id !== asset.id) } : {}) } : previous);
      setUnconfirmed(previous => previous.filter(item => !sameTarget(item, completed)));
      const updated = await fetchDzmmChatMedia(accountId, conversationId, abort.signal).catch(() => null);
      if (updated && active()) acceptOverview(updated);
    } catch (failure) {
      if (!active() || !target) return;
      const failedTarget = target;
      setError({ ...failedTarget, text: failure instanceof Error ? failure.message : "生成失败，请稍后重试。",
        membership: failure instanceof DzmmChatMediaError && failure.status === 403 });
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
        setError({ ...failedTarget, text: "生成结果暂未确认，请检查结果后再试。", membership: false, recovery: true });
      }
    } finally {
      if (operation.current === serial) generating.current = false;
      if (active()) setGeneration(null);
    }
  }, [accountId, conversationId, isGuest, onRequireAccount, saveNow, acceptOverview]);

  return <Context.Provider value={{ overview, generation, error, unconfirmed, reading, readError, reload, generate, onVip }}>
    {readError && <div className={`${s.feedback} ${s.readNotice}`} role="alert"><p>{readError}</p>
      <button type="button" disabled={reading || Boolean(generation)} onClick={() => { void reload(); }}>重新加载素材</button></div>}
    {reading && <div className={`${s.progress} ${s.readNotice}`} role="status">正在加载会话素材…</div>}
    {children}
  </Context.Provider>;
}

const sameTarget = (left: DzmmChatMediaTarget, right: DzmmChatMediaTarget) => left.messageId === right.messageId
  && left.kind === right.kind && left.sourceHash === right.sourceHash;

function MessageAudio({ asset, reload, busy }: { asset: DzmmChatMediaAsset; reload: () => Promise<boolean>; busy: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const audio = ref.current;
    return () => { audio?.pause(); };
  }, [asset.id]);
  const partial = asset.audioTextChars !== undefined && asset.totalTextChars !== undefined && asset.audioTextChars < asset.totalTextChars;
  return <div className={s.voice}>
    <div className={s.voiceTop}><Icon name="volume" size={16} /><span>角色语音</span>
      <small>{duration ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}` : "中文朗读"}</small></div>
    <div className={s.voiceControls}><button type="button" className={s.play} aria-label={playing ? "暂停角色语音" : "播放角色语音"}
      onClick={() => { const audio = ref.current; if (!audio) return; if (audio.paused) { if (failed) audio.load(); void audio.play().catch(() => setFailed(true)); } else audio.pause(); }}>
      <Icon name={playing ? "pause" : "play"} size={17} /></button>
      <audio ref={ref} src={asset.url} controls preload="none" aria-label="角色语音播放器"
        onPlay={() => { setPlaying(true); setFailed(false); document.dispatchEvent(new CustomEvent("qingyu-audio-play", { detail: asset.id })); }}
        onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setFailed(true); }}
        onLoadedMetadata={() => { setFailed(false); if (ref.current && Number.isFinite(ref.current.duration)) setDuration(ref.current.duration); }} />
    </div>
    {partial && <small className={s.partial}>本段朗读前 {asset.audioTextChars?.toLocaleString("zh-CN")} 字</small>}
    {failed && <div className={s.feedback} role="alert"><p className={s.error}>语音加载失败。</p>
      {busy && <p>正在生成素材，完成后可重新加载。</p>}
      <button type="button" disabled={retrying || busy} onClick={() => {
        setRetrying(true);
        void reload().then(loaded => { if (loaded && ref.current) { setPlaying(false); ref.current.preload = "metadata"; ref.current.load(); } })
          .finally(() => setRetrying(false));
      }}>{retrying ? "正在重新加载…" : "重新加载语音"}</button></div>}
    <PauseOtherAudio audioRef={ref} assetId={asset.id} />
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

function PauseOtherAudio({ audioRef, assetId }: { audioRef: { current: HTMLAudioElement | null }; assetId: string }) {
  useEffect(() => {
    const pause = (event: Event) => { if ((event as CustomEvent).detail !== assetId) audioRef.current?.pause(); };
    document.addEventListener("qingyu-audio-play", pause);
    return () => document.removeEventListener("qingyu-audio-play", pause);
  }, [audioRef, assetId]);
  return null;
}

export function ChatMessageMedia({ message, disabled, onCopy, onEdit, onRegenerate, children, label }: {
  message: DzmmSavedMessage; disabled: boolean; onCopy: () => void; onEdit: () => void;
  onRegenerate?: () => void; children: ReactNode; label: string;
}) {
  const media = useContext(Context);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [fingerprint, setFingerprint] = useState<{ text: string; hash: string } | null>(null);
  const [expanded, setExpanded] = useState<DzmmChatMediaAsset | null>(null);
  const [selecting, setSelecting] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const hasRecord = Boolean(media?.overview?.assets.some(asset => asset.messageId === message.id)
    || media?.overview?.pending?.some(item => item.messageId === message.id)
    || media?.unconfirmed.some(item => item.messageId === message.id) || media?.error?.messageId === message.id);
  const mutationDisabled = disabled || Boolean(media?.generation);
  useEffect(() => {
    if (expanded && media?.overview && !media.reading && !media.readError && fingerprint?.text === message.content
      && !media.overview.assets.some(asset => asset.id === expanded.id && asset.sourceHash === fingerprint.hash)) setExpanded(null);
  }, [expanded, media?.overview, media?.reading, media?.readError, fingerprint, message.content]);
  useEffect(() => {
    if (!hasRecord) return;
    let active = true;
    void fingerprintDzmmMediaText(message.content).then(hash => { if (active) setFingerprint({ text: message.content, hash }); }).catch(() => {});
    return () => { active = false; };
  }, [message.content, hasRecord]);
  useLayoutEffect(() => {
    if (!position || !menu.current) return;
    const rect = menu.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8));
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [position]);
  const open = position !== null;
  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); trigger.current?.focus(); } };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    document.addEventListener("qingyu-close-message-menu", close);
    window.addEventListener("resize", close); document.addEventListener("scroll", scroll, true);
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape);
      document.removeEventListener("qingyu-close-message-menu", close);
      window.removeEventListener("resize", close); document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  useEffect(() => { setPosition(null); }, [message.content]);
  useEffect(() => {
    if (!expanded) return;
    const current = dialog.current;
    current?.showModal();
    return () => { current?.close(); };
  }, [expanded]);
  const assets = fingerprint?.text === message.content ? media?.overview?.assets.filter(asset => asset.messageId === message.id && asset.sourceHash === fingerprint.hash) ?? [] : [];
  const pending = fingerprint?.text === message.content ? media?.overview?.pending?.filter(item => item.messageId === message.id && item.sourceHash === fingerprint.hash) ?? [] : [];
  const unconfirmed = fingerprint?.text === message.content ? media?.unconfirmed.filter(item => item.messageId === message.id && item.sourceHash === fingerprint.hash) ?? [] : [];
  const audio = assets.find(asset => asset.kind === "audio"), image = assets.find(asset => asset.kind === "image");
  const audioPending = !audio && pending.some(item => item.kind === "audio"), imagePending = !image && pending.some(item => item.kind === "image");
  const audioUnconfirmed = !audio && unconfirmed.some(item => item.kind === "audio"), imageUnconfirmed = !image && unconfirmed.some(item => item.kind === "image");
  const generating = media?.generation?.messageId === message.id ? media.generation.kind : null;
  const error = media?.error?.messageId === message.id && fingerprint?.text === message.content
    && media.error.sourceHash === fingerprint.hash ? media.error : null;
  const mediaDisabled = mutationDisabled || Boolean(media?.reading || media?.readError) || !message.content.trim();
  const audioDisabled = mediaDisabled || audioPending || audioUnconfirmed, imageDisabled = mediaDisabled || imagePending || imageUnconfirmed;
  const audioAction = generating === "audio" || audioPending ? "生成语音中…" : audio ? "播放语音" : audioUnconfirmed ? "语音结果待确认" : "生成语音";
  const imageAction = generating === "image" || imagePending ? "生成图片中…" : image ? "查看图片" : imageUnconfirmed ? "图片结果待确认" : "生成图片";
  const showAudioAction = Boolean(audio || audioPending || audioUnconfirmed)
    || Boolean(media?.overview?.features.audio && (XUMENG_PAYMENTS_ENABLED || media.overview.vip.active || media.overview.vip.adminPreview));
  const showImageAction = XUMENG_GENERATION_WORKSPACE_ENABLED || Boolean(image || imagePending || imageUnconfirmed);
  const needsCheck = audioPending || imagePending || audioUnconfirmed || imageUnconfirmed;
  function showMenu(x: number, y: number) {
    document.dispatchEvent(new Event("qingyu-close-message-menu"));
    setPosition({ x, y });
  }
  function closeMenu(refocus = true) { setPosition(null); if (refocus) trigger.current?.focus({ preventScroll: true }); }
  function selectText() {
    closeMenu();
    setSelecting(true);
  }
  function handleAudio(fromMenu = false) {
    closeMenu(fromMenu);
    if (audio) refocusAudio(); else void media?.generate(message.id, "audio", message.content);
  }
  function handleImage(fromMenu = false) {
    closeMenu(fromMenu);
    if (image) setExpanded(image); else void media?.generate(message.id, "image", message.content);
  }
  return <div ref={wrapper} className={s.message} tabIndex={0} aria-label={label}
    onContextMenu={event => {
      if (event.shiftKey || (event.target as Element).closest("button,a,audio,video,input,textarea")) return;
      event.preventDefault(); showMenu(event.clientX, event.clientY);
    }} onKeyDown={event => {
      if ((event.target as Element).closest("textarea,input,audio,video,dialog")) return;
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      event.preventDefault(); const rect = wrapper.current!.getBoundingClientRect(); showMenu(rect.left + 20, rect.top + 20);
    }}>
    {children}
    {selecting && <ChatMessageTextSelection content={message.content} onCopy={onCopy} onClose={() => setSelecting(false)} />}
    <div className={s.tools}>
      <button type="button" className={s.action} aria-label={`复制${label}`} onClick={onCopy}>
        <Icon name="copy" size={15} /><span>复制</span></button>
      {message.role === "assistant" && media && <>
        {showAudioAction && <button type="button" className={s.action} disabled={audioDisabled} onClick={() => handleAudio()}
          aria-label={`${label}${audioAction}`}>
          <Icon name="volume" size={15} /><span>{audioAction}</span>{XUMENG_PAYMENTS_ENABLED && !audio && <small>VIP</small>}</button>}
        {showImageAction && <button type="button" className={s.action} disabled={imageDisabled} onClick={() => handleImage()}
          aria-label={`${label}${imageAction}`}>
          <Icon name="image" size={15} /><span>{imageAction}</span>{!image && <small>100 Credit</small>}</button>}
      </>}
      <button type="button" ref={trigger} className={s.more} aria-label={`${label}更多操作`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { if (open) closeMenu(); else { const rect = trigger.current!.getBoundingClientRect(); showMenu(rect.left, rect.bottom + 6); } }}>
        <Icon name="more" size={15} /><span>更多</span></button>
      {position && <div ref={menu} role="menu" className={s.menu} aria-label="消息操作" style={{ left: position.x, top: position.y }} onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
        if (event.key === "Tab") { closeMenu(false); return; }
        event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next]?.focus();
      }}>
        <button type="button" role="menuitem" onClick={selectText}><Icon name="check" size={16} />选择文字</button>
        <button type="button" role="menuitem" onClick={() => { closeMenu(); onCopy(); }}><Icon name="copy" size={16} />复制</button>
        <button type="button" role="menuitem" disabled={mutationDisabled} onClick={() => { closeMenu(); onEdit(); }}><Icon name="edit" size={16} />编辑</button>
        {message.role === "assistant" && <button type="button" role="menuitem" disabled={mutationDisabled || !onRegenerate}
          title={!onRegenerate ? "开场白没有对应用户消息，不能重新生成" : undefined}
          onClick={() => { closeMenu(); onRegenerate?.(); }}><Icon name="refresh" size={16} />重新生成</button>}
        {message.role === "assistant" && media && <>
          {showAudioAction && <button type="button" role="menuitem" disabled={audioDisabled} onClick={() => handleAudio(true)}>
            <Icon name="volume" size={16} />{audioAction}{XUMENG_PAYMENTS_ENABLED && <small>VIP</small>}</button>}
          {showImageAction && <button type="button" role="menuitem" disabled={imageDisabled} onClick={() => handleImage(true)}>
            <Icon name="image" size={16} />{imageAction}{!image && <small>100 Credit</small>}</button>}
        </>}
      </div>}
    </div>
    {generating && <div className={s.progress} role="status"><span className={s.loader} />{generating === "audio" ? "正在生成角色语音…" : "正在绘制这一幕…"}</div>}
    {needsCheck && media && <div className={s.feedback} role="status">
      {(audioPending || imagePending) && <p>{audioPending && imagePending ? "语音和图片正在生成。" : audioPending ? "角色语音正在生成。" : "剧情图片正在生成。"}稍后可检查结果。</p>}
      {(audioUnconfirmed || imageUnconfirmed) && !error && <p>生成结果暂未确认，请先检查结果。</p>}
      <button type="button" disabled={media.reading || Boolean(media.generation)} onClick={() => { void media.reload(); }}>
        {media.reading ? "正在检查…" : "检查生成结果"}</button>
    </div>}
    {audio && media && <MessageAudio key={`${audio.id}:${audio.createdAt}`} asset={audio} reload={media.reload} busy={Boolean(media.generation)} />}
    {image && media && <figure className={s.picture}><MessagePicture key={`${image.id}:${image.createdAt}`} asset={image} reload={media.reload} busy={Boolean(media.generation)} onExpand={() => setExpanded(image)} />
      <figcaption><Icon name="image" size={13} />这一幕 · AI 生成</figcaption></figure>}
    {error && media && <div className={s.feedback} role="status"><p>{error.text}</p>{error.membership && <button type="button" onClick={media.onVip}>{XUMENG_PAYMENTS_ENABLED ? "查看 VIP · ¥28 / 30天" : "查看已有会员权益"}<Icon name="chevron" size={14} /></button>}</div>}
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
