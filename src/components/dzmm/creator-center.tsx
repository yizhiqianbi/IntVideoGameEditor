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
import { setPendingAigenTemplate, setPendingGenerationTemplateId } from "@/lib/xumeng-template-bridge";
import { compileGenerationTemplateDraft, createGenerationTemplateDraft } from "@/lib/xumeng-generation-draft";
import type { GenerationTemplate } from "@/lib/xumeng-generation-templates";
import PublishingCenter from "./publishing-center";
import Icon, { BrandIcon, CoinIcon, type BrandIconName, type IconName } from "./icons";
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

type AiToolItem = {
  key: "video" | "image" | "face" | "coat" | "novel";
  label: string;
  hint: string;
  icon: IconName;
  run: () => void;
};

type CreateModeItem = {
  key: "girlfriend" | "scenario";
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

  const aiTools: AiToolItem[] = [
    {
      key: "video",
      label: isEn ? "Image to Video" : "图生视频",
      hint: isEn ? "Animate still images" : "图片转动态视频",
      icon: "video",
      run: () => onRoute("aigen/video"),
    },
    {
      key: "image",
      label: isEn ? "AI Image" : "AI 生图",
      hint: isEn ? "Text or ref to image" : "文字 / 参考图生图",
      icon: "image",
      run: () => onRoute("aigen/image"),
    },
    {
      key: "face",
      label: isEn ? "Face Swap" : "AI 换脸",
      hint: isEn ? "Swap character face" : "替换人物面部",
      icon: "user",
      run: () => onRoute("aigen/face"),
    },
    {
      key: "coat",
      label: isEn ? "Undress" : "脱衣服",
      hint: isEn ? "Remove outfit cleanly" : "人物一键去衣",
      icon: "sparkles",
      run: () => onRoute("aigen/coat"),
    },
    {
      key: "novel",
      label: isEn ? "AI Novel" : "AI 小说",
      hint: isEn ? "Outlines & chapters" : "大纲与章节创作",
      icon: "book",
      run: () => start("novels/new/novel"),
    },
  ];

  const modes: CreateModeItem[] = [
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
                <h1>{copy.rolesAndPosts}</h1>
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
                <h1>{copy.beginCreate}</h1>
              </div>
              <div className={s.studioQuickActions}>
                <button type="button" className={s.quickBtn} onClick={() => onRoute("studio/roles")}>
                  <Icon name="fileText" size={15} />
                  <span>{copy.myWorks}</span>
                  {drafts.length > 0 && <em className={s.quickBadge}>{drafts.length}</em>}
                </button>
              </div>
            </header>

            {/* Primary Character Creation Hero */}
            <section className={`${s.heroBento} ${s.heroBentoSingle}`} aria-label={copy.createRole}>
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
                      <BrandIcon name="createRole" size={30} />
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
            </section>

            {/* 2-Column Interactive Creation Modes */}
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

            {/* Direct AI Tools Strip */}
            {XUMENG_GENERATION_WORKSPACE_ENABLED && (
              <section className={s.aiToolsSection} aria-label={isEn ? "AI Tools" : "AI 工具"}>
                <div className={s.sectionHead}>
                  <div className={s.sectionTitleWrap}>
                    <h2>{isEn ? "AI Tools" : "AI 工具"}</h2>
                  </div>
                </div>
                <div className={s.aiToolsGrid}>
                  {aiTools.map((tool) => (
                    <button
                      key={tool.key}
                      type="button"
                      className={s.aiToolCard}
                      data-tool={tool.key}
                      onClick={tool.run}
                      title={tool.label}
                    >
                      <div className={s.aiToolTop}>
                        <span className={s.aiToolIcon} aria-hidden="true">
                          <Icon name={tool.icon} size={18} />
                        </span>
                        <span className={s.aiToolArrow} aria-hidden="true">
                          <Icon name="chevron" size={14} />
                        </span>
                      </div>
                      <div className={s.aiToolCopy}>
                        <strong>{tool.label}</strong>
                        <small>{tool.hint}</small>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Single Template Square Shelf */}
            {XUMENG_GENERATION_WORKSPACE_ENABLED && featuredTemplates.length > 0 && (
              <section className={s.templateShelf} aria-label={isEn ? "Template Square" : "模板广场"}>
                <div className={s.sectionHead}>
                  <div className={s.sectionTitleWrap}>
                    <div>
                      <h2>{isEn ? "Template Square" : "模板广场"}</h2>
                    </div>
                  </div>
                  <div className={s.shelfHeadActions}>
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
                        if (tpl.customTemplate || tpl.studioFree) {
                          const compiled = compileGenerationTemplateDraft(tpl, createGenerationTemplateDraft(tpl));
                          setPendingAigenTemplate({
                            id: tpl.id,
                            label: tpl.label,
                            kind: tpl.kind,
                            prompt: compiled || tpl.description || "",
                            demoPosterUrl: tpl.demoPosterUrl,
                            demoVideoUrl: tpl.demoVideoUrl,
                          });
                          onRoute(`aigen/${tpl.kind}`);
                        } else {
                          setPendingGenerationTemplateId(tpl.id);
                          onRoute("generation");
                        }
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
