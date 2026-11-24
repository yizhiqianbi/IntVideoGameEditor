import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { diversifyVideoItems, type VideoRecommendationItem } from "./recommendation";
import "./page.css";

type Item = VideoRecommendationItem;
type Catalog = { brand: string; updatedAt: string; categories: string[]; items: Item[] };
type WatchState = Record<string, { current: number; duration: number; updatedAt: number }>;

const WATCH_KEY = "xumeng-video-watch-state";
const NAV = ["推荐", "最新", "全部"] as const;

function playIdFromLocation(): string | null {
  const path = window.location.pathname.match(/^\/play\/(hg-[0-9]{4,8}-[1-9][0-9]{0,3})\/?$/);
  if (path?.[1]) return path[1];
  return window.location.hash.match(/^#play\/(hg-[0-9]{4,8}-[1-9][0-9]{0,3})$/)?.[1] ?? null;
}

function usePlayId() {
  const [id, setId] = useState(playIdFromLocation);
  useEffect(() => {
    const onPop = () => setId(playIdFromLocation());
    const hash = window.location.hash.match(/^#play\/(hg-[0-9]{4,8}-[1-9][0-9]{0,3})$/)?.[1];
    if (hash && window.location.pathname === "/") {
      window.location.replace(`/play/${hash}`);
      return;
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);
  return id;
}

function mediaUrl(item: Item) {
  return import.meta.env.DEV ? `/media/${encodeURIComponent(item.file)}` : `/media/${item.mediaKey}?v=3`;
}

function posterUrl(item: Item) {
  return item.posterKey.startsWith("posters/huangguo/") ? `/media/${item.posterKey}` : `/${item.posterKey}`;
}

function readWatchState(): WatchState {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCH_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      if (!value || typeof value !== "object") return [];
      const current = Number((value as { current?: unknown }).current);
      const duration = Number((value as { duration?: unknown }).duration);
      const updatedAt = Number((value as { updatedAt?: unknown }).updatedAt);
      return Number.isFinite(current) && Number.isFinite(duration) && duration > 0
        ? [[id, { current: Math.max(0, current), duration, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 }]]
        : [];
    })) as WatchState;
  } catch {
    return {};
  }
}

function writeWatchState(next: WatchState) {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* Continue without persistence. */ }
}

function progressPercent(watch: WatchState, id: string) {
  const value = watch[id];
  if (!value || value.duration < 1 || value.current < 2) return 0;
  return Math.min(100, Math.round((value.current / value.duration) * 100));
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function episodeNumber(item: Item) {
  return Number(item.episode.match(/\d+/)?.[0] ?? item.id.split("-").at(-1) ?? 0);
}

function App() {
  const itemId = usePlayId();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<(typeof NAV)[number]>("推荐");
  const [category, setCategory] = useState("全部");
  const [watch, setWatch] = useState<WatchState>({});

  useEffect(() => {
    fetch("/catalog.json")
      .then(response => response.ok ? response.json() : Promise.reject(new Error("catalog")))
      .then(setCatalog)
      .catch(() => setCatalog({ brand: "叙梦短剧", updatedAt: "", categories: [], items: [] }));
    setWatch(readWatchState());
  }, []);

  const recommended = useMemo(() => catalog ? diversifyVideoItems(catalog.items, new Date().toISOString()) : [], [catalog]);
  const latest = useMemo(() => [...recommended].sort((left, right) => right.id.localeCompare(left.id)), [recommended]);
  const baseItems = active === "最新" ? latest : recommended;
  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(() => baseItems.filter(item => {
    const matchesCategory = category === "全部" || item.category === category;
    const matchesQuery = !keyword || `${item.title} ${item.episode} ${item.category} ${item.badge}`.toLowerCase().includes(keyword);
    return matchesCategory && matchesQuery;
  }), [baseItems, category, keyword]);
  const selected = catalog?.items.find(item => item.id === itemId) || null;
  const feature = recommended[0] ?? null;
  const continueWatching = useMemo(() => recommended
    .filter(item => progressPercent(watch, item.id) > 0 && progressPercent(watch, item.id) < 96)
    .sort((left, right) => (watch[right.id]?.updatedAt ?? 0) - (watch[left.id]?.updatedAt ?? 0))
    .slice(0, 6), [recommended, watch]);
  const categories = useMemo(() => ["全部", ...new Set(catalog?.items.map(item => item.category).filter(Boolean))], [catalog]);

  if (itemId && !catalog) return <div className="app-shell"><main className="empty">正在打开这一集。</main></div>;
  if (itemId && !selected) return <div className="app-shell"><main className="empty">没有找到这一集。<a href="/">返回片库</a></main></div>;
  if (selected) return <Player item={selected} items={catalog?.items ?? []} watch={watch} setWatch={setWatch} />;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark">梦</span><span><b>叙梦短剧</b><small>AI · ORIGINAL · PLAY</small></span></a>
      <nav aria-label="片库导航">{NAV.map(item => <button key={item} className={active === item ? "active" : ""} aria-pressed={active === item} onClick={() => setActive(item)}>{item}</button>)}</nav>
      <div className="actions"><label className="search"><span aria-hidden="true">⌕</span><input aria-label="搜索视频" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索剧名、集数或标签" />{query && <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>×</button>}</label><button className="user">登录 / 注册</button></div>
    </header>
    <main>
      {feature && <section className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(18,14,24,.98) 0%, rgba(18,14,24,.78) 38%, rgba(18,14,24,.12) 78%), url(${posterUrl(feature)})` }}>
        <div className="hero-copy"><span className="eyebrow">今日推荐 · 多剧混排</span><h1>{feature.title}</h1><p>根据更新、新鲜度和观看分布重新编排，避免首页连续刷到同一部剧。</p><div className="hero-meta"><span>{feature.category}</span><span>·</span><span>{feature.episode}</span><span>·</span><span>{feature.badge}</span></div><a className="primary" href={`/play/${feature.id}`}>立即播放 <span>↗</span></a></div><div className="hero-stamp">01<br /><small>RECOMMENDED</small></div>
      </section>}
      {continueWatching.length > 0 && <section className="continue-section"><div className="section-head compact-head"><div><span className="eyebrow">CONTINUE WATCHING</span><h2>接着看</h2></div><span className="section-hint">从上次停下的位置继续</span></div><div className="continue-row">{continueWatching.map(item => <a key={item.id} className="continue-card" href={`/play/${item.id}`}><img src={posterUrl(item)} alt="" /><span><strong>{item.title}</strong><small>{item.episode} · 已看 {progressPercent(watch, item.id)}%</small><i style={{ "--progress": `${progressPercent(watch, item.id)}%` } as CSSProperties} /></span></a>)}</div></section>}
      <section className="section-head"><div><span className="eyebrow">SHELF / {active.toUpperCase()}</span><h2>{query ? `搜索结果 · ${query}` : active === "最新" ? "最近更新" : "为你推荐"}</h2></div><span className="result-count">{filtered.length} 集</span></section>
      <div className="filter-row" aria-label="视频分类">{categories.slice(0, 12).map(item => <button key={item} className={category === item ? "active" : ""} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <section className="drama-grid">{filtered.map((item, index) => <DramaCard key={item.id} item={item} index={index} progress={progressPercent(watch, item.id)} />)}</section>
      {!filtered.length && <div className="empty"><strong>没有找到对应内容</strong><span>换个关键词，或者清除筛选继续浏览。</span><button type="button" onClick={() => { setQuery(""); setCategory("全部"); setActive("推荐"); }}>清除筛选</button></div>}
    </main>
    <footer><span>叙梦短剧 · 专注于有气氛的短内容</span><span>推荐每天刷新 · {catalog?.items.length || 0} 集</span></footer>
  </div>;
}

function DramaCard({ item, index, progress }: { item: Item; index: number; progress: number }) {
  return <article className="drama-card" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}><a href={`/play/${item.id}`} className="poster"><img loading={index > 5 ? "lazy" : "eager"} src={posterUrl(item)} alt={item.title} /><span className="poster-shade" /><span className="play-dot">▶</span><span className="badge">{item.badge}</span>{progress > 0 && <span className="progress-line" style={{ "--progress": `${progress}%` } as CSSProperties} />}</a><div className="card-copy"><div><h3><a href={`/play/${item.id}`}>{item.title}</a></h3><p>{item.episode} · {item.category}</p></div><span className="card-arrow">↗</span></div></article>;
}

function Player({ item, items, watch, setWatch }: { item: Item; items: Item[]; watch: WatchState; setWatch: (next: WatchState) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);
  const [resumeAt, setResumeAt] = useState(0);
  const series = useMemo(() => items.filter(candidate => candidate.dramaId === item.dramaId).sort((left, right) => episodeNumber(left) - episodeNumber(right)), [items, item.dramaId]);
  const next = series[series.findIndex(candidate => candidate.id === item.id) + 1] ?? null;

  useEffect(() => {
    const saved = watch[item.id];
    setResumeAt(saved && saved.current > 3 && saved.current < saved.duration - 5 ? saved.current : 0);
  }, [item.id, watch]);

  function saveProgress(video: HTMLVideoElement, force = false) {
    if (!Number.isFinite(video.duration) || video.duration <= 0 || (!force && Date.now() - lastSaved.current < 2500)) return;
    lastSaved.current = Date.now();
    const nextState = { ...watch, [item.id]: { current: video.currentTime, duration: video.duration, updatedAt: Date.now() } };
    setWatch(nextState);
    writeWatchState(nextState);
  }

  function clearProgress() {
    const nextState = { ...watch };
    delete nextState[item.id];
    setWatch(nextState);
    writeWatchState(nextState);
  }

  return <div className="player-page"><header className="topbar compact"><a className="brand" href="/"><span className="brand-mark">梦</span><span><b>叙梦短剧</b><small>AI · ORIGINAL · PLAY</small></span></a><a className="back" href="/">← 返回片库</a></header><main className="player-main"><div className="player-wrap"><video ref={videoRef} controls autoPlay playsInline poster={posterUrl(item)} src={mediaUrl(item)} onLoadedMetadata={event => { const video = event.currentTarget; if (resumeAt > 0) video.currentTime = resumeAt; }} onTimeUpdate={event => saveProgress(event.currentTarget)} onPause={event => saveProgress(event.currentTarget, true)} onEnded={clearProgress} /></div><div className="player-info"><div><span className="eyebrow">NOW PLAYING · {item.badge}</span><h1>{item.title}</h1><p>{item.episode} · {item.category}</p>{resumeAt > 0 && <p className="resume-note">已从 {formatTime(resumeAt)} 继续播放</p>}</div><div className="player-actions"><div className="player-note">公开样片<br /><small>来自你的媒体空间</small></div>{next && <a className="next-episode" href={`/play/${next.id}`}>下一集 <span>→</span></a>}</div></div></main></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
