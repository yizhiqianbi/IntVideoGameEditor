"use client";

/* eslint-disable @next/next/no-img-element -- Imported character covers are local media assets. */
import { useEffect, useMemo, useRef, useState } from "react";
import { getDzmmCharacterCardBlurb } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { coverShelfTags } from "@/lib/xumeng-shelf-tags";
import { recommendationReasonText, type RecommendationReason } from "@/lib/xumeng-recommendations";
import type { DzmmPreferences } from "@/lib/dzmm-storage";
import { localizeCharacter, sourceCharacterTag, xumengLocalizedAuthorName } from "@/lib/xumeng-card-localization";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengCategoryName, xumengPage, xumengPageFill, xumengReasonLabel } from "@/lib/xumeng-page-copy";
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

function CharacterCards({ characters, authors, favorites, likes = [], onCharacter, onFavorite, onLike, onAuthor, onTag, single = false, userName, reasons, trackRecommendations = false, locale = "zh-Hans" }: CharacterCallbacks & {
  characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[]; onTag?: (tag: string) => void; single?: boolean; userName?: string;
  reasons?: Readonly<Record<string, RecommendationReason>>; trackRecommendations?: boolean; locale?: XumengLocale;
}) {
  const copy = xumengPage(locale);
  return <div className={`${s.cardGrid} ${single ? s.singleGrid : ""}`}>
    {characters.map((character, index) => {
      const displayCharacter = localizeCharacter(character, locale);
      const author = findCharacterAuthor(authors, character.id);
      const favorite = favorites.includes(character.id);
      const liked = likes.includes(character.id);
      const painted = coverShelfTags(displayCharacter.tags, 2);
      const reason = reasons?.[character.id];
      const reasonLabel = xumengReasonLabel(locale, reason) || recommendationReasonText(reason);
      return <article className={s.card} key={character.id} data-recommend-id={trackRecommendations ? character.id : undefined} data-recommend-position={trackRecommendations ? index : undefined}>
        <CoverReel className={s.coverButton} character={displayCharacter} count="corner" onOpen={() => onCharacter(character)}>
          <span className={s.heat}><Icon name="flame" size={14} />{displayCharacter.heat || "—"}</span>
        </CoverReel>
        {painted.length > 0 && <div className={s.coverTags}>{painted.map((tag) => onTag ? <button key={tag} type="button" onClick={() => onTag(sourceCharacterTag(character, locale, tag))} aria-label={xumengPageFill(copy.onlyTag, { tag })}>{tag}</button> : <span key={tag}>{tag}</span>)}</div>}
        <div className={s.cardBody}>
          <button className={s.cardTitle} onClick={() => onCharacter(character)}><h2>{displayCharacter.name}</h2><p>{getDzmmCharacterCardBlurb(displayCharacter, userName)}</p>{reasonLabel && <span className={s.reason}>{reasonLabel}</span>}</button>
          <div className={s.cardFooter}>
            {author ? <button className={s.authorLink} onClick={() => onAuthor(author)} aria-label={xumengPageFill(copy.viewAuthor, { name: xumengLocalizedAuthorName(author.name, locale) })}><span className={s.avatar}>{Array.from(author.name)[0] ?? ""}</span><span>{xumengLocalizedAuthorName(author.name, locale)}</span></button>
              : <span className={s.authorLink}><span className={s.avatar}>{Array.from(character.author)[0] ?? ""}</span><span>{xumengLocalizedAuthorName(character.author, locale)}</span></span>}
            <button className={liked ? s.liked : s.like} onClick={() => onLike?.(character.id)} aria-label={`${liked ? copy.unlike : copy.like} ${character.name}`} aria-pressed={liked}><Icon name="heart" size={16} /><span>{character.likes || "—"}</span></button>
            <button className={favorite ? s.favorited : s.favorite} onClick={() => onFavorite(character.id)} aria-label={`${favorite ? copy.unfavorite : copy.favorite} ${character.name}`} aria-pressed={favorite}><Icon name={favorite ? "check" : "book"} size={16} /></button>
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

export function DiscoveryTagPicker({ open, onClose, options, selected, limit, onToggle, onClear, locale = "zh-Hans" }: {
  open: boolean;
  onClose: () => void;
  options: readonly { id: string; name: string }[];
  selected: readonly string[];
  limit: number;
  onToggle: (id: string) => void;
  onClear: () => void;
  locale?: XumengLocale;
}) {
  const copy = xumengPage(locale);
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
      <header className={s.tagPickerHeader}><div><h2 id="global-tag-picker-title">{copy.pickTags}</h2><p>{xumengPageFill(copy.pickTagsHint, { limit })}</p></div><button type="button" className={s.tagPickerClose} aria-label={copy.closeTags} onClick={close}><Icon name="close" size={18} /></button></header>
      <label className={s.tagPickerSearch}><Icon name="search" size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchTags} aria-label={copy.searchTags} /></label>
      <div className={s.tagPickerChips} role="group" aria-label={copy.categoryTags}><button type="button" className={selected.length === 0 ? s.tagPickerChipOn : s.tagPickerChip} aria-pressed={selected.length === 0} onClick={onClear}>{copy.all}</button>{visible.map((item) => {
        const on = selected.includes(item.id);
        return <button type="button" className={on ? s.tagPickerChipOn : s.tagPickerChip} key={item.id} aria-pressed={on} onClick={() => onToggle(item.id)}>{item.name}</button>;
      })}</div>
      {!visible.length && <p className={s.tagPickerEmpty}>{copy.noMatchingTags}</p>}
      <footer className={s.tagPickerFooter}><span>{xumengPageFill(copy.selectedCount, { selected: selected.length, limit })}</span></footer>
    </section>
  </div>;
}

function ShelfMore({ more, locale = "zh-Hans" }: { more?: ShelfPage | null; locale?: XumengLocale }) {
  const copy = xumengPage(locale);
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
    {more.total > 0 && <p>{xumengPageFill(copy.totalCount, { count: more.total })}</p>}
    {more.loading && <p>{copy.loadingMore}</p>}
  </div>;
}

export type CatalogDiscoveryProps = CharacterCallbacks & {
  characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[];
  preferences: DzmmPreferences; initialCategory?: string | null; locale?: XumengLocale;
  onCategoryChange?: (slug: string | null) => void;
  filters?: CatalogDiscoveryFilters;
  onFiltersChange?: (filters: CatalogDiscoveryFilters) => void;
  more?: ShelfPage | null;
  reasons?: Readonly<Record<string, RecommendationReason>>;
  trackRecommendations?: boolean;
};

export function CatalogDiscovery({ characters, authors, favorites, likes, preferences, initialCategory, locale = "zh-Hans", onCategoryChange, filters: controlledFilters, onFiltersChange, onTag, more, reasons, trackRecommendations, ...callbacks }: CatalogDiscoveryProps) {
  const copy = xumengPage(locale);
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
      <div>{category && <button className={s.back} onClick={() => choose(null)}><Icon name="back" size={17} />{copy.allCategories}</button>}<h1>{selected ? xumengCategoryName(locale, selected.slug, selected.name) : copy.category}</h1></div>
      {category && <span className={s.muted}>{xumengPageFill(copy.listedRoles, { count: listedTotal })}</span>}
    </div>
    {!category ? <>
      <section className={s.tagEntry} aria-labelledby="all-tags-title">
        <div className={s.tagEntryCopy}>
          <h2 id="all-tags-title">{copy.exploreByTag}</h2>
        </div>
        <button type="button" className={s.tagEntryButton} onClick={() => setTagPickerOpen(true)}><Icon name="search" size={18} />{copy.openAllTags}</button>
      </section>
      <div className={s.tagQuickList} aria-label={copy.hotTags}>
        {DZMM_DISCOVERY_CATEGORIES.slice(0, 8).map((item) => <button type="button" className={s.tagQuick} key={item.slug} onClick={() => choose(item.slug)}>{xumengCategoryName(locale, item.slug, item.name)}</button>)}
      </div>
      {tagPickerOpen && <div className={s.tagPickerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTagPickerOpen(false); }}>
        <section className={s.tagPicker} ref={tagPickerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tag-picker-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className={s.tagPickerHeader}><div><h2 id="tag-picker-title">{copy.pickTags}</h2></div><button type="button" className={s.tagPickerClose} aria-label={copy.closeTags} onClick={() => setTagPickerOpen(false)}><Icon name="close" size={18} /></button></header>
          <div className={s.tagPickerGrid}>{DZMM_DISCOVERY_CATEGORIES.map((item) => <button type="button" className={s.tagPickerTag} key={item.slug} onClick={() => choose(item.slug)}><span>{xumengCategoryName(locale, item.slug, item.name)}</span><small>{item.tags.slice(0, 2).join(" · ")}</small><Icon name="chevron" size={15} /></button>)}</div>
        </section>
      </div>}
    </> : <>
      <div className={s.filters}>
        <label>{copy.sortBy}<select aria-label={copy.sortBy} value={sort} onChange={(event) => updateFilters({ sort: event.target.value as DzmmDiscoverySort })}><option value="hot">{copy.hot}</option><option value="new">{copy.newlyListed}</option><option value="likes">{copy.likeRecords}</option></select></label>
        <label>{copy.listedTime}<select aria-label={copy.listedTime} value={time} onChange={(event) => updateFilters({ time: event.target.value as DzmmDiscoveryTime })}><option value="today">{copy.today}</option><option value="week">{copy.thisWeek}</option><option value="month">{copy.thisMonth}</option><option value="quarter">{copy.quarter}</option><option value="all">{copy.allTime}</option></select></label>
        <label className={s.filterSearch}><Icon name="search" size={17} /><input aria-label={xumengPageFill(copy.searchCategoryRoles, { name: selected ? xumengCategoryName(locale, selected.slug, selected.name) : copy.category })} maxLength={DZMM_CATEGORY_QUERY_MAX_LENGTH} value={query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder={copy.searchRolesAuthorsTags} /></label>
      </div>
      {sort === "likes" && <p className={s.filterNote}>{copy.likesNote}</p>}
      {more?.loading && filtered.length === 0 ? <p className={s.loading} role="status">{copy.loadingRoles}…</p> : filtered.length ? <><CharacterCards characters={filtered} authors={authors} favorites={favorites} likes={likes} onTag={onTag} locale={locale} single={preferences.homeLayout === "single"} userName={preferences.nickname} reasons={reasons} trackRecommendations={trackRecommendations} {...callbacks} /><ShelfMore more={listedMore} locale={locale} /></> : <><Empty title={copy.emptyCategory} description={query ? copy.tryOtherFilters : copy.noMatchingFilters} />{more?.hasMore && <ShelfMore more={more} locale={locale} />}</>}
    </>}
  </main>;
}

export type SearchResultsProps = CharacterCallbacks & {
  query: string; characters: Character[]; authors: DzmmAuthor[]; favorites: string[]; likes?: string[];
  preferences?: DzmmPreferences; locale?: XumengLocale;
  onTopic?: (topic: DzmmForumTopic) => void;
  searchTopics?: (query: string, signal: AbortSignal) => Promise<DzmmForumTopic[]>;
  more?: ShelfPage | null;
  reasons?: Readonly<Record<string, RecommendationReason>>;
  trackRecommendations?: boolean;
};

export function SearchResults({ query, characters, authors, favorites, likes, preferences, locale = "zh-Hans", onTopic, searchTopics, more, reasons, trackRecommendations, ...callbacks }: SearchResultsProps) {
  const copy = xumengPage(locale);
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
    void searchTopics(query.trim(), abort.signal).then((result) => { if (!abort.signal.aborted) setTopicResult({ query: query.trim(), retry, topics: result, error: "" }); }).catch((failure: unknown) => { if (!abort.signal.aborted) setTopicResult({ query: query.trim(), retry, topics: [], error: failure instanceof Error ? failure.message : copy.topicSearchFailed }); });
    return () => abort.abort();
  }, [tab, query, searchTopics, retry, locale, copy.topicSearchFailed]);
  return <main className={s.discovery}>
    <div className={s.heading}><h1>{copy.searchHeading}{query.trim() && <span className={s.searchTerm}>“{query.trim()}”</span>}</h1></div>
    <div className={s.tabs} role="tablist" aria-label={copy.searchContent}>
      <button role="tab" aria-selected={tab === "characters"} className={tab === "characters" ? s.activeTab : ""} onClick={() => setTab("characters")}>{copy.roles} <small>{listedTotal}</small></button>
      <button role="tab" aria-selected={tab === "authors"} className={tab === "authors" ? s.activeTab : ""} onClick={() => setTab("authors")}>{copy.users} <small>{matchingAuthors.length}</small></button>
      {searchTopics && <button role="tab" aria-selected={tab === "topics"} className={tab === "topics" ? s.activeTab : ""} onClick={() => setTab("topics")}>{copy.topics}</button>}
    </div>
    {!query.trim() ? <Empty title={copy.searchPrompt} description={searchTopics ? copy.searchPromptTopics : copy.searchPromptAuthors} /> : <>
      {tab === "characters" && (more?.loading && matchingCharacters.length === 0 ? <p className={s.loading} role="status">{copy.searchingRoles}</p> : matchingCharacters.length ? <><CharacterCards characters={matchingCharacters} authors={authors} favorites={favorites} likes={likes} locale={locale} single={preferences?.homeLayout === "single"} userName={preferences?.nickname} reasons={reasons} trackRecommendations={trackRecommendations} {...callbacks} /><ShelfMore more={listedMore} locale={locale} /></> : <><Empty title={copy.emptySearchTitle} description={copy.tryNames} />{more?.hasMore && <ShelfMore more={listedMore} locale={locale} />}</>)}
      {tab === "authors" && (matchingAuthors.length ? <div className={s.authorGrid}>{matchingAuthors.map((author) => <button className={s.authorCard} key={author.id} onClick={() => callbacks.onAuthor(author)}><span className={s.largeAvatar}>{Array.from(author.name)[0] ?? ""}</span><span><strong>{author.name}</strong><small>{xumengPageFill(copy.worksCount, { count: author.characterIds.length })}</small></span><Icon name="chevron" size={18} /></button>)}</div> : <Empty title={copy.noUsers} description={copy.onlyListedAuthors} />)}
      {tab === "topics" && (loading ? <p className={s.loading} role="status">{copy.searchingTopics}</p> : error ? <div className={s.empty}><p role="alert">{error}</p><button className={s.outline} onClick={() => setRetry((value) => value + 1)}>{copy.retry}</button></div> : topics.length ? <div className={s.topicList}>{topics.map((topic) => <button className={s.topic} key={topic.id} onClick={() => onTopic?.(topic)} disabled={!onTopic}><span className={s.topicMeta}>{topic.author || copy.siteUser}{topic.category && ` · ${topic.category}`}</span><h2>{topic.title}</h2>{topic.body && <p>{topic.body}</p>}<span className={s.topicRead}>{copy.viewTopic} <Icon name="chevron" size={15} /></span></button>)}</div> : <Empty title={copy.noTopics} description={searchTopics ? copy.tryKeyword : copy.topicsOffline} />)}
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
  const locale = preferences.locale ?? "zh-Hans";
  const copy = xumengPage(locale);
  const [copied, setCopied] = useState("");
  const following = preferences.followedAuthors?.includes(author.id) ?? false;
  const unique = [...new Map(characters.map((character) => [character.id, character])).values()];
  const works = filterDzmmCharacters(unique.filter((character) => author.characterIds.includes(character.id) || character.publication?.authorId === author.id), { blockedTags: preferences.blockedTags, sort: "new" });
  const listedTotal = more?.serverFiltered ? more.total : works.length;
  const listedMore = more ? { ...more, total: listedTotal } : more;
  function follow() {
    const previous = preferences.followedAuthors ?? [];
    if (!following && previous.length >= 200) { setCopied(copy.followLimit); return; }
    onPreferences({ ...preferences, followedAuthors: following ? previous.filter((id) => id !== author.id) : [...previous, author.id] });
  }
  async function copyId() { try { await navigator.clipboard.writeText(author.id); setCopied(copy.authorCopied); } catch { setCopied(copy.copyFailedManual); } }
  return <main className={s.discovery}>
    <button className={s.back} onClick={onBack}><Icon name="back" size={18} />{copy.back}</button>
    <header className={s.authorHero}><span className={s.profileAvatar}>{Array.from(author.name)[0] ?? ""}</span><div className={s.authorInfo}><h1>{author.name}</h1><button className={s.idButton} onClick={() => void copyId()} aria-label={copy.copyAuthorId}>ID：{author.id}<Icon name="copy" size={13} /></button><p>{author.identityVerified === false ? copy.unsignedAuthor : copy.roleAuthor}</p></div><button className={following ? s.outline : s.primary} onClick={follow} aria-pressed={following}><Icon name={following ? "check" : "plus"} size={16} />{following ? copy.following : copy.follow}</button></header>
    {copied && <p className={s.inlineStatus} role="status">{copied}</p>}
    <div className={s.tabs}><span className={s.activeTab}>{copy.roleWorks} <small>{listedTotal}</small></span></div>
    {more?.loading && works.length === 0 ? <p className={s.loading} role="status">{copy.loadingWorks}</p> : works.length ? <><div className={s.cardGrid}>{works.map((character) => <article className={s.card} key={character.id}><CoverReel className={s.coverButton} character={character} count="corner" onOpen={() => onCharacter(character)}><span className={s.heat}><Icon name="flame" size={14} />{character.heat || "—"}</span></CoverReel><div className={s.cardBody}><button className={s.cardTitle} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterCardBlurb(character, preferences.nickname)}</p></button></div></article>)}</div><ShelfMore more={listedMore} locale={locale} /></> : <><Empty title={copy.noWorks} description={copy.noWorksBody} />{more?.hasMore && <ShelfMore more={listedMore} locale={locale} />}</>}
  </main>;
}
