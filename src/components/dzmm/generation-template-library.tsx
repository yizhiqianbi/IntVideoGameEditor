"use client";
import { useEffect, useRef, useState } from "react";
import { KREA2_IMAGE_GROUPS } from "../../lib/xumeng-krea2-stills";
import { loadPublicCustomGenerationTemplates, subscribeCustomGenerationTemplates } from "../../lib/xumeng-custom-templates";
import { GENERATION_TEMPLATE_CATEGORIES, filterGenerationTemplates,
  type GenerationTemplate, type GenerationTemplateCategory } from "../../lib/xumeng-generation-templates";
import type { GenerationKind } from "../../lib/xumeng-generation";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengStudio, xumengStudioFill, xumengStudioGroupLabel } from "../../lib/xumeng-studio-copy";
import Icon from "./icons";
import s from "./generation-template-library.module.css";

type Props = { userId: string; visible: boolean; busy: boolean; locale?: XumengLocale; onSelect: (template: GenerationTemplate) => void };
type LibraryFilters = {
  key: string;
  kind: GenerationKind | "all";
  category: GenerationTemplateCategory | "all";
  query: string;
};
const defaultFilters = { kind: "all", category: "all", query: "" } as const;

function HoverPreview({ src, poster }: { src: string; poster?: string }) {
  const player = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const node = player.current;
    if (!node) return;
    void node.play().catch(() => undefined);
    return () => { node.pause(); };
  }, [src]);
  return <video ref={player} src={src} poster={poster} muted loop playsInline autoPlay preload="auto" aria-hidden="true" />;
}
const maxStoredLength = 256 * 1024;

function readLibrary(key: string): { value: Record<string, unknown>; writable: boolean } {
  const raw = sessionStorage.getItem(key);
  // Leave an oversized old draft untouched rather than replacing it with just filters.
  if (raw && raw.length > maxStoredLength) return { value: {}, writable: false };
  if (!raw) return { value: {}, writable: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { value: parsed as Record<string, unknown>, writable: true }
      : { value: {}, writable: false };
  } catch { return { value: {}, writable: false }; }
}

export default function GenerationTemplateLibrary({ userId, visible, busy, locale = "zh-Hans", onSelect }: Props) {
  const c = xumengStudio(locale);
  const storageKey = `xumeng-generation-library:${userId}`;
  const [filters, setFilters] = useState<LibraryFilters>({ key: "", ...defaultFilters });
  const [imageGroup, setImageGroup] = useState("all");
  const [videoGroup, setVideoGroup] = useState("all");
  const [, setCustomVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeCustomGenerationTemplates(() => setCustomVersion(v => v + 1));
    void loadPublicCustomGenerationTemplates();
    return unsubscribe;
  }, []);
  const activeKey = useRef(storageKey);
  const hydratedKey = useRef<string | null>(null);
  activeKey.current = storageKey;
  const ready = filters.key === storageKey;
  const query = ready ? filters.query : "";
  const matching = filterGenerationTemplates({ query });

  useEffect(() => {
    hydratedKey.current = null;
    const frame = setTimeout(() => {
      if (activeKey.current !== storageKey) return;
      const restored: LibraryFilters = { key: storageKey, ...defaultFilters };
      try {
        const { value } = readLibrary(storageKey);
        if (value.kind === "all" || value.kind === "image" || value.kind === "video") restored.kind = value.kind;
        if (restored.kind !== "all" && !filterGenerationTemplates({ kind: restored.kind }).length) restored.kind = "all";
        if (value.category === "all" || GENERATION_TEMPLATE_CATEGORIES.some(item => item.id === value.category)) {
          restored.category = value.category as LibraryFilters["category"];
        }
        if (typeof value.query === "string" && value.query.length <= 120) restored.query = value.query;
      } catch { /* Session storage is optional; the catalog remains usable. */ }
      // A former video-use filter may no longer have selectable templates.
      // Keep its parameter drafts intact and restore the useful full action list.
      if (restored.category !== "all" && !filterGenerationTemplates({ kind: restored.kind, category: restored.category }).length) restored.category = "all";
      hydratedKey.current = storageKey;
      setFilters(restored);
    });
    return () => clearTimeout(frame);
  }, [storageKey]);

  useEffect(() => {
    if (filters.key !== storageKey || activeKey.current !== storageKey || hydratedKey.current !== storageKey) return;
    try {
      const stored = readLibrary(storageKey);
      if (!stored.writable) return;
      // The workspace migrates old drafts. Updating filters must preserve those drafts
      // and any other metadata, including edits made since this catalog hydrated.
      const next = JSON.stringify({ ...stored.value, kind: filters.kind, category: filters.category, query: filters.query });
      if (next.length <= maxStoredLength) sessionStorage.setItem(storageKey, next);
    } catch { /* Visible filters remain usable when storage is unavailable. */ }
  }, [filters, storageKey]);

  const updateFilters = (change: Partial<Omit<LibraryFilters, "key">>) => {
    if (hydratedKey.current !== storageKey || activeKey.current !== storageKey) return;
    setFilters(previous => {
      if (previous.key !== storageKey) return previous;
      const next = { ...previous, ...change };
      if (change.kind && next.category !== "all" && !filterGenerationTemplates({ kind: next.kind, category: next.category }).length) next.category = "all";
      return next;
    });
  };

  const [previewId, setPreviewId] = useState<string | null>(null);
  const reducedMotion = useRef(false);
  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => { if (!visible) setPreviewId(null); }, [visible]);
  const startPreview = (item: GenerationTemplate) => {
    if (!item.demoVideoUrl || busy || !ready || reducedMotion.current) return;
    setPreviewId(item.id);
  };
  const stopPreview = (id: string) => setPreviewId(current => current === id ? null : current);
  let taggedFirstCard = false;
  const [brokenIds, setBrokenIds] = useState<Record<string, true>>({});
  const posterCard = (item: GenerationTemplate) => {
    const isFirst = !taggedFirstCard;
    if (isFirst) taggedFirstCard = true;
    const isBroken = Boolean(brokenIds[item.id]);
    return <button type="button" className={`${s.card} ${s.poster}`} key={item.id}
      data-tour={isFirst ? "tpl-card" : undefined}
      disabled={busy || !ready} aria-label={xumengStudioFill(c.gsUseTemplateAria, { label: item.label })} onClick={() => { if (!busy && ready) onSelect(item); }}
      onMouseEnter={() => startPreview(item)} onMouseLeave={() => stopPreview(item.id)}
      onFocus={() => startPreview(item)} onBlur={() => stopPreview(item.id)}>
      <span className={s.cardImage}>
        {item.demoPosterUrl && !isBroken && <img src={item.demoPosterUrl} alt="" loading="lazy" decoding="async" onError={() => setBrokenIds(prev => prev[item.id] ? prev : { ...prev, [item.id]: true })} />}
        {item.demoVideoUrl && previewId === item.id && <HoverPreview src={item.demoVideoUrl} poster={isBroken ? undefined : item.demoPosterUrl} />}
        {item.demoVideoUrl && <span className={s.videoChip} aria-hidden="true"><Icon name="play" size={10} />{locale === "en" ? "Motion" : "动效"}</span>}
        <strong>{item.label}</strong></span>
    </button>;
  };
  const stillCard = (item: GenerationTemplate) => <button type="button" className={s.still} key={item.id}
    disabled={busy || !ready} aria-label={xumengStudioFill(c.gsUseTemplateAria, { label: item.label })} onClick={() => { if (!busy && ready) onSelect(item); }}>
    <strong>{item.label}</strong><span>{item.description}</span></button>;
  const activeKind = ready ? filters.kind : "all";
  const videoPool = matching.filter(item => item.kind === "video" && (item.demoVideoUrl || item.customTemplate));
  const customVideoGroups = Array.from(new Set(videoPool.map(item => item.customGroup).filter((g): g is string => Boolean(g))))
    .map(label => ({ id: `custom:${label}`, label }));
  const videoGroups = [
    ...customVideoGroups,
    ...KREA2_IMAGE_GROUPS.filter(group => videoPool.some(item => item.h3Lora?.group === group.id))
      .map(group => ({ id: group.id, label: xumengStudioGroupLabel(locale, group.id, group.label) })),
  ];
  const matchesGroup = (item: GenerationTemplate, groupId: string, kind: "image" | "video") => {
    if (groupId === "all") return true;
    if (groupId.startsWith("custom:")) return item.customGroup === groupId.slice("custom:".length);
    return kind === "video" ? item.h3Lora?.group === groupId : item.krea2Lora?.group === groupId;
  };
  const videos = videoPool.filter(item => matchesGroup(item, videoGroup, "video"));
  const freeStill = matching.find(item => item.studioFree);
  const imagePool = matching.filter(item => item.kind === "image" && !item.studioFree);
  const customImageGroups = Array.from(new Set(imagePool.map(item => item.customGroup).filter((g): g is string => Boolean(g))))
    .map(label => ({ id: `custom:${label}`, label }));
  const imageGroups = [
    ...customImageGroups,
    ...KREA2_IMAGE_GROUPS.filter(group => imagePool.some(item => item.krea2Lora?.group === group.id))
      .map(group => ({ id: group.id, label: xumengStudioGroupLabel(locale, group.id, group.label) })),
  ];
  const images = imagePool.filter(item => matchesGroup(item, imageGroup, "image"));
  const showVideos = activeKind !== "image" && videos.length > 0;
  const showImages = activeKind !== "video" && (imagePool.length > 0 || Boolean(freeStill));
  const isEn = locale === "en";

  return <section className={s.library} hidden={!visible} aria-label={c.gsShelf} aria-busy={!ready}>
    <div className={s.toolbar} data-tour="tpl-search">
      <div className={s.kindTabs} role="tablist" aria-label={isEn ? "Template type" : "模板类型"}>
        <button type="button" role="tab" aria-selected={activeKind === "all"} aria-pressed={activeKind === "all"} disabled={!ready} onClick={() => updateFilters({ kind: "all" })}>
          {isEn ? "All" : "全部"} <em>{videoPool.length + imagePool.length}</em>
        </button>
        <button type="button" role="tab" aria-selected={activeKind === "video"} aria-pressed={activeKind === "video"} disabled={!ready} onClick={() => updateFilters({ kind: "video" })}>
          <Icon name="video" size={13} />{isEn ? "Video Motion" : "视频动作"} <em>{videoPool.length}</em>
        </button>
        <button type="button" role="tab" aria-selected={activeKind === "image"} aria-pressed={activeKind === "image"} disabled={!ready} onClick={() => updateFilters({ kind: "image" })}>
          <Icon name="image" size={13} />{isEn ? "Image Style" : "图片风格"} <em>{imagePool.length}</em>
        </button>
      </div>
      <div className={s.search}><Icon name="search" size={17}/><input aria-label={c.gsSearchTemplates} disabled={!ready}
        maxLength={120} placeholder={c.gsSearchPh} value={query} onChange={event => updateFilters({ query: event.target.value })}/>
        {query && <button type="button" aria-label={c.gsClearSearch} disabled={!ready} onClick={() => updateFilters({ query: "" })}><Icon name="close" size={15}/></button>}</div>
    </div>
    <div className={`${s.parts} ${showVideos && showImages ? "" : s.partsSingle}`}>
      {showVideos && <section className={s.part} aria-label={c.gsMakeVideos}>
        <div className={s.listHeader}><div><h2>{c.gsMakeVideos}</h2></div><span>{videos.length}</span></div>
        <div className={s.groupTabs} role="tablist" aria-label={c.gsVideoCats}>
          <button type="button" aria-pressed={videoGroup === "all"} disabled={!ready} onClick={() => setVideoGroup("all")}>{c.gsAll}</button>
          {videoGroups.map(group => <button type="button" key={group.id} aria-pressed={videoGroup === group.id} disabled={!ready}
            onClick={() => setVideoGroup(group.id)}>{group.label}<em>{videoPool.filter(item => matchesGroup(item, group.id, "video")).length}</em></button>)}
        </div>
        <div className={s.posterGrid}>{videos.map(item => (item.demoPosterUrl || item.demoVideoUrl) ? posterCard(item) : stillCard(item))}</div>
      </section>}
      {showImages && <section className={s.part} aria-label={c.gsMakeImages}>
        <div className={s.listHeader}><div><h2>{c.gsMakeImages}</h2></div><span>{images.length}</span></div>
        {freeStill && <button type="button" className={s.freeEntry} disabled={busy || !ready} aria-label={xumengStudioFill(c.gsUseTemplateAria, { label: freeStill.label })}
          onClick={() => { if (!busy && ready) onSelect(freeStill); }}>
          <Icon name="sparkles" size={20}/><span><strong>{freeStill.label}</strong><small>{c.gsFreeEntry}</small></span><Icon name="chevron" size={16}/></button>}
        <div className={s.groupTabs} role="tablist" aria-label={c.gsImageCats}>
          <button type="button" aria-pressed={imageGroup === "all"} disabled={!ready} onClick={() => setImageGroup("all")}>{c.gsAll}</button>
          {imageGroups.map(group => <button type="button" key={group.id} aria-pressed={imageGroup === group.id} disabled={!ready}
            onClick={() => setImageGroup(group.id)}>{group.label}<em>{imagePool.filter(item => matchesGroup(item, group.id, "image")).length}</em></button>)}
        </div>
        <div className={s.posterGrid}>{images.map(item => item.demoPosterUrl ? posterCard(item) : stillCard(item))}</div>
      </section>}
    </div>
    {!matching.length && <div className={s.empty}><Icon name="search" size={28}/><h3>{c.gsNoTemplate}</h3>
      <p>{c.gsNoTemplateBody}</p><button type="button" disabled={!ready}
        onClick={() => updateFilters(defaultFilters)}>{c.gsClear}</button></div>}
  </section>;
}
