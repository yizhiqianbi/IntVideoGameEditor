"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isXumengVideoDramaId, parseXumengVideoCatalog, xumengVideoDramaIdFromRoute, xumengVideoMediaUrl, xumengVideoPosterUrl, type XumengVideoDrama } from "@/lib/xumeng-video-catalog";
import Icon from "./icons";
import s from "./video-channel.module.css";

const CATALOG_URLS = ["/assets/xumeng/video-catalog.json", "/api/xumeng-video/catalog"];
const MARKS_KEY = "xumeng-video-marks";
const NOTES_KEY = "xumeng-video-notes";
const CATALOG_TTL_MS = 60_000;
const SWIPE_DISTANCE = 64;
const SWIPE_MS = 180;

type Drama = XumengVideoDrama;
type SheetId = "" | "episodes" | "comments";
type Marks = { likes: string[]; saves: string[] };
type Note = { id: string; dramaId: string; body: string; at: number };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : "";

let catalogCache: { at: number; dramas: Drama[] } | null = null;

async function loadCatalog(signal: AbortSignal): Promise<Drama[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.dramas;
  let failure = "视频目录暂时读不出来。";
  for (const url of CATALOG_URLS) {
    try {
      const response = await fetch(url, { cache: "default", signal });
      if (!response.ok) continue;
      const dramas = parseXumengVideoCatalog(await response.json());
      catalogCache = { at: Date.now(), dramas };
      return dramas;
    } catch (error) {
      if (signal.aborted) throw error;
      failure = error instanceof Error ? error.message : failure;
    }
  }
  throw new Error(failure);
}

function clipFor(drama: Drama, activeId: string, episodeId: string) {
  if (drama.dramaId === activeId) return drama.episodes.find(item => item.id === episodeId) ?? drama.episodes[0] ?? null;
  return drama.episodes[0] ?? null;
}

function readList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && isXumengVideoDramaId(item)).slice(0, 400) : [];
}

function readMarks(): Marks {
  try {
    const raw = JSON.parse(localStorage.getItem(MARKS_KEY) || "");
    if (!record(raw)) return { likes: [], saves: [] };
    return { likes: readList(raw.likes), saves: readList(raw.saves) };
  } catch {
    return { likes: [], saves: [] };
  }
}

function readNotes(): Note[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTES_KEY) || "");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(item => {
      if (!record(item)) return [];
      const id = text(item.id, 40);
      const dramaId = text(item.dramaId, 16);
      const body = text(item.body, 120);
      const at = typeof item.at === "number" && Number.isFinite(item.at) ? item.at : 0;
      return id && isXumengVideoDramaId(dramaId) && body ? [{ id, dramaId, body, at }] : [];
    }).slice(0, 80);
  } catch {
    return [];
  }
}

function dramaHash(dramaId: string) {
  return `#videos/${dramaId}`;
}

export default function VideoChannel() {
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [visualIndex, setVisualIndex] = useState(0);
  const [episodeId, setEpisodeId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState<SheetId>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [marks, setMarks] = useState<Marks>({ likes: [], saves: [] });
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const stageRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const wheeled = useRef(0);
  const moved = useRef(false);
  const sliding = useRef(false);
  const pendingReset = useRef(false);
  const indexRef = useRef(0);
  const visualRef = useRef(0);
  const frameReady = useRef(false);
  const feedLengthRef = useRef(0);
  const mutedRef = useRef(false);

  const feed = dramas;
  const keyword = query.trim().toLowerCase();
  const found = useMemo(() => keyword ? dramas.filter(drama => drama.title.toLowerCase().includes(keyword)) : dramas, [dramas, keyword]);
  const playing = feed[index] ?? null;
  const drama = feed[visualIndex] ?? null;
  const episode = playing ? clipFor(playing, playing.dramaId, episodeId) : null;
  const dramaNotes = notes.filter(item => item.dramaId === drama?.dramaId);
  const panels = [visualIndex - 1, visualIndex, visualIndex + 1].flatMap(slot => {
    const item = feed[slot];
    if (!item) return [];
    const place = slot === visualIndex ? "current" : slot < visualIndex ? "prev" : "next";
    const clip = clipFor(item, playing?.dramaId ?? "", episodeId);
    return clip ? [{ item, place, clip }] : [];
  });
  indexRef.current = index;
  visualRef.current = visualIndex;
  feedLengthRef.current = feed.length;
  mutedRef.current = muted;

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal).then(list => {
      if (!controller.signal.aborted) { setDramas(list); setLoading(false); }
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "视频目录暂时读不出来。");
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setMarks(readMarks());
    setNotes(readNotes());
  }, []);

  useEffect(() => {
    const id = xumengVideoDramaIdFromRoute(location.hash);
    if (!id || !dramas.length || moved.current) return;
    const foundIndex = dramas.findIndex(item => item.dramaId === id);
    if (foundIndex > 0) {
      indexRef.current = foundIndex;
      visualRef.current = foundIndex;
      setIndex(foundIndex);
      setVisualIndex(foundIndex);
    }
  }, [dramas]);

  useEffect(() => {
    if (!playing) return;
    setEpisodeId(current => playing.episodes.some(item => item.id === current) ? current : (playing.episodes[0]?.id ?? ""));
    const pinnedId = xumengVideoDramaIdFromRoute(location.hash);
    if (pinnedId && pinnedId !== playing.dramaId && dramas.some(item => item.dramaId === pinnedId) && index === 0 && !moved.current) return;
    const hash = dramaHash(playing.dramaId);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }, [playing, dramas, index]);

  function currentVideo() {
    return videoRef.current;
  }

  function revealFrame() {
    const node = videoRef.current;
    if (!node || !frameReady.current || visualRef.current !== indexRef.current || node.videoWidth < 1) return;
    node.style.opacity = "1";
    setPaused(false);
  }

  function startPlayback(node: HTMLVideoElement) {
    if (!node.paused && node.readyState >= 2) {
      setPaused(false);
      return;
    }
    node.muted = mutedRef.current;
    const attempt = node.play();
    if (!attempt) return;
    void attempt.then(() => setPaused(false)).catch((error: unknown) => {
      if (!node.paused || (error instanceof DOMException && error.name === "AbortError")) return;
      node.muted = true;
      mutedRef.current = true;
      setMuted(true);
      void node.play().then(() => setPaused(false)).catch(() => setPaused(true));
    });
  }

  useLayoutEffect(() => {
    frameReady.current = false;
    setCurrentTime(0);
    setDuration(0);
    const node = videoRef.current;
    if (node) node.style.opacity = "0";
  }, [episode?.id]);

  useLayoutEffect(() => {
    if (!pendingReset.current) return;
    pendingReset.current = false;
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
    }
    const node = videoRef.current;
    if (node) node.style.transform = "translate3d(0, 0, 0)";
    revealFrame();
  }, [visualIndex]);

  useLayoutEffect(() => {
    const node = currentVideo();
    if (!node || !episode) return;
    const url = xumengVideoMediaUrl(episode.mediaKey);
    if (node.dataset.clip !== episode.id) {
      frameReady.current = false;
      node.style.opacity = "0";
      if (node.getAttribute("src")) {
        node.pause();
        node.removeAttribute("src");
        node.load();
      }
      node.dataset.clip = episode.id;
      node.src = url;
    }
    startPlayback(node);
    if (node.readyState >= 2) {
      frameReady.current = true;
      revealFrame();
    }
  }, [episode?.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function remember(next: Marks) {
    setMarks(next);
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(next)); } catch { /* The buttons still reflect this visit. */ }
  }

  function toggleMark(kind: "likes" | "saves") {
    if (!drama) return;
    const has = marks[kind].includes(drama.dramaId);
    const list = has ? marks[kind].filter(id => id !== drama.dramaId) : [drama.dramaId, ...marks[kind]].slice(0, 400);
    remember({ ...marks, [kind]: list });
  }

  function resetTrack() {
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
    }
    const video = videoRef.current;
    if (video) {
      video.style.transition = "none";
      video.style.transform = "translate3d(0, 0, 0)";
    }
  }

  function move(delta: number) {
    const total = feedLengthRef.current;
    const next = Math.max(0, Math.min(total - 1, indexRef.current + delta));
    if (total < 2 || next === indexRef.current) return;
    indexRef.current = next;
    moved.current = true;
    setExpanded(false);
    setSheet("");
    setIndex(next);
  }

  function placeTrack(y: number, animate: boolean, includeVideo = true) {
    const track = trackRef.current;
    if (!track) return;
    const transform = `translate3d(0, ${y}px, 0)`;
    track.style.transition = animate ? `transform ${SWIPE_MS}ms ease-out` : "none";
    track.style.transform = transform;
    const video = videoRef.current;
    if (includeVideo && video) {
      video.style.transition = track.style.transition;
      video.style.transform = transform;
    }
  }

  function settle(direction: -1 | 1) {
    const track = trackRef.current;
    const total = feedLengthRef.current;
    const current = indexRef.current;
    if (!track || sliding.current || total < 2 || (direction > 0 && current >= total - 1) || (direction < 0 && current <= 0)) {
      placeTrack(0, true);
      return;
    }
    const video = videoRef.current;
    if (video) {
      video.style.opacity = "0";
      video.style.transition = "none";
      video.style.transform = "translate3d(0, 0, 0)";
    }
    frameReady.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || track.clientHeight < 1) {
      pendingReset.current = true;
      move(direction);
      visualRef.current = indexRef.current;
      setVisualIndex(indexRef.current);
      return;
    }
    sliding.current = true;
    move(direction);
    placeTrack(direction > 0 ? -track.clientHeight : track.clientHeight, true, false);
    let finished = false;
    const finish = (event?: Event) => {
      if (finished) return;
      if (event instanceof TransitionEvent && (event.target !== track || event.propertyName !== "transform")) return;
      finished = true;
      sliding.current = false;
      track.removeEventListener("transitionend", finish);
      window.clearTimeout(timer);
      pendingReset.current = true;
      visualRef.current = indexRef.current;
      setVisualIndex(indexRef.current);
    };
    track.addEventListener("transitionend", finish);
    const timer = window.setTimeout(() => finish(), SWIPE_MS + 80);
  }

  function openDrama(next: Drama) {
    const at = dramas.findIndex(item => item.dramaId === next.dramaId);
    moved.current = true;
    indexRef.current = Math.max(0, at);
    visualRef.current = indexRef.current;
    setIndex(indexRef.current);
    setVisualIndex(indexRef.current);
    setEpisodeId(next.episodes[0]?.id ?? "");
    setExpanded(false);
    setSearchOpen(false);
    setSheet("");
    resetTrack();
    const hash = dramaHash(next.dramaId);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function togglePlay() {
    const node = currentVideo();
    if (!node) return;
    if (node.paused) {
      node.muted = false;
      mutedRef.current = false;
      setMuted(false);
      void node.play().then(() => setPaused(false)).catch(() => setPaused(true));
      return;
    }
    node.pause();
    setPaused(true);
  }

  function toggleMute() {
    const node = currentVideo();
    if (!node) return;
    const next = !node.muted;
    node.muted = next;
    mutedRef.current = next;
    setMuted(next);
  }

  function seekTo(value: number) {
    const node = currentVideo();
    if (!node || !Number.isFinite(node.duration)) return;
    const next = Math.max(0, Math.min(node.duration, value));
    node.currentTime = next;
    setCurrentTime(next);
  }

  function scrubAt(node: HTMLElement, clientX: number) {
    const rect = node.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    seekTo(ratio * duration);
  }

  function onScrubKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight") seekTo(currentTime + 5);
    if (event.key === "ArrowLeft") seekTo(currentTime - 5);
  }

  function watchFull() {
    const node = currentVideo() as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!node) return;
    if (node.requestFullscreen) {
      void node.requestFullscreen().catch(() => node.webkitEnterFullscreen?.());
      return;
    }
    node.webkitEnterFullscreen?.();
  }

  async function shareDrama() {
    if (!drama) return;
    const url = `${location.origin}${location.pathname}${location.search}${dramaHash(drama.dramaId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: drama.title, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${drama.title} ${url}`);
      setToast("链接已复制");
    } catch {
      setToast("当前环境复制不了链接");
    }
  }

  function publishNote() {
    const body = draft.trim();
    if (!drama || !body) return;
    const next = [{ id: `${drama.dramaId}-${Date.now()}`, dramaId: drama.dramaId, body: body.slice(0, 120), at: Date.now() }, ...notes].slice(0, 80);
    setNotes(next);
    setDraft("");
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch { /* The note stays on screen for this visit. */ }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (searchOpen || sheet || sliding.current || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, a, label, [role='slider']")) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId || sliding.current) return;
    placeTrack(event.clientY - start.y, false);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    pointer.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) < SWIPE_DISTANCE || Math.abs(dy) < Math.abs(dx)) {
      placeTrack(0, true);
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) togglePlay();
      return;
    }
    settle(dy < 0 ? 1 : -1);
  }

  function onPointerCancel() {
    pointer.current = null;
    if (!sliding.current) placeTrack(0, true);
  }

  const settleRef = useRef(settle);
  const gateRef = useRef({ searchOpen, sheet });
  settleRef.current = settle;
  gateRef.current = { searchOpen, sheet };
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (gateRef.current.searchOpen || gateRef.current.sheet || sliding.current) return;
      if (Math.abs(event.deltaY) < 24) return;
      const now = Date.now();
      if (now - wheeled.current < 420) return;
      wheeled.current = now;
      event.preventDefault();
      settleRef.current(event.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const liked = drama ? marks.likes.includes(drama.dramaId) : false;
  const saved = drama ? marks.saves.includes(drama.dramaId) : false;

  return <div className={s.shell}>
    <section ref={stageRef} className={s.stage} aria-label="短剧" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      {loading && <p className={s.status}>正在打开</p>}
      {error && <p className={s.status} role="alert">{error}</p>}
      {!loading && !error && !drama && <p className={s.status}>还没有可以看的短剧。</p>}
      {drama && episode && playing && <div className={s.reel}>
        <div className={s.track} ref={trackRef}>
          {panels.map(({ item, place, clip }) => <article key={item.dramaId} className={s.panel} data-place={place} aria-hidden={place !== "current"}>
            <img className={s.poster} alt="" src={xumengVideoPosterUrl(clip.posterKey)} decoding="async" />
            <div className={s.shade} />
          </article>)}
        </div>
        <video
          ref={videoRef}
          className={s.video}
          poster={xumengVideoPosterUrl(episode.posterKey)}
          playsInline
          preload="auto"
          aria-label={playing.title}
          onLoadedMetadata={() => {
            const node = videoRef.current;
            if (node) {
              setDuration(Number.isFinite(node.duration) ? node.duration : 0);
              setCurrentTime(node.currentTime || 0);
            }
          }}
          onDurationChange={() => {
            const node = videoRef.current;
            if (node) setDuration(Number.isFinite(node.duration) ? node.duration : 0);
          }}
          onTimeUpdate={() => {
            const node = videoRef.current;
            if (node) setCurrentTime(node.currentTime || 0);
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onLoadedData={() => { frameReady.current = true; revealFrame(); }}
          onError={() => { frameReady.current = false; if (videoRef.current) videoRef.current.style.opacity = "0"; setPaused(true); }}
          onEnded={() => {
            const at = playing.episodes.findIndex(entry => entry.id === episode.id);
            if (at >= 0 && at < playing.episodes.length - 1) setEpisodeId(playing.episodes[at + 1].id);
            else settle(1);
          }}
        />
      </div>}
      {drama && episode && <>
        {duration > 0 && <div
          className={s.scrub}
          data-dragging={scrubbing || undefined}
          role="slider"
          tabIndex={0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(Math.min(currentTime, duration))}
          style={{ "--played": `${Math.min(100, (currentTime / duration) * 100)}%` } as CSSProperties}
          onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setScrubbing(true); scrubAt(event.currentTarget, event.clientX); }}
          onPointerMove={event => { if (event.buttons > 0 || event.currentTarget.hasPointerCapture(event.pointerId)) scrubAt(event.currentTarget, event.clientX); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false); }}
          onPointerCancel={() => setScrubbing(false)}
          onKeyDown={onScrubKey}
        ><i /></div>}
        {paused && <button type="button" className={s.play} aria-label="播放" onClick={togglePlay}><Icon name="play" size={28} /></button>}
        {muted && !paused && <button type="button" className={s.unmute} onClick={() => { toggleMute(); }}>轻点打开声音</button>}
        <button type="button" className={s.full} onClick={watchFull}><Corners />全屏观看</button>
        <div className={s.rail}>
          <RailButton name="喜欢" label={liked ? "1" : "喜欢"} pressed={liked} onClick={() => toggleMark("likes")}><Heart filled={liked} /></RailButton>
          <RailButton name="评论" label={dramaNotes.length > 0 ? String(dramaNotes.length) : "评论"} onClick={() => setSheet("comments")}><Icon name="chat" size={28} /></RailButton>
          <RailButton name="收藏" label={saved ? "1" : "收藏"} pressed={saved} onClick={() => toggleMark("saves")}><Star filled={saved} /></RailButton>
          <RailButton name="分享" label="分享" onClick={() => void shareDrama()}><Share /></RailButton>
        </div>
        <div className={s.caption}>
          <div className={s.copy}>
            <h1>{drama.title}</h1>
            <p className={expanded ? s.synopsisOpen : s.synopsis}>
              <span>{episode.episode}{drama.episodes.length > 1 ? ` · 共 ${drama.episodes.length} 集` : ""}</span>
              <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "展开"}</button>
            </p>
            {expanded && <ol className={s.episodeList}>{drama.episodes.map(item => <li key={item.id}>{item.episode}</li>)}</ol>}
          </div>
          <button type="button" className={s.watchAll} onClick={() => setSheet("episodes")}>
            <span>观看完整短剧 · 全 {drama.episodes.length} 集</span>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </>}
      <header className={s.top}>
        {searchOpen ? <label className={s.searchBox}>
          <Icon name="search" size={16} />
          <input aria-label="搜索短剧" placeholder="搜索短剧" value={query} maxLength={80} autoFocus onChange={event => setQuery(event.target.value)} />
          <button type="button" onClick={() => { setSearchOpen(false); setQuery(""); }}>取消</button>
        </label> : <button type="button" className={s.topSide} aria-label="搜索" onClick={() => setSearchOpen(true)}><Icon name="search" size={20} /></button>}
      </header>
      {searchOpen && <div className={s.results}>
        {!keyword && <p>输入剧名</p>}
        {keyword && found.length === 0 && <p>没有找到对应短剧。</p>}
        {keyword && found.slice(0, 40).map(item => <button type="button" key={item.dramaId} onClick={() => openDrama(item)}>
          <span><strong>{item.title}</strong><small>{item.episodes.length} 集</small></span>
        </button>)}
      </div>}
    </section>
    {sheet === "episodes" && drama && <div className={s.mask} onClick={() => setSheet("")}>
      <div className={s.sheet} role="dialog" aria-label="选集" onClick={event => event.stopPropagation()}>
        <header><strong>{drama.title}</strong><button type="button" aria-label="关闭" onClick={() => setSheet("")}><Icon name="close" size={18} /></button></header>
        <p>全 {drama.episodes.length} 集</p>
        <div className={s.episodeGrid}>
          {drama.episodes.map(item => <button type="button" key={item.id} aria-pressed={item.id === episode?.id} onClick={() => { setEpisodeId(item.id); setSheet(""); }}>{item.episode}</button>)}
        </div>
      </div>
    </div>}
    {sheet === "comments" && drama && <div className={s.mask} onClick={() => setSheet("")}>
      <div className={s.sheet} role="dialog" aria-label="评论" onClick={event => event.stopPropagation()}>
        <header><strong>评论</strong><button type="button" aria-label="关闭" onClick={() => setSheet("")}><Icon name="close" size={18} /></button></header>
        <div className={s.noteList}>
          {dramaNotes.length === 0 && <p>还没有评论，来说第一句。</p>}
          {dramaNotes.map(item => <article key={item.id}><b>我</b><span>{item.body}</span></article>)}
        </div>
        <form className={s.composer} onSubmit={event => { event.preventDefault(); publishNote(); }}>
          <input aria-label="写评论" placeholder="写评论" value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} />
          <button type="submit" aria-label="发送"><Icon name="send" size={16} /></button>
        </form>
      </div>
    </div>}
    {toast && <p className={s.toast} role="status">{toast}</p>}
  </div>;
}

function RailButton({ name, label, pressed, onClick, children }: { name: string; label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={pressed ? s.railOn : undefined} aria-pressed={pressed} aria-label={name} onClick={onClick}>{children}<span>{label}</span></button>;
}

function Heart({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function Star({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 19.8l1-6.1L3.2 9.4l6.1-.9Z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function Share() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function Corners() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
