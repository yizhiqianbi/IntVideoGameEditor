"use client";

/* eslint-disable @next/next/no-img-element -- Imported character covers are local media assets. */
import { useEffect, useMemo, useState } from "react";
import { getDzmmCharacterPreviewText } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { xumengImageUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import type { DzmmPreferences } from "@/lib/dzmm-storage";
import {
  DZMM_DISCOVERY_CATEGORIES, filterDzmmCharacters, findCharacterAuthor,
  isInDzmmCategory, searchDzmmAuthors,
  type DzmmAuthor, type DzmmDiscoveryFilters, type DzmmDiscoverySort, type DzmmDiscoveryTime, type DzmmForumTopic,
} from "@/lib/dzmm-discovery";
import { DZMM_CATEGORY_QUERY_MAX_LENGTH } from "@/lib/dzmm-discovery-history";
import Icon from "./icons";
import categoryCoverDataset from "@/lib/dzmm-category-covers.json";
import s from "./discovery-views.module.css";

const categoryCovers = categoryCoverDataset as Record<string, { path: string; sha256: string }>;

type CharacterCallbacks = {
  onCharacter: (character: Character) => void;
  onFavorite: (id: string) => void;
  onLike?: (id: string) => void;
  onAuthor: (author: DzmmAuthor) => void;
};

function CharacterCards({ characters, authors, favorites, likes = [], onCharacter, onFavorite, onLike, onAuthor, single = false, userName }: CharacterCallbacks & {
  characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[]; single?: boolean; userName?: string;
}) {
  return <div className={`${s.cardGrid} ${single ? s.singleGrid : ""}`}>
    {characters.map((character) => {
      const author = findCharacterAuthor(authors, character.id);
      const favorite = favorites.includes(character.id);
      const liked = likes.includes(character.id);
      return <article className={s.card} key={character.id}>
        <button className={s.coverButton} onClick={() => onCharacter(character)} aria-label={`查看 ${character.name}`}>
          <img src={xumengImageUrl(character.cover || XUMENG_FALLBACK_COVER)} alt={character.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = XUMENG_FALLBACK_COVER; }} />
          <span className={s.heat}><Icon name="flame" size={14} />{character.heat || "—"}</span>
        </button>
        <div className={s.cardBody}>
          <button className={s.cardTitle} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterPreviewText(character, userName)}</p></button>
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

export type CatalogDiscoveryProps = CharacterCallbacks & {
  characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[];
  preferences: DzmmPreferences; initialCategory?: string | null;
  onCategoryChange?: (slug: string | null) => void;
  filters?: CatalogDiscoveryFilters;
  onFiltersChange?: (filters: CatalogDiscoveryFilters) => void;
};

export function CatalogDiscovery({ characters, authors, favorites, likes, preferences, initialCategory, onCategoryChange, filters: controlledFilters, onFiltersChange, ...callbacks }: CatalogDiscoveryProps) {
  const [localCategory, setCategory] = useState<string | null>(null);
  const category = initialCategory === undefined ? localCategory : initialCategory;
  const [localFilters, setLocalFilters] = useState<CatalogDiscoveryFilters>({ sort: "hot", time: "all", query: "" });
  const filters = controlledFilters ?? localFilters;
  const { sort, time, query } = filters;
  function updateFilters(change: Partial<CatalogDiscoveryFilters>) {
    const next = { ...filters, ...change };
    setLocalFilters(next);
    onFiltersChange?.(next);
  }
  const visible = useMemo(() => filterDzmmCharacters(characters, { blockedTags: preferences.blockedTags }), [characters, preferences.blockedTags]);
  const filtered = useMemo(() => filterDzmmCharacters(characters, { category, query, sort, time, blockedTags: preferences.blockedTags }), [characters, category, query, sort, time, preferences.blockedTags]);
  const selected = DZMM_DISCOVERY_CATEGORIES.find((item) => item.slug === category);
  function choose(slug: string | null) {
    // The route owner must capture the old query before this explicit category change clears it.
    onCategoryChange?.(slug); setCategory(slug); updateFilters({ query: "" });
  }
  return <main className={s.discovery}>
    <div className={s.heading}>
      <div>{category && <button className={s.back} onClick={() => choose(null)}><Icon name="back" size={17} />全部分类</button>}<h1>{selected?.name ?? "分类"}</h1></div>
      {category && <span className={s.muted}>{filtered.length} 个已收录角色</span>}
    </div>
    {!category ? <div className={s.categoryGrid}>
      {DZMM_DISCOVERY_CATEGORIES.map((item) => {
        const roles = visible.filter((character) => isInDzmmCategory(character, item.slug));
        return <button className={s.categoryTile} key={item.slug} onClick={() => choose(item.slug)} aria-label={`浏览 ${item.name} 分类，${roles.length} 个已收录角色`}>
          {categoryCovers[item.slug]?.path ? <img src={xumengImageUrl(categoryCovers[item.slug].path)} alt="" /> : <span className={s.categoryPlaceholder}><Icon name="book" size={30} /></span>}
          <span className={s.tileCaption}><strong>{item.name}</strong><small>{roles.length} 个已收录</small></span>
        </button>;
      })}
    </div> : <>
      <div className={s.filters}>
        <label>排序方式<select aria-label="排序方式" value={sort} onChange={(event) => updateFilters({ sort: event.target.value as DzmmDiscoverySort })}><option value="hot">热门</option><option value="new">最新收录</option><option value="likes">点赞记录</option></select></label>
        <label>收录时间<select aria-label="收录时间范围" value={time} onChange={(event) => updateFilters({ time: event.target.value as DzmmDiscoveryTime })}><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option><option value="quarter">近三个月</option><option value="all">全部</option></select></label>
        <label className={s.filterSearch}><Icon name="search" size={17} /><input aria-label={`搜索 ${selected?.name ?? "分类"} 角色`} maxLength={DZMM_CATEGORY_QUERY_MAX_LENGTH} value={query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="搜索角色、作者或标签" /></label>
      </div>
      {sort === "likes" && <p className={s.filterNote}>按已收录的点赞记录排序，未知记录排在后面。</p>}
      {filtered.length ? <CharacterCards characters={filtered} authors={authors} favorites={favorites} likes={likes} single={preferences.homeLayout === "single"} userName={preferences.nickname} {...callbacks} /> : <Empty title="这个分类还没有相关角色" description={query ? "试试其他关键词，或清除时间和标签筛选。" : "目前没有收录符合筛选条件的角色。"} />}
    </>}
  </main>;
}

export type SearchResultsProps = CharacterCallbacks & {
  query: string; characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[];
  preferences?: DzmmPreferences;
  onTopic?: (topic: DzmmForumTopic) => void;
  searchTopics?: (query: string, signal: AbortSignal) => Promise<DzmmForumTopic[]>;
};

export function SearchResults({ query, characters, authors, favorites, likes, preferences, onTopic, searchTopics, ...callbacks }: SearchResultsProps) {
  const [tab, setTab] = useState<"characters" | "authors" | "topics">("characters");
  const [retry, setRetry] = useState(0);
  const [topicResult, setTopicResult] = useState<{ query: string; retry: number; topics: DzmmForumTopic[]; error: string }>({ query: "", retry: -1, topics: [], error: "" });
  const resultCurrent = topicResult.query === query.trim() && topicResult.retry === retry;
  const topics = resultCurrent ? topicResult.topics : [];
  const error = resultCurrent ? topicResult.error : "";
  const loading = Boolean(searchTopics && query.trim() && !resultCurrent);
  const matchingCharacters = useMemo(() => filterDzmmCharacters(characters, { query, blockedTags: preferences?.blockedTags }), [characters, query, preferences?.blockedTags]);
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
      <button role="tab" aria-selected={tab === "characters"} className={tab === "characters" ? s.activeTab : ""} onClick={() => setTab("characters")}>角色 <small>{matchingCharacters.length}</small></button>
      <button role="tab" aria-selected={tab === "authors"} className={tab === "authors" ? s.activeTab : ""} onClick={() => setTab("authors")}>用户 <small>{matchingAuthors.length}</small></button>
      <button role="tab" aria-selected={tab === "topics"} className={tab === "topics" ? s.activeTab : ""} onClick={() => setTab("topics")}>主题</button>
    </div>
    {!query.trim() ? <Empty title="输入关键词开始搜索" description="可以查找角色、已收录作者和站内主题。" /> : <>
      {tab === "characters" && (matchingCharacters.length ? <CharacterCards characters={matchingCharacters} authors={authors} favorites={favorites} likes={likes} single={preferences?.homeLayout === "single"} userName={preferences?.nickname} {...callbacks} /> : <Empty title="没有找到相关角色" description="试试角色名称、作者名或其他标签。" />)}
      {tab === "authors" && (matchingAuthors.length ? <div className={s.authorGrid}>{matchingAuthors.map((author) => <button className={s.authorCard} key={author.id} onClick={() => callbacks.onAuthor(author)}><span className={s.largeAvatar}>{Array.from(author.name)[0] ?? ""}</span><span><strong>{author.name}</strong><small>{author.characterIds.length} 个已收录作品</small></span><Icon name="chevron" size={18} /></button>)}</div> : <Empty title="没有找到相关用户" description="目前只显示已收录角色的作者资料。" />)}
      {tab === "topics" && (loading ? <p className={s.loading} role="status">正在搜索主题…</p> : error ? <div className={s.empty}><p role="alert">{error}</p><button className={s.outline} onClick={() => setRetry((value) => value + 1)}>重试</button></div> : topics.length ? <div className={s.topicList}>{topics.map((topic) => <button className={s.topic} key={topic.id} onClick={() => onTopic?.(topic)} disabled={!onTopic}><span className={s.topicMeta}>{topic.author || "站内用户"}{topic.category && ` · ${topic.category}`}</span><h2>{topic.title}</h2>{topic.body && <p>{topic.body}</p>}<span className={s.topicRead}>查看主题 <Icon name="chevron" size={15} /></span></button>)}</div> : <Empty title="没有找到相关主题" description={searchTopics ? "换一个关键词试试。" : "主题搜索尚未连接。"} />)}
    </>}
  </main>;
}

export type AuthorProfileProps = {
  author: DzmmAuthor; characters: Character[]; preferences: DzmmPreferences;
  onPreferences: (preferences: DzmmPreferences) => void;
  onCharacter: (character: Character) => void; onBack: () => void;
};

export function AuthorProfile({ author, characters, preferences, onPreferences, onCharacter, onBack }: AuthorProfileProps) {
  const [copied, setCopied] = useState("");
  const following = preferences.followedAuthors?.includes(author.id) ?? false;
  const works = filterDzmmCharacters(characters.filter((character) => author.characterIds.includes(character.id)), { blockedTags: preferences.blockedTags, sort: "new" });
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
    <div className={s.tabs}><span className={s.activeTab}>角色作品 <small>{works.length}</small></span></div>
    {works.length ? <div className={s.cardGrid}>{works.map((character) => <article className={s.card} key={character.id}><button className={s.coverButton} onClick={() => onCharacter(character)} aria-label={`查看 ${character.name}`}><img src={xumengImageUrl(character.cover)} alt={character.name} /><span className={s.heat}><Icon name="flame" size={14} />{character.heat || "—"}</span></button><div className={s.cardBody}><button className={s.cardTitle} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterPreviewText(character, preferences.nickname)}</p></button></div></article>)}</div> : <Empty title="暂无可显示的作品" description="这个作者的已收录作品为空，或已被你的标签设置屏蔽。" />}
  </main>;
}
