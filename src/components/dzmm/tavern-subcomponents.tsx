"use client";

/* eslint-disable @next/next/no-img-element -- Local research assets and user-imported character covers. */
import { memo, Suspense, type ReactNode, useEffect, useRef, useState } from "react";
import { applyDzmmReaderNames } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { localizeCharacter, xumengLocalizedAuthorName } from "@/lib/xumeng-card-localization";
import { applyXumengFrontendScripts, type XumengFrontendScript } from "@/lib/xumeng-frontend-card";
import { xumengHomeCover } from "@/lib/xumeng-home-covers";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { splitXumengPanelTail } from "@/lib/xumeng-interaction-panels";
import {
  peelXumengLabeledStatusTail,
  plainXumengStoryText,
  splitXumengMessagePresentation,
  splitXumengSpeech,
  type XumengMessagePresentation,
} from "@/lib/xumeng-message-presentation";
import { splitXumengMomentTail } from "@/lib/xumeng-moment-status";
import { xumengPage, xumengPageFill } from "@/lib/xumeng-page-copy";
import { xumengCardCoverUrl, xumengCoverMissUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import { XUMENG_GENERATION_WORKSPACE_ENABLED, XUMENG_PAYMENTS_ENABLED } from "@/lib/xumeng-feature-availability";
import { XUMENG_TELEGRAM_GROUP_URL } from "@/lib/xumeng-links";
import CharacterIntroduction from "./character-introduction";
import CharacterRichText, { hasCharacterMarkup } from "./character-rich-text";
import { CoverVisual } from "./cover-visual";
import Icon, { type IconName } from "./icons";
import { EMPTY_STATUS_LABELS, HOME_HERO_IMAGES, type TavernView } from "./tavern-helpers";
import s from "./tavern.module.css";
import { AccountAvatar } from "./user-mark";
import { XumengStatusCard } from "./xumeng-moment-status";

export function Deferred({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className={s.routeSkeleton} role="status" aria-busy="true" aria-label="正在打开">
          <div className={s.routeSkeletonBar} />
          <div className={s.routeSkeletonSub} />
          <div className={s.routeSkeletonGrid}>
            <div className={s.routeSkeletonCard} />
            <div className={s.routeSkeletonCard} />
            <div className={s.routeSkeletonCard} />
            <div className={s.routeSkeletonCard} />
          </div>
          <span className={s.srOnly}>正在打开…</span>
        </main>
      }
    >
      {children}
    </Suspense>
  );
}

const SOCIAL_MARKS = {
  youtube: "M23 12.2s0-3.2-.4-4.6c-.2-.9-.9-1.6-1.8-1.8C19.2 5.4 12 5.4 12 5.4s-7.2 0-8.8.4c-.9.2-1.6.9-1.8 1.8C1 9 1 12.2 1 12.2s0 3.2.4 4.6c.2.9.9 1.6 1.8 1.8 1.6.4 8.8.4 8.8.4s7.2 0 8.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.4.4-4.6.4-4.6zM9.8 15.5v-6.6l6.2 3.3-6.2 3.3z",
  x: "M17.6 3H20.4L13.8 10.2 21.5 21h-6.2l-4.9-6.4L5.2 21H2.4l7.1-8.1L2 3h6.4l4.4 5.8L17.6 3zm-1.1 16.2h1.7L7.6 4.7H5.8l10.7 14.5z",
  discord: "M19.3 5.2A17 17 0 0 0 15.1 4l-.4.8a15.6 15.6 0 0 1 4 1.6 16 16 0 0 0-13.4 0 12 12 0 0 1 3.9-1.6L9 4a17 17 0 0 0-4.3 1.2C2.1 8.4 1.4 12.2 1.6 16a17.4 17.4 0 0 0 5.3 2.7l.7-1.1a11.3 11.3 0 0 1-1.8-.9l.4-.3c3.6 1.7 7.5 1.7 11 0l.4.3c-.6.4-1.2.7-1.8.9l.7 1.1a17.4 17.4 0 0 0 5.3-2.7c.5-4.4-.7-8.1-2.5-10.8zM8.7 14.3c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm6.6 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.9 2.1-1.9 2.1z",
  tiktok: "M14.5 3c.4 2.4 1.8 4 4.2 4.4v2.4c-1.5 0-2.9-.5-4.2-1.3v6.7c0 3.3-2.6 5.8-5.8 5.8S3 18.5 3 15.2c0-3.2 2.5-5.7 5.7-5.8v2.5c-1.8.1-3.2 1.6-3.2 3.3 0 1.8 1.5 3.3 3.3 3.3s3.3-1.5 3.3-3.3V3h2.4z",
  instagram: "M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5zm8 2H8a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3zm-4 2.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5zM17.2 6.8a1 1 0 1 1-1 1 1 1 0 0 1 1-1z",
  telegram: "M21.5 4.4 2.8 11.2c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 11.1-7c.5-.3 1-.1.6.2l-9 8.1-.3 4.8c.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.2-.5-1.8-1.2-1.3z",
} as const;

export function SocialMark({ name }: { name: keyof typeof SOCIAL_MARKS }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={SOCIAL_MARKS[name]} />
    </svg>
  );
}

export function PlayBackdrop({ poster, motion }: { poster: string; motion?: string }) {
  if (motion) return <CoverVisual className={s.chatBackdrop} src={motion} poster={poster} alt="" play />;
  return <img className={s.chatBackdrop} alt="" src={poster} />;
}

export function Cover({
  character,
  className,
}: {
  character: Character;
  className?: string;
}) {
  const shelf = xumengHomeCover(character.id);
  return (
    <img
      src={shelf || xumengCardCoverUrl(character.cover || XUMENG_FALLBACK_COVER)}
      alt={character.name}
      className={className}
      onError={(event) => {
        const image = event.currentTarget;
        const next = xumengCoverMissUrl(image.currentSrc || image.src, character.cover || XUMENG_FALLBACK_COVER);
        image.onerror = () => { image.onerror = null; image.src = XUMENG_FALLBACK_COVER; };
        if (next === XUMENG_FALLBACK_COVER) image.onerror = null;
        image.src = next;
      }}
    />
  );
}

/** Home hero: swipeable image carousel with the fixed Play With Them copy. */
export function HomeHero({ title, installLabel, createLabel, carouselLabel, prevLabel, nextLabel, slideLabel, onInstall, onCreate }: {
  title: string; installLabel: string; createLabel: string; carouselLabel: string;
  prevLabel: string; nextLabel: string; slideLabel: (index: number) => string;
  onInstall: () => void; onCreate: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [paused, setPaused] = useState(false);
  activeRef.current = active;
  function go(delta: number) {
    const node = track.current;
    if (!node) return;
    const next = (activeRef.current + delta + HOME_HERO_IMAGES.length) % HOME_HERO_IMAGES.length;
    node.scrollTo({ left: next * node.clientWidth, behavior: "smooth" });
    setActive(next);
  }
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const update = () => setActive(Math.max(0, Math.min(HOME_HERO_IMAGES.length - 1, Math.round(node.scrollLeft / Math.max(1, node.clientWidth)))));
    node.addEventListener("scroll", update, { passive: true });
    return () => node.removeEventListener("scroll", update);
  }, []);
  // Auto-advance; pauses on hover/focus/touch and for reduced-motion users.
  useEffect(() => {
    if (paused || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      const node = track.current;
      if (!node || document.visibilityState === "hidden") return;
      const next = (activeRef.current + 1) % HOME_HERO_IMAGES.length;
      node.scrollTo({ left: next * node.clientWidth, behavior: "smooth" });
      setActive(next);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [paused]);
  return (
    <section
      className={s.shelfHero}
      aria-roledescription="carousel"
      aria-label={`${carouselLabel} · ${title}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <div className={s.shelfHeroTrack} ref={track}>
        {HOME_HERO_IMAGES.map((src, index) => (
          <img key={src} className={s.shelfHeroImage} src={src} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" fetchPriority={index === 0 ? "high" : "auto"} />
        ))}
      </div>
      <div className={s.shelfHeroShade} aria-hidden="true" />
      <div className={s.shelfHeroCopy}>
        <h2 id="shelf-hero-title" className={s.shelfHeroScript} lang="en"><span>Play</span><span>With Them</span></h2>
        <div className={s.shelfHeroRule} aria-hidden="true" />
        <div className={s.shelfHeroActions}>
          <button type="button" onClick={onInstall}><Icon name="download" size={15} />{installLabel}</button>
          <button type="button" onClick={onCreate}><Icon name="edit" size={15} />{createLabel}</button>
        </div>
      </div>
      <button type="button" className={`${s.shelfHeroArrow} ${s.shelfHeroArrowPrev}`} aria-label={prevLabel} onClick={() => go(-1)}>‹</button>
      <button type="button" className={`${s.shelfHeroArrow} ${s.shelfHeroArrowNext}`} aria-label={nextLabel} onClick={() => go(1)}>›</button>
      <div className={s.shelfHeroDots} role="tablist" aria-label={carouselLabel} aria-live="polite">
        {HOME_HERO_IMAGES.map((src, index) => (
          <button
            key={src}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={slideLabel(index + 1)}
            className={index === active ? `${s.shelfHeroDot} ${s.shelfHeroDotOn}` : s.shelfHeroDot}
            onClick={() => {
              const node = track.current;
              if (node) {
                node.scrollTo({ left: index * node.clientWidth, behavior: "smooth" });
                setActive(index);
              }
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function PlayCharacterSheet({
  character,
  locale,
  userName,
  liked,
  likeCount,
  favorited,
  onLike,
  onFavorite,
  onAuthor,
  onOpenDetail,
}: {
  character: Character;
  locale: XumengLocale;
  userName?: string;
  liked: boolean;
  likeCount: string | number;
  favorited: boolean;
  onLike: () => void;
  onFavorite: () => void;
  onAuthor: () => void;
  onOpenDetail: () => void;
}) {
  const copy = xumengPage(locale);
  const profile = localizeCharacter(character, locale);
  const authorName = xumengLocalizedAuthorName(character.author, locale);
  const seen = new Set<string>();
  const sections = [
    { key: "intro", label: copy.playIntro, text: profile.introduction || profile.description || "" },
    { key: "scene", label: copy.playScene, text: profile.scenario },
    { key: "personality", label: copy.playPersonality, text: profile.personality },
    { key: "appearance", label: copy.playAppearance, text: profile.appearance || "" },
    { key: "interaction", label: copy.playInteraction, text: profile.interactionSettings || "" },
  ].flatMap((section) => {
    const text = section.text.trim();
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [{ ...section, text }];
  });
  return (
    <div className={s.playSheet}>
      <div className={s.playSheetHead}>
        <Cover character={character} className={s.playSheetAvatar} />
        <div>
          <strong>{profile.name}</strong>
          <button type="button" onClick={onAuthor} aria-label={xumengPageFill(copy.viewAuthor, { name: authorName })}>{authorName}</button>
        </div>
      </div>
      <div className={s.playSheetActions} role="group" aria-label={`${copy.like} / ${copy.favorite}`}>
        <button type="button" onClick={onLike} aria-pressed={liked} aria-label={`${liked ? copy.unlike : copy.like} ${profile.name}`} title={liked ? copy.unlike : copy.like}>
          <Icon name="heart" size={14} />
          <span>{likeCount}</span>
        </button>
        <button type="button" onClick={onFavorite} aria-pressed={favorited} aria-label={`${favorited ? copy.unfavorite : copy.favorite} ${profile.name}`} title={favorited ? copy.unfavorite : copy.favorite}>
          <Icon name="bookmark" size={14} />
        </button>
      </div>
      {sections.length ? (
        <div className={s.playSheetProfile}>
          {sections.map((section) => (
            <section key={section.key} className={s.playSheetSection}>
              <h3>{section.label}</h3>
              <CharacterIntroduction text={section.text} characterName={profile.name} userName={userName} bodyClassName={s.playSheetProse} />
            </section>
          ))}
        </div>
      ) : <p className={s.playSheetProse}>{copy.noBlurb}</p>}
      <button type="button" className={s.playSheetMore} onClick={onOpenDetail}>{copy.viewSetting}</button>
    </div>
  );
}

export const MessageText = memo(function MessageText({
  text,
  role = "assistant",
  characterName,
  userName,
  statusLabels = EMPTY_STATUS_LABELS,
  showPeeledStatus = true,
  holdStatus = false,
  frontendScripts,
  messageDepth = 0,
}: {
  text: string;
  role?: "user" | "assistant";
  characterName?: string;
  userName?: string;
  statusLabels?: readonly string[];
  showPeeledStatus?: boolean;
  holdStatus?: boolean;
  frontendScripts?: readonly XumengFrontendScript[];
  messageDepth?: number;
}) {
  const scripted = applyXumengFrontendScripts(text, frontendScripts, { role, depth: messageDepth, pass: "display" });
  const markup = hasCharacterMarkup(scripted);
  const escapeName = (value?: string) => markup
    ? value?.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!))
    : value;
  const named = applyDzmmReaderNames(scripted, { characterName: escapeName(characterName), userName: escapeName(userName) });
  if (markup) return <CharacterRichText text={named} />;
  // Status presentation applies to character replies, never to the user's own text.
  const presentation = role === "user" ? { body: named, status: null } : splitXumengMessagePresentation(splitXumengMomentTail(splitXumengPanelTail(named).body).body);
  const peeled = role === "user" || presentation.status ? null : peelXumengLabeledStatusTail(presentation.body, statusLabels, { streaming: holdStatus });
  const body = peeled ? peeled.body : presentation.body;
  const revealed = presentation.status ?? (peeled?.fields.length ? { title: "状态栏", fields: peeled.fields } : null);
  const status = holdStatus || !showPeeledStatus ? null : revealed;
  if (!body && !status) return null;
  return (
    <>
      {body && <MessageTextBody text={body} />}
      {status && <MessageStatus status={status} />}
    </>
  );
});

function MessageTextBody({ text }: { text: string }) {
  if (hasCharacterMarkup(text)) return <CharacterRichText text={text} />;
  return plainXumengStoryText(text)
    .split("\n")
    .map((line, index) => (
      <div key={index}>
        {line ? splitXumengSpeech(line).map((part, j) => part.speech
          ? <span key={j} className={s.speech}>{part.text}</span> : part.text) : <br />}
      </div>
    ));
}

function MessageStatus({ status }: { status: NonNullable<XumengMessagePresentation["status"]> }) {
  const sections = status.sections ?? [{ title: "", fields: status.fields, notes: [] }];
  return (
    <XumengStatusCard
      name={status.title || "状态"}
      sections={sections.map((section, index) => ({
        title: section.title,
        notes: section.notes,
        fields: section.fields.map((field, fieldIndex) => ({
          key: `${index}:${fieldIndex}:${field.label}`,
          label: field.label,
          type: "text" as const,
          value: field.value,
        })),
      }))}
    />
  );
}

export type LocalizedNavItem = { view: TavernView; label: string; icon: IconName };

export function TavernAppRail({
  view,
  localizedNav,
  navigationCurrent,
  openNav,
  navigate,
  avatar,
  accountLabel,
  firstRechargeHalfAvailable = false,
  copy,
  t,
}: {
  view: TavernView;
  localizedNav: readonly LocalizedNavItem[];
  navigationCurrent: (target: TavernView) => boolean;
  openNav: (target: TavernView) => void;
  navigate: (target: TavernView) => void;
  avatar?: string;
  accountLabel: string;
  firstRechargeHalfAvailable?: boolean;
  copy: { mainNav: string; brandSquare: string; socialLinks: string; telegramJoin: string };
  t: (key: "utilityExploreApps" | "navTemplates" | "navTasks" | "utilityDailyCheckIn" | "navInvite" | "utilityRechargeVip" | "utilityInstallApp") => string;
}) {
  return (
    <aside className={s.appRail} aria-label={copy.mainNav}>
      <a href="#characters" className={s.railBrand} aria-label={copy.brandSquare} onClick={(event) => { event.preventDefault(); navigate("characters"); }}>
        <img src="/assets/xumeng/brand/xumeng-mark.svg" width="36" height="36" alt="" />
        <span>叙梦<small>XUMENG</small></span>
      </a>
      <nav data-tour="discover-nav">
        {localizedNav.map((n) => (
          <a
            key={n.view}
            href={`#${n.view}`}
            onClick={(e) => { e.preventDefault(); openNav(n.view); }}
            className={navigationCurrent(n.view) ? s.navActive : ""}
          >
            <Icon name={n.icon} size={18} />
            {n.label}
          </a>
        ))}
      </nav>
      <p className={s.railLabel}>{t("utilityExploreApps")}</p>
      <nav>
        {XUMENG_GENERATION_WORKSPACE_ENABLED && (
          <a href="#generation" className={view === "generation" || view === "aigen" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("generation"); }}>
            <Icon name="grid" size={18} />{t("navTemplates")}
          </a>
        )}
        <a href="#tasks" className={view === "tasks" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("tasks"); }}>
          <Icon name="trophy" size={18} />{t("navTasks")}
        </a>
        <a href="#checkin" className={view === "checkin" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("checkin"); }}>
          <Icon name="sun" size={18} />{t("utilityDailyCheckIn")}
        </a>
        <a href="#invite" className={view === "invite" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("invite"); }}>
          <Icon name="users" size={18} />{t("navInvite")}
        </a>
        {XUMENG_PAYMENTS_ENABLED && (
          <a href="#recharge" className={`${s.railRecharge} ${view === "recharge" || view === "vip" ? s.navActive : ""}`} onClick={(event) => { event.preventDefault(); navigate("recharge"); }}>
            <Icon name="wallet" size={18} /><span>{t("utilityRechargeVip")}</span>{firstRechargeHalfAvailable && <em className={s.railPromoTag}>首充5折</em>}
          </a>
        )}
      </nav>
      <div className={s.railDock}>
        <div className={s.railSocial} role="group" aria-label={copy.socialLinks}>
          <a className={`${s.railSocialItem} ${s.railSocialLive}`} href={XUMENG_TELEGRAM_GROUP_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram" title={copy.telegramJoin}><SocialMark name="telegram" /></a>
          <a href="#app" className={s.railSocialMore} onClick={(event) => { event.preventDefault(); navigate("app"); }} title={t("utilityInstallApp")}>
            <Icon name="download" size={13} />
            <span>{t("utilityInstallApp")}</span>
          </a>
        </div>
        <button type="button" className={s.railUser} onClick={() => navigate("profile")}>
          <span className={s.avatar}><AccountAvatar src={avatar} className={s.avatarImage} /></span>
          <strong>{accountLabel}</strong>
        </button>
      </div>
    </aside>
  );
}

export function TavernMobileNav({
  label,
  mobileNavItems,
  mobileNavSplit,
  mobileCreate,
  navigationCurrent,
  openNav,
}: {
  label: string;
  mobileNavItems: readonly LocalizedNavItem[];
  mobileNavSplit: number;
  mobileCreate?: LocalizedNavItem;
  navigationCurrent: (target: TavernView) => boolean;
  openNav: (target: TavernView) => void;
}) {
  return (
    <nav className={s.mobileNav} aria-label={label} data-tour="discover-nav">
      {mobileNavItems.slice(0, mobileNavSplit).map((n) => (
        <a
          href={`#${n.view}`}
          key={n.view}
          onClick={(e) => {
            e.preventDefault();
            openNav(n.view);
          }}
          className={navigationCurrent(n.view) ? s.navActive : ""}
        >
          <Icon name={n.icon} size={21} />
          <span>{n.label}</span>
        </a>
      ))}
      {mobileCreate && (
        <a
          href="#studio"
          aria-label={mobileCreate.label}
          title={mobileCreate.label}
          onClick={(e) => {
            e.preventDefault();
            openNav("studio");
          }}
          className={`${s.mobileCreate} ${navigationCurrent("studio") ? s.navActive : ""}`}
        >
          <span className={s.mobileCreateDisc}><Icon name="sparkles" size={26} /></span>
        </a>
      )}
      {mobileNavItems.slice(mobileNavSplit).map((n) => (
        <a
          href={`#${n.view}`}
          key={n.view}
          onClick={(e) => {
            e.preventDefault();
            openNav(n.view);
          }}
          className={navigationCurrent(n.view) ? s.navActive : ""}
        >
          <Icon name={n.icon} size={21} />
          <span>{n.label}</span>
        </a>
      ))}
    </nav>
  );
}
