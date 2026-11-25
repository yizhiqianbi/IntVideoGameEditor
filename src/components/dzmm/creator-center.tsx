"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "@/lib/xumeng-feature-availability";
import { useCharacterCreateCost } from "@/lib/dzmm-scene-prices";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "@/lib/xumeng-page-copy";
import { xumengCardCoverUrl } from "@/lib/xumeng-routes";
import { STUDIO_COVER_FALLBACKS, type StudioCoverSlot } from "@/lib/xumeng-studio-covers";
import { setPendingGenerationTemplateId } from "@/lib/xumeng-template-bridge";
import type { GenerationTemplate } from "@/lib/xumeng-generation-templates";
import PublishingCenter from "./publishing-center";
import Icon from "./icons";
import s from "./creator-center.module.css";

export type CreatorCenterProps = {
  user: DzmmCloudUser | null; drafts: Character[]; section?: "home" | "roles";
  onCreate: () => void; onEdit: (card: Character) => void; onCharacter: (card: Character) => void;
  onRequireAccount: () => void; onCatalogChanged: () => Promise<void>;
  onRoute: (route: string) => void;
  locale?: XumengLocale;
};

type CreateKind = "novel" | "girlfriend" | "scenario";

type CreateBanner = {
  key: string;
  cover: string;
  title: string;
  hint: string;
  cost?: number;
  run: () => void;
};

function BannerCarousel({ banners, carouselLabel, prevLabel, nextLabel, slideLabel }: {
  banners: CreateBanner[]; carouselLabel: string; prevLabel: string; nextLabel: string; slideLabel: (index: number) => string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [paused, setPaused] = useState(false);
  activeRef.current = active;

  const readActive = useCallback(() => {
    const node = track.current;
    if (!node) return;
    const index = Math.round(node.scrollLeft / Math.max(1, node.clientWidth));
    setActive(Math.max(0, Math.min(banners.length - 1, index)));
  }, [banners.length]);

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const onScroll = () => readActive();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [readActive]);

  useEffect(() => {
    if (paused || typeof window === "undefined" || banners.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      const node = track.current;
      if (!node || document.visibilityState === "hidden") return;
      const next = (activeRef.current + 1) % banners.length;
      node.scrollTo({ left: next * node.clientWidth, behavior: "smooth" });
      setActive(next);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, banners.length]);

  function go(delta: number) {
    const node = track.current;
    if (!node) return;
    const next = (activeRef.current + delta + banners.length) % banners.length;
    node.scrollTo({ left: next * node.clientWidth, behavior: "smooth" });
    setActive(next);
  }

  return <section className={s.banner} aria-roledescription="carousel" aria-label={carouselLabel}
    onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
    onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
    <div className={s.bannerTrack} ref={track}>
      {banners.map((banner, index) => (
        <button key={banner.key} type="button" className={s.bannerSlide} onClick={banner.run}
          aria-label={banner.cost ? `${banner.title} · ${banner.cost} 金币` : banner.title} title={banner.title}
          aria-hidden={index !== active} tabIndex={index === active ? 0 : -1}>
          <img className={s.bannerArt} src={banner.cover} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" fetchPriority={index === 0 ? "high" : "auto"} />
          <span className={s.bannerShade} aria-hidden="true" />
          <span className={s.bannerText}>
            <strong>{banner.title}</strong>
            <small>{banner.cost ? `${banner.cost} 金币 · ` : ""}{banner.hint}</small>
          </span>
        </button>
      ))}
    </div>
    <div className={s.bannerDots} role="tablist" aria-label={carouselLabel} aria-live="polite">
      {banners.map((banner, index) => (
        <button key={banner.key} type="button" role="tab" aria-selected={index === active} aria-label={banner.title}
          className={index === active ? `${s.bannerDot} ${s.bannerDotOn}` : s.bannerDot}
          onClick={() => { const node = track.current; if (node) { node.scrollTo({ left: index * node.clientWidth, behavior: "smooth" }); setActive(index); } }} />
      ))}
    </div>
    <button type="button" className={`${s.bannerArrow} ${s.bannerArrowPrev}`} aria-label={prevLabel} onClick={() => go(-1)}>‹</button>
    <button type="button" className={`${s.bannerArrow} ${s.bannerArrowNext}`} aria-label={nextLabel} onClick={() => go(1)}>›</button>
  </section>;
}

export default function CreatorCenter({ user, drafts, section = "home", locale = "zh-Hans", onCreate, onEdit, onCharacter, onRequireAccount, onCatalogChanged, onRoute }: CreatorCenterProps) {
  const copy = xumengPage(locale);
  const createCost = useCharacterCreateCost();
  const [covers, setCovers] = useState(STUDIO_COVER_FALLBACKS);
  const [featuredTemplates, setFeaturedTemplates] = useState<GenerationTemplate[]>([]);
  useEffect(() => {
    if (!XUMENG_GENERATION_WORKSPACE_ENABLED || section !== "home") return;
    let live = true;
    void import("@/lib/xumeng-generation-templates").then(({ filterGenerationTemplates }) => {
      if (!live) return;
      const all = filterGenerationTemplates({});
      const videos = all.filter((item) => item.kind === "video" && item.demoPosterUrl && item.demoVideoUrl);
      const images = all.filter((item) => item.kind === "image" && !item.studioFree && item.demoPosterUrl);
      const picked: GenerationTemplate[] = [];
      for (let i = 0; i < 4; i++) {
        if (i < videos.length && picked.length < 6) picked.push(videos[i]!);
        if (i < images.length && picked.length < 6) picked.push(images[i]!);
      }
      setFeaturedTemplates(picked);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [section]);
  useEffect(() => {
    let live = true;
    void fetch("/api/backend/v1/studio/covers", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value: { covers?: Partial<Record<StudioCoverSlot, string>> } | null) => {
        if (!live || !value?.covers) return;
        setCovers((current) => ({ ...current, ...Object.fromEntries(Object.entries(value.covers ?? {}).filter((entry) => typeof entry[1] === "string")) }));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  const registered = Boolean(user && !user.isGuest);
  const start = (route: string) => registered ? onRoute(route) : onRequireAccount();
  /** The top strip is an ad slot, not a duplicate of the entry grid. */
  const banners: CreateBanner[] = [
    { key: "member", cover: covers.member, title: copy.promoMemberTitle, hint: copy.promoMemberHint, run: () => onRoute("vip") },
    { key: "recharge", cover: covers.recharge, title: copy.promoRechargeTitle, hint: copy.promoRechargeHint, run: () => onRoute("recharge") },
    { key: "invite", cover: covers.invite, title: copy.promoInviteTitle, hint: copy.promoInviteHint, run: () => onRoute("invite") },
  ];
  return <main className={s.workspace}>
    <section className={s.content}>
      {section === "roles" && <header className={s.header}><div><p>{copy.creatorEyebrow}</p><h1>{copy.rolesAndPosts}</h1><span>{copy.rolesLead}</span></div><div className={s.headerActions}><button onClick={() => onRoute("studio")}><Icon name="back" size={16}/>{copy.workbench}</button></div></header>}
      {section === "roles" ? <PublishingCenter locale={locale} embedded user={user} drafts={drafts} onCreate={onCreate} onEdit={onEdit} onCharacter={onCharacter} onRequireAccount={onRequireAccount} onCatalogChanged={onCatalogChanged} onNovels={() => onRoute("novels")}/> : <>
        <section className={s.createHome} aria-label={copy.beginCreate}>
          <div className={s.createTop}>
            <button type="button" className={s.primaryCreate} onClick={onCreate} title={copy.createRole}
              aria-label={createCost ? `${copy.createRole} · ${createCost} 金币` : copy.createRole}>
              <img className={s.primaryArt} src={covers.role} alt="" loading="lazy" decoding="async" />
              <span className={s.primaryShade} aria-hidden="true" />
              <span className={s.primaryText}>
                <strong>{copy.createRole}</strong>
                <small>{createCost ? `${createCost} 金币 · ` : ""}{copy.createRoleHint}</small>
              </span>
              <span className={s.primaryArrow} aria-hidden="true"><Icon name="chevron" size={16} /></span>
            </button>
            {XUMENG_GENERATION_WORKSPACE_ENABLED && <button type="button" className={`${s.primaryCreate} ${s.generateCreate}`} onClick={() => onRoute("generation")} title={locale === "en" ? "Template Square & AI Generation" : "模板广场 · AI 图生视频"} aria-label={locale === "en" ? "Template Square & AI Generation" : "模板广场 · AI 图生视频"}>
              <img className={s.primaryArt} src={covers.generate} alt="" loading="lazy" decoding="async" />
              <span className={s.primaryShade} aria-hidden="true" />
              <span className={s.primaryText}>
                <strong>{locale === "en" ? "Template Square" : "模板广场"}</strong>
                <small>{locale === "en" ? "Motion & style templates · Free AI tools" : "挑现成动作/画风一键生成 · 含自由工具"}</small>
              </span>
              <span className={s.primaryArrow} aria-hidden="true"><Icon name="sparkles" size={16} /></span>
            </button>}
          </div>
          {XUMENG_GENERATION_WORKSPACE_ENABLED && featuredTemplates.length > 0 && (
            <section className={s.templateShelf} aria-label={locale === "en" ? "Featured Templates" : "模板广场精选"}>
              <div className={s.worksHead}>
                <div>
                  <h2>{locale === "en" ? "Template Square Picks" : "模板广场精选"}</h2>
                  <p>{locale === "en" ? "Pick a motion or style card — or bring any character portrait directly in." : "选现成动作与画风卡片一键出图/出视频，支持从角色页直接带入立绘。"}</p>
                </div>
                <div className={s.shelfHeadActions}>
                  <button type="button" className={s.worksAll} onClick={() => onRoute("aigen")}>{locale === "en" ? "Free Tools" : "自由工具"}</button>
                  <button type="button" className={`${s.worksAll} ${s.shelfPrimaryBtn}`} onClick={() => onRoute("generation")}>{locale === "en" ? "Browse all" : "进入模板广场"}<Icon name="chevron" size={14} /></button>
                </div>
              </div>
              <div className={s.templateStrip}>
                {featuredTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className={s.templateTile}
                    onClick={() => {
                      setPendingGenerationTemplateId(tpl.id);
                      onRoute("generation");
                    }}
                  >
                    <img src={tpl.demoPosterUrl} alt="" loading="lazy" decoding="async" />
                    <span className={s.templateTileShade} aria-hidden="true" />
                    <span className={s.templateTileBadge}>{tpl.kind === "video" ? (locale === "en" ? "Motion" : "视频动效") : (locale === "en" ? "Style" : "画风模板")}</span>
                    <strong className={s.templateTileName}>{tpl.label}</strong>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className={s.startGrid}>
            {([
              { key: "novel", label: copy.novelsStories, hint: copy.createNovelHint, icon: "book" as const, run: () => start("novels/new/novel") },
              { key: "girlfriend", label: copy.uploadGirlfriend, hint: copy.createGirlfriendHint, icon: "upload" as const, run: () => onRoute("studio/girlfriends/new") },
              { key: "scenario", label: copy.createScenario, hint: copy.createScenarioHint, icon: "users" as const, run: () => start("studio/scenarios/new") },
            ] as Array<{ key: CreateKind; label: string; hint: string; icon: "book" | "upload" | "play" | "users" | "image"; run: () => void }>).map(tile => (
              <button key={tile.key} type="button" className={s.startTile} data-kind={tile.key} onClick={tile.run} title={tile.label}>
                <img className={s.startTileArt} src={covers[tile.key]} alt="" loading="lazy" decoding="async" />
                <span className={s.startTileShade} aria-hidden="true" />
                <span className={s.startTileIcon}><Icon name={tile.icon} size={15} /></span>
                <span className={s.startTileLabel}>
                  <span>{tile.label}</span>
                  {tile.key === "scenario" && tile.hint && <small className={s.startTileHint}>{tile.hint}</small>}
                </span>
              </button>
            ))}
          </div>
          <BannerCarousel banners={banners} carouselLabel={copy.adSlotLabel}
            prevLabel={copy.carouselPrev} nextLabel={copy.carouselNext}
            slideLabel={(index) => xumengPageFill(copy.carouselSlide, { n: index })} />
          <section className={s.works} aria-label={copy.myWorks}>
            <div className={s.worksHead}>
              <div><h2>{copy.myWorks}</h2><p>{drafts.length ? copy.studioWorksHint : copy.studioWorksEmpty}</p></div>
              {drafts.length > 0 && <button type="button" className={s.worksAll} onClick={() => onRoute("studio/roles")}>{copy.viewAll}<Icon name="chevron" size={14} /></button>}
            </div>
            {drafts.length > 0
              ? <div className={s.worksGrid}>{drafts.slice(0, 10).map(card => (
                  <button key={card.id} type="button" className={s.workCard} onClick={() => onCharacter(card)} title={card.name}>
                    <img className={s.workCover} src={xumengCardCoverUrl(card.cover)} alt="" loading="lazy" decoding="async" />
                    <span className={s.workShade} aria-hidden="true" />
                    <span className={s.workName}>{card.name}</span>
                  </button>
                ))}</div>
              : <button type="button" className={s.worksEmpty} onClick={onCreate}><Icon name="plus" size={18} />{copy.createRole}</button>}
          </section>
        </section>
      </>}
    </section>
  </main>;
}
