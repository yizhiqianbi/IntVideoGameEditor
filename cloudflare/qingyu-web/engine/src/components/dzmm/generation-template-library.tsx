"use client";
import { useEffect, useRef, useState } from "react";
import { KREA2_IMAGE_GROUPS } from "../../lib/xumeng-krea2-stills";
import { GENERATION_TEMPLATE_CATEGORIES, filterGenerationTemplates,
  type GenerationTemplate, type GenerationTemplateCategory } from "../../lib/xumeng-generation-templates";
import type { GenerationKind } from "../../lib/xumeng-generation";
import Icon from "./icons";
import s from "./generation-template-library.module.css";

type Props = { userId: string; visible: boolean; busy: boolean; onSelect: (template: GenerationTemplate) => void };
type LibraryFilters = {
  key: string;
  kind: GenerationKind | "all";
  category: GenerationTemplateCategory | "all";
  query: string;
};
const defaultFilters = { kind: "all", category: "all", query: "" } as const;
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

export default function GenerationTemplateLibrary({ userId, visible, busy, onSelect }: Props) {
  const storageKey = `qingyu-generation-library:${userId}`;
  const [filters, setFilters] = useState<LibraryFilters>({ key: "", ...defaultFilters });
  const [imageGroup, setImageGroup] = useState("all");
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

  const posterCard = (item: GenerationTemplate) => <button type="button" className={`${s.card} ${s.poster}`} key={item.id}
    disabled={busy || !ready} aria-label={`使用模板：${item.label}`} onClick={() => { if (!busy && ready) onSelect(item); }}>
    <span className={s.cardImage}><img src={item.demoPosterUrl} alt="" loading="lazy" decoding="async" />
      <strong>{item.label}</strong></span>
  </button>;
  const stillCard = (item: GenerationTemplate) => <button type="button" className={s.still} key={item.id}
    disabled={busy || !ready} aria-label={`使用模板：${item.label}`} onClick={() => { if (!busy && ready) onSelect(item); }}>
    <strong>{item.label}</strong><span>{item.description}</span></button>;
  const videos = matching.filter(item => item.kind === "video" && item.demoVideoUrl);
  const imagePool = matching.filter(item => item.kind === "image");
  const imageGroups = KREA2_IMAGE_GROUPS.filter(group => imagePool.some(item => item.krea2Lora?.group === group.id));
  const images = imageGroup === "all" ? imagePool : imagePool.filter(item => item.krea2Lora?.group === imageGroup);

  return <section className={s.library} hidden={!visible} aria-label="生成模板广场" aria-busy={!ready}>
    <div className={s.toolbar}>
      <div className={s.search}><Icon name="search" size={17}/><input aria-label="搜索生成模板" disabled={!ready}
        maxLength={120} placeholder="搜索动作或静帧" value={query} onChange={event => updateFilters({ query: event.target.value })}/>
        {query && <button type="button" aria-label="清除模板搜索" disabled={!ready} onClick={() => updateFilters({ query: "" })}><Icon name="close" size={15}/></button>}</div>
    </div>
    <div className={s.parts}>
      {videos.length > 0 && <section className={s.part} aria-label="生视频">
        <div className={s.listHeader}><div><h2>生视频</h2>
          <p>选一个动作，再上传你的参考图。</p></div><span>{videos.length}</span></div>
        <div className={s.posterGrid}>{videos.map(posterCard)}</div>
      </section>}
      {imagePool.length > 0 && <section className={s.part} aria-label="生图">
        <div className={s.listHeader}><div><h2>生图</h2>
          <p>选一张清楚的模板图。生成时再配风格和参考图。</p></div><span>{images.length}</span></div>
        <div className={s.groupTabs} role="tablist" aria-label="生图分类">
          <button type="button" aria-pressed={imageGroup === "all"} disabled={!ready} onClick={() => setImageGroup("all")}>全部</button>
          {imageGroups.map(group => <button type="button" key={group.id} aria-pressed={imageGroup === group.id} disabled={!ready}
            onClick={() => setImageGroup(group.id)}>{group.label}<em>{imagePool.filter(item => item.krea2Lora?.group === group.id).length}</em></button>)}
        </div>
        <div className={s.posterGrid}>{images.map(item => item.demoPosterUrl ? posterCard(item) : stillCard(item))}</div>
      </section>}
    </div>
    {!matching.length && <div className={s.empty}><Icon name="search" size={28}/><h3>没有找到匹配的模板</h3>
      <p>换个关键词，或清除搜索。</p><button type="button" disabled={!ready}
        onClick={() => updateFilters(defaultFilters)}>清除搜索</button></div>}
  </section>;
}
