"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isXumengVideoDramaId, matchXumengVideoCharacter, parseXumengVideoCatalog, rankXumengVideoDramas, rotateXumengVideoFeed, xumengVideoDramaIdFromRoute, xumengVideoMediaUrl, xumengVideoPosterUrl, type XumengVideoDrama } from "@/lib/xumeng-video-catalog";
import { attachXumengShortDramaCards, xumengShortDramaForDrama } from "@/lib/xumeng-short-drama-cards";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { shareHookLine } from "@/lib/xumeng-share-poster";
import { xumengPage, xumengPageFill } from "@/lib/xumeng-page-copy";
import Icon from "./icons";
import { SharePoster, type XumengSharePoster } from "./share-game";
import s from "./video-channel.module.css";

const CATALOG_URLS = ["/assets/xumeng/video-catalog.json", "/api/xumeng-video/catalog"];
const OPENING_KEY = "xumeng-video-opening";
const MARKS_KEY = "xumeng-video-marks";
const NOTES_KEY = "xumeng-video-notes";
const PROGRESS_KEY = "xumeng-video-progress";
const CATALOG_TTL_MS = 60_000;
const EPISODE_CREDITS = 50;
const INTERACTIVE_CATEGORY = "互动剧";
const FREE_EPISODE_COUNT = 3;
const SWIPE_DISTANCE = 64;
const SWIPE_MS = 180;

type Drama = XumengVideoDrama;
type SheetId = "" | "episodes" | "comments";
type Marks = { likes: string[]; saves: string[] };
type Note = { id: string; dramaId: string; body: string; at: number; mine?: boolean };
type WatchProgress = { dramaId: string; episodeId: string; currentTime: number; duration: number; updatedAt: number };

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
      const dramas = attachXumengShortDramaCards(parseXumengVideoCatalog(await response.json()));
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
      return id && isXumengVideoDramaId(dramaId) && body ? [{ id, dramaId, body, at, ...(item.mine === true ? { mine: true } : {}) }] : [];
    }).slice(0, 80);
  } catch {
    return [];
  }
}

function readProgress(): Record<string, WatchProgress> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "");
    if (!record(raw)) return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([episodeId, item]) => {
      const dramaId = record(item) && typeof item.dramaId === "string" ? item.dramaId : "";
      if (!record(item) || !isXumengVideoDramaId(dramaId) || typeof item.episodeId !== "string" || item.episodeId !== episodeId) return [];
      const currentTime = typeof item.currentTime === "number" && Number.isFinite(item.currentTime) && item.currentTime >= 0 ? item.currentTime : 0;
      const duration = typeof item.duration === "number" && Number.isFinite(item.duration) && item.duration > 0 ? item.duration : 0;
      const updatedAt = typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : 0;
      return [{ key: episodeId, value: { dramaId, episodeId, currentTime, duration, updatedAt } }];
    }).sort((a, b) => b.value.updatedAt - a.value.updatedAt).slice(0, 200).map(item => [item.key, item.value]));
  } catch {
    return {};
  }
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function dramaHash(dramaId: string) {
  return `#videos/${dramaId}`;
}

let recentOpening: { at: number; ticket: number } | null = null;

function takeOpeningTicket(pinned: boolean): number {
  if (pinned || typeof sessionStorage === "undefined") return 0;
  const now = Date.now();
  if (recentOpening && now - recentOpening.at < 400) return recentOpening.ticket;
  const previous = Number(sessionStorage.getItem(OPENING_KEY) ?? "");
  const ticket = Number.isFinite(previous) ? previous + 1 : Math.floor(Math.random() * 1_000_000) + 1;
  try { sessionStorage.setItem(OPENING_KEY, String(ticket)); } catch { /* This visit still uses the ticket. */ }
  recentOpening = { at: now, ticket };
  return ticket;
}

function dramaSynopsis(drama: Drama, character: { introduction?: string; description?: string; scenario?: string } | null) {
  const raw = drama.synopsis || character?.introduction || character?.description || character?.scenario || "";
  return raw.replace(/\s+/gu, " ").trim();
}

function feedTags(drama: Drama, character: { tags?: string[] } | null) {
  const source = drama.tags.length ? drama.tags : character?.tags ?? [];
  const tags = source.map(tag => tag.replace(/^#/u, "").trim()).filter(Boolean).slice(0, 4);
  if (tags.length) return tags;
  if (drama.category.includes("漫剧")) return ["漫剧"];
  if (drama.category.includes("换脸")) return ["换脸"];
  if (drama.category.includes("魔改")) return ["魔改"];
  return ["短剧"];
}

export type VideoCharacterLink = {
  id: string;
  name: string;
  description?: string;
  introduction?: string;
  scenario?: string;
  tags?: string[];
  cover?: string;
};

function interactiveBlurb(character: VideoCharacterLink) {
  const intro = (character.introduction || "").trim();
  const plain = (intro || character.description || "").replace(/^【[^】]*】/, "").replace(/\s+/g, " ").trim();
  if (plain) return plain.length > 54 ? `${plain.slice(0, 54)}…` : plain;
  const tags = (character.tags || []).slice(0, 3).join(" · ");
  return tags || "";
}

export default function VideoChannel({ characters = [], locale = "zh-Hans", signedIn = false, onOpenCharacter, onOpenPlay, onOpenStory, onCreateCharacter, onRequireAccount }: {
  characters?: readonly VideoCharacterLink[];
  locale?: XumengLocale;
  signedIn?: boolean;
  onOpenCharacter?: (id: string) => void;
  onOpenPlay?: () => void;
  onOpenStory?: (characterId: string) => void;
  onCreateCharacter?: (drama: XumengVideoDrama) => Promise<void> | void;
  onRequireAccount?: () => void;
}) {
  const copy = xumengPage(locale);
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [visualIndex, setVisualIndex] = useState(0);
  const [episodeId, setEpisodeId] = useState("");
  const [sheet, setSheet] = useState<SheetId>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogReload, setCatalogReload] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [marks, setMarks] = useState<Marks>({ likes: [], saves: [] });
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [poster, setPoster] = useState<XumengSharePoster | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [videoRetry, setVideoRetry] = useState(0);
  const [unlockedDrama, setUnlockedDrama] = useState("");
  const [unlockedIds, setUnlockedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [frameShown, setFrameShown] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [blurbOpen, setBlurbOpen] = useState(false);
  const [hookOpen, setHookOpen] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const seekGesture = useRef<{ id: number; startX: number; startTime: number; active: boolean } | null>(null);
  const [seekHud, setSeekHud] = useState<{ target: number; delta: number } | null>(null);
  const [creatingCard, setCreatingCard] = useState(false);
  const wheeled = useRef(0);
  const moved = useRef(false);
  const sliding = useRef(false);
  const pendingReset = useRef(false);
  const indexRef = useRef(0);
  const visualRef = useRef(0);
  const frameReady = useRef(false);
  const feedLengthRef = useRef(0);
  const mutedRef = useRef(false);
  const progressRef = useRef<Record<string, WatchProgress>>({});
  const lastProgressWriteRef = useRef(0);

  const ordered = useMemo(() => rankXumengVideoDramas(dramas), [dramas]);
  const [opening] = useState(() => takeOpeningTicket(typeof location !== "undefined" && Boolean(xumengVideoDramaIdFromRoute(location.hash))));
  const feed = useMemo(() => {
    if (category) return ordered.filter(item => item.category === category || item.category.includes(category));
    return rotateXumengVideoFeed(ordered, opening);
  }, [ordered, category, opening]);
  const keyword = query.trim().toLowerCase();
  const found = useMemo(() => keyword ? ordered.filter(drama => drama.title.toLowerCase().includes(keyword)) : ordered, [ordered, keyword]);
  const playing = feed[index] ?? null;
  const drama = feed[visualIndex] ?? null;
  const episode = playing ? clipFor(playing, playing.dramaId, episodeId) : null;
  const hookConfig = playing?.hook;
  const storyTargetId = playing ? (playing.hook?.characterId || matchXumengVideoCharacter(playing, characters)?.id || "") : "";
  const storyEntry = playing?.category.includes(INTERACTIVE_CATEGORY) && storyTargetId ? storyTargetId : "";
  const hookCharacter = playing
    ? (hookConfig?.characterId ? characters.find(item => item.id === hookConfig.characterId) ?? null : matchXumengVideoCharacter(playing, characters))
    : null;
  const episodeFree = (episode?.episodeNumber ?? 1) <= FREE_EPISODE_COUNT;
  const episodeOpen = episodeFree || (episode !== null && unlockedDrama === episode.dramaId && unlockedIds.has(episode.id));
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
    setLoading(true);
    setError("");
    loadCatalog(controller.signal).then(list => {
      if (!controller.signal.aborted) { setDramas(list); setLoading(false); }
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "视频目录暂时读不出来。");
      setLoading(false);
    });
    return () => controller.abort();
  }, [catalogReload]);

  useEffect(() => {
    setMarks(readMarks());
    setNotes(readNotes());
    progressRef.current = readProgress();
  }, []);

  useEffect(() => {
    if (!feed.length || index < feed.length) return;
    indexRef.current = 0;
    visualRef.current = 0;
    setIndex(0);
    setVisualIndex(0);
  }, [feed.length, index]);

  useEffect(() => {
    const id = xumengVideoDramaIdFromRoute(location.hash);
    if (!id || !feed.length || moved.current) return;
    const foundIndex = feed.findIndex(item => item.dramaId === id);
    if (foundIndex > 0) {
      indexRef.current = foundIndex;
      visualRef.current = foundIndex;
      setIndex(foundIndex);
      setVisualIndex(foundIndex);
    }
  }, [feed]);

  useEffect(() => {
    if (!playing) return;
    setEpisodeId(current => playing.episodes.some(item => item.id === current) ? current : (playing.episodes[0]?.id ?? ""));
    const pinnedId = xumengVideoDramaIdFromRoute(location.hash);
    if (pinnedId && pinnedId !== playing.dramaId && dramas.some(item => item.dramaId === pinnedId) && index === 0 && !moved.current) return;
    const hash = dramaHash(playing.dramaId);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }, [playing, dramas, index]);

  useEffect(() => { setLandscape(false); }, [episode?.id]);

  function noteFrame(node: HTMLVideoElement) {
    if (node.videoWidth > 0 && node.videoHeight > 0) setLandscape(node.videoWidth > node.videoHeight);
  }

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
    setVideoError(false);
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

  useEffect(() => {
    const dramaId = playing?.dramaId;
    if (!dramaId) return;
    const controller = new AbortController();
    setUnlockedDrama("");
    void fetch(`/api/backend/v1/videos/unlocks?dramaId=${encodeURIComponent(dramaId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => response.ok ? response.json() : { episodeIds: [] })
      .then((body: { episodeIds?: unknown }) => {
        if (controller.signal.aborted) return;
        const ids = Array.isArray(body.episodeIds) ? body.episodeIds.filter((id): id is string => typeof id === "string") : [];
        setUnlockedIds(new Set(ids));
        setUnlockedDrama(dramaId);
      })
      .catch(() => { if (!controller.signal.aborted) { setUnlockedIds(new Set()); setUnlockedDrama(dramaId); } });
    return () => controller.abort();
  }, [playing?.dramaId]);

  useEffect(() => { setBlurbOpen(false); }, [drama?.dramaId]);
  useEffect(() => { setPayError(""); }, [episode?.id]);

  async function payForEpisode() {
    if (!episode || episodeFree || paying) return;
    if (!signedIn) {
      setPayError("请先登录后再观看。");
      onRequireAccount?.();
      return;
    }
    setPaying(true);
    setPayError("");
    try {
      const response = await fetch("/api/backend/v1/videos/unlock", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId: episode.id }),
      });
      const body = await response.json().catch(() => null) as { error?: unknown; chargedCredits?: unknown } | null;
      if (response.status === 401 || response.status === 403) {
        const message = typeof body?.error === "string" ? body.error : "请先登录后再观看。";
        setPayError(message);
        setToast(message);
        onRequireAccount?.();
        return;
      }
      if (!response.ok) {
        const message = typeof body?.error === "string" ? body.error : "这一集暂时不能打开。";
        setPayError(message);
        setToast(message);
        return;
      }
      setUnlockedIds(current => new Set(current).add(episode.id));
      setUnlockedDrama(episode.dramaId);
      setPayError("");
      if (body?.chargedCredits === EPISODE_CREDITS) setToast(`已使用 ${EPISODE_CREDITS} ${copy.coinBalance}`);
    } catch {
      setPayError("网络异常，请再试一次。");
      setToast("网络异常，请再试一次。");
    } finally {
      setPaying(false);
    }
  }

  useLayoutEffect(() => {
    const node = currentVideo();
    if (!node || !episode) return;
    if (!episodeOpen) {
      node.pause();
      node.style.opacity = "0";
      if (node.currentSrc || node.src || node.getAttribute("src")) {
        node.removeAttribute("src");
        node.load();
      }
      node.dataset.clip = "";
      setFrameShown(false);
      setPaused(true);
      setDuration(0);
      setCurrentTime(0);
      setVideoError(false);
      return;
    }
    const url = xumengVideoMediaUrl(episode.mediaKey);
    if (node.dataset.clip !== episode.id || videoRetry > 0) {
      frameReady.current = false;
      setFrameShown(false);
      node.style.opacity = "0";
      if (node.getAttribute("src")) {
        node.pause();
        node.removeAttribute("src");
        node.load();
      }
      node.dataset.clip = episode.id;
      node.src = url;
      node.load();
    }
    startPlayback(node);
    if (node.readyState >= 2) {
      frameReady.current = true;
      revealFrame();
    }
  }, [episode?.id, episodeOpen, videoRetry]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function remember(next: Marks) {
    setMarks(next);
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(next)); } catch { /* The buttons still reflect this visit. */ }
  }

  function rememberProgress(next: WatchProgress) {
    const current = { ...progressRef.current, [next.episodeId]: next };
    const trimmed = Object.fromEntries(Object.entries(current).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 200));
    progressRef.current = trimmed;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(trimmed)); } catch { /* Playback remains usable without persistence. */ }
  }

  function clearProgress(episodeId: string) {
    if (!progressRef.current[episodeId]) return;
    const next = { ...progressRef.current };
    delete next[episodeId];
    progressRef.current = next;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(next)); } catch { /* The completed episode can still advance. */ }
  }

  function retryVideo() {
    setVideoError(false);
    setVideoRetry(value => value + 1);
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

  function chooseCategory(next: string) {
    if (next === category) return;
    moved.current = true;
    indexRef.current = 0;
    visualRef.current = 0;
    setCategory(next);
    setIndex(0);
    setVisualIndex(0);
    setEpisodeId("");
    setSheet("");
    setSearchOpen(false);
    setHookOpen(false);
    resetTrack();
  }

  async function enterCharacterCard() {
    if (!drama) return;
    const official = xumengShortDramaForDrama(drama.dramaId);
    if (official && onOpenCharacter) { onOpenCharacter(official.character.id); return; }
    if (linkedCharacter) { openCharacter(); return; }
    if (!onCreateCharacter) { setToast("请先登录后再生成角色卡。"); return; }
    setCreatingCard(true);
    try { await onCreateCharacter(drama); }
    catch (error) { setToast(error instanceof Error ? error.message : "AI 角色卡生成失败，请重试。"); }
    finally { setCreatingCard(false); }
  }

  function openCharacter() {
    if (!drama) return;
    const official = xumengShortDramaForDrama(drama.dramaId);
    if (official && onOpenCharacter) { onOpenCharacter(official.character.id); return; }
    const character = matchXumengVideoCharacter(drama, characters);
    if (!character || !onOpenCharacter) {
      setToast("这部剧还没有对应的角色卡");
      return;
    }
    onOpenCharacter(character.id);
  }

  function openDrama(next: Drama) {
    const recommended = rotateXumengVideoFeed(ordered, opening);
    const at = recommended.findIndex(item => item.dramaId === next.dramaId);
    setCategory("");
    moved.current = true;
    indexRef.current = Math.max(0, at);
    visualRef.current = indexRef.current;
    setIndex(indexRef.current);
    setVisualIndex(indexRef.current);
    setEpisodeId(next.episodes[0]?.id ?? "");
    setSearchOpen(false);
    setSheet("");
    resetTrack();
    const hash = dramaHash(next.dramaId);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function togglePlay() {
    const node = currentVideo();
    if (!node || !episodeOpen) return;
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

  function shareDrama() {
    if (!drama) return;
    const clip = episode && episode.dramaId === drama.dramaId ? episode : drama.episodes[0];
    const character = matchXumengVideoCharacter(drama, characters);
    setPoster({
      title: drama.title,
      hook: shareHookLine(dramaSynopsis(drama, character)),
      coverUrl: clip ? xumengVideoPosterUrl(clip.posterKey) : "",
      url: new URL(`${location.pathname}${location.search}#videos/${drama.dramaId}`, location.origin).toString(),
      kicker: "叙梦短剧",
    });
  }

  function publishNote() {
    const body = draft.trim();
    if (!drama || !body) return;
    if (!signedIn) { onRequireAccount?.(); return; }
    const next = [{ id: `${drama.dramaId}-${Date.now()}`, dramaId: drama.dramaId, body: body.slice(0, 120), at: Date.now(), mine: true }, ...notes].slice(0, 80);
    setNotes(next);
    setDraft("");
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch { /* The note stays on screen for this visit. */ }
  }

  function removeNote(id: string) {
    setNotes(current => {
      const next = current.filter(item => item.id !== id);
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch { /* The list stays on screen for this visit. */ }
      return next;
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (searchOpen || sheet || sliding.current || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, a, label, [role='slider']")) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    const node = videoRef.current;
    seekGesture.current = node && Number.isFinite(node.duration) && node.duration > 0
      ? { id: event.pointerId, startX: event.clientX, startTime: node.currentTime || 0, active: false }
      : null;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId || sliding.current) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const seek = seekGesture.current;
    if (seek && !seek.active && Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.15) seek.active = true;
    if (seek?.active) {
      const node = videoRef.current;
      if (!node || !Number.isFinite(node.duration)) return;
      event.preventDefault();
      const width = Math.max(1, event.currentTarget.getBoundingClientRect().width);
      const next = Math.max(0, Math.min(node.duration, seek.startTime + (dx / width) * node.duration));
      node.currentTime = next;
      setCurrentTime(next);
      setSeekHud({ target: next, delta: next - seek.startTime });
      return;
    }
    placeTrack(dy, false);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    pointer.current = null;
    const seek = seekGesture.current; seekGesture.current = null;
    if (seek?.id === event.pointerId && seek.active) { setSeekHud(null); return; }
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dy) < SWIPE_DISTANCE || Math.abs(dy) < Math.abs(dx)) {
      placeTrack(0, true);
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) togglePlay();
      return;
    }
    settle(dy < 0 ? 1 : -1);
  }

  function onPointerCancel() {
    pointer.current = null; seekGesture.current = null; setSeekHud(null);
    if (!sliding.current) placeTrack(0, true);
  }

  function onStageKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      settleRef.current(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      settleRef.current(-1);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.key === "Escape") {
      if (sheet) setSheet("");
      else if (searchOpen) setSearchOpen(false);
    }
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
  const linkedCharacter = drama ? matchXumengVideoCharacter(drama, characters) : null;
  const synopsis = drama ? dramaSynopsis(drama, linkedCharacter) : "";
  const tags = drama ? feedTags(drama, linkedCharacter) : [];

  return <div className={s.shell}>
    <section ref={stageRef} className={s.stage} aria-label={copy.shorts} tabIndex={0} onKeyDown={onStageKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      {seekHud && <div className={s.seekHud} aria-hidden="true"><div className={s.seekHudRow}><Icon name={seekHud.delta >= 0 ? "chevron" : "chevron"} size={18} /><strong>{formatTime(seekHud.target)}</strong><span>{seekHud.delta >= 0 ? "+" : ""}{Math.round(seekHud.delta)}s</span></div><div className={s.seekHudBar}><i style={{ width: `${duration > 0 ? Math.min(100, (seekHud.target / duration) * 100) : 0}%` }} /></div></div>}
      {loading && <p className={s.status}>{copy.openingShorts}</p>}
      {error && <div className={s.status} role="alert"><p>{error}</p><button type="button" onClick={() => setCatalogReload(value => value + 1)}>{copy.reloadShorts}</button></div>}
      {!loading && !error && !drama && (category === INTERACTIVE_CATEGORY
        ? <div className={s.interactiveEmpty}><h2>{copy.interactiveEmpty}</h2><button type="button" onClick={() => chooseCategory("AI成人短剧")}>{copy.interactiveEmptyAction}</button></div>
        : <p className={s.status}>{copy.noShorts}</p>)}
      {drama && episode && playing && <div className={s.reel}>
        <div className={s.track} ref={trackRef}>
          {panels.map(({ item, place, clip }) => <article key={item.dramaId} className={s.panel} data-place={place} aria-hidden={place !== "current"}>
            <img className={s.poster} alt="" src={xumengVideoPosterUrl(clip.posterKey)} decoding="async" />
            <div className={s.shade} />
          </article>)}
        </div>
        <video
          ref={videoRef}
          className={landscape ? `${s.video} ${s.landscape}` : s.video}
          poster={xumengVideoPosterUrl(episode.posterKey)}
          playsInline
          preload="auto"
          aria-label={playing.title}
          onLoadedMetadata={() => {
            const node = videoRef.current;
            if (node) {
              noteFrame(node);
              setDuration(Number.isFinite(node.duration) ? node.duration : 0);
              const saved = episode ? progressRef.current[episode.id] : undefined;
              const canResume = saved && saved.currentTime >= 5 && saved.currentTime < node.duration - 2;
              if (canResume) {
                node.currentTime = saved.currentTime;
                setCurrentTime(saved.currentTime);
                setToast(xumengPageFill(copy.resumeAt, { time: formatTime(saved.currentTime) }));
              } else setCurrentTime(node.currentTime || 0);
            }
          }}
          onDurationChange={() => {
            const node = videoRef.current;
            if (node) setDuration(Number.isFinite(node.duration) ? node.duration : 0);
          }}
          onTimeUpdate={() => {
            const node = videoRef.current;
            if (node) {
              const nextTime = node.currentTime || 0;
              setCurrentTime(nextTime);
              if (episode && nextTime > 0 && Date.now() - lastProgressWriteRef.current >= 3000) {
                lastProgressWriteRef.current = Date.now();
                rememberProgress({ dramaId: episode.dramaId, episodeId: episode.id, currentTime: nextTime, duration: Number.isFinite(node.duration) ? node.duration : 0, updatedAt: Date.now() });
              }
            }
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onLoadedData={() => { const node = videoRef.current; if (node) noteFrame(node); setVideoError(false); frameReady.current = true; setFrameShown(true); revealFrame(); }}
          onError={() => { frameReady.current = false; setFrameShown(false); if (videoRef.current) videoRef.current.style.opacity = "0"; setPaused(true); setVideoError(true); }}
          onEnded={() => {
            if (episode) clearProgress(episode.id);
            const at = playing.episodes.findIndex(entry => entry.id === episode.id);
            const lastEpisode = at < 0 || at >= playing.episodes.length - 1;
            if (!lastEpisode) { setEpisodeId(playing.episodes[at + 1].id); return; }
            // 互动剧在结尾埋钩子：不自动滑走，先问「换你来选」
            if (playing.category.includes(INTERACTIVE_CATEGORY) || playing.hook) { setHookOpen(true); setPaused(true); return; }
            settle(1);
          }}
        />
        {!episodeOpen && <div className={s.payGate} role="dialog" aria-label={copy.unlockEpisode} onPointerDown={event => event.stopPropagation()}>
          <p>{xumengPageFill(copy.episodeNeeds, { episode: episode?.episode ?? "", credits: EPISODE_CREDITS })}</p>
          {payError && <p className={s.payError} role="alert">{payError}</p>}
          <button type="button" disabled={paying} onClick={() => void payForEpisode()}>{paying ? copy.confirming : copy.payWatch}</button>
        </div>}
        {videoError && episodeOpen && <div className={s.videoError} role="alert">
          <p>{copy.episodeFailed}</p>
          <button type="button" onClick={retryVideo}>{copy.retryPlay}</button>
        </div>}
      </div>}
      {drama && episode && <>
        {duration > 0 && episodeOpen && <div
          className={s.scrub}
          data-dragging={scrubbing || undefined}
          role="slider"
          tabIndex={0}
          aria-label={copy.progress}
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
        {episodeOpen && !videoError && (!frameShown || paused) && <div className={s.playWrap} onPointerDown={event => event.stopPropagation()}>
          <button type="button" className={s.play} aria-label={frameShown ? copy.play : copy.loadingFrame} onClick={togglePlay}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.2v9.6l8.2-4.8L9 7.2Z" fill="currentColor" /></svg></button>
          {!frameShown && <span>{copy.loadingDots}</span>}
        </div>}
        {muted && !paused && <button type="button" className={s.unmute} onClick={() => { toggleMute(); }}>{copy.tapSound}</button>}
        <div className={s.rail}>
          <div className={s.mark} aria-hidden="true"><span><img src="/assets/xumeng/brand/xumeng-mark.svg" alt="" /><i><Icon name="play" size={9} /></i></span><small>{copy.xumengShorts}</small></div>
          <RailButton name={copy.liked} label={liked ? "1" : ""} pressed={liked} onClick={() => toggleMark("likes")}><Heart filled={liked} /></RailButton>
          <RailButton name={copy.comments} label={dramaNotes.length > 0 ? String(dramaNotes.length) : ""} onClick={() => setSheet("comments")}><Icon name="chat" size={28} /></RailButton>
          <RailButton name={copy.favorite} label={saved ? "1" : ""} pressed={saved} onClick={() => toggleMark("saves")}><Star filled={saved} /></RailButton>
          <RailButton name={copy.share} label={copy.share} onClick={() => void shareDrama()}><Share /></RailButton>
        </div>
        <div className={s.story} onPointerDown={event => event.stopPropagation()}>
          <h1>{drama.title}</h1>
          {synopsis && <p className={blurbOpen ? s.blurbOpen : s.blurb}>
            <span>{synopsis}</span>
            {synopsis.length > 18 && <button type="button" onClick={() => setBlurbOpen(value => !value)}>{blurbOpen ? copy.collapse : copy.expand}</button>}
          </p>}
          <div className={s.hashes}>{tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
          <button type="button" className={s.playCard} disabled={creatingCard} onClick={() => void enterCharacterCard()}>
            <Icon name="play" size={16} />
            {linkedCharacter?.cover && <img src={linkedCharacter.cover} alt="" />}
            {creatingCard ? "正在打开角色卡…" : linkedCharacter ? `点击去玩 · ${linkedCharacter.name}` : "点击去玩"}
          </button>
          <button type="button" className={s.watchAll} onClick={() => setSheet("episodes")}>
            <span>{xumengPageFill(copy.watchAll, { count: drama.episodes.length })}</span>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </>}
      {hookOpen && playing && <div className={s.hook} role="dialog" aria-label={copy.hookTitle} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) { setHookOpen(false); settle(1); } }}>
        <div className={s.hookCard}>
          <span className={s.hookEyebrow}>{copy.interactive}</span>
          <h2>{hookConfig?.title || copy.hookTitle}</h2>
          <p>{hookConfig?.body || (hookCharacter ? xumengPageFill(copy.hookBodyNamed, { name: hookCharacter.name }) : copy.hookBody)}</p>
          <button type="button" className={s.hookPlay} onClick={() => { const target = hookConfig?.characterId || hookCharacter?.id; setHookOpen(false); if (target && onOpenStory) onOpenStory(target); else if (target) onOpenCharacter?.(target); else onOpenPlay?.(); }}>{hookConfig?.action || copy.hookAction}<Icon name="chevron" size={16} /></button>
        </div>
      </div>}
      <header className={s.top} onPointerDown={event => event.stopPropagation()}>
        {searchOpen ? <label className={s.searchBox}>
          <Icon name="search" size={16} />
          <input aria-label={copy.searchShorts} placeholder={copy.searchShorts} value={query} maxLength={80} autoFocus onChange={event => setQuery(event.target.value)} />
          <button type="button" onClick={() => { setSearchOpen(false); setQuery(""); }}>{copy.cancelSearch}</button>
        </label> : <>
          <div className={s.tabs} role="tablist" aria-label={copy.shortCategory}>
            <button type="button" role="tab" aria-selected={category === "AI成人短剧"} onClick={() => chooseCategory("AI成人短剧")}>{copy.shorts}</button>
            <button type="button" role="tab" aria-selected={category === "AI成人漫剧"} onClick={() => chooseCategory("AI成人漫剧")}>{copy.comics}</button>
            <button type="button" role="tab" aria-selected={!category} onClick={() => chooseCategory("")}>{copy.recommended}</button>
          </div>
          <button type="button" className={s.topSide} aria-label={copy.search} onClick={() => setSearchOpen(true)}><Icon name="search" size={22} /></button>
        </>}
      </header>
      {searchOpen && <div className={s.results}>
        {!keyword && <p>{copy.typeTitle}</p>}
        {keyword && found.length === 0 && <p>{copy.noShortMatch}</p>}
        {keyword && found.slice(0, 40).map(item => <button type="button" key={item.dramaId} onClick={() => openDrama(item)}>
          <span><strong>{item.title}</strong><small>{item.category || copy.shorts} · {xumengPageFill(copy.episodeCount, { count: item.episodes.length })}</small></span>
        </button>)}
      </div>}
    </section>
    {sheet === "episodes" && drama && <div className={s.mask} onClick={() => setSheet("")}>
      <div className={s.sheet} role="dialog" aria-label={copy.episodes} onClick={event => event.stopPropagation()}>
        <header><strong>{drama.title}</strong><button type="button" aria-label={copy.close} onClick={() => setSheet("")}><Icon name="close" size={18} /></button></header>
        {linkedCharacter && <button type="button" className={s.sheetCard} onClick={() => { setSheet(""); openCharacter(); }}>
          {linkedCharacter.cover && <img src={linkedCharacter.cover} alt="" />}
          <span><strong>{linkedCharacter.name}</strong><small>这部剧的角色卡</small></span>
        </button>}
        <p>{xumengPageFill(copy.allEpisodes, { count: drama.episodes.length })}</p>
        <div className={s.episodeGrid}>
          {drama.episodes.map(item => {
            const paid = item.episodeNumber > FREE_EPISODE_COUNT && !(unlockedDrama === drama.dramaId && unlockedIds.has(item.id));
            return <button type="button" key={item.id} aria-pressed={item.id === episode?.id} onClick={() => { setEpisodeId(item.id); setSheet(""); }}>{item.episode}{paid ? ` · ${EPISODE_CREDITS} ${copy.coinBalance}` : ""}</button>;
          })}
        </div>
      </div>
    </div>}
    {sheet === "comments" && drama && <div className={s.mask} onClick={() => setSheet("")}>
      <div className={s.sheet} role="dialog" aria-label={copy.comments} onClick={event => event.stopPropagation()}>
        <header><strong>{copy.comments}</strong><button type="button" aria-label={copy.close} onClick={() => setSheet("")}><Icon name="close" size={18} /></button></header>
        <div className={s.noteList}>
          {dramaNotes.length === 0 && <p>{copy.noComments}</p>}
          {dramaNotes.map(item => <article key={item.id}><div className={s.noteHead}><b>{item.mine ? copy.me : copy.commentGuest}</b><button type="button" onClick={() => removeNote(item.id)}>{copy.deleteComment}</button></div><span>{item.body}</span></article>)}
        </div>
        <form className={s.composer} onSubmit={event => { event.preventDefault(); publishNote(); }}>
          <input aria-label={copy.writeComment} placeholder={copy.writeComment} value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} />
          <button type="submit" aria-label={copy.send}><Icon name="send" size={16} /></button>
        </form>
      </div>
    </div>}
    {toast && <p className={s.toast} role="status">{toast}</p>}
    {poster && <SharePoster poster={poster} onClose={() => setPoster(null)} />}
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
