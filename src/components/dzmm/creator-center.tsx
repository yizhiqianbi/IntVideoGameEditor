"use client";

import { useEffect, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "@/lib/xumeng-feature-availability";
import { useCharacterCreateCost } from "@/lib/dzmm-scene-prices";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengPage } from "@/lib/xumeng-page-copy";
import { xumengCardCoverUrl } from "@/lib/xumeng-routes";
import { STUDIO_COVER_FALLBACKS, type StudioCoverSlot } from "@/lib/xumeng-studio-covers";
import { setPendingGenerationTemplateId } from "@/lib/xumeng-template-bridge";
import type { GenerationTemplate } from "@/lib/xumeng-generation-templates";
import PublishingCenter from "./publishing-center";
import Icon, { BrandIcon, CoinIcon, type BrandIconName } from "./icons";
import s from "./creator-center.module.css";

export type CreatorCenterProps = {
  user: DzmmCloudUser | null;
  drafts: Character[];
  section?: "home" | "roles";
  onCreate: () => void;
  onEdit: (card: Character) => void;
  onCharacter: (card: Character) => void;
  onRequireAccount: () => void;
  onCatalogChanged: () => Promise<void>;
  onRoute: (route: string) => void;
  locale?: XumengLocale;
};

type CreateModeItem = {
  key: "novel" | "girlfriend" | "scenario";
  label: string;
  hint: string;
  badge: string;
  brandIcon: BrandIconName;
  cover: string;
  run: () => void;
};

type PerkItem = {
  key: "member" | "recharge" | "invite";
  title: string;
  hint: string;
  cta: string;
  brandIcon: BrandIconName;
  cover: string;
  tone: "gold" | "rose" | "violet";
  run: () => void;
};

export default function CreatorCenter({
  user,
  drafts,
  section = "home",
  locale = "zh-Hans",
  onCreate,
  onEdit,
  onCharacter,
  onRequireAccount,
  onCatalogChanged,
  onRoute,
}: CreatorCenterProps) {
  const copy = xumengPage(locale);
  const isEn = locale === "en";
  const createCost = useCharacterCreateCost();
  const [covers, setCovers] = useState(STUDIO_COVER_FALLBACKS);
  const [featuredTemplates, setFeaturedTemplates] = useState<GenerationTemplate[]>([]);

  useEffect(() => {
    if (!XUMENG_GENERATION_WORKSPACE_ENABLED || section !== "home") return;
    let live = true;
    void import("@/lib/xumeng-generation-templates")
      .then(({ filterGenerationTemplates }) => {
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
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [section]);

  useEffect(() => {
    let live = true;
    void fetch("/api/backend/v1/studio/covers", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: { covers?: Partial<Record<StudioCoverSlot, string>> } | null) => {
        if (!live || !value?.covers) return;
        setCovers((current) => ({
          ...current,
          ...Object.fromEntries(Object.entries(value.covers ?? {}).filter((entry) => typeof entry[1] === "string")),
        }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const registered = Boolean(user && !user.isGuest);
  const start = (route: string) => (registered ? onRoute(route) : onRequireAccount());

  const modes: CreateModeItem[] = [
    {
      key: "novel",
      label: copy.novelsStories,
      hint: copy.createNovelHint,
      badge: isEn ? "Story" : "长篇互动",
      brandIcon: "novelBook",
      cover: covers.novel,
      run: () => start("novels/new/novel"),
    },
    {
      key: "girlfriend",
      label: copy.uploadGirlfriend,
      hint: copy.createGirlfriendHint,
      badge: isEn ? "Companion" : "语音视频",
      brandIcon: "companionHeart",
      cover: covers.girlfriend,
      run: () => onRoute("studio/girlfriends/new"),
    },
    {
      key: "scenario",
      label: copy.createScenario,
      hint: copy.createScenarioHint,
      badge: isEn ? "Co-op" : "多人剧场",
      brandIcon: "scenarioStage",
      cover: covers.scenario,
      run: () => start("studio/scenarios/new"),
    },
  ];

  const perks: PerkItem[] = [
    {
      key: "member",
      title: copy.promoMemberTitle,
      hint: copy.promoMemberHint,
      cta: isEn ? "Upgrade" : "查看权益",
      brandIcon: "vipCrown",
      cover: covers.member,
      tone: "gold",
      run: () => onRoute("vip"),
    },
    {
      key: "recharge",
      title: copy.promoRechargeTitle,
      hint: copy.promoRechargeHint,
      cta: isEn ? "Top up" : "立即充值",
      brandIcon: "walletCard",
      cover: covers.recharge,
      tone: "rose",
      run: () => onRoute("recharge"),
    },
    {
      key: "invite",
      title: copy.promoInviteTitle,
      hint: copy.promoInviteHint,
      cta: isEn ? "Invite" : "去邀请",
      brandIcon: "inviteGift",
      cover: covers.invite,
      tone: "violet",
      run: () => onRoute("invite"),
    },
  ];

  const hideBrokenImg = (event: React.SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.display = "none";
  };

  return (
    <main className={s.workspace}>
      <section className={s.content}>
        {section === "roles" ? (
          <>
            <header className={s.header}>
              <div>
                <p>{copy.creatorEyebrow}</p>
                <h1>{copy.rolesAndPosts}</h1>
                <span>{copy.rolesLead}</span>
              </div>
              <div className={s.headerActions}>
                <button type="button" onClick={() => onRoute("studio")}>
                  <Icon name="back" size={16} />
                  {copy.workbench}
                </button>
              </div>
            </header>
            <PublishingCenter
              locale={locale}
              embedded
              user={user}
              drafts={drafts}
              onCreate={onCreate}
              onEdit={onEdit}
              onCharacter={onCharacter}
              onRequireAccount={onRequireAccount}
              onCatalogChanged={onCatalogChanged}
              onNovels={() => onRoute("novels")}
            />
          </>
        ) : (
          <div className={s.createHome}>
            {/* Studio Header Bar */}
            <header className={s.studioBar}>
              <div className={s.studioTitle}>
                <span className={s.studioEyebrow}>
                  <span className={s.eyebrowDot} aria-hidden="true" />
                  {copy.creatorEyebrow}
                </span>
                <h1>{copy.beginCreate}</h1>
                <p>
                  {isEn
                    ? "Build interactive characters, stories, companions, and AI motion scenes from one studio."
                    : "角色卡、AI 动效模板、互动小说与专属陪伴，一站式开启你的叙事创作。"}
                </p>
              </div>
              <div className={s.studioQuickActions}>
                <button type="button" className={s.quickBtn} onClick={() => onRoute("studio/roles")}>
                  <Icon name="fileText" size={15} />
                  <span>{copy.myWorks}</span>
                  {drafts.length > 0 && <em className={s.quickBadge}>{drafts.length}</em>}
                </button>
                {XUMENG_GENERATION_WORKSPACE_ENABLED && (
                  <button type="button" className={`${s.quickBtn} ${s.quickBtnAccent}`} onClick={() => onRoute("aigen")}>
                    <Icon name="sparkles" size={15} />
                    <span>{isEn ? "Free AI Tools" : "自由生图工具"}</span>
                  </button>
                )}
              </div>
            </header>

            {/* Primary Bento Hero Row */}
            <section
              className={XUMENG_GENERATION_WORKSPACE_ENABLED ? s.heroBento : `${s.heroBento} ${s.heroBentoSingle}`}
              aria-label={copy.beginCreate}
            >
              <button
                type="button"
                className={`${s.heroCard} ${s.heroRole}`}
                onClick={onCreate}
                title={copy.createRole}
                aria-label={createCost ? `${copy.createRole} · ${createCost} 金币` : copy.createRole}
              >
                <img className={s.heroArt} src={covers.role} alt="" loading="eager" decoding="async" onError={hideBrokenImg} />
                <span className={s.heroMask} aria-hidden="true" />
                <div className={s.heroInner}>
                  <div className={s.heroTopRow}>
                    <span className={s.heroIconBox}>
                      <BrandIcon name="createRole" size={34} />
                    </span>
                    <span className={s.heroPricePill}>
                      <CoinIcon size={14} />
                      <span>
                        {createCost
                          ? isEn
                            ? `${createCost} Coins`
                            : `${createCost} 金币 / 张`
                          : isEn
                            ? "Free to create"
                            : "免费创建"}
                      </span>
                    </span>
                  </div>
                  <div className={s.heroCopy}>
                    <strong>{copy.createRole}</strong>
                    <p>{copy.createRoleHint}</p>
                  </div>
                  <div className={s.heroFoot}>
                    <span className={s.heroCtaGold}>
                      <span>{isEn ? "Start Creating" : "开始创建角色"}</span>
                      <Icon name="chevron" size={15} />
                    </span>
                  </div>
                </div>
              </button>

              {XUMENG_GENERATION_WORKSPACE_ENABLED && (
                <button
                  type="button"
                  className={`${s.heroCard} ${s.heroTemplate}`}
                  onClick={() => onRoute("generation")}
                  title={isEn ? "Template Square & AI Generation" : "模板广场 · AI 图生视频"}
                  aria-label={isEn ? "Template Square & AI Generation" : "模板广场 · AI 图生视频"}
                >
                  <img className={s.heroArt} src={covers.generate} alt="" loading="eager" decoding="async" onError={hideBrokenImg} />
                  <span className={s.heroMaskRose} aria-hidden="true" />
                  <div className={s.heroInner}>
                    <div className={s.heroTopRow}>
                      <span className={s.heroIconBoxRose}>
                        <BrandIcon name="templateSquare" size={34} />
                      </span>
                      <span className={s.heroTagPill}>
                        {isEn ? "Motion · Style" : "动效 · 画风 · 角色带入"}
                      </span>
                    </div>
                    <div className={s.heroCopy}>
                      <strong>{isEn ? "Template Square" : "AI 模板广场"}</strong>
                      <p>
                        {isEn
                          ? "One-click motion & style templates, plus free AI studio tools."
                          : "挑现成动作与画风模板一键出图/出视频，支持直接带入角色立绘。"}
                      </p>
                    </div>
                    <div className={s.heroFoot}>
                      <span className={s.heroCtaRose}>
                        <span>{isEn ? "Open Templates" : "进入模板广场"}</span>
                        <Icon name="sparkles" size={14} />
                      </span>
                    </div>
                  </div>
                </button>
              )}
            </section>

            {/* 3-Column Creation Modes Strip */}
            <section className={s.modeSection} aria-label={isEn ? "More creation modes" : "更多创作模式"}>
              <div className={s.modeGrid}>
                {modes.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={s.modeCard}
                    data-kind={item.key}
                    onClick={item.run}
                    title={item.label}
                  >
                    <div className={s.modeThumbWrap}>
                      <img className={s.modeThumb} src={item.cover} alt="" loading="lazy" decoding="async" onError={hideBrokenImg} />
                      <span className={s.modeThumbShade} aria-hidden="true" />
                      <span className={s.modeThumbIcon} aria-hidden="true">
                        <BrandIcon name={item.brandIcon} size={24} />
                      </span>
                    </div>
                    <div className={s.modeMeta}>
                      <div className={s.modeMetaTop}>
                        <strong>{item.label}</strong>
                        <span className={s.modeBadge}>{item.badge}</span>
                      </div>
                      <p>{item.hint}</p>
                    </div>
                    <span className={s.modeArrow} aria-hidden="true">
                      <Icon name="chevron" size={16} />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Featured Template Gallery */}
            {XUMENG_GENERATION_WORKSPACE_ENABLED && featuredTemplates.length > 0 && (
              <section className={s.templateShelf} aria-label={isEn ? "Featured Templates" : "模板广场精选"}>
                <div className={s.sectionHead}>
                  <div className={s.sectionTitleWrap}>
                    <BrandIcon name="videoReel" size={26} />
                    <div>
                      <h2>{isEn ? "Template Square Picks" : "模板广场精选"}</h2>
                      <p>
                        {isEn
                          ? "Pick a motion or style card — or bring any character portrait directly in."
                          : "精选高人气动效与画风卡片，一键复刻大片质感。"}
                      </p>
                    </div>
                  </div>
                  <div className={s.shelfHeadActions}>
                    <button type="button" className={s.worksAll} onClick={() => onRoute("aigen")}>
                      {isEn ? "Free Tools" : "自由工具"}
                    </button>
                    <button
                      type="button"
                      className={`${s.worksAll} ${s.shelfPrimaryBtn}`}
                      onClick={() => onRoute("generation")}
                    >
                      {isEn ? "Browse all" : "查看全部"}
                      <Icon name="chevron" size={14} />
                    </button>
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
                      <img src={tpl.demoPosterUrl} alt="" loading="lazy" decoding="async" onError={hideBrokenImg} />
                      <span className={s.templateTileShade} aria-hidden="true" />
                      <span className={tpl.kind === "video" ? `${s.templateTileBadge} ${s.badgeVideo}` : s.templateTileBadge}>
                        {tpl.kind === "video" ? (isEn ? "Motion" : "视频动效") : isEn ? "Style" : "画风模板"}
                      </span>
                      <strong className={s.templateTileName}>{tpl.label}</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* My Works */}
            <section className={s.works} aria-label={copy.myWorks}>
              <div className={s.sectionHead}>
                <div className={s.sectionTitleWrap}>
                  <BrandIcon name="chatBubble" size={26} />
                  <div>
                    <h2>{copy.myWorks}</h2>
                    <p>{drafts.length ? copy.studioWorksHint : copy.studioWorksEmpty}</p>
                  </div>
                </div>
                {drafts.length > 0 && (
                  <button type="button" className={s.worksAll} onClick={() => onRoute("studio/roles")}>
                    {copy.viewAll}
                    <Icon name="chevron" size={14} />
                  </button>
                )}
              </div>
              {drafts.length > 0 ? (
                <div className={s.worksGrid}>
                  {drafts.slice(0, 10).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={s.workCard}
                      onClick={() => onCharacter(card)}
                      title={card.name}
                    >
                      <img
                        className={s.workCover}
                        src={xumengCardCoverUrl(card.cover)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <span className={s.workShade} aria-hidden="true" />
                      <span className={s.workName}>{card.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button type="button" className={s.worksEmpty} onClick={onCreate}>
                  <BrandIcon name="createRole" size={32} />
                  <div>
                    <strong>{copy.createRole}</strong>
                    <span>{isEn ? "Create your first character card to see it here." : "还没有作品，立即创建你的第一张角色卡"}</span>
                  </div>
                  <span className={s.worksEmptyAction}>
                    <Icon name="plus" size={15} />
                    {isEn ? "Create" : "去创建"}
                  </span>
                </button>
              )}
            </section>

            {/* Bottom Creator Perks & Economy Strip */}
            <section className={s.perksSection} aria-label={copy.adSlotLabel}>
              <div className={s.perksGrid}>
                {perks.map((perk) => (
                  <button
                    key={perk.key}
                    type="button"
                    className={`${s.perkCard} ${s[`perk_${perk.tone}`]}`}
                    onClick={perk.run}
                    title={perk.title}
                  >
                    <img className={s.perkArt} src={perk.cover} alt="" loading="lazy" decoding="async" onError={hideBrokenImg} />
                    <span className={s.perkMask} aria-hidden="true" />
                    <span className={s.perkIcon} aria-hidden="true">
                      <BrandIcon name={perk.brandIcon} size={30} />
                    </span>
                    <div className={s.perkBody}>
                      <strong>{perk.title}</strong>
                      <small>{perk.hint}</small>
                    </div>
                    <span className={s.perkCta}>
                      {perk.cta}
                      <Icon name="chevron" size={13} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
