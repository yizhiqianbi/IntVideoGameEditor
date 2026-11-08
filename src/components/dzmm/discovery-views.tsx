"use client";

/* eslint-disable @next/next/no-img-element -- Imported character covers are local media assets. */
import { useEffect, useMemo, useRef, useState } from "react";
import { getDzmmCharacterCardBlurb } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { coverShelfTags } from "@/lib/xumeng-shelf-tags";
import { recommendationReasonText, type RecommendationReason } from "@/lib/xumeng-recommendations";
import type { DzmmPreferences } from "@/lib/dzmm-storage";
import {
  DZMM_DISCOVERY_CATEGORIES, filterDzmmCharacters, findCharacterAuthor, isDzmmCharacterBlocked,
  searchDzmmAuthors,
  type DzmmAuthor, type DzmmDiscoveryFilters, type DzmmDiscoverySort, type DzmmDiscoveryTime, type DzmmForumTopic,
} from "@/lib/dzmm-discovery";
import { DZMM_CATEGORY_QUERY_MAX_LENGTH } from "@/lib/dzmm-discovery-history";
import { CoverReel } from "./cover-reel";
import Icon from "./icons";
import s from "./discovery-views.module.css";

type CharacterCallbacks = {
  onCharacter: (character: Character) => void;
  onFavorite: (id: string) => void;
  onLike?: (id: string) => void;
  onAuthor: (author: DzmmAuthor) => void;
  onTag?: (tag: string) => void;
};

function CharacterCards({ characters, authors, favorites, likes = [], onCharacter, onFavorite, onLike, onAuthor, onTag, single = false, userName, reasons, trackRecommendations = false }: CharacterCallbacks & {
  characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[]; onTag?: (tag: string) => void; single?: boolean; userName?: string;
  reasons?: Readonly<Record<string, RecommendationReason>>; trackRecommendations?: boolean;
}) {
  return <div className={`${s.cardGrid} ${single ? s.singleGrid : ""}`}>
    {characters.map((character, index) => {
      const author = findCharacterAuthor(authors, character.id);
      const favorite = favorites.includes(character.id);
      const liked = likes.includes(character.id);
      const painted = coverShelfTags(character.tags, 2);
      const reason = reasons?.[character.id];
      const reasonLabel = recommendationReasonText(reason);
      return <article className={s.card} key={character.id} data-recommend-id={trackRecommendations ? character.id : undefined} data-recommend-position={trackRecommendations ? index : undefined}>
        <CoverReel className={s.coverButton} character={character} count="corner" onOpen={() => onCharacter(character)}>
          <span className={s.heat}><Icon name="flame" size={14} />{character.heat || "—"}</span>
        </CoverReel>
        {painted.length > 0 && <div className={s.coverTags}>{painted.map((tag) => onTag ? <button key={tag} type="button" onClick={() => onTag(tag)} aria-label={`只看${tag}`}>{tag}</button> : <span key={tag}>{tag}</span>)}</div>}
        <div className={s.cardBody}>
          <button className={s.cardTitle} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterCardBlurb(character, userName)}</p>{reasonLabel && <span className={s.reason}>{reasonLabel}</span>}</button>
          <div className={s.cardFooter}>
            {author ? <button className={s.authorLink} onClick={() => onAuthor(author)} aria-label={`查看作者 ${author.name}`}><span className={s.avatar}>{Array.from(author.name)[0] ?? ""}</span><span>{author.name}</span></button>
              : <span className={s.authorLink}><span className={s.avatar}>{Array.from(character.author)[0] ?? ""}</span><span>{character.author}</span></span>}
            <button className={liked ? s.liked : s.like} onClick={() => onLike?.(character.id)} aria-label={`${liked ? "取消点赞" : "点赞"} ${character.name}`} aria-pressed={liked}><Icon name="heart" size={16} /><span>{character.likes || "—"}</span></button>
            <button className={favorite ? s.favorited : s.favorite} onClick={() => onFavorite(character.id)} aria-label={`${favorite ? "取消收藏" : "收藏"} ${character.name}`} aria-pressed={favorite}><Icon name={favorite ? "check" : "book"} size={16} /></button>
          </div>
        </div>
      </article>;
    })}
  </div>;
}

function Empty({ title, description }: { title: string; description: string }) {
  return <div className={s.empty}><Icon name="search" size={34} /><h2>{title}</h2><p>{description}</p></div>;
}

export type CatalogDiscoveryFilters = DzmmDiscoveryFilters;

export type ShelfPage = { total: number; hasMore: boolean; loading: boolean; onLoad: () => void; serverFiltered?: boolean };

export function DiscoveryTagPicker({ open, onClose, options, selected, limit, onToggle, onClear }: {
  open: boolean;
  onClose: () => void;
  options: readonly { id: string; name: string }[];
  selected: readonly string[];
  limit: number;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const pickerRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? options.filter((item) => item.name.toLocaleLowerCase().includes(term)) : options;
  }, [options, query]);
  useEffect(() => {
    if (!open) return;
    const close = () => { setQuery(""); onClose(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => pickerRef.current?.focus());
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  const close = () => { setQuery(""); onClose(); };
  return <div className={s.tagPickerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className={s.tagPicker} ref={pickerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="global-tag-picker-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className={s.tagPickerHeader}><div><span className={s.tagEntryKicker}>EXPLORE</span><h2 id="global-tag-picker-title">选择标签</h2><p>点一下就筛选，最多 {limit} 个。</p></div><button type="button" className={s.tagPickerClose} aria-label="关闭标签选择" onClick={close}><Icon name="close" size={18} /></button></header>
      <label className={s.tagPickerSearch}><Icon name="search" size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签" aria-label="搜索标签" /></label>
      <div className={s.tagPickerChips} role="group" aria-label="分类标签"><button type="button" className={selected.length === 0 ? s.tagPickerChipOn : s.tagPickerChip} aria-pressed={selected.length === 0} onClick={onClear}>全部</button>{visible.map((item) => {
        const on = selected.includes(item.id);
        return <button type="button" className={on ? s.tagPickerChipOn : s.tagPickerChip} key={item.id} aria-pressed={on} onClick={() => onToggle(item.id)}>{item.name}</button>;
      })}</div>
      {!visible.length && <p className={s.tagPickerEmpty}>没有匹配的标签</p>}
      <footer className={s.tagPickerFooter}><span>已选 {selected.length}/{limit}</span></footer>
    </section>
  </div>;
}

function ShelfMore({ more }: { more?: ShelfPage | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const hasMore = Boolean(more?.hasMore);
  const loading = Boolean(more?.loading);
  const onLoad = more?.onLoad;
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading || !onLoad) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoad();
    }, { rootMargin: "720px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoad]);
  if (!more || (more.total <= 0 && !more.hasMore && !more.loading)) return null;
  return <div className={s.more} ref={ref}>
    {more.total > 0 && <p>共 {more.total} 个</p>}
    {more.loading && <p>正在往下加载…</p>}
  </div>;
}

export type CatalogDiscoveryProps = CharacterCallbacks & {
  characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[];
  preferences: DzmmPreferences; initialCategory?: string | null;
  onCategoryChange?: (slug: string | null) => void;
  filters?: CatalogDiscoveryFilters;
  onFiltersChange?: (filters: CatalogDiscoveryFilters) => void;
  more?: ShelfPage | null;
  reasons?: Readonly<Record<string, RecommendationReason>>;
  trackRecommendations?: boolean;
};

export function CatalogDiscovery({ characters, authors, favorites, likes, preferences, initialCategory, onCategoryChange, filters: controlledFilters, onFiltersChange, onTag, more, reasons, trackRecommendations, ...callbacks }: CatalogDiscoveryProps) {
  const [localCategory, setCategory] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const tagPickerRef = useRef<HTMLElement | null>(null);
  const category = initialCategory === undefined ? localCategory : initialCategory;
  const [localFilters, setLocalFilters] = useState<CatalogDiscoveryFilters>({ sort: "hot", time: "all", query: "" });
  const filters = controlledFilters ?? localFilters;
  const { sort, time, query } = filters;
  function updateFilters(change: Partial<CatalogDiscoveryFilters>) {
    const next = { ...filters, ...change };
    setLocalFilters(next);
    onFiltersChange?.(next);
  }
  const filtered = useMemo(() => more?.serverFiltered
    ? characters.filter((character) => !isDzmmCharacterBlocked(character, preferences.blockedTags))
    : filterDzmmCharacters(characters, { category, query, sort, time, blockedTags: preferences.blockedTags }), [characters, category, query, sort, time, preferences.blockedTags, more?.serverFiltered]);
  const listedTotal = more?.serverFiltered ? more.total : filtered.length;
  const listedMore = more ? { ...more, total: listedTotal } : more;
  const selected = DZMM_DISCOVERY_CATEGORIES.find((item) => item.slug === category);
  function choose(slug: string | null) {
    // The route owner must capture the old query before this explicit category change clears it.
    onCategoryChange?.(slug); setCategory(slug); updateFilters({ query: "" }); setTagPickerOpen(false);
  }
  useEffect(() => {
    if (!tagPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setTagPickerOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => tagPickerRef.current?.focus());
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tagPickerOpen]);
  return <main className={s.discovery}>
    <div className={s.heading}>
      <div>{category && <button className={s.back} onClick={() => choose(null)}><Icon name="back" size={17} />全部分类</button>}<h1>{selected?.name ?? "分类"}</h1></div>
      {category && <span className={s.muted}>{listedTotal} 个已收录角色</span>}
    </div>
    {!category ? <>
      <section className={s.tagEntry} aria-labelledby="all-tags-title">
        <div className={s.tagEntryCopy}>
          <span className={s.tagEntryKicker}>DISCOVER</span>
          <h2 id="all-tags-title">按标签探索</h2>
          <p>从纯爱、女性向到世界模拟，打开标签面板，选择你想看的内容。</p>
        </div>
        <button type="button" className={s.tagEntryButton} onClick={() => setTagPickerOpen(true)}><Icon name="search" size={18} />打开全部标签</button>
      </section>
      <div className={s.tagQuickList} aria-label="热门标签">
        {DZMM_DISCOVERY_CATEGORIES.slice(0, 8).map((item) => <button type="button" className={s.tagQuick} key={item.slug} onClick={() => choose(item.slug)}>{item.name}</button>)}
      </div>
      {tagPickerOpen && <div className={s.tagPickerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTagPickerOpen(false); }}>
        <section className={s.tagPicker} ref={tagPickerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tag-picker-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className={s.tagPickerHeader}><div><span className={s.tagEntryKicker}>EXPLORE</span><h2 id="tag-picker-title">选择标签</h2></div><button type="button" className={s.tagPickerClose} aria-label="关闭标签选择" onClick={() => setTagPickerOpen(false)}><Icon name="close" size={18} /></button></header>
          <div className={s.tagPickerGrid}>{DZMM_DISCOVERY_CATEGORIES.map((item) => <button type="button" className={s.tagPickerTag} key={item.slug} onClick={() => choose(item.slug)}><span>{item.name}</span><small>{item.tags.slice(0, 2).join(" · ")}</small><Icon name="chevron" size={15} /></button>)}</div>
        </section>
      </div>}
    </> : <>
      <div className={s.filters}>
        <label>排序方式<select aria-label="排序方式" value={sort} onChange={(event) => updateFilters({ sort: event.target.value as DzmmDiscoverySort })}><option value="hot">热门</option><option value="new">最新收录</option><option value="likes">点赞记录</option></select></label>
        <label>收录时间<select aria-label="收录时间范围" value={time} onChange={(event) => updateFilters({ time: event.target.value as DzmmDiscoveryTime })}><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option><option value="quarter">近三个月</option><option value="all">全部</option></select></label>
        <label className={s.filterSearch}><Icon name="search" size={17} /><input aria-label={`搜索 ${selected?.name ?? "分类"} 角色`} maxLength={DZMM_CATEGORY_QUERY_MAX_LENGTH} value={query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="搜索角色、作者或标签" /></label>
      </div>
      {sort === "likes" && <p className={s.filterNote}>按已收录的点赞记录排序，未知记录排在后面。</p>}
      {more?.loading && filtered.length === 0 ? <p className={s.loading} role="status">正在加载角色…</p> : filtered.length ? <><CharacterCards characters={filtered} authors={authors} favorites={favorites} likes={likes} onTag={onTag} single={preferences.homeLayout === "single"} userName={preferences.nickname} reasons={reasons} trackRecommendations={trackRecommendations} {...callbacks} /><ShelfMore more={listedMore} /></> : <><Empty title="这个分类还没有相关角色" description={query ? "试试其他关键词，或清除时间和标签筛选。" : "目前没有收录符合筛选条件的角色。"} />{more?.hasMore && <ShelfMore more={listedMore} />}</>}
    </>}
  </main>;
}

export type SearchResultsProps = CharacterCallbacks & {
  query: string; characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[];
  preferences?: DzmmPreferences;
  onTopic?: (topic: DzmmForumTopic) => void;
  searchTopics?: (query: string, signal: AbortSignal) => Promise<DzmmForumTopic[]>;
  more?: ShelfPage | null;
  reasons?: Readonly<Record<string, RecommendationReason>>;
  trackRecommendations?: boolean;
};

export function SearchResults({ query, characters, authors, favorites, likes, preferences, onTopic, searchTopics, more, reasons, trackRecommendations, ...callbacks }: SearchResultsProps) {
  const [tab, setTab] = useState<"characters" | "authors" | "topics">("characters");
  const [retry, setRetry] = useState(0);
  const [topicResult, setTopicResult] = useState<{ query: string; retry: number; topics: DzmmForumTopic[]; error: string }>({ query: "", retry: -1, topics: [], error: "" });
  const resultCurrent = topicResult.query === query.trim() && topicResult.retry === retry;
  const topics = resultCurrent ? topicResult.topics : [];
  const error = resultCurrent ? topicResult.error : "";
  const loading = Boolean(searchTopics && query.trim() && !resultCurrent);
  const matchingCharacters = useMemo(() => more?.serverFiltered
    ? characters.filter((character) => !isDzmmCharacterBlocked(character, preferences?.blockedTags))
    : filterDzmmCharacters(characters, { query, blockedTags: preferences?.blockedTags }), [characters, query, preferences?.blockedTags, more?.serverFiltered]);
  const listedTotal = more?.serverFiltered ? more.total : matchingCharacters.length;
  const listedMore = more ? { ...more, total: listedTotal } : more;
  const matchingAuthors = useMemo(() => searchDzmmAuthors(authors, query), [authors, query]);
  useEffect(() => {
    if (tab !== "topics" || !searchTopics || !query.trim()) return;
    const abort = new AbortController();
    void searchTopics(query.trim(), abort.signal).then((result) => { if (!abort.signal.aborted) setTopicResult({ query: query.trim(), retry, topics: result, error: "" }); }).catch((failure: unknown) => { if (!abort.signal.aborted) setTopicResult({ query: query.trim(), retry, topics: [], error: failure instanceof Error ? failure.message : "主题搜索失败，请重试。" }); });
    return () => abort.abort();
  }, [tab, query, searchTopics, retry]);
  return <main className={s.discovery}>
    <div className={s.heading}><h1>搜索{query.trim() && <span className={s.searchTerm}>“{query.trim()}”</span>}</h1></div>
    <div className={s.tabs} role="tablist" aria-label="搜索内容">
      <button role="tab" aria-selected={tab === "characters"} className={tab === "characters" ? s.activeTab : ""} onClick={() => setTab("characters")}>角色 <small>{listedTotal}</small></button>
      <button role="tab" aria-selected={tab === "authors"} className={tab === "authors" ? s.activeTab : ""} onClick={() => setTab("authors")}>用户 <small>{matchingAuthors.length}</small></button>
      {searchTopics && <button role="tab" aria-selected={tab === "topics"} className={tab === "topics" ? s.activeTab : ""} onClick={() => setTab("topics")}>主题</button>}
    </div>
    {!query.trim() ? <Empty title="输入关键词开始搜索" description={searchTopics ? "可以查找角色、已收录作者和站内主题。" : "可以查找角色和已收录作者。"} /> : <>
      {tab === "characters" && (more?.loading && matchingCharacters.length === 0 ? <p className={s.loading} role="status">正在搜索角色…</p> : matchingCharacters.length ? <><CharacterCards characters={matchingCharacters} authors={authors} favorites={favorites} likes={likes} single={preferences?.homeLayout === "single"} userName={preferences?.nickname} reasons={reasons} trackRecommendations={trackRecommendations} {...callbacks} /><ShelfMore more={listedMore} /></> : <><Empty title="没有找到相关角色" description="试试角色名称、作者名或其他标签。" />{more?.hasMore && <ShelfMore more={listedMore} />}</>)}
      {tab === "authors" && (matchingAuthors.length ? <div className={s.authorGrid}>{matchingAuthors.map((author) => <button className={s.authorCard} key={author.id} onClick={() => callbacks.onAuthor(author)}><span className={s.largeAvatar}>{Array.from(author.name)[0] ?? ""}</span><span><strong>{author.name}</strong><small>{author.characterIds.length} 个已收录作品</small></span><Icon name="chevron" size={18} /></button>)}</div> : <Empty title="没有找到相关用户" description="目前只显示已收录角色的作者资料。" />)}
      {tab === "topics" && (loading ? <p className={s.loading} role="status">正在搜索主题…</p> : error ? <div className={s.empty}><p role="alert">{error}</p><button className={s.outline} onClick={() => setRetry((value) => value + 1)}>重试</button></div> : topics.length ? <div className={s.topicList}>{topics.map((topic) => <button className={s.topic} key={topic.id} onClick={() => onTopic?.(topic)} disabled={!onTopic}><span className={s.topicMeta}>{topic.author || "站内用户"}{topic.category && ` · ${topic.category}`}</span><h2>{topic.title}</h2>{topic.body && <p>{topic.body}</p>}<span className={s.topicRead}>查看主题 <Icon name="chevron" size={15} /></span></button>)}</div> : <Empty title="没有找到相关主题" description={searchTopics ? "换一个关键词试试。" : "主题搜索尚未连接。"} />)}
    </>}
  </main>;
}

export type AuthorProfileProps = {
  author: DzmmAuthor; characters: Character[]; preferences: DzmmPreferences;
  onPreferences: (preferences: DzmmPreferences) => void;
  onCharacter: (character: Character) => void; onBack: () => void;
  more?: ShelfPage | null;
};

export function AuthorProfile({ author, characters, preferences, onPreferences, onCharacter, onBack, more }: AuthorProfileProps) {
  const [copied, setCopied] = useState("");
  const following = preferences.followedAuthors?.includes(author.id) ?? false;
  const unique = [...new Map(characters.map((character) => [character.id, character])).values()];
  const works = filterDzmmCharacters(unique.filter((character) => author.characterIds.includes(character.id) || character.publication?.authorId === author.id), { blockedTags: preferences.blockedTags, sort: "new" });
  const listedTotal = more?.serverFiltered ? more.total : works.length;
  const listedMore = more ? { ...more, total: listedTotal } : more;
  function follow() {
    const previous = preferences.followedAuthors ?? [];
    if (!following && previous.length >= 200) { setCopied("最多关注 200 位作者，请先取消一些关注。"); return; }
    onPreferences({ ...preferences, followedAuthors: following ? previous.filter((id) => id !== author.id) : [...previous, author.id] });
  }
  async function copyId() { try { await navigator.clipboard.writeText(author.id); setCopied("作者 ID 已复制。"); } catch { setCopied("未能复制，请选择下方 ID 手动复制。"); } }
  return <main className={s.discovery}>
    <button className={s.back} onClick={onBack}><Icon name="back" size={18} />返回</button>
    <header className={s.authorHero}><span className={s.profileAvatar}>{Array.from(author.name)[0] ?? ""}</span><div className={s.authorInfo}><h1>{author.name}</h1><button className={s.idButton} onClick={() => void copyId()} aria-label="复制作者 ID">ID：{author.id}<Icon name="copy" size={13} /></button><p>{author.identityVerified === false ? "作品作者 · 尚未认领本站身份" : "角色作者"}</p></div><button className={following ? s.outline : s.primary} onClick={follow} aria-pressed={following}><Icon name={following ? "check" : "plus"} size={16} />{following ? "已关注" : "关注"}</button></header>
    {copied && <p className={s.inlineStatus} role="status">{copied}</p>}
    <div className={s.tabs}><span className={s.activeTab}>角色作品 <small>{listedTotal}</small></span></div>
    {more?.loading && works.length === 0 ? <p className={s.loading} role="status">正在加载作品…</p> : works.length ? <><div className={s.cardGrid}>{works.map((character) => <article className={s.card} key={character.id}><CoverReel className={s.coverButton} character={character} count="corner" onOpen={() => onCharacter(character)}><span className={s.heat}><Icon name="flame" size={14} />{character.heat || "—"}</span></CoverReel><div className={s.cardBody}><button className={s.cardTitle} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterCardBlurb(character, preferences.nickname)}</p></button></div></article>)}</div><ShelfMore more={listedMore} /></> : <><Empty title="暂无可显示的作品" description="这个作者的已收录作品为空，或已被你的标签设置屏蔽。" />{more?.hasMore && <ShelfMore more={listedMore} />}</>}
  </main>;
}
