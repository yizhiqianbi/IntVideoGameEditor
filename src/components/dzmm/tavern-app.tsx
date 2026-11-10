"use client";

/* eslint-disable @next/next/no-img-element -- Local research assets and user-imported character covers. */
import { applyDzmmReaderNames, getDzmmCharacterCardBlurb, getDzmmCharacterCreatorNotes } from "@/lib/dzmm-character-presentation";
import { characterLinkId, characterSharePath } from "@/lib/xumeng-character-link";
import CharacterIntroduction from "./character-introduction";
import { currentXumengPanelState, splitXumengPanelTail } from "@/lib/xumeng-interaction-panels";
import { chatViewportAnchorTop, chatViewportFrame, chatViewportSettled } from "@/lib/xumeng-chat-viewport";
import { splitXumengMomentTail } from "@/lib/xumeng-moment-status";
import CharacterRichText, { hasCharacterMarkup } from "./character-rich-text";
import { useDzmmComposerDrafts } from "./use-composer-drafts";
import {
  lazy,
  Suspense,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  isDzmmListedCharacter,
  parseCharacterImport,
  parseCharacterDraftImport,
  DZMM_CHARACTER_CARD_MAX_BYTES,
  readDzmmCharacterImportText,
  dzmmPngCharacterFile,
  exportCharacterJson,
  exportCharacterDraftJson,
  type Character,
} from "@/lib/dzmm-characters";
import { getDzmmNewConversationBlockReason, loadMissingPublishedCharacters, mergeDzmmConversationCharacters, selectDzmmDirectory } from "@/lib/dzmm-catalog";
import { DzmmMemoryRequestError, prepareDzmmRememberedRequest } from "@/lib/dzmm-memory-client";
import { applyDzmmConversationOpening, captureDzmmConversationOpening, parseDzmmConversationOpening,
  reconcileDzmmConversationOpening, resolveDzmmConversationOpening, restoreDzmmConversationContexts } from "@/lib/dzmm-conversation-context";
import { DZMM_CONVERSATION_BACKUP_MAX_BYTES, parseDzmmConversationBackup } from "@/lib/dzmm-conversation-backup";
import { filterDzmmConversations, filterDzmmSearchRows } from "@/lib/dzmm-conversation-search";
import { createDzmmUnavailableConversationBackup, parseDzmmUnavailableConversationBackup } from "@/lib/dzmm-unavailable-conversation-backup";
import { fetchDzmmBillingConfig, type DzmmBillingConfig } from "@/lib/dzmm-billing-client";
import { createDzmmStoryMemory, matchesDzmmStoryMemory, type DzmmStoryState } from "@/lib/dzmm-story-memory";
import { appendDzmmWorldSnapshot, createDzmmWorldState,
  pruneDzmmWorldJournal, recordDzmmWorldModeChange, resolveDzmmWorldRuntime,
  type DzmmWorldClockMode, type DzmmWorldJournal } from "@/lib/dzmm-world-state";
import { readDzmmWorldResponse, type DzmmWorldStreamResult } from "@/lib/dzmm-world-stream";
import { rebindDzmmWorldJournal } from "@/lib/dzmm-world-client";
import {
  copyDzmmConversationPersona,
  dropDzmmConversationPersonas,
  isDzmmPublishedCharacterId,
  resolveDzmmConversationPersona,
  type DzmmSavedConversation,
  type DzmmSavedMessage,
  type DzmmPreferences,
} from "@/lib/dzmm-storage";
import { dzmmCloudRequest, uploadDzmmCover, useDzmmCloud, type DzmmAccountValues } from "@/lib/dzmm-cloud";
import { fetchDzmmPlayMaterials, fetchDzmmPublicCharacter } from "@/lib/dzmm-publishing";
import { isDzmmListPreview, orderDzmmShelfByTime, xumengPlayCatalogSort, type DzmmCatalogLook, type DzmmCatalogRequest } from "@/lib/dzmm-public-shelf";
import { dzmmBundledPlayableCharacter } from "@/lib/load-dzmm-bundled-cards";
import { dzmmDeferredIntroductionCharacter } from "@/lib/load-dzmm-public-introductions";
import { isDzmmDeferredAiArchiveId } from "@/lib/dzmm-ai-archive-ids";
import { isDzmmDeferredIntroductionId } from "@/lib/dzmm-public-introduction-ids";
import { loadDzmmAiCharacters } from "@/lib/load-dzmm-ai-characters";
import { loadDzmmPublicIntroductionShelf } from "@/lib/load-dzmm-public-introduction-shelf";
import { dzmmDeferredContextCharacter } from "@/lib/load-dzmm-public-context";
import { isXumengPinnedCard, loadXumengCardProvenance } from "@/lib/xumeng-card-shelf";
import { dzmmLocalLook } from "@/lib/dzmm-local-looks";
import { usePublicCharacterShelf } from "./use-public-shelf";
import Icon, { type IconName } from "./icons";
import { ComposerQuickInsert } from "./composer-quick-insert";
import { dzmmChatBackgroundStyle, dzmmChatDisplayStyle, dzmmEnterSends } from "@/lib/dzmm-chat-display";
import ResponsiveNavigation from "./responsive-navigation";
import CharacterDetail from "./character-detail";
import AccountModal from "./account-modal";
import authorsData from "@/lib/dzmm-authors.json";
import { DZMM_DISCOVERY_CATEGORIES, dzmmDiscoveryCutoff, findCharacterAuthor, isDzmmCharacterBlocked, resolveCharacterAuthorTarget, type DzmmAuthor, type DzmmForumTopic } from "@/lib/dzmm-discovery";
import { characterMatchesShelfTags, coverShelfTags } from "@/lib/xumeng-shelf-tags";
import { isPublicRecommendationCharacter, QUALIFIED_USER_MESSAGES, recommendationReasonText, type RecommendationReason, type RecommendationSurface } from "@/lib/xumeng-recommendations";
import {
  fetchXumengRecommendations, recommendationRequestAborted, recordXumengRecommendationEvents,
  type XumengRecommendationEvent, type XumengRecommendationPage, type XumengRecommendationQuery,
} from "@/lib/xumeng-recommendations-client";
import { ACQUISITION_STORAGE_KEY, parseStoredAcquisition, readAcquisitionLanding } from "@/lib/xumeng-acquisition";
import { recordXumengAcquisition } from "@/lib/xumeng-acquisition-client";
import { fetchDzmmReferral } from "@/lib/dzmm-referral";
import { DZMM_GLOBAL_QUERY_MAX_LENGTH, dzmmDiscoveryRouteCategory, dzmmDiscoverySource, dzmmSearchDiscoverySource, mergeDzmmDiscoveryHistory, readDzmmDiscoveryHistory,
  defaultDzmmTaskSelection, dzmmTaskSelectionForRole, dzmmTaskDiscoverySource,
  type DzmmDiscoverySource, type DzmmTaskSelection } from "@/lib/dzmm-discovery-history";
import { DiscoveryTagPicker, SearchResults, AuthorProfile, type CatalogDiscoveryFilters } from "./discovery-views";
import { InviteCenter, ProfileView, ProfileSettings, PresetLibrary } from "./profile-settings";
import ChatSettings from "./chat-settings";
import UnavailableConversation from "./unavailable-conversation";
import { fetchDzmmForumPosts } from "@/lib/dzmm-forum";
import { getDzmmCharacterMedia, withDzmmPublicOpening } from "@/lib/dzmm-character-media";
import { CoverReel } from "./cover-reel";
import { xumengCardCoverUrl, xumengCoverMissUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import { useGamePlayLibrary, type GamePlaySelection } from "./use-game-play-library";
import { parseXumengGameId, XUMENG_BUILTIN_GAMES, xumengBuiltinGame } from "@/lib/xumeng-games";
import gameNavigation from "./game-play-navigation.module.css";
import { xumengStatusBarLabels, xumengStatusBarSections } from "@/lib/xumeng-character-status";
import { XUMENG_PAYMENT_INFO_DRAFT, XUMENG_PAYMENT_INFO_PAGES } from "@/lib/xumeng-payment-info";
import { girlfriendLiveVoice } from "@/app/xumeng/girlfriend/companion-voices";
import { REALISTIC_COMPANION_PROFILES, type CompanionProfile } from "@/app/xumeng/girlfriend/companion-profiles";
import { girlfriendProfile, listGirlfriends, type GirlfriendPersona } from "@/app/xumeng/girlfriend/girlfriend-persona";
import { GIRLFRIEND_CAST, girlfriendCastById, type GirlfriendCast } from "@/app/xumeng/girlfriend/cast";
import { chatListStamp, companionLane, useCompanionInbox } from "@/app/xumeng/girlfriend/companion-inbox";
import { usePerformanceCharacters } from "./use-performance-characters";
import { xumengPerformanceFromCard, type XumengPerformanceCharacter } from "@/lib/xumeng-performance-character";
import { buildXumengLiveConversationHandoff } from "@/lib/xumeng-live-conversation";
import { xumengVideoDramaIdFromRoute } from "@/lib/xumeng-video-catalog";
import { XUMENG_CALLS_ENABLED, XUMENG_CALLS_LOCKED_MESSAGE, XUMENG_CHARACTER_VOICE_ENABLED, XUMENG_FORUM_ENABLED, XUMENG_FORUM_LOCKED_MESSAGE, XUMENG_GENERATION_WORKSPACE_ENABLED, XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import { DZMM_OFFERED_MODEL_OPTIONS, normalizeDzmmModelSelection } from "@/lib/dzmm-models";
import { SignupWelcome } from "./signup-welcome";
import { ChatMediaProvider, ChatMessageMedia } from "./chat-message-media";
import { XumengStatusCard, type MomentSection } from "./xumeng-moment-status";
import ChatMessageEditor from "./chat-message-editor";
import { ChatBillingStatus } from "./chat-billing-status";
import { peelXumengLabeledStatusTail, plainXumengStoryText, splitXumengMessagePresentation, splitXumengSpeech, xumengConversationPreview, type XumengMessagePresentation } from "@/lib/xumeng-message-presentation";
import { canRegenerateDzmmMessage, createDzmmRegenerationBranch, createDzmmReplySuggestionBranch, editDzmmConversationMessage } from "@/lib/dzmm-message-actions";
import { dzmmReplySuggestionPrefixKeys, dzmmReplySuggestionSettingsKey, fetchDzmmReplySuggestions, prepareDzmmReplySuggestionsRequest } from "@/lib/dzmm-reply-suggestions-client";
import { DZMM_REPLY_SUGGESTIONS_PROMPT_VERSION } from "@/lib/dzmm-reply-suggestions";
import { fetchHomeBanners, type PublicHomeBanner } from "@/lib/home-banners-client";
import ReplySuggestions from "./reply-suggestions";
import { fetchDzmmLikeStats, setDzmmCharacterLike, submitDzmmCharacter, fetchDzmmPublishingMine, type DzmmLikeStats, type DzmmPublishingSubmission } from "@/lib/dzmm-publishing";
import { XUMENG_LOCALES, resolveXumengLocale, xumengHtmlLang, xumengLocaleLabel, xumengTranslate, type XumengMessageKey } from "@/lib/xumeng-i18n";
import { loadXumengCardTranslations, localizeCharacter, localizedCharacterTags, sourceCharacterTag } from "@/lib/xumeng-card-localization";
import { xumengLocaleFromPathname, xumengLocalePathname, XUMENG_DEFAULT_LOCALE, type XumengLocale } from "@/lib/xumeng-i18n";
import { XUMENG_TELEGRAM_GROUP_URL } from "@/lib/xumeng-links";
import s from "./tavern.module.css";

const ForumView = lazy(() => import("./forum-view"));
const CharacterStudio = lazy(() => import("./character-studio"));
const PublishingCenter = lazy(() => import("./publishing-center"));
const CreatorCenter = lazy(() => import("./creator-center"));
const GameStudio = lazy(() => import("./game-studio"));
const GamePlayer = lazy(() => import("./game-player").then((module) => ({ default: module.GamePlayer })));
const ScenarioStudio = lazy(() => import("./scenario-studio").then((module) => ({ default: module.ScenarioStudio })));
const AdminDashboard = lazy(() => import("./admin-dashboard"));
const NovelStudio = lazy(() => import("./novel-studio"));
const LiveStudio = lazy(() => import("./live-studio"));
const MiniCpmPhone = lazy(() => import("./minicpm-phone"));
const CompanionPage = lazy(() => import("@/app/xumeng/girlfriend/companion-page"));
const GirlfriendStudio = lazy(() => import("@/app/xumeng/girlfriend/girlfriend-studio"));
const QwenCompanion = lazy(() => import("@/app/xumeng/girlfriend/qwen-companion"));
const VoiceStudio = lazy(() => import("./voice-studio"));
const GenerationStudio = lazy(() => import("./generation-studio"));
const VideoChannel = lazy(() => import("./video-channel"));
const GenerationHistory = lazy(() => import("./generation-history"));
const TaskHub = lazy(() => import("./task-hub").then((module) => ({ default: module.TaskHub })));
const InstallApp = lazy(() => import("./install-app").then((module) => ({ default: module.InstallApp })));
const Recharge = lazy(() => import("./recharge").then((module) => ({ default: module.Recharge })));
const DailyCheckin = lazy(() => import("./daily-checkin").then((module) => ({ default: module.DailyCheckin })));

function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className={s.profileEmpty} role="status"><p>正在打开…</p></main>}>{children}</Suspense>;
}

function prefetchRoute(target: string) {
  if (target.startsWith("chat/girlfriend-qwen")) void import("@/app/xumeng/girlfriend/qwen-companion");
  else if (target.startsWith("chat/girlfriend")) void import("@/app/xumeng/girlfriend/companion-page");
  else if (target.startsWith("chat/game/")) void import("./game-player");
  else if (target.startsWith("studio/girlfriends")) void import("@/app/xumeng/girlfriend/girlfriend-studio");
  else if (target.startsWith("studio/games")) void import("./game-studio");
  else if (target.startsWith("studio/scenarios") || target.startsWith("studio/room/")) void import("./scenario-studio");
  else if (target === "studio/new" || target.startsWith("studio/edit/")) void import("./character-studio");
  else if (target === "studio" || target === "studio/roles") void import("./creator-center");
  else if (target === "novels" || target.startsWith("novels/")) void import("./novel-studio");
  else if (target === "videos" || xumengVideoDramaIdFromRoute(target)) void import("./video-channel");
  else if (target === "live") void import("./minicpm-phone");
  else if (target === "voice") void import("./voice-studio");
  else if (target === "generation") {
    if (XUMENG_GENERATION_WORKSPACE_ENABLED) void import("./generation-studio");
    else void import("./generation-history");
  }
  else if (target === "tasks") void import("./task-hub");
  else if (target === "app") void import("./install-app");
  else if (target === "recharge" || target === "vip") void import("./recharge");
  else if (target === "checkin") void import("./daily-checkin");
  else if (target === "forum" || target.startsWith("forum/")) void import("./forum-view");
  else if (target === "admin") {
    void import("./admin-dashboard");
    void import("./publishing-center");
    void import("./forum-view");
  }
}

type View = "play-games" | "videos" | "characters" | "chat" | "forum" | "profile" | "search" | "author" | "settings" | "presets" | "admin" | "studio" | "studio-edit" | "games" | "girlfriends" | "scenarios" | "novels" | "live" | "voice" | "generation" | "tasks" | "app" | "recharge" | "vip" | "invite" | "checkin";
type Message = DzmmSavedMessage;
type Conversation = DzmmSavedConversation;
type Preferences = DzmmPreferences;
type ChatSection = "stories" | "chats" | "games";
const CHAT_SECTION_ROUTES: Record<ChatSection, string> = { stories: "chat", chats: "chat/chats", games: "chat/games" };
const TABS = ["新手", "猜你喜欢", "关注", "最新", "榜单", "分类"];
const FEATURED_CHARACTER_COUNT = 13;
const MODEL_MODES = DZMM_OFFERED_MODEL_OPTIONS;
const MAX_PARALLEL_REPLIES = 3;
const COARSE_POINTER = "(pointer: coarse)";
const BROWSE_GENRES_STORAGE_KEY = "xumeng-browse-genres";
const BROWSE_TAG_LIMIT = 3;
function isBrowseLook(id: string): id is DzmmCatalogLook {
  return id === "photo" || id === "anime";
}
function browseTagName(id: string): string {
  if (id === "photo") return "真人";
  if (id === "anime") return "动漫";
  return DZMM_DISCOVERY_CATEGORIES.find((item) => item.slug === id)?.name ?? id;
}
type CoverTagTone = "rose" | "violet" | "gold" | "blue" | "plum";
function coverTagTone(tag: string): CoverTagTone {
  const value = tag.trim().toLowerCase();
  if (/(病娇|抖s|女王|支配|强势|人妻|熟女|成人|性瘾|巨乳|反差|暧昧|暗恋)/u.test(value)) return "rose";
  if (/(战斗|冒险|超英|修仙|异世界|魔法|大世界|游戏)/u.test(value)) return "violet";
  if (/(温柔|治愈|陪伴|日常|乡村|校园)/u.test(value)) return "gold";
  if (/(权力|职场|模拟|悬疑|推理|科幻)/u.test(value)) return "blue";
  return "plum";
}
function readStoredBrowseSelection(): string[] {
  const stored: string[] = [];
  if (typeof window !== "undefined") {
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(BROWSE_GENRES_STORAGE_KEY) || "null");
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim() && !stored.includes(item)) stored.push(item);
        }
      }
    } catch { /* The current selection remains the source of truth. */ }
  }
  const looks = stored.filter(isBrowseLook);
  const rest = stored.filter((id) => !isBrowseLook(id));
  const savedLook = looks.length ? null : savedCatalogLook();
  const unique: string[] = [];
  for (const id of [...(savedLook ? [savedLook] : looks), ...rest]) {
    if (!unique.includes(id)) unique.push(id);
  }
  return unique.slice(0, BROWSE_TAG_LIMIT);
}

function recommendationRandomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

function recommendationShuffleHash(id: string, seed: number): number {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** Keep a few strong cards at the front while changing the exploration set on every refresh. */
function shuffleHomeRecommendationIds(ids: readonly string[], seed: number): string[] {
  const stable = ids.slice(0, 6);
  const exploratory = ids.slice(6).map((id, index) => ({ id, index, hash: recommendationShuffleHash(id, seed) }));
  exploratory.sort((left, right) => left.hash - right.hash || left.index - right.index);
  return [...stable, ...exploratory.map((item) => item.id)];
}

function subscribeCoarsePointer(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function readCoarsePointer() { return window.matchMedia(COARSE_POINTER).matches; }
const AUTHORS: DzmmAuthor[] = authorsData;
const uid = () => crypto.randomUUID();
type LikeStat = { count: number; liked: boolean };
function parseLikeBaseline(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(万|k)?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (match[2]?.toLowerCase() === "k" ? 1000 : match[2] === "万" ? 10000 : 1));
}
function formatLikeTotal(character: Character, stat?: LikeStat) {
  if (!stat) return character.likes || "—";
  const baseline = parseLikeBaseline(character.likes);
  if (baseline === null) return stat.count > 0 ? String(stat.count) : "—";
  const total = baseline + stat.count;
  if (total >= 10000) {
    const value = (total / 10000).toFixed(total >= 100000 ? 0 : 1).replace(/\.0$/, "");
    return `${value}万`;
  }
  return String(total);
}
const NAV: { view: View; labelKey: XumengMessageKey; icon: IconName }[] = [
  { view: "videos", labelKey: "navVideos", icon: "video" },
  { view: "characters", labelKey: "navPlay", icon: "users" },
  { view: "chat", labelKey: "navChat", icon: "chat" },
  ...(XUMENG_FORUM_ENABLED ? [{ view: "forum" as const, labelKey: "navForum" as const, icon: "compass" as const }] : []),
  { view: "studio", labelKey: "navCreate", icon: "edit" },
  { view: "profile", labelKey: "navProfile", icon: "user" },
];
const NAV_TOOLS: { view: View; labelKey: XumengMessageKey; icon: IconName }[] = [
  { view: "invite", labelKey: "navInvite", icon: "users" },
  { view: "novels", labelKey: "navNovels", icon: "book" },
  { view: "voice", labelKey: "navVoice", icon: "volume" },
  { view: "tasks", labelKey: "navTasks", icon: "trophy" },
  ...(XUMENG_PAYMENTS_ENABLED ? [{ view: "recharge" as const, labelKey: "navRecharge" as const, icon: "wallet" as const }, { view: "vip" as const, labelKey: "navVip" as const, icon: "crown" as const }] : [{ view: "recharge" as const, labelKey: "navRecharge" as const, icon: "sun" as const }]),
  { view: "presets", labelKey: "navPresets", icon: "sliders" },
  { view: "settings", labelKey: "navSettings", icon: "user" },
  { view: "app", labelKey: "navInstallApp", icon: "download" },
];

async function searchForumTopics(query: string, signal: AbortSignal): Promise<DzmmForumTopic[]> {
  if (signal.aborted) return [];
  const result = await fetchDzmmForumPosts({ q: query });
  if (signal.aborted) return [];
  return result.posts.map((post) => ({ id: post.id, title: post.title, body: post.body, author: post.author.nickname, category: post.category, updatedAt: post.updatedAt }));
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CONTENT_PEOPLE = [
  {
    variant: "classic" as const, castId: "", look: "photo" as const, name: "林幺", line: "一点四十。烟在你左手边，别看我。", cover: "/assets/xumeng/content-covers/yume.jpg",
    situation: "凌晨一点四十，发发便利店。她踩着凳子够顶层货。",
    description: "二十三，夜班店员林幺。嘴上没好话，关东煮多你两块萝卜。你的外号叫一点四十。",
    personality: "二十三，林幺，发发便利店夜班。叫你一点四十。嘴上没好话，萝卜多舀半勺。速写本里画了你，她说是练人体。画稿被毙的晚上话变少，货码得很齐。",
  },
  {
    variant: "intimate" as const, castId: "", look: "photo" as const, name: "宁宁", line: "坏老公。灯还亮着嘛。", cover: "/assets/xumeng/content-covers/wanning.jpg",
    situation: "人在家。手机贴在脸颊上，声音发黏。",
    description: "宁宁，你老婆。先骂一句坏老公，再说自己刚刚在干什么。已婚，不是学生。",
    personality: "宁宁，你老婆，已婚，不是学生。先骂坏老公，再说刚刚在干什么。口癖人家、哎呀、嘛。想靠近就说人话。你说停，她这轮把话收回去。",
  },
  ...GIRLFRIEND_CAST.map(person => ({
    variant: "cast" as const, castId: person.id, look: "photo" as const, name: person.name, line: person.line, cover: person.cover,
    situation: person.situation, description: person.description, personality: person.style.personality,
  })),
  {
    variant: "sales" as const, castId: "", look: "photo" as const, name: "Eva", line: "看我一眼。就一眼。", cover: "/assets/xumeng/exported-cards/foreverse-songzhixia-cover.png",
    situation: "妆还没卸。项链压在锁骨上，微信刚加上。",
    description: "二十八，Eva。一次只给一张没修的图。你说不看，她回一个行。",
    personality: "二十八，Eva。妆没卸，项链压在锁骨上。刚加上，一次只求你看一张没修的图。你不回她换一句。你说不看，她这轮回行。看过才算看过。",
  },
  {
    variant: "qwen" as const, castId: "", look: "photo" as const, name: "小节", line: "我很喜欢和人讲话，所以我不想和你讲。", cover: "/assets/xumeng/content-covers/sumai.jpg",
    situation: "收租日。圆框眼镜，黑短发，人还坐在电脑前。",
    description: "二十六，房东小节。六套房，饭在家吃。骂人不带脏字。多收的钱她会退。",
    personality: "二十六，小节。圆框眼镜，男式T恤，房租自己收。有钱，但抠。嘴损，不带脏字。旧键盘比你金贵。不熟的人，她不喝酒。多收的钱她退，退的时候还要损你一句。",
  },
];
type CompanionVariant = "classic" | "intimate" | "qwen" | "custom" | "sales" | "cast";
function isGirlfriendRoute(route: string) {
  return route === "chat/girlfriend" || route === "chat/girlfriend-intimate" || route === "chat/girlfriend-qwen" || route === "chat/girlfriend-sales" || route.startsWith("chat/girlfriend-custom/") || route.startsWith("chat/girlfriend-cast/") || route.startsWith("chat/girlfriend-mine/");
}
function companionVariantFromRoute(route: string): CompanionVariant {
  if (route === "chat/girlfriend-intimate") return "intimate";
  if (route === "chat/girlfriend-qwen") return "qwen";
  if (route === "chat/girlfriend-sales") return "sales";
  if (route.startsWith("chat/girlfriend-custom/") || route.startsWith("chat/girlfriend-mine/")) return "custom";
  if (route.startsWith("chat/girlfriend-cast/")) return "cast";
  return "classic";
}
const CHAT_CALL_CHARACTERS: XumengPerformanceCharacter[] = CONTENT_PEOPLE.map(person => ({
  id: `chat-${person.castId || person.variant}`, key: `chat:${person.castId || person.variant}`, source: "character" as const, sourceId: person.castId || person.variant, sourceLabel: "聊天",
  name: person.name, avatar: person.cover, description: person.description, personality: person.personality, scenario: person.situation, dialogue: "",
  liveVoice: girlfriendLiveVoice(person.castId || person.variant),
}));
function gameHeat(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 60 + (hash % 840);
}

const GAME_COVERS: Record<string, string> = {};

type ContentShelfItem =
  | { kind: "game"; key: string; game: { id: string; title: string; synopsis: string } }
  | { kind: "character"; key: string; character: Character }
  | { kind: "companion"; key: string; person: (typeof CONTENT_PEOPLE)[number] };

/** Games and character cards share one shelf. Chat cards stay in their own row. */
function selectedShelfTags(selected: readonly string[]): string[] {
  const slugs = new Set<string>(DZMM_DISCOVERY_CATEGORIES.map((item) => item.slug));
  const fromCategories = DZMM_DISCOVERY_CATEGORIES.filter((item) => selected.includes(item.slug)).flatMap((item) => item.tags);
  return [...fromCategories, ...selected.filter((tag) => !slugs.has(tag) && !isBrowseLook(tag))];
}

function companionAge(text: string): string | null {
  const digit = /(\d{1,2})\s*岁/u.exec(text);
  if (digit) return `${digit[1]}岁`;
  const written = /([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])岁/u.exec(text);
  return written ? `${written[1]}岁` : null;
}

function weaveEqual<T>(lanes: readonly (readonly T[])[]): T[] {
  const pending = lanes.map(lane => [...lane]);
  const mixed: T[] = [];
  while (pending.some(lane => lane.length > 0)) {
    for (const lane of pending) {
      const next = lane.shift();
      if (next !== undefined) mixed.push(next);
    }
  }
  return mixed;
}

function storyUnread(messages: { id: string; role: string; content: string }[], seenId: string | undefined) {
  if (!seenId) return 0;
  const index = messages.findIndex(message => message.id === seenId);
  if (index < 0) return 0;
  return messages.slice(index + 1).filter(message => message.role === "assistant" && message.content.trim()).length;
}

function formatConversationStamp(updatedAt: number): string {
  const date = new Date(updatedAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) return `周${"日一二三四五六"[date.getDay()]}`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function chatPresence(character: { description: string; tags: string[] }, typing: boolean): string {
  if (typing) return "正在输入…";
  const line = character.description.replace(/\s+/g, " ").trim();
  if (!line) return character.tags[0] || "在线";
  const chars = Array.from(line);
  return chars.length > 18 ? `${chars.slice(0, 18).join("")}…` : line;
}

function Cover({
  character,
  className,
}: {
  character: Character;
  className?: string;
}) {
  return (
    <img
      src={xumengCardCoverUrl(character.cover || XUMENG_FALLBACK_COVER)}
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

function savedCatalogLook(): DzmmCatalogLook | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem("xumeng-catalog-look");
    if (saved === "anime" || saved === "photo") return saved;
  } catch {
    /* The saved look can wait until the next visit. */
  }
  return null;
}

function linkedPublishedCharacterId(): string | null {
  if (typeof window === "undefined") return null;
  const fromPath = characterLinkId(window.location.pathname);
  if (fromPath && isDzmmPublishedCharacterId(fromPath)) return fromPath;
  if (!window.location.hash.startsWith("#character/")) return null;
  let id = window.location.hash.slice("#character/".length);
  try { id = decodeURIComponent(id); } catch { return null; }
  return isDzmmPublishedCharacterId(id) ? id : null;
}

export default function TavernApp() {
  const [generating, setGenerating] = useState<Record<string, "reply" | "summary">>({});
  const [notice, setNotice] = useState("");
  const cloud = useDzmmCloud({ busy: Object.keys(generating).length > 0, onNotice: setNotice });
  const { state, setState, loaded } = cloud;
  const [backupSelection, setBackupSelection] = useState<{ accountId: string; key: string } | null>(null);
  const requestedBackup = backupSelection?.accountId === cloud.user?.id ? backupSelection?.key : undefined;
  const selectedBackup = requestedBackup && cloud.backupChoices.some(item => item.key === requestedBackup)
    ? requestedBackup : cloud.backupChoices[0]?.key ?? "";
  const [accountMode, setAccountMode] = useState<"login" | "register" | null>(null);
  const [guestGate, setGuestGate] = useState<{ character: Character; stage: "account" | "welcome" | "open" } | null>(null);
  const [pendingInvite, setPendingInvite] = useState("");
  const [view, setView] = useState<View>("characters");
  const [routeLocale, setRouteLocale] = useState<XumengLocale | null>(() => typeof window === "undefined" ? null : xumengLocaleFromPathname(window.location.pathname));
  const [, setCardTranslationRevision] = useState(0);
  const [tab, setTab] = useState("新手");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [appliedTags, setAppliedTags] = useState<string[]>(readStoredBrowseSelection);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const look = useMemo(() => {
    const looks = appliedTags.filter(isBrowseLook);
    return looks.length === 1 ? looks[0] : null;
  }, [appliedTags]);
  const genres = useMemo(() => appliedTags.filter((id) => !isBrowseLook(id)), [appliedTags]);
  const browseTagChoices = useMemo(() => [
    { id: "photo", name: "真人" },
    { id: "anime", name: "动漫" },
    ...DZMM_DISCOVERY_CATEGORIES.map((item) => ({ id: item.slug, name: item.name })),
  ], []);
  useEffect(() => {
    try {
      if (appliedTags.length) window.sessionStorage.setItem(BROWSE_GENRES_STORAGE_KEY, JSON.stringify(appliedTags));
      else window.sessionStorage.removeItem(BROWSE_GENRES_STORAGE_KEY);
      window.localStorage.setItem("xumeng-catalog-look", look ?? "all");
    } catch { /* The current tab state remains the source of truth. */ }
  }, [appliedTags, look]);
  const [homeBanners, setHomeBanners] = useState<PublicHomeBanner[]>([]);
  useEffect(() => {
    let live = true;
    void fetchHomeBanners().then((banners) => { if (live) setHomeBanners(banners); }).catch(() => { if (live) setHomeBanners([]); });
    return () => { live = false; };
  }, []);
  const [query, setQuery] = useState("");
  const [sortMode] = useState<"recommended" | "heat" | "likes" | "updated" | "name">("recommended");
  const [rankingPeriod, setRankingPeriod] = useState<"day" | "week" | "all">("week");
  const [recommendEpoch, setRecommendEpoch] = useState(recommendationRandomSeed);
  const [localHidden, setLocalHidden] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState<XumengRecommendationPage & { status: "idle" | "loading" | "ready" | "error"; key: string }>({ status: "idle", key: "", ids: [], reasons: {}, personalized: false, hiddenIds: [] });
  const [relatedRank, setRelatedRank] = useState<XumengRecommendationPage & { status: "idle" | "loading" | "ready" | "error" }>({ status: "idle", ids: [], reasons: {}, personalized: false, hiddenIds: [] });
  const [detail, setDetail] = useState<Character | null>(null);
  const [likeStats, setLikeStats] = useState<Record<string, LikeStat>>({});
  const likeStatsRef = useRef(likeStats);
  likeStatsRef.current = likeStats;
  const likeOwner = useRef<string | null>(null);
  const likeInflight = useRef(new Set<string>());
  const likeRequests = useRef(new Set<AbortController>());
  const [editor, setEditor] = useState<Character | "new" | null>(null);
  const [studioSession, setStudioSession] = useState(0);
  const [studioSubmission, setStudioSubmission] = useState<Pick<DzmmPublishingSubmission, "status" | "reason"> | null>(null);
  const studioSubmissionGeneration = useRef(0);
  const studioRoute = useRef("");
  const studioDirty = useRef(false);
  const studioBusy = useRef(false);
  const [creatorSection, setCreatorSection] = useState<"home" | "roles">("home");
  const [creatorInitial, setCreatorInitial] = useState<{ id?: string; roomCode?: string }>({});
  const creatorRoute = useRef("");
  const creatorDirty = useRef(false);
  const creatorBusy = useRef(false);
  const [novelInitial, setNovelInitial] = useState<{ id?: string; type?: "novel" | "story" }>({});
  const novelRoute = useRef("novels");
  const novelDirty = useRef(false);
  const novelBusy = useRef(false);
  const novelRouteActive = useRef(false);
  const liveBusy = useRef(false);
  const liveRouteActive = useRef(false);
  const callReturnRoute = useRef("chat");
  const [liveMode, setLiveMode] = useState<"phone" | "video">("phone");
  const requestedLiveMode = useRef<"phone" | "video">("phone");
  const activeAccount = useRef<string | null>(null);
  const detailRecommendSurface = useRef<RecommendationSurface | null>(null);
  const catalogRef = useRef<HTMLElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = tabsRef.current;
    const node = wrap?.querySelector("nav");
    if (!wrap || !node) return;
    const update = () => wrap.toggleAttribute("data-more", node.scrollWidth - node.clientWidth - node.scrollLeft > 12);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    node.addEventListener("scroll", update, { passive: true });
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [view, tab, appliedTags]);
  const shelfMoreRef = useRef<HTMLDivElement | null>(null);
  const resolvedAttempt = useRef(new Set<string>());
  const impressed = useRef(new Set<string>());
  const qualifiedSent = useRef(new Set<string>());
  const qualifiedPending = useRef(new Set<string>());
  const previousStudioAccount = useRef<string | null>(null);
  activeAccount.current = cloud.user?.id ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const busy = activeId ? generating[activeId] !== undefined : false;
  const selectedConversationAccount = useRef<string | null>(null);
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationType, setConversationType] = useState<ChatSection>("stories");
  const [chatListOpen, setChatListOpen] = useState(() => {
    try { return sessionStorage.getItem("xumeng-chat-list") !== "closed"; }
    catch { return true; }
  });
  function toggleChatList() {
    setChatListOpen(open => {
      const next = !open;
      try { sessionStorage.setItem("xumeng-chat-list", next ? "open" : "closed"); }
      catch { /* The list still toggles for this visit. */ }
      return next;
    });
  }
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionVariant, setCompanionVariant] = useState<CompanionVariant>("classic");
  const [customCompanion, setCustomCompanion] = useState<CompanionProfile | null>(null);
  const [castCompanion, setCastCompanion] = useState<GirlfriendCast | null>(null);
  const [mineId, setMineId] = useState<string | null>(null);
  const [girlfriends, setGirlfriends] = useState<GirlfriendPersona[]>([]);
  const [girlfriendsReady, setGirlfriendsReady] = useState(false);
  const companionWarmup = useRef(new Set<string>());
  const [wideChat, setWideChat] = useState(false);
  const [gameRequest, setGameRequest] = useState<(GamePlaySelection & {accountId: string}) | null>(null);
  const gameSelection = gameRequest?.accountId === cloud.user?.id ? gameRequest : null;
  const gameLibrary = useGamePlayLibrary(cloud.user?.id, cloud.user?.isGuest ?? true, view === "chat" || view === "characters" || view === "play-games", gameSelection);
  const gameLastPlayed = new Map(gameLibrary.recent.map(game => [game.id, game.updatedAt]));
  const visibleBuiltinGames = [...filterDzmmSearchRows([...XUMENG_BUILTIN_GAMES], conversationQuery, game => [game.title, game.synopsis, game.credit])];
  const visibleGames = [...filterDzmmSearchRows(gameLibrary.games, conversationQuery, game => [game.title, game.synopsis])]
    .sort((a, b) => (gameLastPlayed.get(b.id) ?? b.updatedAt) - (gameLastPlayed.get(a.id) ?? a.updatedAt));
  const chatInbox = useCompanionInbox(CONTENT_PEOPLE.map(companionLane), cloud.user && !cloud.user.isGuest ? cloud.user.id : null);
  const [storySeen, setStorySeen] = useState<Record<string, string>>({});
  const chatPeople = [...CONTENT_PEOPLE].sort((left, right) => (chatInbox.get(companionLane(right))?.at ?? 0) - (chatInbox.get(companionLane(left))?.at ?? 0))
    .filter(person => filterDzmmSearchRows([`${person.name} ${person.line} ${person.description} ${chatInbox.get(companionLane(person))?.preview || ""}`], conversationQuery, value => [value]).length > 0);


  const { drafts: composerDrafts, setDrafts: setComposerDrafts, warning: composerStorageWarning, originalCache: composerOriginalCache } = useDzmmComposerDrafts(cloud.user?.id ?? null);
  const suggestionSendLock = useRef(false);
  const suggestionRequests = useRef(new Set<AbortController>());
  const draft = activeId ? composerDrafts[activeId]?.text ?? "" : "";
  const pendingDraft = activeId ? composerDrafts[activeId]?.pending : undefined;
  function setDraft(text: string) {
    if (activeId) setComposerDrafts(previous => ({ ...previous, [activeId]: { ...previous[activeId], text, failed: previous[activeId]?.failed ?? [] } }));
  }
  function insertComposerSnippet(text: string, caret: number) {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? draft.length, end = input?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    if (next.length > 12000) { setNotice("输入已达上限，无法再插入。"); return; }
    setDraft(next);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + caret, start + caret); });
  }
  const summarizing = activeId ? generating[activeId] === "summary" : false;
  const [error, setError] = useState("");
  const [billingConfig, setBillingConfig] = useState<DzmmBillingConfig | null>(null);
  const [billingRefresh, setBillingRefresh] = useState(0);
  const [chatBalance, setChatBalance] = useState<number | null>(null);
  const [rechargeNeeded, setRechargeNeeded] = useState(false);
  const [rechargeMessage, setRechargeMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState<{ accountId: string | null; conversationId: string; messageId: string; original: string } | null>(null);
  const detailReturn = useRef<View>("characters");
  const detailReturnHash = useRef("characters");
  const detailDiscoveryOrigin = useRef<DzmmDiscoverySource | null>(null);
  const detailDiscoveryAccount = useRef<string | null>(null);
  const pendingDetailRoute = useRef<{ accountId: string | null; route: string } | null>(null);
  const lastResolvedRoute = useRef<{ accountId: string | null; route: string } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [discoveryFilters, setDiscoveryFilters] = useState<CatalogDiscoveryFilters>({ sort: "hot", time: "all", query: "" });
  const discoveryFiltersRef = useRef(discoveryFilters);
  discoveryFiltersRef.current = discoveryFilters;
  const [taskNavigation, setTaskNavigation] = useState<{ accountId: string; selection: DzmmTaskSelection } | null>(null);
  const taskSelection = cloud.user && taskNavigation?.accountId === cloud.user.id
    ? dzmmTaskSelectionForRole(taskNavigation.selection, cloud.user.role === "super") : defaultDzmmTaskSelection();
  const taskSelectionRef = useRef(taskSelection);
  taskSelectionRef.current = taskSelection;
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [resolvedCards, setResolvedCards] = useState<Character[]>([]);
  const [deferredQuery, setDeferredQuery] = useState("");
  const [deferredCategoryQuery, setDeferredCategoryQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredCategoryQuery(discoveryFilters.query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [discoveryFilters.query]);
  const rankQuery = useMemo((): XumengRecommendationQuery | null => {
    const withLook = (query: XumengRecommendationQuery): XumengRecommendationQuery => look ? { ...query, look } : query;
    if (view === "search") {
      if (!deferredQuery) return null;
      return withLook({ surface: "search", q: deferredQuery });
    }
    if (view !== "characters" && view !== "play-games") return null;
    const homeTags = selectedShelfTags(genres);
    if (tab === "新手" && sortMode === "recommended") return withLook(homeTags.length ? { surface: "home", tags: homeTags } : { surface: "home" });
    if (tab === "猜你喜欢" && sortMode === "recommended") return withLook({ surface: "for_you" });
    if (tab === "榜单" && (sortMode === "recommended" || sortMode === "heat" || sortMode === "likes")) return withLook({ surface: "ranking", period: rankingPeriod });
    if (tab === "分类" && category && discoveryFilters.sort === "hot") {
      const item = DZMM_DISCOVERY_CATEGORIES.find((entry) => entry.slug === category);
      if (!item) return null;
      const since = dzmmDiscoveryCutoff(discoveryFilters.time);
      return withLook({ surface: "category", tags: [...item.tags], ...(deferredCategoryQuery ? { q: deferredCategoryQuery } : {}), ...(since ? { since } : {}) });
    }
    return null;
  }, [view, deferredQuery, look, tab, sortMode, genres, rankingPeriod, category, discoveryFilters.sort, discoveryFilters.time, deferredCategoryQuery]);
  const rankKey = rankQuery ? JSON.stringify(rankQuery) : "";
  const canRank = loaded && !cloud.authBusy && Boolean(cloud.user?.id);
  const rankReady = canRank && Boolean(rankQuery) && recommendation.status === "ready" && recommendation.key === rankKey;
  const rankFailed = canRank && Boolean(rankQuery) && recommendation.status === "error" && recommendation.key === rankKey;
  const rankWaiting = canRank && Boolean(rankQuery) && !rankReady && !rankFailed;
  const displayRecommendationIds = useMemo(() => {
    if (!rankReady || rankQuery?.surface !== "home") return recommendation.ids;
    return shuffleHomeRecommendationIds(recommendation.ids, recommendEpoch);
  }, [rankReady, rankQuery?.surface, recommendation.ids, recommendEpoch]);
  const shelfRequest = useMemo((): DzmmCatalogRequest | null => {
    const authorKey = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
    const scoped = (request: DzmmCatalogRequest): DzmmCatalogRequest => look ? { ...request, look } : request;
    const rankedIds = rankReady ? displayRecommendationIds : null;
    if (view === "search") return rankedIds ? scoped({ ids: rankedIds, sort: "hot" }) : scoped({ q: deferredQuery, sort: "hot" });
    if (view === "author" && authorId && authorKey.test(authorId)) return scoped({ authorIds: [authorId], sort: "new" });
    if (view === "forum") return scoped({ sort: "hot" });
    if (view !== "characters" && view !== "play-games") return null;
    if (tab === "分类") {
      if (!category) return null;
      const item = DZMM_DISCOVERY_CATEGORIES.find((entry) => entry.slug === category);
      const since = dzmmDiscoveryCutoff(discoveryFilters.time);
      const sort = discoveryFilters.sort === "new" ? "new" : discoveryFilters.sort === "likes" ? "likes" : "hot";
      if (rankedIds && sort === "hot") return scoped({ ids: rankedIds, sort: "hot" });
      return scoped({ tags: item ? [...item.tags] : [], q: deferredCategoryQuery, sort, ...(since ? { since } : {}) });
    }
    const shelfTags = selectedShelfTags(genres);
    if (tab === "关注") {
      const authorIds = (state.preferences.followedAuthors ?? []).filter((id) => authorKey.test(id)).slice(0, 20);
      return authorIds.length ? scoped({ authorIds, sort: "new", tags: shelfTags }) : null;
    }
    if (tab === "榜单" && (sortMode === "recommended" || sortMode === "heat" || sortMode === "likes")) {
      if (!rankReady) return null;
      return scoped({ ids: recommendation.ids, sort: "hot", tags: shelfTags });
    }
    if ((tab === "新手" || tab === "猜你喜欢") && canRank && rankQuery && sortMode === "recommended") {
      if (!rankReady) return rankFailed ? scoped({ tags: shelfTags, sort: xumengPlayCatalogSort(tab, sortMode) }) : null;
      return scoped({ ids: recommendation.ids, sort: "hot", tags: shelfTags });
    }
    return scoped({ tags: selectedShelfTags(genres), sort: xumengPlayCatalogSort(tab, sortMode) });
  }, [view, deferredQuery, authorId, tab, category, discoveryFilters.sort, discoveryFilters.time, deferredCategoryQuery, state.preferences.followedAuthors, recommendation.status, recommendation.ids, recommendation.key, rankQuery, canRank, rankReady, rankFailed, sortMode, genres, look, displayRecommendationIds]);
  const publicShelf = usePublicCharacterShelf(shelfRequest);
  const rememberCharacter = (character: Character) => {
    setResolvedCards((previous) => {
      const index = previous.findIndex((item) => item.id === character.id);
      if (index < 0) return [character, ...previous].slice(0, 80);
      const next = previous.slice();
      next[index] = character;
      return next;
    });
  };
  async function playableArchive(character: Character): Promise<Character> {
    if (character.introductionDeferred) {
      const full = await dzmmDeferredIntroductionCharacter(character.id);
      if (!full || full.introductionDeferred) throw new Error("角色介绍暂时无法加载。");
      rememberCharacter(full);
      setDetail((current) => current?.id === full.id && current.introductionDeferred ? full : current);
      return full;
    }
    if (!character.contextDeferred) return character;
    const full = await dzmmDeferredContextCharacter(character);
    if (!full || full.contextDeferred) throw new Error("角色介绍暂时无法加载。");
    rememberCharacter(full);
    setDetail((current) => current?.id === full.id && current.contextDeferred ? full : current);
    return full;
  }
  const [forumPostId, setForumPostId] = useState<string | null>(null);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [performanceSelection, setPerformanceSelection] = useState<{ accountId: string; character: XumengPerformanceCharacter } | null>(null);
  useEffect(() => { if (view !== "live" && view !== "voice") setPerformanceSelection(null); }, [view]);
  useEffect(() => {
    if (view === "live") setLiveMode(requestedLiveMode.current);
    else setLiveMode("phone");
  }, [view]);
  useEffect(() => { if (view !== "chat") setGameRequest(null); }, [view]);
  const voiceBusy = useRef(false);
  const [systemDark, setSystemDark] = useState(false);
  const replyRequests = useRef(new Map<string, AbortController>());
  const anyReplyActive = () => replyRequests.current.size > 0;
  const activeReplyActive = () => Boolean(activeIdRef.current && replyRequests.current.has(activeIdRef.current));
  const appRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importChatRef = useRef<HTMLInputElement>(null);

  function writeDiscoveryHistory(route: string, filters = discoveryFiltersRef.current, origin?: DzmmDiscoverySource | null) {
    const accountId = activeAccount.current;
    if (!loaded || cloud.authBusy) return;
    const item = { version: 1, accountId, route, ...(route === "tasks" ? { taskSelection: taskSelectionRef.current }
      : dzmmDiscoveryRouteCategory(route) ? { filters } : origin ? { origin } : {}) };
    // Clear inherited anonymous origins on independent visits; only search details may persist.
    const snapshot = !accountId && origin?.kind !== "search" ? null : item;
    try { window.history.replaceState(mergeDzmmDiscoveryHistory(window.history.state, snapshot), ""); } catch { /* Discovery remains usable without a restorable entry. */ }
  }
  function saveCurrentDiscoveryHistory() {
    const route = location.hash.slice(1);
    if (dzmmDiscoveryRouteCategory(route) || route === "tasks") writeDiscoveryHistory(route);
  }
  function updateTaskSelection(accountId: string, selection: DzmmTaskSelection) {
    if (!loaded || cloud.authBusy || activeAccount.current !== accountId) return;
    const selected = dzmmTaskSelectionForRole(selection, cloud.user?.role === "super");
    taskSelectionRef.current = selected; setTaskNavigation({ accountId, selection: selected });
    if (location.hash === "#tasks") writeDiscoveryHistory("tasks");
  }
  function updateDiscoveryFilters(filters: CatalogDiscoveryFilters) {
    discoveryFiltersRef.current = filters; setDiscoveryFilters(filters);
    saveCurrentDiscoveryHistory();
  }
  function chooseDiscoveryCategory(slug: string | null) {
    const route = slug ? `category/${slug}` : "category";
    if (!dzmmDiscoveryRouteCategory(route)) return;
    saveCurrentDiscoveryHistory();
    const filters = { ...discoveryFiltersRef.current, query: "" };
    discoveryFiltersRef.current = filters; setDiscoveryFilters(filters); setCategory(slug);
    location.hash = route;
    writeDiscoveryHistory(route, filters);
  }
  function toggleBrowseTag(id: string) {
    if (appliedTags.includes(id)) {
      setAppliedTags(appliedTags.filter((item) => item !== id));
      return;
    }
    if (appliedTags.length >= BROWSE_TAG_LIMIT) {
      setNotice("最多选三个。");
      return;
    }
    setAppliedTags([...appliedTags, id]);
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setWideChat(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const dark = state.preferences.theme === "system" ? systemDark : state.preferences.theme ? state.preferences.theme === "dark" : state.preferences.dark;
  const locale = routeLocale ?? state.preferences.locale ?? XUMENG_DEFAULT_LOCALE;
  const t = (key: XumengMessageKey) => xumengTranslate(locale, key);
  const localizedNav = NAV.map(item => ({ ...item, label: t(item.labelKey) }));
  const localizedTools = NAV_TOOLS.map(item => ({ ...item, label: t(item.labelKey) }));
  const localizedAdmin = { view: "admin" as const, label: t("navAdmin"), icon: "sliders" as const };
  useEffect(() => {
    document.documentElement.lang = xumengHtmlLang(locale);
    const pathname = window.location.pathname;
    const nextPath = xumengLocalePathname(pathname, locale);
    if (nextPath !== pathname) window.history.replaceState(window.history.state, "", `${nextPath}${window.location.search}${window.location.hash}`);
  }, [locale]);
  useEffect(() => {
    let active = true;
    void loadXumengCardTranslations(locale).then((loaded) => {
      if (active && loaded) setCardTranslationRevision((revision) => revision + 1);
    });
    return () => { active = false; };
  }, [locale]);
  const invitePrompted = useRef(false);
  useEffect(() => {
    const stored = parseStoredAcquisition(window.sessionStorage.getItem(ACQUISITION_STORAGE_KEY));
    const incoming = readAcquisitionLanding({ pathname: window.location.pathname, search: window.location.search });
    const landing = stored ?? incoming;
    if (incoming && !stored) window.sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(incoming));
    if (landing?.inviteCode) setPendingInvite(landing.inviteCode);
    if (!incoming) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("invite");
    params.delete("from");
    params.delete("poster");
    const next = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`);
  }, []);
  useEffect(() => {
    if (!pendingInvite || !loaded || cloud.authBusy || invitePrompted.current || !cloud.user?.isGuest) return;
    invitePrompted.current = true;
    setAccountMode("register");
  }, [pendingInvite, loaded, cloud.authBusy, cloud.user?.isGuest]);
  useEffect(() => {
    if (!loaded || cloud.authBusy || routeLocale || state.preferences.locale) return;
    let active = true;
    const apply = (detected: XumengLocale | null) => {
      if (!active || !detected || detected === "zh-Hans") return;
      setState(previous => previous.preferences.locale ? previous : { ...previous, preferences: { ...previous.preferences, locale: detected } });
    };
    void fetch("/api/dzmm/region", { cache: "no-store" }).then(async response => {
      if (!response.ok) return null;
      const payload = await response.json() as { locale?: unknown };
      return typeof payload.locale === "string" ? resolveXumengLocale(payload.locale) : null;
    }).catch(() => null).then(detected => {
      if (detected) apply(detected);
      else if (typeof navigator !== "undefined") apply(resolveXumengLocale(undefined, navigator.languages));
    });
    return () => { active = false; };
  }, [loaded, cloud.authBusy, routeLocale, state.preferences.locale, setState]);
  useEffect(() => {
    if (!loaded || cloud.authBusy || !routeLocale || state.preferences.locale === routeLocale) return;
    setState(previous => previous.preferences.locale === routeLocale ? previous : { ...previous, preferences: { ...previous.preferences, locale: routeLocale } });
  }, [loaded, cloud.authBusy, routeLocale, state.preferences.locale, setState]);
  const profileUser = cloud.user ?? { id: "offline", nickname: state.preferences.nickname, isGuest: true, role: "user" };
  const playUserName = state.preferences.nickname.trim() || cloud.user?.nickname.trim() || "";
  const likedForCurrentAccount = loaded && !cloud.authBusy
    ? Object.entries(likeStats).filter(([, stat]) => stat.liked).map(([id]) => id)
    : [];
  useEffect(() => () => {
    for (const controller of likeRequests.current) controller.abort();
    likeRequests.current.clear();
    likeInflight.current.clear();
  }, []);
  useEffect(() => {
    if (!loaded || cloud.authBusy || !cloud.user?.id) {
      for (const controller of likeRequests.current) controller.abort();
      likeRequests.current.clear();
      likeInflight.current.clear();
      likeOwner.current = null;
      likeStatsRef.current = {};
      setLikeStats({});
      return;
    }
    const owner = cloud.user.id;
    if (likeOwner.current !== owner) {
      for (const controller of likeRequests.current) controller.abort();
      likeRequests.current.clear();
      likeInflight.current.clear();
      likeOwner.current = owner;
      likeStatsRef.current = {};
      setLikeStats({});
    }
    const ids = [...new Set([...cloud.catalog, ...publicShelf.characters]
      .filter((character) => character.sourceKind === "public-summary" || character.publication)
      .map((character) => character.id))];
    const missing = ids.filter((id) => likeStatsRef.current[id] === undefined && !likeInflight.current.has(id));
    if (!missing.length) return;
    const controller = new AbortController();
    likeRequests.current.add(controller);
    for (const id of missing) likeInflight.current.add(id);
    void (async () => {
      try {
        for (let index = 0; index < missing.length; index += 100) {
          const batch = await fetchDzmmLikeStats(missing.slice(index, index + 100), controller.signal);
          if (controller.signal.aborted || likeOwner.current !== owner) return;
          setLikeStats((previous) => {
            const next = { ...previous, ...batch };
            likeStatsRef.current = next;
            return next;
          });
        }
      } catch (failure) {
        if (!controller.signal.aborted) setNotice(failure instanceof Error ? failure.message : "点赞状态暂时无法读取。请稍后重试。");
      } finally {
        likeRequests.current.delete(controller);
        if (likeOwner.current === owner) {
          for (const id of missing) likeInflight.current.delete(id);
        }
      }
    })();
  }, [cloud.catalog, publicShelf.characters, cloud.authBusy, cloud.user?.id, loaded]);
  const authors = useMemo(() => {
    const community = new Map<string, DzmmAuthor>();
    for (const card of [...cloud.catalog, ...publicShelf.characters]) {
      if (!card.publication) continue;
      const author = community.get(card.publication.authorId) ?? { id: card.publication.authorId, name: card.author, sourceUrl: "", characterIds: [] };
      if (!author.characterIds.includes(card.id)) author.characterIds.push(card.id);
      community.set(author.id, author);
    }
    const sourceAuthors = AUTHORS.map(author => ({ ...author, characterIds: author.characterIds.filter(id => isDzmmListedCharacter({ id })) }))
      .filter(author => author.characterIds.length > 0);
    return [...sourceAuthors, ...community.values()];
  }, [cloud.catalog, publicShelf.characters]);
  const authorHold = useRef<DzmmAuthor | null>(null);
  const authorRecord = authors.find((author) => author.id === authorId) ?? null;
  if (authorRecord) authorHold.current = authorRecord;
  else if (authorHold.current?.id !== authorId) authorHold.current = null;
  const selectedAuthor = authorRecord ?? authorHold.current;
  function savePreferences(preferences: Preferences) {
    setRouteLocale(preferences.locale && preferences.locale !== XUMENG_DEFAULT_LOCALE ? preferences.locale : null);
    setState((previous) => ({ ...previous, preferences }));
  }
  const studioCharacterId = view === "studio-edit" && editor && editor !== "new" ? editor.id : null;
  const studioAccountId = cloud.user?.id;
  const studioAccountIsGuest = cloud.user?.isGuest;
  useEffect(() => {
    const generation = ++studioSubmissionGeneration.current;
    setStudioSubmission(null);
    if (!studioCharacterId || !studioAccountId || studioAccountIsGuest) return;
    let cancelled = false;
    const accountId = studioAccountId;
    const current = () => !cancelled && generation === studioSubmissionGeneration.current && accountId === activeAccount.current;
    async function loadSubmission() {
      let offset = 0;
      for (;;) {
        const page = await fetchDzmmPublishingMine(offset);
        if (!current()) return;
        const publication = page.publications.find(item => item.privateCharacterId === studioCharacterId);
        if (publication) { setStudioSubmission({ status: publication.latestSubmission.status, reason: publication.latestSubmission.reason }); return; }
        if (!page.hasMore) return;
        const nextOffset = page.offset + page.publications.length;
        if (nextOffset <= offset) throw new Error("发布记录分页无效。");
        offset = nextOffset;
      }
    }
    void loadSubmission().catch(() => {
      if (current()) setNotice("审核状态暂时无法读取，草稿可以继续编辑。");
    });
    return () => { cancelled = true; };
  }, [studioCharacterId, studioAccountId, studioAccountIsGuest]);

  useEffect(() => {
    const backgroundRequests = suggestionRequests.current;
    const replies = replyRequests.current;
    return () => {
      for (const abort of replies.values()) abort.abort();
      for (const abort of backgroundRequests) abort.abort();
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    fetchDzmmBillingConfig(abort.signal).then(setBillingConfig).catch(() => {
      if (!abort.signal.aborted) setBillingConfig(null);
    });
    return () => abort.abort();
  }, [view]);

  useEffect(() => {
    if (!loaded || cloud.authBusy) return;
    const accountId = cloud.user?.id ?? "offline";
    const firstLoad = selectedConversationAccount.current !== accountId;
    selectedConversationAccount.current = accountId;
    setActiveId((previous) => firstLoad ? state.conversations[0]?.id ?? null
      : state.conversations.some((conversation) => conversation.id === previous) ? previous : null);
  }, [state.conversations, loaded, cloud.user?.id, cloud.authBusy]);
  useEffect(() => { setEditingMessage(null); }, [activeId, cloud.user?.id, view]);
  useEffect(() => { setError(""); setRechargeNeeded(false); }, [activeId, cloud.user?.id]);
  useEffect(() => {
    const previous = previousStudioAccount.current;
    previousStudioAccount.current = cloud.user?.id ?? null;
    if (previous !== (cloud.user?.id ?? null)) setTaskNavigation(null);
    if (previous === null || previous === (cloud.user?.id ?? null)) return;
    setDetail(null);
    detailReturn.current = "characters"; detailReturnHash.current = "characters";
    detailDiscoveryOrigin.current = null; detailDiscoveryAccount.current = null; pendingDetailRoute.current = null;
    const filters: CatalogDiscoveryFilters = { sort: "hot", time: "all", query: "" };
    discoveryFiltersRef.current = filters; setDiscoveryFilters(filters);
    setEditor(null);
    studioDirty.current = false; studioBusy.current = false; studioRoute.current = "";
    novelDirty.current = false; novelBusy.current = false;
    creatorDirty.current = false; creatorBusy.current = false; creatorRoute.current = ""; setCreatorInitial({}); setNovelInitial({});
    liveBusy.current = false;
    if (location.hash.startsWith("#studio/")) { setView("studio"); location.hash = "studio"; }
    if (location.hash.startsWith("#novels/")) { setView("novels"); novelRoute.current = "novels"; location.hash = "novels"; }
    setChatSettingsOpen(false);
    setConversationQuery("");
    suggestionSendLock.current = false;
    for (const abort of suggestionRequests.current) abort.abort();
    for (const abort of replyRequests.current.values()) abort.abort();
    setError("");
  }, [cloud.user?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const detailId = detail?.id;
  const detailIsPublic = Boolean(detail?.publication) || Boolean(detail && isDzmmListPreview(detail));
  useEffect(() => {
    if (!detailId || !detailIsPublic) return;
    const targetId = detailId;
    let stopped = false;
    let request: AbortController | null = null;
    const refresh = async () => {
      request?.abort();
      request = new AbortController();
      try {
        const [fresh, stats] = await Promise.all([
          fetchDzmmPublicCharacter(targetId, request.signal),
          cloud.user?.id ? fetchDzmmLikeStats([targetId], request.signal) : Promise.resolve<DzmmLikeStats>({}),
        ]);
        if (stopped) return;
        rememberCharacter(fresh);
        setDetail(current => current?.id === targetId ? fresh : current);
        const stat = stats[targetId];
        if (stat) setLikeStats(current => ({ ...current, [targetId]: stat }));
      } catch { /* A transient refresh failure leaves the last visible values intact. */ }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 20_000);
    return () => { stopped = true; request?.abort(); window.clearInterval(timer); };
  }, [detailId, detailIsPublic, cloud.user?.id]);
  const characters = useMemo(
    () => {
      const resolvedById = new Map(resolvedCards.map((card) => [card.id, card]));
      const shared = cloud.catalog.map((card) => {
        const resolved = resolvedById.get(card.id);
        return resolved && card.listPreview && !resolved.listPreview ? resolved : card;
      });
      const known = new Set(shared.map((card) => card.id));
      const extras = resolvedCards.filter((card) => !known.has(card.id));
      return selectDzmmDirectory(state.custom, [...shared, ...extras].map(withDzmmPublicOpening), new Set(cloud.suppressedPrivateIds)).map((character) => ({
        ...character,
        likes: formatLikeTotal(character, likeStats[character.id]),
      }));
    },
    [state.custom, cloud.catalog, resolvedCards, cloud.suppressedPrivateIds, likeStats],
  );
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  const [pendingCharacterIds, setPendingCharacterIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingCharacterIdsRef = useRef(pendingCharacterIds);
  pendingCharacterIdsRef.current = pendingCharacterIds;
  const publishedCharacterKey = useMemo(() => {
    const ids = new Set<string>();
    const linked = linkedPublishedCharacterId();
    if (linked) ids.add(linked);
    for (const conversation of state.conversations) if (isDzmmPublishedCharacterId(conversation.characterId)) ids.add(conversation.characterId);
    for (const id of state.favorites) if (isDzmmPublishedCharacterId(id)) ids.add(id);
    return [...ids].sort().join("\n");
  }, [state.conversations, state.favorites]);
  useLayoutEffect(() => {
    if (!loaded || !publishedCharacterKey) return;
    const ids = publishedCharacterKey.split("\n");
    const missing = ids.filter((id) => !resolvedAttempt.current.has(id) && !charactersRef.current.some((character) => character.id === id && !isDzmmListPreview(character)));
    if (!missing.length) return;
    setPendingCharacterIds((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const id of missing) if (!next.has(id)) { next.add(id); changed = true; }
      return changed ? next : previous;
    });
    const controller = new AbortController();
    let stopped = false;
    const settle = (id: string) => {
      if (stopped) return;
      setPendingCharacterIds((previous) => {
        if (!previous.has(id)) return previous;
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    };
    void loadMissingPublishedCharacters({
      ids: missing,
      hasFullCard: (id) => charactersRef.current.some((character) => character.id === id && !isDzmmListPreview(character)),
      attempted: resolvedAttempt.current,
      signal: controller.signal,
      isStopped: () => stopped,
      load: (id) => fetchDzmmPublicCharacter(id, controller.signal),
      remember: (character) => { if (!stopped) rememberCharacter(character); },
      onSettled: settle,
    });
    return () => {
      stopped = true;
      controller.abort();
      setPendingCharacterIds((previous) => {
        if (!missing.some((id) => previous.has(id))) return previous;
        const next = new Set(previous);
        for (const id of missing) next.delete(id);
        return next;
      });
    };
  }, [loaded, publishedCharacterKey]);
  const serverSurface = rankQuery?.surface ?? null;
  const usesServerRank = rankQuery !== null;
  const hiddenIds = useMemo(() => new Set([...localHidden, ...recommendation.hiddenIds, ...relatedRank.hiddenIds]), [localHidden, recommendation.hiddenIds, relatedRank.hiddenIds]);
  useEffect(() => { setLocalHidden([]); setInviteCode(null); setRecommendation({ status: "idle", key: "", ids: [], reasons: {}, personalized: false, hiddenIds: [] }); impressed.current.clear(); qualifiedSent.current.clear(); qualifiedPending.current.clear(); }, [cloud.user?.id]);
  useEffect(() => {
    if (!loaded || cloud.authBusy || !cloud.user || cloud.user.isGuest) return;
    const owner = cloud.user.id;
    const controller = new AbortController();
    void fetchDzmmReferral().then((info) => {
      if (!controller.signal.aborted && info.accountId === owner) setInviteCode(info.inviteCode);
    }, () => undefined);
    return () => controller.abort();
  }, [loaded, cloud.authBusy, cloud.user]);
  useEffect(() => {
    if (!loaded || !cloud.user?.id) return;
    const landing = parseStoredAcquisition(window.sessionStorage.getItem(ACQUISITION_STORAGE_KEY));
    if (!landing) return;
    const sentKey = `${ACQUISITION_STORAGE_KEY}:${cloud.user.id}`;
    if (window.sessionStorage.getItem(sentKey)) return;
    window.sessionStorage.setItem(sentKey, "1");
    void recordXumengAcquisition(landing).then((ok) => { if (!ok) window.sessionStorage.removeItem(sentKey); });
  }, [loaded, cloud.user?.id]);
  useEffect(() => {
    if (!rankQuery || !cloud.user?.id) return;
    const key = rankKey;
    const query = rankQuery;
    const controller = new AbortController();
    setRecommendation((current) => ({ ...current, key, status: "loading" }));
    void fetchXumengRecommendations(query, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setRecommendation({ key, status: "ready", ...page });
    }, (error: unknown) => {
      if (controller.signal.aborted || recommendationRequestAborted(error)) return;
      setRecommendation((current) => ({ status: "error", key, ids: [], reasons: {}, personalized: false, hiddenIds: current.hiddenIds }));
    });
    return () => controller.abort();
  }, [rankQuery, rankKey, cloud.user?.id, recommendEpoch]);
  useEffect(() => {
    if (!detail || !cloud.user?.id || !isPublicRecommendationCharacter(detail)) {
      setRelatedRank({ status: "idle", ids: [], reasons: {}, personalized: false, hiddenIds: [] });
      return;
    }
    const controller = new AbortController();
    setRelatedRank((current) => ({ ...current, status: "loading", ids: [] }));
    void fetchXumengRecommendations({ surface: "related", seed: detail.id }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setRelatedRank({ status: "ready", ...page });
    }, (error: unknown) => {
      if (controller.signal.aborted || recommendationRequestAborted(error)) return;
      setRelatedRank({ status: "error", ids: [], reasons: {}, personalized: false, hiddenIds: [] });
    });
    return () => controller.abort();
  }, [detail, cloud.user?.id, recommendEpoch]);
  useEffect(() => {
    const accountId = cloud.user?.id;
    if (!loaded || !accountId) return;
    const totals = new Map<string, number>();
    for (const conversation of state.conversations) {
      const turns = conversation.messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
      if (turns) totals.set(conversation.characterId, (totals.get(conversation.characterId) ?? 0) + turns);
    }
    for (const [characterId, turns] of totals) {
      const key = `${accountId}:${characterId}`;
      if (turns < QUALIFIED_USER_MESSAGES || qualifiedSent.current.has(key) || qualifiedPending.current.has(key)) continue;
      const character = characters.find((item) => item.id === characterId);
      if (!character || !isPublicRecommendationCharacter(character)) continue;
      qualifiedPending.current.add(key);
      void recordXumengRecommendationEvents([{ characterId, surface: "home", action: "depth" }]).then((accepted) => {
        qualifiedPending.current.delete(key);
        if (accepted >= 1) qualifiedSent.current.add(key);
      });
    }
  }, [loaded, cloud.user?.id, state.conversations, characters]);
  const conversationCharacters = useMemo(() => mergeDzmmConversationCharacters(characters), [characters]);
  const visibleConversations = useMemo(() => filterDzmmConversations(state.conversations, conversationCharacters, conversationQuery),
    [state.conversations, conversationCharacters, conversationQuery]);
  const active = state.conversations.find((c) => c.id === activeId);
  useEffect(() => {
    setStorySeen(previous => {
      let changed = false;
      const next = { ...previous };
      for (const conversation of state.conversations) {
        if (next[conversation.id]) continue;
        let seen = "";
        try { seen = localStorage.getItem(`xumeng-story-seen:${conversation.id}`) || ""; } catch { /* Private mode still opens the list. */ }
        if (!seen) {
          seen = conversation.messages.at(-1)?.id || "";
          if (seen) try { localStorage.setItem(`xumeng-story-seen:${conversation.id}`, seen); } catch { /* The badge can wait. */ }
        }
        if (seen) { next[conversation.id] = seen; changed = true; }
      }
      return changed ? next : previous;
    });
  }, [state.conversations]);
  useEffect(() => {
    const last = active?.messages.at(-1);
    if (!active || !last) return;
    try { localStorage.setItem(`xumeng-story-seen:${active.id}`, last.id); } catch { /* The open story is already on screen. */ }
    setStorySeen(previous => previous[active.id] === last.id ? previous : { ...previous, [active.id]: last.id });
  }, [active]);
  const activeCharacter = conversationCharacters.find((c) => c.id === active?.characterId);
  useEffect(() => {
    if (view !== "chat" || !activeCharacter?.listPreview || !isXumengPinnedCard(activeCharacter)) return;
    const requestedId = activeCharacter.id;
    let cancelled = false;
    void dzmmBundledPlayableCharacter(requestedId).then((full) => {
      if (!cancelled && full && !full.listPreview) rememberCharacter(full);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [view, activeCharacter]);
  useEffect(() => {
    if (!detail?.listPreview || !isXumengPinnedCard(detail)) return;
    const requestedId = detail.id;
    let cancelled = false;
    void dzmmBundledPlayableCharacter(requestedId).then((full) => {
      if (cancelled || !full || full.listPreview) return;
      rememberCharacter(full);
      setDetail((current) => current?.id === requestedId && current.listPreview ? full : current);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [detail]);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const load = () => {
      const ids = new Set<string>();
      for (const conversation of state.conversations) {
        if (isDzmmDeferredIntroductionId(conversation.characterId)) ids.add(conversation.characterId);
      }
      for (const id of state.favorites) if (isDzmmDeferredIntroductionId(id)) ids.add(id);
      const pathId = characterLinkId(window.location.pathname);
      if (pathId && isDzmmDeferredIntroductionId(pathId)) ids.add(pathId);
      const hash = window.location.hash.startsWith("#character/") ? window.location.hash.slice("#character/".length) : "";
      let routeId = hash;
      try { routeId = hash ? decodeURIComponent(hash) : ""; } catch { routeId = ""; }
      if (routeId && isDzmmDeferredIntroductionId(routeId)) ids.add(routeId);
      const missing = [...ids].filter((id) => !charactersRef.current.some((character) => character.id === id));
      if (!missing.length) return;
      void loadDzmmPublicIntroductionShelf().then((loadedShelf) => {
        if (cancelled) return;
        for (const id of missing) {
          const character = loadedShelf.dzmmPublicIntroductionShelfCharacter(id);
          if (character) rememberCharacter(character);
        }
      }).catch(() => undefined);
    };
    load();
    window.addEventListener("hashchange", load);
    window.addEventListener("popstate", load);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", load);
      window.removeEventListener("popstate", load);
    };
  }, [loaded, state.conversations, state.favorites]);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const load = () => {
      const ids = new Set<string>();
      for (const conversation of state.conversations) {
        if (isDzmmDeferredAiArchiveId(conversation.characterId)) ids.add(conversation.characterId);
      }
      for (const id of state.favorites) if (isDzmmDeferredAiArchiveId(id)) ids.add(id);
      const pathId = characterLinkId(window.location.pathname);
      if (pathId && isDzmmDeferredAiArchiveId(pathId)) ids.add(pathId);
      const hash = window.location.hash.startsWith("#character/") ? window.location.hash.slice("#character/".length) : "";
      let routeId = hash;
      try { routeId = hash ? decodeURIComponent(hash) : ""; } catch { routeId = ""; }
      if (routeId && isDzmmDeferredAiArchiveId(routeId)) ids.add(routeId);
      const missing = [...ids].filter((id) => !charactersRef.current.some((character) => character.id === id));
      if (!missing.length) return;
      void loadDzmmAiCharacters().then((loadedArchive) => {
        if (cancelled) return;
        for (const id of missing) {
          const character = loadedArchive.dzmmAiArchiveCharacter(id);
          if (character) rememberCharacter(character);
        }
      }).catch(() => undefined);
    };
    load();
    window.addEventListener("hashchange", load);
    window.addEventListener("popstate", load);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", load);
      window.removeEventListener("popstate", load);
    };
  }, [loaded, state.conversations, state.favorites]);
  useEffect(() => {
    if (view !== "chat" || !activeCharacter?.introductionDeferred) return;
    const requestedId = activeCharacter.id;
    let cancelled = false;
    void dzmmDeferredIntroductionCharacter(requestedId).then((full) => {
      if (!cancelled && full && !full.introductionDeferred) rememberCharacter(full);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [view, activeCharacter]);
  useEffect(() => {
    if (!detail?.introductionDeferred) return;
    const requestedId = detail.id;
    let cancelled = false;
    void dzmmDeferredIntroductionCharacter(requestedId).then((full) => {
      if (cancelled || !full || full.introductionDeferred) return;
      rememberCharacter(full);
      setDetail((current) => current?.id === requestedId && current.introductionDeferred ? full : current);
    }).catch(() => {
      if (!cancelled) setNotice("角色介绍暂时无法加载。");
    });
    return () => { cancelled = true; };
  }, [detail]);
  useEffect(() => {
    if (view !== "chat" || !activeCharacter?.contextDeferred) return;
    const requestedId = activeCharacter.id;
    let cancelled = false;
    void dzmmDeferredContextCharacter(activeCharacter).then((full) => {
      if (!cancelled && full && !full.contextDeferred && full.id === requestedId) rememberCharacter(full);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [view, activeCharacter]);
  useEffect(() => {
    if (!detail?.contextDeferred) return;
    const requestedId = detail.id;
    let cancelled = false;
    void dzmmDeferredContextCharacter(detail).then((full) => {
      if (cancelled || !full || full.contextDeferred || full.id !== requestedId) return;
      rememberCharacter(full);
      setDetail((current) => current?.id === requestedId && current.contextDeferred ? full : current);
    }).catch(() => {
      if (!cancelled) setNotice("角色介绍暂时无法加载。");
    });
    return () => { cancelled = true; };
  }, [detail]);
  const [playChrome, setPlayChrome] = useState<Record<string, { interactionTemplate?: Character["interactionTemplate"]; statusBar?: Character["statusBar"] }>>({});
  useEffect(() => {
    const id = view === "chat" ? activeCharacter?.id : "";
    if (!id || !activeCharacter?.publication || activeCharacter.interactionTemplate || activeCharacter.statusBar || playChrome[id]) return;
    let cancelled = false;
    void fetchDzmmPlayMaterials(id).then(play => {
      if (!cancelled) setPlayChrome(current => ({ ...current, [id]: { interactionTemplate: play.interactionTemplate, statusBar: play.statusBar } }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [view, activeCharacter?.id, activeCharacter?.publication, activeCharacter?.interactionTemplate, activeCharacter?.statusBar, playChrome]);
  const panelTemplate = activeCharacter?.interactionTemplate ?? playChrome[activeCharacter?.id ?? ""]?.interactionTemplate;
  const panelState = useMemo(() => panelTemplate && active ? currentXumengPanelState(panelTemplate, active.messages) : null, [panelTemplate, active]);
  const statusBar = activeCharacter?.statusBar ?? playChrome[activeCharacter?.id ?? ""]?.statusBar;
  const statusBarLabels = useMemo(() => statusBar ? xumengStatusBarLabels(statusBar) : [], [statusBar]);
  const momentSections = useMemo((): MomentSection[] => {
    if (panelTemplate && panelState) return panelTemplate.panels.map(panel => ({
      title: panel.title,
      fields: panel.fields.map(field => ({
        key: `${panel.id}:${field.name}`,
        label: field.name,
        type: field.type,
        value: panelState.panels[panel.title]?.[field.name] ?? field.initial,
      })),
    }));
    if (statusBar) return xumengStatusBarSections(statusBar, active?.messages ?? []);
    return [];
  }, [panelTemplate, panelState, statusBar, active?.messages]);
  const momentFields = momentSections.flatMap(section => section.fields);
  const momentMessageId = [...(active?.messages ?? [])].reverse().find(message => message.role === "assistant" && message.content.trim())?.id;
  useEffect(() => {
    if (!activeId || activeCharacter) return;
    setChatSettingsOpen(false);
    setEditingMessage(null);
    if (active?.characterId && pendingCharacterIdsRef.current.has(active.characterId)) return;
    if (activeReplyActive()) {
      replyRequests.current.get(activeId)?.abort();
      setNotice("角色暂不可用，已停止当前回复并保留收到的内容。");
    }
    for (const abort of suggestionRequests.current) abort.abort();
  }, [activeId, activeCharacter, active?.characterId]);
  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    // Restored drafts and inserted suggestions do not fire an input change event.
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft, activeId, activeCharacter, view, detail]);
  const activeOpening = useMemo(() => activeCharacter && active ? resolveDzmmConversationOpening(activeCharacter, active) : null, [activeCharacter, active]);
  const activePersona = resolveDzmmConversationPersona(state.preferences, active?.id);
  const coarsePointer = useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, () => false);
  const enterSends = dzmmEnterSends(state.preferences, coarsePointer);
  const chatBusy = busy;
  const replySuggestionKeys = useMemo(() => {
    if (!active) return [];
    const prefixes = dzmmReplySuggestionPrefixKeys(active.messages);
    const world = pruneDzmmWorldJournal(active.worldState, active.messages);
    const memory = matchesDzmmStoryMemory(active.storyMemory, active.messages) ? active.storyMemory : undefined;
    const settings = dzmmReplySuggestionSettingsKey([DZMM_REPLY_SUGGESTIONS_PROMPT_VERSION, activeCharacter, activeOpening,
      state.preferences.preset, activePersona, state.preferences.nickname, state.preferences.locale]);
    return active.messages.map((message, index) => {
      if (message.role !== "assistant") return prefixes[index];
      // Later world/summary updates must not invalidate earlier cached options.
      const snapshot = world?.snapshots.filter(item => item.sourceCount <= index + 1).at(-1);
      const context = dzmmReplySuggestionSettingsKey([snapshot, memory && memory.sourceCount <= index + 1 ? memory : undefined]);
      return `${prefixes[index]}:${settings}:${context}`;
    });
  }, [active, activeCharacter, activeOpening, state.preferences.preset, activePersona, state.preferences.nickname, state.preferences.locale]);
  useEffect(() => {
    if (!loaded || cloud.authBusy || anyReplyActive()) return;
    setState(previous => {
      const conversations = restoreDzmmConversationContexts(previous.conversations, characters);
      return conversations === previous.conversations ? previous : { ...previous, conversations };
    });
  }, [characters, state.conversations, loaded, cloud.authBusy, cloud.user?.id, busy, setState]);
  useEffect(() => {
    const hasOnlyOpening = active && activeOpening && active.messages.length <= activeOpening.messages.length
      && active.messages.every((message, index) => message.role === activeOpening.messages[index]?.role
        && message.content.trim() === activeOpening.messages[index]?.content.trim());
    const scroller = messageScrollRef.current;
    if (!scroller) return;
    if (!chatBusy && active && (!active.messages.some(message => message.role === "user") || hasOnlyOpening)) {
      scroller.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: chatBusy ? "instant" : "smooth" });
  }, [active, activeOpening, chatBusy, view, detail]);
  useEffect(() => {
    // Only people who have chatted before are prewarmed; a shared pool slot is
    // not spent on every visitor who merely opens the chat list.
    if (!loaded || cloud.authBusy || !cloud.user || cloud.user.isGuest || conversationType !== "chats") return;
    for (const variant of ["classic", "intimate", "sales"] as const) {
      try { if (localStorage.getItem(`xumeng-companion-cache:${variant}`)) warmCompanion(variant); } catch { /* Storage can be blocked. */ }
    }
    for (const person of GIRLFRIEND_CAST) {
      try { if (localStorage.getItem(`xumeng-companion-cache:cast-${person.id}`)) warmCompanion("cast", person.id); } catch { /* Storage can be blocked. */ }
    }
  }, [loaded, cloud.authBusy, cloud.user, conversationType]);
  useEffect(() => {
    const accountId = cloud.user && !cloud.user.isGuest ? cloud.user.id : "";
    if (!accountId) { setGirlfriends([]); setGirlfriendsReady(true); return; }
    let alive = true;
    setGirlfriendsReady(false);
    void listGirlfriends(accountId).then(people => { if (!alive) return; setGirlfriends(people); setGirlfriendsReady(true); }).catch(() => { if (!alive) return; setGirlfriends([]); setGirlfriendsReady(true); });
    return () => { alive = false; };
  }, [cloud.user]);

  useEffect(() => {
    const accountId = cloud.user?.id ?? null;
    if (!loaded || cloud.authBusy) return;
    const readHash = (event?: Event) => {
      const pathId = characterLinkId(location.pathname);
      const hashTarget = location.hash.slice(1);
      if (pathId && hashTarget && hashTarget !== `character/${pathId}`) {
        window.history.replaceState(window.history.state, "", `/${hashTarget ? `#${hashTarget}` : ""}`);
      } else if (pathId && hashTarget === `character/${pathId}`) {
        window.history.replaceState(window.history.state, "", `/c/${pathId}`);
      }
      const target = pathId && (!hashTarget || hashTarget === `character/${pathId}`) ? `character/${pathId}` : hashTarget;
      if (voiceBusy.current && target !== "voice") { setNotice("语音正在生成，请等待完成后离开。"); location.hash = "voice"; return; }
      if (liveRouteActive.current && target !== "live" && liveBusy.current) {
        setNotice("请先在实时影像工作台结束当前会话，再离开页面。");
        location.hash = "live"; return;
      }
      if (creatorRoute.current && target !== creatorRoute.current && (creatorDirty.current || creatorBusy.current)) {
        setNotice(creatorBusy.current ? "创作操作正在处理，请稍候。" : "有未保存的修改，请先在工作台保存或放弃修改。");
        location.hash = creatorRoute.current; return;
      }
      if (novelRouteActive.current && target !== novelRoute.current && (novelDirty.current || novelBusy.current)) {
        setNotice(novelBusy.current ? "请先完成或停止小说创作操作。" : "小说有未保存的修改，请先在工作台保存或放弃修改。");
        location.hash = novelRoute.current; return;
      }
      if (studioRoute.current && target !== studioRoute.current && (studioDirty.current || studioBusy.current)) {
        setNotice(studioBusy.current ? "请等待当前创作操作完成。" : "有未保存的修改，请先在工作台保存或放弃修改。");
        location.hash = studioRoute.current;
        return;
      }
      if (anyReplyActive() && target !== "chat") { setNotice("请先停止当前回复，再离开聊天。"); if (target.startsWith("chat/")) window.history.replaceState(null, "", "#chat"); return; }
      // Catalog/state updates rerun this effect; only a new route/account or actual traversal restores input.
      const restoreHistory = Boolean(event) || lastResolvedRoute.current?.accountId !== accountId || lastResolvedRoute.current?.route !== target;
      if (isGirlfriendRoute(target)) {
        if (cloud.user?.isGuest) {
          setCompanionOpen(false);
          setConversationType("chats");
          setGameRequest(null); setActiveId(null); setDetail(null); setView("chat");
          openAccount("login");
          if (location.hash !== "#chat/chats") location.hash = "chat/chats";
          return;
        }
        setConversationType("chats");
        setCompanionOpen(true);
        if (target.startsWith("chat/girlfriend-mine/")) {
          let id = "";
          try { id = decodeURIComponent(target.slice("chat/girlfriend-mine/".length)); } catch { setNotice("这个女友还没准备好。"); return; }
          if (!id) { setNotice("这个女友还没准备好。"); return; }
          setMineId(id);
          setCompanionVariant("custom");
        } else if (target.startsWith("chat/girlfriend-custom/")) {
          setMineId(null);
          setCustomCompanion(REALISTIC_COMPANION_PROFILES.find(profile => profile.id === target.slice("chat/girlfriend-custom/".length)) || REALISTIC_COMPANION_PROFILES[0]);
          setCompanionVariant("custom");
        } else if (target.startsWith("chat/girlfriend-cast/")) {
          const person = girlfriendCastById(target.slice("chat/girlfriend-cast/".length));
          if (!person) { setNotice("这个女友还没准备好。"); return; }
          setCastCompanion(person);
          setMineId(null);
          setCompanionVariant("cast");
        } else {
          setMineId(null);
          setCompanionVariant(companionVariantFromRoute(target));
        }
        setGameRequest(null); setActiveId(null); setDetail(null); setView("chat");
      } else if (target === "chat/chats" || target === "chat/games") {
        setCompanionVariant("classic");
        setConversationType(target === "chat/chats" ? "chats" : "games");
        setGameRequest(null); setActiveId(null); setDetail(null); setView("chat");
      } else if (target.startsWith("chat/game/")) {
        const segments = target.split("/");
        let id = ""; try { id = decodeURIComponent(segments[3] ?? ""); parseXumengGameId(id); } catch { setNotice("游戏入口无效，请从游玩列表重新选择。"); return; }
        if (segments.length !== 4 || !accountId || (segments[2] !== "private" && segments[2] !== "builtin") || (segments[2] === "builtin" && !xumengBuiltinGame(id))) { setNotice("这部游戏暂不可用，请从游玩列表重新选择。"); return; }
        const gameKind: GamePlaySelection["kind"] = segments[2] === "builtin" ? "builtin" : "private";
        setConversationType("games");
        setGameRequest(previous => previous?.accountId === accountId && previous.kind === gameKind && previous.id === id ? previous : {accountId, kind: gameKind, id});
        setActiveId(null); setDetail(null); setView("chat");
      } else if (target === "studio/girlfriends" || target.startsWith("studio/girlfriends/")) {
        let id = "library";
        try { id = target === "studio/girlfriends" ? "library" : decodeURIComponent(target.slice("studio/girlfriends/".length)) || "library"; } catch { return; }
        if (creatorRoute.current !== target) setCreatorInitial({ id });
        creatorRoute.current = target; setDetail(null); setView("girlfriends");
      } else if (/^studio\/(games|scenarios)(?:\/[^/]+)?$/.test(target) || /^studio\/room\/[A-Za-z0-9-]+$/.test(target)) {
        let id: string | undefined;
        try { id = target.split("/")[2] ? decodeURIComponent(target.split("/")[2]) : undefined; } catch { return; }
        if (creatorRoute.current !== target) setCreatorInitial(target.startsWith("studio/room/") ? { roomCode: id } : { id });
        creatorRoute.current = target; setDetail(null); setView(target.startsWith("studio/games") ? "games" : "scenarios");
      } else if (target === "studio/roles") {
        setDetail(null); setCreatorSection("roles"); setView("studio");
      } else if (target.startsWith("novels/")) {
        let id: string | undefined; try { id = decodeURIComponent(target.slice(7)); } catch { return; }
        if (id !== "new/novel" && id !== "new/story" && (!id || id.includes("/"))) return;
        if (novelRoute.current !== target) setNovelInitial(id === "new/novel" || id === "new/story" ? { type: id === "new/story" ? "story" : "novel" } : { id });
        setDetail(null); setView("novels"); novelRoute.current = target;
      } else if (target === "studio/new" || target.startsWith("studio/edit/")) {
        if (studioRoute.current !== target) { studioRoute.current = target; setStudioSession((previous) => previous + 1); }
        setDetail(null); setView("studio-edit");
        const role = state.custom.find((card) => card.id === target.slice(12));
        setEditor((previous) => target === "studio/new" ? previous ?? "new" : role ?? "new");
      } else if (target.startsWith("character/")) {
        const character = characters.find((c) => c.id === target.slice(10));
        if (!character) return;
        if (restoreHistory) {
          const item = readDzmmDiscoveryHistory(window.history.state, accountId, target);
          const origin = item?.origin ?? null;
          const fromClick = pendingDetailRoute.current?.accountId === accountId && pendingDetailRoute.current.route === target;
          detailDiscoveryOrigin.current = origin;
          detailDiscoveryAccount.current = accountId;
          if (origin || !fromClick) {
            detailReturn.current = origin?.kind === "search" ? "search" : origin?.kind === "task-market" ? "tasks" : "characters"; detailReturnHash.current = origin?.route ?? "characters";
          }
          pendingDetailRoute.current = null;
        }
        setDetail((current) => current && current.id === character.id && isDzmmListPreview(character) && !isDzmmListPreview(current) ? current : character);
      } else if (target === "category" || target.startsWith("category/")) {
        const selected = dzmmDiscoveryRouteCategory(target);
        if (!selected) return;
        setDetail(null); setView("characters"); setCategory(null); setAppliedTags(selected.category ? [selected.category] : []);
        if (location.hash !== "#characters") location.hash = "characters";
        return;
      } else if (target === "tasks") {
        if (restoreHistory) {
          const item = accountId ? readDzmmDiscoveryHistory(window.history.state, accountId, target) : null;
          const selection = dzmmTaskSelectionForRole(item?.taskSelection, cloud.user?.role === "super");
          taskSelectionRef.current = selection;
          setTaskNavigation(accountId ? { accountId, selection } : null);
        }
        setDetail(null); setView("tasks");
      } else if (target.startsWith("author/")) {
        setDetail(null); setAuthorId(target.slice(7)); setView("author");
      } else if (target.startsWith("search/")) {
        let search = ""; try { search = decodeURIComponent(target.slice(7)); } catch { /* Invalid URLs show an empty search. */ }
        setDetail(null); setQuery(search); setView("search");
      } else if ((target === "forum" || target.startsWith("forum/post/")) && !XUMENG_FORUM_ENABLED) {
        setNotice(XUMENG_FORUM_LOCKED_MESSAGE);
        if (location.hash !== "#characters") location.hash = "characters";
        return;
      } else if (target.startsWith("forum/post/")) {
        setDetail(null); setForumPostId(target.slice(11)); setView("forum");
      } else if (target === "live" && !XUMENG_CALLS_ENABLED) {
        setNotice(XUMENG_CALLS_LOCKED_MESSAGE);
        if (location.hash !== "#characters") location.hash = "characters";
        return;
      } else if (target === "videos" || xumengVideoDramaIdFromRoute(target)) {
        setDetail(null);
        setView("videos");
      } else if (["play-games", "characters", "chat", "forum", "profile", "settings", "presets", "admin", "search", "studio", "novels", "live", "voice", "generation", "tasks", "app", "recharge", "vip", "invite", "checkin"].includes(target)) {
        setDetail(null);
        if (target === "chat") { setGameRequest(null); setConversationType("stories"); }
        if (target === "forum") setForumPostId(null);
        if (target === "studio") setCreatorSection("home");
        if (target === "novels") { setNovelInitial({}); novelRoute.current = "novels"; }
        setView(target as View);
      } else return;
      if (restoreHistory && (target === "chat" || target.startsWith("chat/"))) setConversationQuery("");
      prefetchRoute(target);
      if (!isGirlfriendRoute(target)) setCompanionOpen(false);
      const previousResolved = lastResolvedRoute.current;
      lastResolvedRoute.current = { accountId, route: target };
      if (!previousResolved || previousResolved.accountId !== accountId || previousResolved.route !== target) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      // Only a resolved route can replace the displayed page's protections.
      novelRouteActive.current = target === "novels" || target.startsWith("novels/");
      if (!target.startsWith("studio/games") && !target.startsWith("studio/scenarios") && !target.startsWith("studio/room/")) creatorRoute.current = "";
      if (target !== "studio/new" && !target.startsWith("studio/edit/")) studioRoute.current = "";
      liveRouteActive.current = target === "live";
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);
    return () => { window.removeEventListener("hashchange", readHash); window.removeEventListener("popstate", readHash); };
  }, [characters, loaded, state.custom, cloud.user?.id, cloud.authBusy]);

  function navigate(target: View, route: string = target): boolean {
    if (target === "forum" && !XUMENG_FORUM_ENABLED) { setNotice(XUMENG_FORUM_LOCKED_MESSAGE); return false; }
    if (target === "live" && !XUMENG_CALLS_ENABLED) { setNotice(XUMENG_CALLS_LOCKED_MESSAGE); return false; }
    if (view === "voice" && target !== "voice" && voiceBusy.current) { setNotice("语音正在生成，请等待完成后离开。"); return false; }
    if ((view === "live" || liveRouteActive.current) && target !== "live" && liveBusy.current) {
      setNotice("请先在实时影像工作台结束当前会话，再离开页面。");
      return false;
    }
    if (creatorRoute.current && (creatorBusy.current || creatorDirty.current)) {
      setNotice(creatorBusy.current ? "请等待当前创作操作完成。" : "有未保存的修改，请用工作台返回按钮保存或放弃修改。"); return false;
    }
    if ((view === "novels" || novelRouteActive.current) && (target !== "novels" || novelRoute.current !== "novels") && (novelBusy.current || novelDirty.current)) {
      setNotice(novelBusy.current ? "请先完成或停止小说创作操作。" : "小说有未保存的修改，请用工作台的返回按钮保存或放弃修改。");
      return false;
    }
    if (view === "studio-edit" && (studioBusy.current || studioDirty.current)) {
      setNotice(studioBusy.current ? "请等待当前创作操作完成。" : "有未保存的修改，请用工作台的返回按钮保存或放弃修改。");
      return false;
    }
    if (anyReplyActive() && (target !== "chat" || route !== "chat")) {
      setNotice("请先停止当前回复，再离开聊天。");
      return false;
    }
    prefetchRoute(route);
    saveCurrentDiscoveryHistory();
    if (target !== "live" && target !== "voice") setPerformanceSelection(null);
    setDetail(null);
    const companionRoute = isGirlfriendRoute(route);
    if (route.startsWith("chat/girlfriend-mine/")) {
      try { setMineId(decodeURIComponent(route.slice("chat/girlfriend-mine/".length))); } catch { return false; }
    } else setMineId(null);
    if (route.startsWith("chat/girlfriend-cast/")) {
      const person = girlfriendCastById(route.slice("chat/girlfriend-cast/".length));
      if (!person) return false;
      setCastCompanion(person);
    }
    setCompanionOpen(target === "chat" && companionRoute);
    setCompanionVariant(companionVariantFromRoute(route));
    if (target === "chat") setConversationType(route === "chat/chats" || companionRoute ? "chats" : route === "chat/games" || route.startsWith("chat/game/") ? "games" : "stories");
    if (target === "studio") setCreatorSection("home");
    if (target === "novels") { setNovelInitial({}); novelRoute.current = "novels"; }
    setView(target);
    creatorRoute.current = ""; studioRoute.current = "";
    novelRouteActive.current = target === "novels";
    liveRouteActive.current = target === "live";
    location.hash = route;
    window.scrollTo({ top: 0, behavior: "instant" });
    return true;
  }
  function openMessages(): boolean {
    if (anyReplyActive()) {
      setNotice("请先停止当前回复，再离开聊天。");
      if (view === "chat") return false;
      return navigate("chat");
    }
    if (!navigate("chat", CHAT_SECTION_ROUTES[conversationType])) return false;
    setActiveId(null);
    setGameRequest(null);
    setError("");
    return true;
  }
  function openNav(target: View): boolean {
    return target === "chat" ? openMessages() : navigate(target);
  }
  function selectChatSection(section: ChatSection) {
    if (section === conversationType) return;
    if (anyReplyActive()) { setNotice("请先停止当前回复，再切换分类。"); return; }
    if (!navigate("chat", CHAT_SECTION_ROUTES[section])) return;
    setActiveId(null); setGameRequest(null); setConversationQuery(""); setError("");
  }
  function warmCompanion(variant: "classic" | "intimate" | "qwen" | "sales" | "cast", castId?: string) {
    if (variant === "qwen") void import("@/app/xumeng/girlfriend/qwen-companion");
    else void import("@/app/xumeng/girlfriend/companion-page");
    const key = variant === "cast" ? `cast:${castId || ""}` : variant;
    if (variant === "qwen" || (variant === "cast" && !castId) || companionWarmup.current.has(key) || typeof window === "undefined") return;
    companionWarmup.current.add(key);
    const endpoint = variant === "intimate" ? "/api/xumeng/companion-intimate/api/health"
      : variant === "sales" ? "/api/xumeng/companion-sales/api/health"
      : variant === "cast" ? `/api/xumeng/companion-cast/${castId}/api/health`
      : "/api/xumeng/companion/api/health";
    void fetch(endpoint, { method: "GET", cache: "no-store", credentials: "same-origin" }).catch(() => {
      companionWarmup.current.delete(key);
    });
  }
  function openGirlfriendStudio(id = "new") {
    if (!loaded || cloud.authBusy || !cloud.user) { setNotice("正在加载账户，请稍候再上传女友。"); return; }
    location.hash = id === "library" ? "studio/girlfriends" : `studio/girlfriends/${encodeURIComponent(id)}`;
  }
  function openMineGirlfriend(id: string) {
    if (!loaded || cloud.authBusy || !cloud.user) { setNotice("正在加载账户，请稍候再打开聊天。"); return; }
    if (cloud.user.isGuest) { openAccount("login"); return; }
    const person = girlfriends.find(item => item.id === id);
    setMineId(id);
    if (person) setCustomCompanion(girlfriendProfile(person));
    if (!navigate("chat", `chat/girlfriend-mine/${encodeURIComponent(id)}`)) return;
    setGameRequest(null); setActiveId(null); setError("");
  }
  function rememberGirlfriend(person: GirlfriendPersona) {
    setGirlfriends(people => [person, ...people.filter(item => item.id !== person.id)]);
    setMineId(person.id);
    setCustomCompanion(girlfriendProfile(person));
    if (!navigate("chat", `chat/girlfriend-mine/${encodeURIComponent(person.id)}`)) return;
    setGameRequest(null); setActiveId(null); setError("");
  }
  function openCompanion(variant: CompanionVariant = "classic", profile?: CompanionProfile, castId?: string) {
    if (!loaded || cloud.authBusy || !cloud.user) { setNotice("正在加载账户，请稍候再打开聊天。"); return; }
    if (cloud.user.isGuest) { openAccount("login"); return; }
    if (variant === "cast") {
      const person = girlfriendCastById(castId || "");
      if (!person) return;
      setCastCompanion(person);
      warmCompanion("cast", person.id);
      if (!navigate("chat", `chat/girlfriend-cast/${person.id}`)) return;
    } else if (variant === "custom") {
      setCustomCompanion(profile || REALISTIC_COMPANION_PROFILES[0]);
      setCompanionVariant("custom");
      if (!navigate("chat", `chat/girlfriend-custom/${encodeURIComponent((profile || REALISTIC_COMPANION_PROFILES[0]).id)}`)) return;
    } else {
      warmCompanion(variant);
      if (!navigate("chat", variant === "intimate" ? "chat/girlfriend-intimate" : variant === "qwen" ? "chat/girlfriend-qwen" : variant === "sales" ? "chat/girlfriend-sales" : "chat/girlfriend")) return;
    }
    setGameRequest(null); setActiveId(null); setError("");
  }
  function leaveCompanion() {
    setActiveId(null); setGameRequest(null); navigate("chat", "chat/chats");
  }
  function playGame(selection: GamePlaySelection) {
    if (anyReplyActive()) { setNotice("请先停止当前回复，再切换到游戏。"); return; }
    const accountId = cloud.user?.id;
    if (!loaded || cloud.authBusy || !accountId) { setNotice("正在加载账户，请稍候再打开游戏。"); return; }
    if (!navigate("chat", `chat/game/${selection.kind}/${encodeURIComponent(selection.id)}`)) return;
    setGameRequest({ ...selection, accountId }); setActiveId(null); setConversationType("games"); setError("");
  }
  function leaveGame() { setGameRequest(null); setActiveId(null); navigate("chat", "chat/games"); }
  function openCreatorRoute(route: string) {
    if (["studio", "novels", "presets", "voice", "characters"].includes(route)) { navigate(route as View); return; }
    if (creatorDirty.current || creatorBusy.current || studioDirty.current || studioBusy.current || novelDirty.current || novelBusy.current || anyReplyActive()) {
      setNotice("请先保存或完成当前操作，再打开其他作品。"); return;
    }
    setDetail(null); location.hash = route;
  }
  function performCharacter(character: XumengPerformanceCharacter, target: "live" | "voice", mode: "phone" | "video" = "phone") {
    if (target === "live" && !XUMENG_CALLS_ENABLED) { setNotice(XUMENG_CALLS_LOCKED_MESSAGE); return; }
    if (target === "live" && billingConfig?.enabled === true && chatBalance !== null && chatBalance < 200) {
      setNotice("语音和视频通话需要至少 200 Credit。");
      return;
    }
    const accountId = cloud.user?.id;
    if (!accountId || cloud.user?.isGuest || cloud.authBusy) { openAccount("login"); return; }
    if (target === "live") {
      const current = location.hash.replace(/^#/, "");
      callReturnRoute.current = current && current !== "live" ? current : "chat";
      requestedLiveMode.current = mode;
    }
    if (!navigate(target)) {
      if (target === "live") requestedLiveMode.current = "phone";
      return;
    }
    if (target === "live") setLiveMode(mode);
    setPerformanceSelection({ accountId, character });
  }
  function returnFromCall() {
    const route = callReturnRoute.current || "chat";
    if (route.startsWith("chat/")) navigate("chat", route);
    else navigate("chat");
  }
  function callCompanion(variant: "classic" | "intimate" | "qwen" | "sales", mode: "phone" | "video" = "phone") {
    const person = CHAT_CALL_CHARACTERS.find(item => item.sourceId === variant);
    if (person) performCharacter(person, "live", mode);
  }
  function callCustomCompanion(profile: CompanionProfile, mode: "phone" | "video" = "phone") {
    performCharacter({
      id: `chat-custom-${profile.id}`, key: `chat:custom:${profile.id}`, source: "character", sourceId: profile.id, sourceLabel: "聊天",
      name: profile.name, avatar: profile.cover, description: profile.introduction,
      personality: profile.style.personality, scenario: profile.situation, dialogue: "",
      liveVoice: girlfriendLiveVoice(profile.id),
    }, "live", mode);
  }
  function startCompanionCall(mode: "phone" | "video") {
    if (companionVariant === "cast" && castCompanion) {
      const character = CHAT_CALL_CHARACTERS.find(item => item.sourceId === castCompanion.id);
      if (character) performCharacter(character, "live", mode);
    } else if (companionVariant === "custom") callCustomCompanion(customCompanion ?? REALISTIC_COMPANION_PROFILES[0], mode);
    else if (companionVariant === "intimate" || companionVariant === "classic" || companionVariant === "sales" || companionVariant === "qwen") callCompanion(companionVariant, mode);
  }
  function navigationCurrent(itemView: View) {
    return itemView === view
      || (itemView === "characters" && view === "play-games")
      || (itemView === "chat" && view === "live")
      || (itemView === "studio" && (view === "studio-edit" || view === "games" || view === "scenarios" || view === "novels" || view === "generation"));
  }
  function performActiveCharacter(target: "live" | "voice", mode: "phone" | "video" = "phone") {
    if (!activeCharacter || !active) return;
    performCharacter({ ...xumengPerformanceFromCard(activeCharacter),
      scene: buildXumengLiveConversationHandoff(active.messages, active.worldState, Date.now(), active.worldClockMode ?? "story") }, target, mode);
  }
  const performanceLibrary = usePerformanceCharacters(cloud.user?.id, cloud.user?.isGuest ?? true, characters, view === "live" || view === "voice", view === "live");
  const performanceCharacter = performanceSelection && performanceSelection.accountId === cloud.user?.id && !cloud.user?.isGuest
    ? performanceSelection.character
    : null;
  async function openStudio(card: Character | "new") {
    if (!cloud.user || cloud.user.isGuest) { openAccount("register"); setNotice("请先注册或登录，再创建角色。"); return; }
    if (anyReplyActive()) { setNotice("请先停止当前回复，再编辑角色。"); return; }
    if (creatorDirty.current || creatorBusy.current || novelDirty.current || novelBusy.current || studioDirty.current || studioBusy.current) { setNotice("请先保存或完成当前创作操作。"); return; }
    const owned = card !== "new" && state.custom.some((item) => item.id === card.id);
    if (card !== "new" && isXumengPinnedCard(card)) await loadXumengCardProvenance();
    const draftCard = card === "new" ? "new" : owned || (card.sourceKind === "original" && !card.publication) ? card : parseCharacterImport(exportCharacterJson(card));
    if (draftCard !== "new" && !owned) setState((previous) => ({ ...previous, custom: [draftCard, ...previous.custom.filter((item) => item.id !== draftCard.id)] }));
    prefetchRoute("studio/new");
    studioSubmissionGeneration.current++; setStudioSubmission(null);
    setDetail(null); setEditor(draftCard); setView("studio-edit");
    const route = draftCard === "new" ? "studio/new" : `studio/edit/${draftCard.id}`;
    studioRoute.current = route; setStudioSession((previous) => previous + 1);
    location.hash = route;
  }
  async function saveStudioCharacter(character: Character, retrySync = false) {
    const accountId = cloud.user?.id ?? null;
    if (!accountId || activeAccount.current !== accountId) throw new Error("账号已切换，请重新打开当前账号的草稿。");
    // Hook ownership changes synchronously, before React updates the rendered
    // account. Do not stage an old editor's card into a newly loaded account.
    cloud.assertAccount(accountId);
    setState((previous) => ({ ...previous, custom: [character, ...previous.custom.filter((card) => card.id !== character.id)] }));
    if (retrySync) await cloud.retrySync(accountId);
    else await cloud.saveNow(accountId);
    cloud.assertAccount(accountId);
    if (activeAccount.current !== accountId) throw new Error("账号已切换，已停止旧草稿操作。");
    setEditor(character);
    studioRoute.current = `studio/edit/${character.id}`;
    location.hash = `studio/edit/${character.id}`;
  }
  async function submitStudioCharacter(character: Character) {
    if (!cloud.user || cloud.user.isGuest) { openAccount("register"); throw new Error("注册并登录后才能提交公开发布，草稿可以继续私人保存。"); }
    const accountId = cloud.user.id;
    const checkAccount = () => { if (activeAccount.current !== accountId) throw new Error("账号已切换，已停止旧草稿提交。"); };
    checkAccount();
    await saveStudioCharacter(character);
    checkAccount();
    let offset = 0;
    for (;;) {
      const page = await fetchDzmmPublishingMine(offset);
      checkAccount();
      const publication = page.publications.find((item) => item.privateCharacterId === character.id);
      if (publication || !page.hasMore) {
        const result = await submitDzmmCharacter(character, publication?.id, publication?.version, accountId);
        checkAccount();
        studioSubmissionGeneration.current++;
        setStudioSubmission({ status: result.submission.status, reason: result.submission.reason });
        break;
      }
      if (!page.publications.length) throw new Error("发布记录分页无效，请刷新后重试。");
      offset = page.offset + page.publications.length;
    }
    checkAccount();
    setNotice("角色已提交审核，可在创作者中心查看进度。");
  }
  async function testStudioCharacter(character: Character, openingIndex = 0) {
    const accountId = cloud.user?.id ?? null;
    await saveStudioCharacter(character);
    if (activeAccount.current !== accountId) throw new Error("账号已切换，已停止旧角色试聊。");
    studioDirty.current = false; studioBusy.current = false;
    startChat(character, true, openingIndex);
  }
  function showAuthor(author: DzmmAuthor) {
    if (anyReplyActive()) { setNotice("请先停止当前回复，再查看作者。"); return; }
    saveCurrentDiscoveryHistory();
    setDetail(null); setAuthorId(author.id); setView("author"); location.hash = `author/${author.id}`;
  }
  function showCharacterAuthor(character: Character) {
    const target = resolveCharacterAuthorTarget(authors, character);
    if (target.kind === "author") showAuthor(target.author);
    else if (target.kind === "profile") navigate("profile");
    else setNotice("这张卡没有署名作者，没有可打开的作者主页。");
  }
  function characterAuthorControl(character: Character) {
    const mark = <span className={s.authorAvatar}>{Array.from(character.author)[0] ?? ""}</span>;
    if (resolveCharacterAuthorTarget(authors, character).kind === "unsigned") {
      return <span className={s.author}>{mark}{character.author}</span>;
    }
    return <button type="button" className={s.author} onClick={() => showCharacterAuthor(character)} aria-label={`查看作者 ${character.author}`}>{mark}{character.author}</button>;
  }
  function toggleFollow(character: Character) {
    const author = findCharacterAuthor(authors, character.id);
    if (!author) return;
    const previous = state.preferences.followedAuthors ?? [];
    if (!previous.includes(author.id) && previous.length >= 200) { setNotice("最多关注 200 位作者。"); return; }
    savePreferences({ ...state.preferences, followedAuthors: previous.includes(author.id) ? previous.filter((id) => id !== author.id) : [...previous, author.id] });
  }
  function showForumPost(id: string | null) {
    if (!navigate("forum")) return;
    setForumPostId(id); location.hash = id ? `forum/post/${id}` : "forum";
  }
  function branchConversation() {
    if (!active || !activeCharacter || busy) return;
    const messages = active.messages.map((message) => ({ ...message, id: uid() }));
    const { storyMemory: previousMemory, worldState: previousWorld, ...rest } = active;
    const storyMemory = previousMemory && matchesDzmmStoryMemory(previousMemory, active.messages)
      ? createDzmmStoryMemory(previousMemory.state, messages.slice(0, previousMemory.sourceCount)) : undefined;
    const worldState = rebindDzmmWorldJournal(previousWorld, active.messages, messages);
    const branch = { ...rest, id: uid(), title: `${active.title.slice(0, 100)} · 分支`, messages,
      ...(active.opening ? { opening: parseDzmmConversationOpening(reconcileDzmmConversationOpening(active.opening, active.messages)) } : {}),
      ...(worldState ? { worldState } : {}),
      ...(storyMemory ? { storyMemory } : {}), updatedAt: Date.now() };
    setState((previous) => ({ ...previous, conversations: [branch, ...previous.conversations], preferences: copyDzmmConversationPersona(previous.preferences, active.id, branch.id) }));
    setActiveId(branch.id); setChatSettingsOpen(false); setNotice("已复制当前会话，可从这里继续新的剧情。");
  }
  function deleteCharacter(character: Character) {
    if (busy || !state.custom.some((item) => item.id === character.id)) return;
    setState((previous) => ({ ...previous, custom: previous.custom.filter((item) => item.id !== character.id), favorites: previous.favorites.filter((id) => id !== character.id), conversations: previous.conversations.filter((item) => item.characterId !== character.id),
      preferences: dropDzmmConversationPersonas(previous.preferences, id => previous.conversations.some(item => item.id === id && item.characterId !== character.id)) }));
  }
  function showDetail(character: Character, taskSource?: DzmmTaskSelection, origin?: RecommendationSurface) {
    if (anyReplyActive()) {
      setNotice("请先停止当前回复，再查看角色详情。");
      return;
    }
    if (!cloud.user) { openAccount("login"); setNotice("请先登录，再查看角色和聊天。"); return; }
    const surface = origin ?? shelfRecommendationSurface(view, tab);
    detailRecommendSurface.current = surface;
    if (surface && isPublicRecommendationCharacter(character)) {
      void recordXumengRecommendationEvents([{ characterId: character.id, surface, action: "open" }]);
    }
    if (!detail || detailDiscoveryAccount.current !== activeAccount.current) {
      saveCurrentDiscoveryHistory();
      detailReturn.current = view; detailReturnHash.current = location.hash.slice(1) || "characters";
      const route = dzmmDiscoveryRouteCategory(detailReturnHash.current) ? detailReturnHash.current
        : view === "characters" && tab === "分类" ? category ? `category/${category}` : "category" : "";
      const searchOrigin = view === "search" ? dzmmSearchDiscoverySource(query) : null;
      const taskOrigin = view === "tasks" && activeAccount.current && taskSource ? dzmmTaskDiscoverySource(taskSource) : null;
      detailDiscoveryOrigin.current = taskOrigin ?? searchOrigin ?? dzmmDiscoverySource(route, discoveryFiltersRef.current);
      detailDiscoveryAccount.current = activeAccount.current;
      if (searchOrigin) detailReturnHash.current = searchOrigin.route;
    }
    setDetail(character);
    const requestedId = character.id;
    const applyFull = (full: Character) => {
      rememberCharacter(full);
      setDetail((current) => current?.id === requestedId ? full : current);
    };
    if (isDzmmListPreview(character) && isXumengPinnedCard(character)) {
      void dzmmBundledPlayableCharacter(requestedId).then((full) => {
        if (!full) throw new Error("missing");
        applyFull(full);
      }).catch(() => {
        void fetchDzmmPublicCharacter(requestedId).then(applyFull).catch(() => setNotice("角色详情暂时无法加载。"));
      });
    } else if (isDzmmListPreview(character)) {
      void fetchDzmmPublicCharacter(requestedId).then(applyFull).catch(() => setNotice("角色详情暂时无法加载。"));
    }
    const route = `character/${character.id}`;
    pendingDetailRoute.current = { accountId: activeAccount.current, route };
    const sharePath = characterSharePath(character.id);
    if (sharePath) {
      const localizedPath = xumengLocalePathname(sharePath, locale);
      if (location.pathname !== localizedPath || location.hash) window.history.pushState(window.history.state, "", localizedPath);
    } else location.hash = route;
    writeDiscoveryHistory(route, discoveryFiltersRef.current, detailDiscoveryOrigin.current);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function closeDetail() {
    const sameAccount = detailDiscoveryAccount.current === activeAccount.current;
    const origin = sameAccount ? detailDiscoveryOrigin.current : null;
    if (!navigate(sameAccount ? detailReturn.current : "characters", origin?.route ?? (sameAccount ? detailReturnHash.current : "characters"))) return;
    if (origin?.kind === "task-market" && activeAccount.current) {
      updateTaskSelection(activeAccount.current, origin.selection);
    } else if (origin && origin.kind !== "search" && origin.kind !== "task-market") {
      discoveryFiltersRef.current = origin.filters; setDiscoveryFilters(origin.filters);
      writeDiscoveryHistory(origin.route, origin.filters);
    }
  }
  function hideRecommendation(character: Character) {
    if (!isPublicRecommendationCharacter(character)) return;
    setLocalHidden((current) => current.includes(character.id) ? current : [...current, character.id]);
    const surface = detailRecommendSurface.current ?? shelfRecommendationSurface(view, tab) ?? "home";
    void recordXumengRecommendationEvents([{ characterId: character.id, surface, action: "hide" }]).then((accepted) => {
      if (accepted >= 1) setRecommendEpoch((value) => value + 1);
    });
    closeDetail();
    setNotice("已减少类似推荐。");
  }
  function refreshHomeRecommendations() {
    setRecommendEpoch((current) => {
      const next = recommendationRandomSeed();
      return next === current ? (next + 1) >>> 0 : next;
    });
  }
  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice("消息已复制。");
    } catch {
      setNotice("复制失败，请选择消息文字复制。");
    }
  }
  function allowBilledConversation() {
    if (!billingConfig) { setError("聊天费率暂时未能确认，请刷新页面后重试。"); return false; }
    if (billingConfig.enabled && !cloud.user) {
      setNotice("登录后可使用钱包 Credit 进行角色对话。"); openAccount("login"); return false;
    }
    return true;
  }
  function editMessage(message: Message) {
    if (!active || !activeCharacter || activeReplyActive()) return;
    setEditingMessage({ accountId: activeAccount.current, conversationId: active.id, messageId: message.id, original: message.content });
  }
  function saveEditedMessage(content: string) {
    if (!activeCharacter) throw new Error("角色当前不可用，历史消息仅供查看。");
    if (!editingMessage || activeReplyActive()) throw new Error("请先停止当前回复，再修改消息。");
    if (activeAccount.current !== editingMessage.accountId || active?.id !== editingMessage.conversationId) throw new Error("账户或会话已切换，请重新打开消息编辑。");
    let changed = false;
    setState(previous => {
      const conversation = previous.conversations.find(item => item.id === editingMessage.conversationId);
      if (!conversation || conversation.messages.find(item => item.id === editingMessage.messageId)?.content !== editingMessage.original)
        throw new Error("这条消息已经更新，请关闭编辑后重新打开。");
      const visible = splitXumengMomentTail(splitXumengPanelTail(editingMessage.original).body).body;
      const tail = editingMessage.original.startsWith(visible) ? editingMessage.original.slice(visible.length) : "";
      const updated = editDzmmConversationMessage(conversation, editingMessage.messageId, tail.trim() ? `${content.trimEnd()}${tail}` : content);
      changed = updated !== conversation;
      return changed ? { ...previous, conversations: previous.conversations.map(item => item.id === updated.id ? updated : item) } : previous;
    });
    setNotice(changed ? "消息已修改，后续聊天原文已保留。" : "消息未改变。");
  }
  function regenerateMessage(messageId: string) {
    if (!active || !activeCharacter || activeReplyActive() || !canRegenerateDzmmMessage(active, messageId) || !allowBilledConversation()) return;
    if (active.messages.at(-1)?.id === messageId && active.messages.at(-2)?.role === "user") { void send(true); return; }
    const branch = createDzmmRegenerationBranch(active, messageId);
    setState(previous => ({ ...previous, conversations: [branch, ...previous.conversations], preferences: copyDzmmConversationPersona(previous.preferences, active.id, branch.id) }));
    setActiveId(branch.id); setNotice("已建立分支重新生成，原会话完整保留。");
    void send(true, branch);
  }
  async function generateReplySuggestions(messageId: string, signal: AbortSignal) {
    if (!active || !activeCharacter || cloud.authBusy) throw new Error("请等待账号加载完成，再生成建议。");
    const suggestionCharacter = await playableArchive(activeCharacter);
    if (!billingConfig) throw new Error("建议费率暂时未能确认，请刷新后重试。");
    if (billingConfig.enabled && (!cloud.user || cloud.user.isGuest)) throw new Error("登录后可使用 Credit 生成下一步建议。");
    const owner = activeAccount.current;
    if (!owner) throw new Error("账号仍在加载，请稍后重试。");
    cloud.assertAccount(owner);
    const request = prepareDzmmReplySuggestionsRequest(suggestionCharacter, active, messageId, state.preferences);
    const abort = new AbortController();
    suggestionRequests.current.add(abort);
    try {
      const options = await fetchDzmmReplySuggestions(request, AbortSignal.any([signal, abort.signal]));
      cloud.assertAccount(owner);
      if (activeAccount.current !== owner) throw new DOMException("账号已切换", "AbortError");
      return options;
    } finally {
      suggestionRequests.current.delete(abort);
      if (activeAccount.current === owner) setBillingRefresh(value => value + 1);
    }
  }
  async function chooseReplySuggestion(messageId: string, reply: string): Promise<boolean> {
    if (suggestionSendLock.current) throw new Error("正在发送上一条建议。");
    if (!active || !activeCharacter || activeReplyActive() || cloud.authBusy) throw new Error("请等待当前操作完成且角色可用，再选择建议。");
    const owner = activeAccount.current;
    if (!owner) throw new Error("账号仍在加载，请稍后重试。");
    cloud.assertAccount(owner);
    const text = reply.trim();
    if (!text) throw new Error("这条建议是空的。");
    suggestionSendLock.current = true;
    try {
      if (active.messages.at(-1)?.id !== messageId) {
        const branch = createDzmmReplySuggestionBranch(active, messageId);
        setState(previous => ({ ...previous, conversations: [branch, ...previous.conversations], preferences: copyDzmmConversationPersona(previous.preferences, active.id, branch.id) }));
        setActiveId(branch.id);
        return await send(false, branch, text);
      }
      return await send(false, undefined, text);
    } finally {
      suggestionSendLock.current = false;
    }
  }
  async function sendSuggested(text: string) {
    if (suggestionSendLock.current || busy || cloud.authBusy) return;
    suggestionSendLock.current = true;
    try { await send(false, undefined, text); }
    finally { suggestionSendLock.current = false; }
  }
  function exportConversation() {
    if (!active) return;
    if (!activeCharacter) {
      try { download(`会话存档-${active.title}.json`, JSON.stringify(createDzmmUnavailableConversationBackup(active), null, 2)); }
      catch (error) { setNotice(error instanceof Error ? error.message : "会话存档导出失败，请重试。"); }
      return;
    }
    const { authoringDraft: privateDraft, ...playableCharacter } = activeCharacter;
    void privateDraft;
    const worldState = pruneDzmmWorldJournal(active.worldState, active.messages);
    download(
      `会话-${activeCharacter.name}.json`,
      JSON.stringify(
        { version: 1, character: playableCharacter, messages: active.messages,
          opening: resolveDzmmConversationOpening(activeCharacter, active),
          worldClockMode: active.worldClockMode ?? "story",
          ...(worldState ? { worldState } : {}),
          ...(active.storyMemory && matchesDzmmStoryMemory(active.storyMemory, active.messages) ? { storyMemory: active.storyMemory } : {}) },
        null,
        2,
      ),
    );
  }
  function toggleFavorite(id: string) {
    if (!cloud.user) { openAccount("login"); setNotice("请先登录，再收藏角色。"); return; }
    const removing = state.favorites.includes(id);
    setState((previous) => ({
      ...previous,
      favorites: previous.favorites.includes(id)
        ? previous.favorites.filter((v) => v !== id)
        : [...previous.favorites, id],
    }));
    const character = characters.find((item) => item.id === id);
    if (!character || !isPublicRecommendationCharacter(character)) return;
    const surface = detailRecommendSurface.current ?? shelfRecommendationSurface(view, tab) ?? "home";
    void recordXumengRecommendationEvents([{ characterId: id, surface, action: removing ? "unfavorite" : "favorite" }]).then((accepted) => {
      if (accepted >= 1) setRecommendEpoch((value) => value + 1);
    });
  }
  async function toggleLike(id: string) {
    if (!loaded || cloud.authBusy || !cloud.user?.id) return;
    const previous = likeStats[id] ?? { count: 0, liked: false };
    const nextLiked = !previous.liked;
    setLikeStats((current) => ({ ...current, [id]: { count: Math.max(0, previous.count + (nextLiked ? 1 : -1)), liked: nextLiked } }));
    try {
      const result = await setDzmmCharacterLike(id, nextLiked);
      setLikeStats((current) => ({ ...current, [id]: result }));
      setRecommendEpoch((value) => value + 1);
    } catch (failure) {
      setLikeStats((current) => ({ ...current, [id]: previous }));
      setNotice(failure instanceof Error ? failure.message : "点赞暂时失败，请稍后重试。");
    }
  }
  function startChat(character: Character, fresh = false, openingIndex = 0) {
    if (isDzmmListPreview(character) && isXumengPinnedCard(character)) {
      void dzmmBundledPlayableCharacter(character.id).then((full) => {
        if (!full) throw new Error("missing");
        rememberCharacter(full);
        startChat(full, fresh, openingIndex);
      }).catch(() => {
        void fetchDzmmPublicCharacter(character.id).then((full) => {
          rememberCharacter(full);
          startChat(full, fresh, openingIndex);
        }).catch(() => setNotice("角色详情暂时无法加载。"));
      });
      return;
    }
    if (isDzmmListPreview(character)) {
      void fetchDzmmPublicCharacter(character.id).then((full) => {
        rememberCharacter(full);
        startChat(full, fresh, openingIndex);
      }).catch(() => setNotice("角色详情暂时无法加载。"));
      return;
    }
    if (!loaded || cloud.authBusy) {
      setNotice("正在加载你的会话，请稍候再开始。");
      return;
    }
    if (character.authoringDraft) { openStudio(character); setNotice("世界书还有未完成的词条，请先完善草稿再开始对话。"); return; }
    const localizedCharacterForOpening = localizeCharacter(character, locale);
    const existing = state.conversations.find(
      (c) => c.characterId === character.id,
    );
    const newConversationBlock = (!existing || fresh) ? getDzmmNewConversationBlockReason(character) : null;
    if (newConversationBlock) {
      setNotice(newConversationBlock); return;
    }
    const resumeExisting = Boolean(existing && !fresh && existing.messages.some(message => message.role === "user"));
    let opening: ReturnType<typeof captureDzmmConversationOpening>;
    try { opening = resumeExisting ? resolveDzmmConversationOpening(character, existing!)
      : captureDzmmConversationOpening(localizedCharacterForOpening, openingIndex); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : "角色开场暂时无法加载。"); return; }
    const openingMessages = opening.messages.map((message) => ({ ...message, id: uid() }));
    if (existing && !fresh) {
      setActiveId(existing.id);
      const sameOpening = existing.messages.length === opening.messages.length && existing.messages.every((message, index) =>
        message.role === opening.messages[index]?.role && message.content.trim() === opening.messages[index].content.trim());
      if (!resumeExisting && !sameOpening) patchMessages(existing.id, openingMessages, undefined, undefined, opening);
      else if (existing.opening !== opening) setState(previous => ({ ...previous, conversations: previous.conversations.map(conversation =>
        conversation.id === existing.id ? { ...conversation, opening } : conversation) }));
    }
    else {
      const conversation: Conversation = {
        id: uid(),
        characterId: character.id,
        title: localizedCharacterForOpening.name,
        opening,
        messages: openingMessages,
        worldClockMode: state.preferences.worldClockMode ?? "story",
        updatedAt: Date.now(),
      };
      setState((previous) => ({
        ...previous,
        conversations: [conversation, ...previous.conversations],
      }));
      setActiveId(conversation.id);
    }
    setDetail(null);
    setError("");
    const surface = detailRecommendSurface.current ?? shelfRecommendationSurface(view, tab);
    if (surface && isPublicRecommendationCharacter(character)) {
      void recordXumengRecommendationEvents([{ characterId: character.id, surface, action: "start" }]);
    }
    setGameRequest(null); navigate("chat");
  }
  function selectConversation(c: Conversation) {
    setConversationType("stories"); setCompanionOpen(false); setGameRequest(null); window.history.replaceState(null, "", "#chat");
    setActiveId(c.id);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function removeActiveConversation() {
    if (!active || activeReplyActive()) return;
    const id = active.id;
    setState(previous => ({ ...previous, conversations: previous.conversations.filter(conversation => conversation.id !== id),
      preferences: dropDzmmConversationPersonas(previous.preferences, conversationId => conversationId !== id) }));
    setComposerDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
    suggestionSendLock.current = false;
    setActiveId(null);
    setChatSettingsOpen(false);
    setError("");
    setRechargeNeeded(false);
  }
  function patchMessages(conversationId: string, messages: Message[], world?: DzmmWorldStreamResult, restoreWorld?: DzmmWorldJournal, restoreOpening?: Conversation["opening"], restoreMemory?: Conversation["storyMemory"]) {
    setState((previous) => ({
      ...previous,
      conversations: previous.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        const { storyMemory, worldState: previousWorld, ...rest } = c;
        const sourceOpening = restoreOpening ?? c.opening;
        const opening = sourceOpening ? reconcileDzmmConversationOpening(sourceOpening, messages) : undefined;
        const journal = restoreWorld ?? previousWorld;
        const sameCoveredMessages = !restoreWorld && previousWorld?.snapshots.every(snapshot =>
          snapshot.sourceCount <= c.messages.length && snapshot.sourceCount <= messages.length
          && c.messages.slice(0, snapshot.sourceCount).every((message, index) => message === messages[index]));
        const worldState = world ? appendDzmmWorldSnapshot(journal, messages, world.state, world.recordedAt, c.worldClockMode ?? "story")
          : sameCoveredMessages ? previousWorld : pruneDzmmWorldJournal(journal, messages);
        const memory = restoreMemory && matchesDzmmStoryMemory(restoreMemory, messages) ? restoreMemory
          : storyMemory && matchesDzmmStoryMemory(storyMemory, messages) ? storyMemory : undefined;
        return { ...rest, messages, updatedAt: Date.now(),
          ...(opening ? { opening } : {}),
          ...(worldState ? { worldState } : {}),
          ...(memory ? { storyMemory: memory } : {}) };
      }),
    }));
  }
  function saveWorldClockMode(mode: DzmmWorldClockMode) {
    if (!active || busy) return;
    const now = Date.now();
    setState(previous => ({ ...previous, conversations: previous.conversations.map(c => {
      if (c.id !== active.id || (c.worldClockMode ?? "story") === mode) return c;
      const previousMode = c.worldClockMode ?? "story";
      const runtime = resolveDzmmWorldRuntime(c.worldState, c.messages, now, previousMode);
      const journal = recordDzmmWorldModeChange(c.worldState, c.messages, now, mode);
      const worldState = c.messages.length
        ? appendDzmmWorldSnapshot(journal, c.messages, runtime?.state ?? createDzmmWorldState(), now, mode) : journal;
      return { ...c, worldClockMode: mode, worldState, updatedAt: now };
    }) }));
  }
  function saveStoryMemory(next: DzmmStoryState | undefined) {
    if (!active || busy) return;
    setState(previous => ({ ...previous, conversations: previous.conversations.map(c => {
      if (c.id !== active.id) return c;
      const { storyMemory, ...rest } = c;
      if (!next) return { ...rest, updatedAt: Date.now() };
      if (!storyMemory || !matchesDzmmStoryMemory(storyMemory, c.messages)) return c;
      return { ...c, storyMemory: createDzmmStoryMemory(next, c.messages.slice(0, storyMemory.sourceCount)), updatedAt: Date.now() };
    }) }));
  }
  async function send(regenerate = false, override?: Conversation, explicitText?: string): Promise<boolean> {
    if (!loaded || cloud.authBusy) { setNotice("账号正在加载，请稍候再发送消息。"); return false; }
    const owner = activeAccount.current;
    if (owner) {
      try { cloud.assertAccount(owner); }
      catch (failure) { setNotice(failure instanceof Error ? failure.message : "账号正在切换，请稍候再发送消息。"); return false; }
    }
    const explicit = typeof explicitText === "string";
    const outgoing = (explicit ? explicitText : draft).trim();
    const conversation = override ?? active;
    if (
      (conversation && replyRequests.current.has(conversation.id)) ||
      !conversation ||
      !activeCharacter ||
      (!regenerate && !outgoing)
    )
      return false;
    if (!regenerate && composerDrafts[conversation.id]?.pending) { setError("上次回复尚未确认，请先检查会话并恢复或移除待确认原文，再发送新消息。"); return false; }
    if (!allowBilledConversation()) return false;
    if (billingConfig?.enabled && cloud.user && !cloud.user.isGuest && chatBalance === 0) {
      setRechargeMessage("当前可用 0 Credit，这条消息还没发出去。");
      setRechargeNeeded(true);
      return false;
    }
    if (activeCharacter.authoringDraft) { setError("这个角色的世界书还有未完成项，请在创作中心完善后继续对话。"); return false; }
    let replyCharacter = activeCharacter;
    if (activeCharacter.introductionDeferred || activeCharacter.contextDeferred) {
      try { replyCharacter = await playableArchive(activeCharacter); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "角色介绍暂时无法加载。"); return false; }
    }
    if (replyRequests.current.size >= MAX_PARALLEL_REPLIES) { setNotice(`最多同时生成 ${MAX_PARALLEL_REPLIES} 个回复，请等其中一个写完。`); return false; }
    const conversationId = conversation.id;
    const originalInput = draft;
    const showError = (message: string) => {
      if (activeIdRef.current === conversationId) setError(message);
      else setNotice(`「${conversation.title.slice(0, 20)}」${message}`);
    };
    const requestId = uid();
    const previousMessages =
      regenerate && conversation.messages.at(-1)?.role === "assistant"
        ? conversation.messages.slice(0, -1)
        : conversation.messages;
    if (regenerate && !previousMessages.some((m) => m.role === "user")) return false;
    const submitted: Message[] = regenerate
      ? previousMessages
      : [
          ...previousMessages,
          { id: uid(), role: "user", content: outgoing },
        ];
    const assistantId = uid();
    let answer = "";
    let preparedMemory: Conversation["storyMemory"];
    let userMessageShown = false;
    let insufficient = false;
    const abort = new AbortController();
    replyRequests.current.set(conversationId, abort);
    setGenerating(previous => ({ ...previous, [conversationId]: "reply" }));
    setError("");
    setRechargeNeeded(false);
    // The typed draft stays until the reply is accepted. A suggestion never replaces it.
    try {
        const worldRuntime = resolveDzmmWorldRuntime(conversation.worldState, submitted, Date.now(), conversation.worldClockMode ?? "story");
        if (replyCharacter.publication) {
          const play = await fetchDzmmPlayMaterials(replyCharacter.id, abort.signal);
          replyCharacter = { ...replyCharacter, ...play };
        }
        const { request } = await prepareDzmmRememberedRequest({ character: applyDzmmConversationOpening(replyCharacter, { ...conversation, messages: submitted }), messages: submitted,
        world: { clockMode: conversation.worldClockMode ?? "story", ...(worldRuntime ? { state: worldRuntime.state,
          recordedAt: worldRuntime.recordedAt, previousClockMode: worldRuntime.clockMode } : {}) },
        memory: conversation.storyMemory, preset: state.preferences.preset, userPersona: resolveDzmmConversationPersona(state.preferences, conversationId),
        userName: playUserName, locale, model: normalizeDzmmModelSelection(state.preferences.model), maxTokens: state.preferences.maxTokens, signal: abort.signal,
        onSummaryStart: () => setGenerating(previous => previous[conversationId] ? { ...previous, [conversationId]: "summary" } : previous),
        onMemory: (storyMemory) => {
          if (activeAccount.current !== owner) return;
          if (matchesDzmmStoryMemory(storyMemory, submitted)) preparedMemory = storyMemory;
          if (regenerate || !userMessageShown) return;
          setState((previous) => ({ ...previous, conversations: previous.conversations.map((c) =>
            c.id === conversationId && matchesDzmmStoryMemory(storyMemory, c.messages)
              ? { ...c, storyMemory, updatedAt: Date.now() } : c) }));
        },
      });
      if (activeAccount.current !== owner) return false;
      setGenerating(previous => previous[conversationId] ? { ...previous, [conversationId]: "reply" } : previous);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Xumeng-Request-Id": requestId },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 402) {
          insufficient = true;
          setRechargeMessage(typeof body?.error === "string" && body.error.trim() ? body.error : "余额不够，这条消息还没发出去。");
          setRechargeNeeded(true);
        }
        if ((response.status === 401 || response.status === 403) && billingConfig?.enabled && (!cloud.user || cloud.user.isGuest)) openAccount("login");
        throw new Error(body?.error || "回复失败，请稍后重试。");
      }
      if (!regenerate) {
        userMessageShown = true;
        patchMessages(conversationId, submitted, undefined, undefined, undefined, preparedMemory);
        if (!explicit) setComposerDrafts(previous => {
          const current = previous[conversationId] ?? { text: "", failed: [] };
          if ((current.text ?? "") !== originalInput) return previous;
          return { ...previous, [conversationId]: { ...current, text: "" } };
        });
      }
      const result = await readDzmmWorldResponse(response, (text) => {
        if (activeAccount.current !== owner) return;
        answer = text;
        if (!answer.trim()) return;
        patchMessages(conversationId, [
          ...submitted,
          { id: assistantId, role: "assistant", content: answer },
        ], undefined, undefined, undefined, preparedMemory);
      });
      if (activeAccount.current !== owner) return false;
      answer = result.answer;
      patchMessages(conversationId, [
        ...submitted,
        { id: assistantId, role: "assistant", content: answer },
      ], result.world, undefined, undefined, preparedMemory);
      return true;
    } catch (e) {
      if (activeAccount.current !== owner) return false;
      const hasValidAnswer = Boolean(answer.trim());
      if (e instanceof DzmmMemoryRequestError && e.status === 402) {
        insufficient = true;
        setRechargeMessage(e.message || "余额不够，这条消息还没发出去。");
        setRechargeNeeded(true);
      }
      if (e instanceof DzmmMemoryRequestError && (e.status === 401 || e.status === 403) && billingConfig?.enabled && (!cloud.user || cloud.user.isGuest)) openAccount("login");
      if (!insufficient && e instanceof Error && e.name !== "AbortError")
        showError(hasValidAnswer ? "回复中断，已保留收到的内容。可以重新生成。" : e.message);
      if (!hasValidAnswer && !regenerate) {
        if (!explicit) setComposerDrafts(previous => {
          const current = previous[conversationId] ?? { text: "", failed: [] };
          if (current.text.trim()) return previous;
          return { ...previous, [conversationId]: { ...current, text: originalInput } };
        });
        if (userMessageShown) patchMessages(conversationId, previousMessages);
      }
      if (!hasValidAnswer && regenerate) {
        const restoredMemory = conversation.storyMemory && matchesDzmmStoryMemory(conversation.storyMemory, conversation.messages)
          ? conversation.storyMemory : preparedMemory;
        patchMessages(conversationId, conversation.messages, undefined, conversation.worldState, conversation.opening, restoredMemory);
      }
      return false;
    } finally {
      if (!regenerate && activeAccount.current === owner) setComposerDrafts(previous => {
        const current = previous[conversationId];
        if (current?.pending?.requestId !== requestId) return previous;
        const { pending: completed, ...rest } = current; void completed;
        return { ...previous, [conversationId]: rest };
      });
      if (replyRequests.current.get(conversationId) === abort) replyRequests.current.delete(conversationId);
      setGenerating(previous => { const { [conversationId]: finished, ...rest } = previous; void finished; return rest; });
      setBillingRefresh(value => value + 1);
    }
  }

  const shelfList = useMemo(() => {
    const rankedFeed = Boolean(rankQuery) && sortMode === "recommended" && (tab === "新手" || tab === "猜你喜欢");
    const hideRanked = tab === "新手" || tab === "猜你喜欢" || tab === "榜单" || tab === "分类" || view === "search";
    const remote = (rankedFeed && rankWaiting ? [] : publicShelf.characters).filter((character) => !isDzmmCharacterBlocked(character, state.preferences.blockedTags) && !(hideRanked && hiddenIds.has(character.id)));
    const seen = new Set<string>();
    const pinLocal = view === "characters" && tab === "新手" && !rankedFeed;
    const pinned = pinLocal ? characters.filter((character) => !character.publication && !isDzmmListPreview(character)
      && !isDzmmCharacterBlocked(character, state.preferences.blockedTags) && characterMatchesShelfTags(character.tags, selectedShelfTags(genres))) : [];
    const followed = new Set(state.preferences.followedAuthors ?? []);
    const followedLocal = tab === "关注" ? characters.filter((character) => {
      const author = findCharacterAuthor(authors, character.id);
      return !character.publication && author ? followed.has(author.id) : false;
    }) : [];
    const orderedRemote = tab === "最新" ? orderDzmmShelfByTime(remote) : remote;
    const visible = [...followedLocal, ...pinned, ...orderedRemote].filter((character) => {
      if (!character.cover || character.cover.includes("placeholder")) return false;
      if (look && !character.publication && dzmmLocalLook(character.id) !== look) return false;
      if (seen.has(character.id)) return false;
      seen.add(character.id);
      return true;
    });
    if (!rankedFeed || !rankReady) return visible;
    const order = new Map(displayRecommendationIds.map((id, index) => [id, index]));
    return visible.filter((character) => order.has(character.id)).sort((left, right) => order.get(left.id)! - order.get(right.id)!);
  }, [publicShelf.characters, characters, state.preferences.blockedTags, state.preferences.followedAuthors, view, tab, genres, authors, hiddenIds, look, rankQuery, rankReady, rankWaiting, displayRecommendationIds, sortMode]);
  const relatedCards = useMemo(() => {
    if (!detail || relatedRank.status !== "ready") return [];
    const byId = new Map(characters.map((character) => [character.id, character]));
    return relatedRank.ids.flatMap((id) => {
      const character = byId.get(id);
      if (!character || character.id === detail.id || !isPublicRecommendationCharacter(character)) return [];
      if (isDzmmCharacterBlocked(character, state.preferences.blockedTags) || hiddenIds.has(character.id)) return [];
      return [character];
    }).slice(0, 8);
  }, [detail, relatedRank, characters, hiddenIds, state.preferences.blockedTags]);
  const recommendPositions = rankReady
    ? new Map(shelfList.map((character, index) => [character.id, index]))
    : null;
  const showRecommendationReasons = rankReady && serverSurface !== "ranking" && serverSurface !== null;
  const shelfKey = shelfList.map((character) => character.id).join("\n");
  useEffect(() => {
    const root = appRef.current;
    const accountId = cloud.user?.id;
    if (!rankReady || !serverSurface || !accountId || detail || !root) return;
    const queued: XumengRecommendationEvent[] = [];
    let timer = 0;
    const flush = () => {
      if (!queued.length) return;
      const batch = queued.splice(0, 40);
      void recordXumengRecommendationEvents(batch);
      if (queued.length) timer = window.setTimeout(flush, 200);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
        const element = entry.target;
        if (!(element instanceof HTMLElement)) continue;
        const characterId = element.dataset.recommendId;
        if (!characterId) continue;
        const key = `${accountId}:${serverSurface}:${characterId}`;
        if (impressed.current.has(key)) { observer.unobserve(element); continue; }
        const position = Number(element.dataset.recommendPosition);
        if (!Number.isInteger(position) || position < 0 || position > 500) continue;
        impressed.current.add(key);
        queued.push({ characterId, surface: serverSurface, action: "impression", position });
        observer.unobserve(element);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 350);
    }, { threshold: 0.5 });
    for (const element of root.querySelectorAll<HTMLElement>("[data-recommend-id]")) observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); flush(); };
  }, [rankReady, serverSurface, view, detail, shelfKey, cloud.user?.id]);

  const directRank = Boolean(rankQuery) && sortMode === "recommended" && tab === "新手";
  const showFeatured = false;
  const showBuiltinShelf = !directRank && tab !== "关注" && tab !== "榜单" && tab !== "猜你喜欢" && tab !== "最新" && genres.length === 0 && !query.trim() && view !== "search";
  const builtinShelfItems = useMemo<ContentShelfItem[]>(() => showBuiltinShelf ? XUMENG_BUILTIN_GAMES.map(game => ({ kind: "game", key: `builtin:${game.id}`, game })) : [], [showBuiltinShelf]);
  const featured = useMemo<ContentShelfItem[]>(() => {
    if (!showFeatured) return [];
    const companions: ContentShelfItem[] = CONTENT_PEOPLE.filter(person => person.variant !== "qwen" && (!look || person.look === look)).map(person => ({ kind: "companion", key: `companion:${person.variant}:${person.castId || person.name}`, person }));
    const cards: ContentShelfItem[] = shelfList.slice(0, FEATURED_CHARACTER_COUNT).map(character => ({ kind: "character", key: `character:${character.id}`, character }));
    const mixed: ContentShelfItem[] = [];
    if (cards[0]) mixed.push(cards[0]);
    let cardIndex = 1;
    companions.forEach((person, index) => {
      mixed.push(person);
      if (index < companions.length - 1) {
        mixed.push(...cards.slice(cardIndex, cardIndex + 3));
        cardIndex += 3;
      }
    });
    mixed.push(...cards.slice(cardIndex));
    return showBuiltinShelf ? [...builtinShelfItems, ...mixed] : mixed;
  }, [showFeatured, shelfList, look, showBuiltinShelf, builtinShelfItems]);
  const shelf = useMemo(() => {
    const characters = weaveEqual<ContentShelfItem>([
      (showFeatured ? shelfList.slice(FEATURED_CHARACTER_COUNT) : shelfList).map(character => ({ kind: "character", key: `character:${character.id}`, character })),
    ]);
    return showBuiltinShelf && !showFeatured ? [...builtinShelfItems, ...characters] : characters;
  }, [shelfList, showFeatured, showBuiltinShelf, builtinShelfItems]);
  useEffect(() => {
    const node = shelfMoreRef.current;
    if (!node || !publicShelf.hasMore || publicShelf.loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) publicShelf.loadMore();
    }, { rootMargin: "720px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [publicShelf.hasMore, publicShelf.loading, publicShelf.loadMore, view, detail, tab]);

  async function importRole(file?: File) {
    if (!file) return;
    try {
      if (file.size > DZMM_CHARACTER_CARD_MAX_BYTES) throw new Error("角色卡文件不能超过 5 MB。");
      const owner = activeAccount.current;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const source = readDzmmCharacterImportText(bytes);
      const character = parseCharacterDraftImport(source.text);
      if (activeAccount.current !== owner || cloud.authBusy) throw new Error("账号已切换，请在当前账号重新导入角色卡。");
      if (!owner || !loaded) throw new Error("账号尚未加载，请稍候再导入角色卡。");
      cloud.assertAccount(owner);
      if (studioDirty.current || studioBusy.current) throw new Error("角色草稿尚未保存，请先在创作工作台保存，再导入新角色卡。");
      let coverNote = "";
      if (source.embeddedPng) {
        try {
          character.cover = await uploadDzmmCover(dzmmPngCharacterFile(file, bytes));
          coverNote = "封面已使用这张图片。";
        } catch (error) {
          coverNote = error instanceof Error ? `封面未上传：${error.message}` : "封面未上传。";
        }
        if (activeAccount.current !== owner || cloud.authBusy) throw new Error("账号已切换，请在当前账号重新导入角色卡。");
      }
      setState((p) => ({ ...p, custom: [character, ...p.custom] }));
      if (character.authoringDraft) openStudio(character); else showDetail(character);
      setNotice(`${character.authoringDraft ? "私人创作草稿已导入，可继续完善世界书。" : "角色卡已导入。"}${coverNote}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "导入失败。");
    }
    if (importRef.current) importRef.current.value = "";
  }
  async function importConversation(file?: File) {
    if (!file) return;
    if (anyReplyActive()) {
      setNotice("请先停止当前回复，再导入会话。");
      if (importChatRef.current) importChatRef.current.value = "";
      return;
    }
    try {
      if (file.size > DZMM_CONVERSATION_BACKUP_MAX_BYTES) throw new Error("会话文件不能超过 2 MB。");
      const owner = activeAccount.current;
      const raw = await file.text();
      if (activeAccount.current !== owner) throw new Error("账号已切换，请在当前账号重新导入会话。");
      if (anyReplyActive() || cloud.authBusy) throw new Error("当前操作尚未完成，请稍后重新导入会话。");
      if (owner) cloud.assertAccount(owner);
      const archive = parseDzmmUnavailableConversationBackup(raw, { createId: uid });
      const { character, conversation: c } = archive ? { character: null, conversation: archive }
        : parseDzmmConversationBackup(raw, { createId: uid });
      setState((p) => ({
        ...p,
        custom: character ? [character, ...p.custom] : p.custom,
        conversations: [c, ...p.conversations],
      }));
      setActiveId(c.id);
      navigate("chat");
      setNotice(archive ? "会话存档已导入；原角色不可用时可查看只读历史。" : "会话已导入。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "导入失败。");
    }
    if (importChatRef.current) importChatRef.current.value = "";
  }

  function openAccount(mode: "login" | "register"): boolean {
    if (!loaded) { setNotice("正在加载当前账号，请稍候。"); return false; }
    if (creatorBusy.current || creatorDirty.current || novelBusy.current || novelDirty.current) { setNotice("请先保存并完成创作操作，再登录其他账号。"); return false; }
    if (studioBusy.current) { setNotice("角色草稿正在处理，请稍候再注册或登录。"); return false; }
    if (studioDirty.current) { setNotice("请先保存或导出角色草稿，再注册或登录。"); return false; }
    if (anyReplyActive()) {
      setNotice("请先停止当前回复，再切换账号。");
      return false;
    }
    try {
      if (cloud.user?.id) cloud.assertAccount(cloud.user.id);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "账号正在切换，请稍候。"); return false; }
    cloud.clearAuthError();
    setAccountMode(mode);
    return true;
  }

  function finishGuestGate(registered: boolean) {
    setGuestGate(gate => gate?.stage === "account" ? { ...gate, stage: registered ? "welcome" : "open" } : gate);
  }

  async function submitAccount(values: DzmmAccountValues) {
    if (!accountMode) return;
    const registered = await cloud.authenticate(accountMode, values);
    setAccountMode(null);
    finishGuestGate(registered);
  }

  useEffect(() => {
    if (guestGate?.stage !== "open" || !cloud.user || cloud.user.isGuest || cloud.authBusy) return;
    const { character } = guestGate;
    setGuestGate(null);
    showDetail(characters.find(item => item.id === character.id) ?? character);
  }, [guestGate, cloud.user, cloud.authBusy]);

  const paymentReturn = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const companionInMain = (companionOpen || (conversationType === "chats" && wideChat && loaded && !cloud.authBusy && Boolean(cloud.user))) && !cloud.user?.isGuest;
  const pinChatToKeyboard = view === "chat" && !detail && Boolean(active || companionInMain || gameSelection);
  useEffect(() => {
    const root = appRef.current;
    if (!root) return;
    const viewport = window.visualViewport;
    const keyboardApi = readVirtualKeyboard();
    const fullHeight = { current: 0 };
    let frameId = 0;
    let followUps: number[] = [];
    let corrections = 0;
    let keyboardWasOpen = false;
    let keyboardRectSeen = false;
    let scrolledHome = false;
    const clearFollowUps = () => {
      for (const id of followUps) window.clearTimeout(id);
      followUps = [];
    };
    const release = () => {
      fullHeight.current = 0;
      corrections = 0;
      keyboardWasOpen = false;
      scrolledHome = false;
      for (const property of ["position", "left", "right", "top", "height", "min-height", "padding-bottom"]) {
        root.style.removeProperty(property);
      }
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-height");
      delete root.dataset.keyboard;
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
      setKeyboardOverlay(keyboardApi, false);
    };
    const sync = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        if (!pinChatToKeyboard || !mobile) {
          release();
          return;
        }
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        if (!scrolledHome && (window.scrollX !== 0 || window.scrollY !== 0)) {
          scrolledHome = true;
          window.scrollTo(0, 0);
        }
        const layoutHeight = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
        if (layoutHeight < 120) return;
        const visualHeight = viewport && viewport.height > 0 ? viewport.height : layoutHeight;
        const offsetTop = viewport?.offsetTop ?? 0;
        const keyboardHeight = keyboardInset(keyboardApi);
        if (keyboardHeight > 40) keyboardRectSeen = true;
        const snapshot = { layoutHeight, visualHeight, offsetTop, fullHeight: fullHeight.current, keyboardHeight };
        if (chatViewportSettled(snapshot)) fullHeight.current = layoutHeight;
        const frame = chatViewportFrame({ ...snapshot, fullHeight: fullHeight.current });
        root.style.position = "fixed";
        root.style.left = "0px";
        root.style.right = "0px";
        root.style.minHeight = "0px";
        root.style.paddingBottom = "0px";
        root.style.height = `${frame.height}px`;
        root.style.setProperty("--vv-height", `${frame.height}px`);
        const rect = root.getBoundingClientRect();
        const usedTop = Number.parseFloat(window.getComputedStyle(root).top);
        const currentTop = Number.isFinite(usedTop) ? usedTop : 0;
        if (Math.abs(rect.top) > 2) {
          corrections += 1;
          const anchored = chatViewportAnchorTop(currentTop, rect.top, layoutHeight);
          root.style.top = `${corrections > 4 ? 0 : anchored}px`;
        } else {
          corrections = 0;
          if (!root.style.top) root.style.top = "0px";
        }
        root.style.setProperty("--vv-top", root.style.top || "0px");
        const typing = document.activeElement instanceof HTMLElement
          && root.contains(document.activeElement)
          && (document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "INPUT");
        if (frame.keyboardOpen || typing) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
        if (frame.keyboardOpen && !keyboardWasOpen && document.activeElement === composerInputRef.current) {
          const scroller = messageScrollRef.current;
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
        }
        if (!frame.keyboardOpen && !typing) {
          corrections = 0;
          scrolledHome = false;
        }
        keyboardWasOpen = frame.keyboardOpen;
      });
    };
    const schedule = () => {
      sync();
      clearFollowUps();
      for (const delay of [80, 240, 700]) followUps.push(window.setTimeout(sync, delay));
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !root.contains(target)) return;
      if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") return;
      schedule();
      // Only opt into the virtual-keyboard overlay when the browser neither resizes nor pans.
      followUps.push(window.setTimeout(() => {
        if (!keyboardApi || keyboardRectSeen || document.activeElement !== target) return;
        if (!window.matchMedia("(max-width: 767px)").matches) return;
        const current = window.visualViewport;
        const layout = window.innerHeight;
        const visual = current?.height ?? layout;
        const unchanged = Math.abs(layout - visual) < 40
          && Math.abs(current?.offsetTop ?? 0) < 40
          && (fullHeight.current === 0 || fullHeight.current - layout < 80);
        if (!unchanged) return;
        setKeyboardOverlay(keyboardApi, true);
        sync();
        followUps.push(window.setTimeout(() => {
          if (!keyboardRectSeen && document.activeElement === target) {
            setKeyboardOverlay(keyboardApi, false);
            sync();
          }
        }, 500));
      }, 400));
    };
    const onFocusOut = () => schedule();
    const onOrientation = () => {
      fullHeight.current = 0;
      schedule();
    };
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", onOrientation);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    keyboardApi?.addEventListener("geometrychange", sync);
    return () => {
      cancelAnimationFrame(frameId);
      clearFollowUps();
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", onOrientation);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      keyboardApi?.removeEventListener("geometrychange", sync);
      release();
    };
  }, [pinChatToKeyboard]);
  const minePerson = mineId ? girlfriends.find(person => person.id === mineId) ?? null : null;
  const storyOpen = Boolean(activeCharacter && active && !companionInMain && !gameSelection);
  const chatMainStyle = storyOpen ? { ...dzmmChatDisplayStyle(state.preferences), ...dzmmChatBackgroundStyle(state.preferences, activeCharacter?.cover, state.preferences.dark) } : undefined;

  const renderShelfItem = (item: ContentShelfItem, index: number) => item.kind === "companion" ? (
                  <article key={item.key} className={s.card} style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}>
                    <button className={s.coverButton} aria-label={`和${item.person.name}聊天`} onClick={() => openCompanion(item.person.variant, undefined, item.person.castId || undefined)}>
                      <img src={item.person.cover} alt="" />
                      <span className={s.heat}>AI 女友</span>
                    </button>
                    <div className={s.cardBody}>
                      <button className={s.cardText} onClick={() => openCompanion(item.person.variant, undefined, item.person.castId || undefined)}>
                        <h2>{item.person.name}{companionAge(item.person.description) ? <small className={s.cardAge}>{companionAge(item.person.description)}</small> : null}</h2>
                        <p>{item.person.situation}</p>
                      </button>
                    </div>
                  </article>
                ) : item.kind === "game" ? (
                  <article key={item.key} className={s.card} style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}>
                    <button className={s.coverButton} style={GAME_COVERS[item.game.id] ? undefined : { background: "linear-gradient(165deg,#4a4034,#221e1a)" }} aria-label={`游玩${item.game.title}`} onClick={() => playGame({ kind: xumengBuiltinGame(item.game.id) ? "builtin" : "private", id: item.game.id })}>
                      {GAME_COVERS[item.game.id] ? <img src={GAME_COVERS[item.game.id]} alt="" /> : <span className={s.contentPlate} aria-hidden="true">{Array.from(item.game.title)[0] || "游"}</span>}
                      <span className={s.heat}>游戏 · <Icon name="flame" size={14} />{gameHeat(item.game.id)}</span>
                    </button>
                    <div className={s.cardBody}>
                      <button className={s.cardText} onClick={() => playGame({ kind: xumengBuiltinGame(item.game.id) ? "builtin" : "private", id: item.game.id })}>
                        <h2>{item.game.title}</h2>
                        <p>{(item.game.synopsis || "打开就能玩").replace(/\s+/g, " ").split(/[。！？]/)[0].slice(0, 42)}</p>
                      </button>
                    </div>
                  </article>
                ) : (
                  <article
                    key={item.key}
                    className={s.card}
                    style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}
                    data-recommend-id={recommendPositions?.has(item.character.id) ? item.character.id : undefined}
                    data-recommend-position={recommendPositions?.get(item.character.id)}
                  >
                    {(() => {
                      const displayCharacter = localizeCharacter(item.character, locale);
                      const displayTags = coverShelfTags(displayCharacter.tags, 2);
                      return <>
                    <CoverReel className={s.coverButton} character={displayCharacter} onOpen={() => showDetail(item.character)}>
                      <span className={s.heat}>
                        <Icon name="flame" size={14} />
                        {item.character.heat || "—"}
                      </span>
                      {item.character.sourceKind === "original" && !item.character.publication && (
                        <span className={s.localBadge}>我的角色</span>
                      )}
                    </CoverReel>
                    {displayTags.length > 0 && <div className={s.coverTags}>{displayTags.map((tag) => <button key={tag} type="button" data-tone={coverTagTone(tag)} onClick={() => { setAppliedTags([sourceCharacterTag(item.character, locale, tag)]); }} aria-label={`只看${tag}`}>{tag}</button>)}</div>}
                    <div className={s.cardBody}>
                      <button
                        className={s.cardText}
                        onClick={() => showDetail(item.character)}
                      >
                        <h2>{displayCharacter.name}</h2>
                        <p>{getDzmmCharacterCardBlurb(displayCharacter, playUserName)}</p>
                        {showRecommendationReasons && recommendationReasonText(recommendation.reasons[item.character.id]) && <span className={s.reason}>{recommendationReasonText(recommendation.reasons[item.character.id])}</span>}
                      </button>
                      <div className={s.cardFooter}>
                        {characterAuthorControl(item.character)}
                        <button
                          className={likedForCurrentAccount.includes(item.character.id) ? s.liked : s.like}
                          onClick={() => toggleLike(item.character.id)}
                          aria-label={`${likedForCurrentAccount.includes(item.character.id) ? "取消点赞" : "点赞"} ${displayCharacter.name}`}
                          aria-pressed={likedForCurrentAccount.includes(item.character.id)}
                        >
                          <Icon name="heart" size={15} />
                          <span>{item.character.likes || "—"}</span>
                        </button>
                        <button
                          className={state.favorites.includes(item.character.id) ? s.favorited : ""}
                          onClick={() => toggleFavorite(item.character.id)}
                          aria-label={`${state.favorites.includes(item.character.id) ? "取消收藏" : "收藏"} ${localizeCharacter(item.character, locale).name}`}
                          aria-pressed={state.favorites.includes(item.character.id)}
                        >
                          <Icon name={state.favorites.includes(item.character.id) ? "check" : "book"} size={15} />
                        </button>
                      </div>
                    </div>
                      </>;
                    })()}
                  </article>
                );

  return (
    <div
      ref={appRef}
      className={`${s.app} ${dark ? s.dark : ""} ${view === "chat" && !detail ? s.chatPage : ""} ${view === "chat" && !detail && (active || companionInMain || gameSelection) ? s.chatMode : ""} ${view === "videos" && !detail ? s.videoMode : ""}`}
    >
      <aside className={s.appRail} aria-label="主导航">
        <button type="button" className={s.railUser} onClick={() => navigate("profile")}>
          <span className={s.avatar}>{Array.from(state.preferences.nickname)[0] ?? ""}</span>
          <strong>{state.preferences.nickname}</strong>
        </button>
        <nav>
          {localizedNav.map((n) => (
            <a key={n.view} href={`#${n.view}`}
              onClick={(e) => { e.preventDefault(); openNav(n.view); }}
              className={navigationCurrent(n.view) ? s.navActive : ""}>
              <Icon name={n.icon} size={18} />
              {n.label}
            </a>
          ))}
        </nav>
        <p className={s.railLabel}>{t("utilityExploreApps")}</p>
        <nav>
          <a href="#tasks" className={view === "tasks" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("tasks"); }}><Icon name="trophy" size={18} />{t("navTasks")}</a>
          <a href="#checkin" className={view === "checkin" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("checkin"); }}><Icon name="sun" size={18} />{t("utilityDailyCheckIn")}</a>
          <a href="#invite" className={view === "invite" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("invite"); }}><Icon name="users" size={18} />{t("navInvite")}</a>
          {XUMENG_PAYMENTS_ENABLED && <a href="#recharge" className={view === "recharge" || view === "vip" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("recharge"); }}><Icon name="wallet" size={18} />{t("utilityRechargeVip")}</a>}
          <a href="#app" className={view === "app" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("app"); }}><Icon name="download" size={18} />{t("utilityInstallApp")}</a>
        </nav>
      </aside>
      <header className={s.topbar}>
        <a
          href="#characters"
          className={s.logo}
          onClick={(e) => {
            e.preventDefault();
            navigate("characters");
          }}
          aria-label="叙梦角色广场"
        >
          <img
            src="/assets/xumeng/brand/xumeng-mark.svg"
            width="36"
            height="36"
            alt=""
            aria-hidden="true"
          />
          <span>
            叙梦 <small>XUMENG</small>
          </span>
        </a>
        <nav className={s.mainNav} aria-label="主导航">
          {localizedNav.map((n) => (
            <a
              key={n.view}
              href={`#${n.view}`}
              onClick={(e) => {
                e.preventDefault();
                openNav(n.view);
              }}
              className={navigationCurrent(n.view) ? s.navActive : ""}
            >
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
          <a
            href="#invite"
            className={`${s.mainReferralEntry} ${view === "invite" ? s.navActive : ""}`}
            aria-label="邀请好友并获得聊天 Credit"
            onClick={(event) => { event.preventDefault(); navigate("invite"); }}
          >
            <Icon name="users" size={17} />
            <span>{t("navInvite")}</span>
            <strong>{t("navEarnCredit")}</strong>
          </a>
        </nav>
        <ResponsiveNavigation key={view} items={localizedNav} tools={cloud.user?.role === "super" ? [...localizedTools, localizedAdmin] : localizedTools}
          currentView={view === "play-games" ? "characters" : view === "studio-edit" || view === "games" || view === "scenarios" || view === "novels" || view === "generation" ? "studio" : view === "live" ? "chat" : view === "checkin" ? "tasks" : view}
          onNavigate={openNav} onHome={() => navigate("characters")} locale={locale}
          footer={<><button type="button" className={s.navDrawerTool} onClick={() => setState((previous) => ({ ...previous, preferences: { ...previous.preferences, dark: !dark, theme: dark ? "light" : "dark" } }))}><Icon name={dark ? "moon" : "sun"} size={18} /><span>{dark ? t("themeLight") : t("themeDark")}</span></button><label className={s.navDrawerTool}><span className={s.srOnly}>{t("language")}</span><select aria-label={t("language")} value={locale} onChange={(event) => savePreferences({ ...state.preferences, locale: event.target.value as XumengLocale })}>{XUMENG_LOCALES.map(option => <option key={option} value={option}>{xumengLocaleLabel(option)}</option>)}</select></label></>} />
        <label className={s.search}>
          <Icon name="search" size={20} />
          <input
            aria-label={t("searchAll")}
            placeholder={t("searchAllPlaceholder")}
            maxLength={DZMM_GLOBAL_QUERY_MAX_LENGTH}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { if (navigate("search")) location.hash = `search/${encodeURIComponent(query.trim())}`; } }}
          />
          {query && (
            <button aria-label={t("clearSearch")} onClick={() => { setQuery(""); if (view === "search") location.hash = "search"; }}>
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        {XUMENG_PAYMENTS_ENABLED && <a href="#vip" className={s.vipEntry} aria-label={t("vipCenter")} onClick={event => { event.preventDefault(); navigate("vip"); }}>
          <Icon name="crown" size={17} /><span>VIP</span>
        </a>}
        <a href="#invite" className={s.referralTopEntry} aria-label="邀请好友并获得聊天 Credit" onClick={event => { event.preventDefault(); navigate("invite"); }}>
          <Icon name="users" size={16} /><span>邀请好友</span><strong>赚 Credit</strong>
        </a>
        <button
          className={s.iconButton}
          aria-label={dark ? t("themeLight") : t("themeDark")}
          onClick={() =>
            setState((p) => ({
              ...p,
              preferences: { ...p.preferences, dark: !dark, theme: dark ? "light" : "dark" },
            }))
          }
        >
          <Icon name={dark ? "moon" : "sun"} size={20} />
        </button>
        <label className={s.localePicker}>
          <span className={s.srOnly}>{t("language")}</span>
          <select aria-label={t("language")} value={locale} onChange={(event) => savePreferences({ ...state.preferences, locale: event.target.value as XumengLocale })}>
            {XUMENG_LOCALES.map(option => <option key={option} value={option}>{xumengLocaleLabel(option)}</option>)}
          </select>
        </label>
        <div className={s.topEnd}>
          <a className={s.telegramTop} href={XUMENG_TELEGRAM_GROUP_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram" title="加入 Telegram 群（新标签页打开）"><Icon name="send" size={16} /></a>
          <button className={s.account} onClick={() => navigate("profile")}>
            <span className={s.avatar}>
              {Array.from(state.preferences.nickname)[0] ?? ""}
            </span>
            <span>{state.preferences.nickname}</span>
          </button>
        </div>
      </header>

      {(view === "characters" || view === "play-games") && !detail && (
        <>
          <div className={s.browseNav}>
            <div className={s.browseHead}>
            <div className={s.tabScroll} ref={tabsRef}>
            <nav className={s.tabs} aria-label="浏览">
              {TABS.map((tabKey) => (
                <button
                  key={tabKey}
                  role="tab"
                  aria-selected={tabKey === tab}
                  aria-haspopup={tabKey === "分类" ? "dialog" : undefined}
                  aria-expanded={tabKey === "分类" ? tagPickerOpen : undefined}
                  className={tabKey === tab ? s.tabActive : ""}
                  onClick={() => {
                    saveCurrentDiscoveryHistory();
                    if (tabKey === "分类") { setTagPickerOpen(true); return; }
                    setTagPickerOpen(false); setTab(tabKey); setQuery(""); location.hash = "characters";
                  }}
                >
                  {tabKey === "榜单" && <Icon name="trophy" size={15} />} {tabKey === "分类" && appliedTags.length ? `${t("tabCategories")} · ${appliedTags.map(browseTagName).join("、")}` : (({ "关注": t("tabFollowing"), "最新": t("tabLatest"), "新手": t("tabNew"), "猜你喜欢": t("tabRecommended"), "榜单": t("tabRanking"), "分类": t("tabCategories") } as Record<string, string>)[tabKey] ?? tabKey)}
                </button>
              ))}
            </nav>
            </div>
            {rankQuery?.surface === "home" && canRank && <button type="button" className={`${s.secondary} ${s.recommendRefresh}`} aria-label="换一批推荐角色" disabled={rankWaiting} onClick={refreshHomeRecommendations}><Icon name="refresh" size={14} />换一批</button>}
            </div>
          </div>
          <DiscoveryTagPicker open={tagPickerOpen} onClose={() => setTagPickerOpen(false)} options={browseTagChoices} selected={appliedTags} limit={BROWSE_TAG_LIMIT} onToggle={toggleBrowseTag} onClear={() => setAppliedTags([])} />
          <>
          <main className={s.catalog} ref={catalogRef}>
            {tab === "榜单" && <div className={s.rankingBar} role="tablist" aria-label="榜单周期">{([ ["day", "日榜"], ["week", "周榜"], ["all", "总榜"] ] as const).map(([period, label]) => <button key={period} role="tab" aria-selected={rankingPeriod === period} className={rankingPeriod === period ? s.rankActive : ""} onClick={() => setRankingPeriod(period)}>{label}</button>)}</div>}
            {homeBanners.length > 0 && <div className={s.homeRails}>{homeBanners.map((banner) => banner.href
              ? <a key={banner.id} className={s.homeBanner} href={banner.href}><strong>{banner.title}</strong><p>{banner.body}</p></a>
              : <section key={banner.id} className={s.homeBanner} aria-label="首页横幅"><strong>{banner.title}</strong><p>{banner.body}</p></section>)}</div>}
            {((rankWaiting && sortMode === "recommended" && (tab === "新手" || tab === "猜你喜欢")) || ((publicShelf.loading || rankWaiting) && shelfList.length === 0)) ? (
              <div className={s.empty} role="status"><h2>正在加载角色</h2><p>马上就好。</p></div>
            ) : featured.length || shelf.length ? (
              <div className={`${s.cardGrid} ${state.preferences.homeLayout === "single" ? s.singleLayout : ""}`}>
                {(featured.length ? [...featured, ...shelf] : shelf).map(renderShelfItem)}
              </div>
            ) : (
              <div className={s.empty}>
                <Icon name={tab === "关注" ? "heart" : tab === "榜单" ? "trophy" : "search"} size={38} />
                <h2>
                  {tab === "关注" ? "还没有关注作者" : tab === "榜单" && usesServerRank ? "榜单" : "没有找到相关角色"}
                </h2>
                <p>
                  {tab === "关注"
                    ? "进入作者主页，关注后就能在这里看到他的作品。"
                    : tab === "榜单" && usesServerRank && recommendation.status !== "ready"
                      ? (recommendation.status === "error" ? "榜单暂时没有更新，请稍后再看。" : "正在统计这个周期的真实互动。")
                    : tab === "榜单" && usesServerRank && recommendation.ids.length === 0
                      ? "这个周期还没有足够的真实互动。"
                    : appliedTags.length
                      ? `「${appliedTags.map(browseTagName).join("、")}」下还没有角色。创作时加上这个标签，或换一个看看。`
                      : "试试其他关键词，或者定制你自己的角色。"}
                </p>
                <button
                  className={s.primary}
                  onClick={() => {
                    setQuery("");
                    setAppliedTags([]);
                    setTab("新手");
                  }}
                >
                  浏览角色
                </button>
              </div>
            )}
            <div className={s.shelfMore} ref={shelfMoreRef}>
              {publicShelf.total > 0 && <p>已显示 {publicShelf.characters.length} / {publicShelf.total}</p>}
              {publicShelf.error && <p role="alert">{publicShelf.error}</p>}
              {publicShelf.loading && publicShelf.characters.length > 0 && <p>正在往下加载…</p>}
            </div>
          </main></>
          <footer className={s.footer}>
            <span>叙梦 · 与角色相遇，让故事继续。</span>
            <a href={XUMENG_TELEGRAM_GROUP_URL} target="_blank" rel="noopener noreferrer" title="加入 Telegram 群（新标签页打开）">Telegram</a>
            <button
              onClick={() =>
                setNotice(
                  "角色目录包含公开介绍原文和原创改写样本，作者与出处见角色详情。",
                )
              }
            >
              内容来源
            </button>
            <button title="JSON 或带有角色卡的 PNG" onClick={() => importRef.current?.click()}>
              导入角色卡
            </button>
            <button onClick={() => navigate("presets")}>模型与预设</button>
            {!XUMENG_PAYMENT_INFO_DRAFT && XUMENG_PAYMENT_INFO_PAGES.map(page => (
              <a key={page.path} href={page.path}>{page.label}</a>
            ))}
          </footer>
        </>
      )}

      {view === "chat" && !detail && (
        <main className={s.chatLayout} data-list={chatListOpen ? "open" : "closed"}>
          <aside
            id="xumeng-chat-list"
            className={`${s.chatSidebar} ${active || gameSelection || companionInMain ? s.hasActive : ""}`}
          >
            <label className={s.conversationSearch}>
              <Icon name="search" size={16} />
              <input aria-label={conversationType === "stories" ? "搜索故事" : conversationType === "chats" ? "搜索聊天对象" : "搜索游戏"} placeholder={conversationType === "stories" ? "搜索故事、角色或剧情" : conversationType === "chats" ? "搜索聊天对象" : "搜索游戏作品"} maxLength={120}
                value={conversationQuery} onChange={event => setConversationQuery(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") setConversationQuery(""); }} />
              {conversationQuery && <button type="button" aria-label="清除会话搜索" onClick={() => setConversationQuery("")}><Icon name="close" size={14} /></button>}
            </label>
            <div className={gameNavigation.filters} role="group" aria-label="互动分类">
              {([ ["stories", "故事"], ["chats", "聊天"], ["games", "游戏"] ] as const).map(([type,label]) => <button key={type} aria-pressed={conversationType === type} onClick={() => selectChatSection(type)}>{label}</button>)}
            </div>
            {conversationType === "games" && gameLibrary.recentError && <p className={gameNavigation.cacheWarning} role="status">{gameLibrary.recentError}</p>}
            <div className={s.conversationList} aria-label={conversationType === "stories" ? "故事列表" : conversationType === "chats" ? "聊天列表" : "游戏列表"}>
              {conversationType === "games" && <>
                {visibleBuiltinGames.map(game => <button key={game.id} className={`${s.conversation} ${gameSelection?.kind === "builtin" && gameSelection.id === game.id ? s.conversationActive : ""}`} aria-label={`游玩${game.title}`} onClick={() => playGame({ kind: "builtin", id: game.id })}>
                  <div className={gameNavigation.gameAvatar} aria-hidden="true"><Icon name="game" size={23}/></div><span><strong>{game.title}</strong><small>{game.synopsis}</small></span>
                </button>)}
                {cloud.user?.isGuest ? <div className={gameNavigation.listState}><p>登录后可以保存你自己的游戏作品。</p><button onClick={() => openAccount("login")}>登录</button></div>
                : gameLibrary.loading || !cloud.user ? <p className={s.sidebarEmpty} role="status">正在加载游戏…</p>
                : gameLibrary.error ? <div className={gameNavigation.listState} role="alert"><p>{gameLibrary.error}</p><button onClick={gameLibrary.refresh}>重新加载</button></div>
                : visibleGames.length ? <><div className={gameNavigation.listState}><button onClick={() => openCreatorRoute("studio/games")}>上传游戏</button></div>{visibleGames.map(game => <button key={game.id} className={`${s.conversation} ${gameSelection?.kind === "private" && gameSelection.id === game.id ? s.conversationActive : ""}`} aria-label={`游玩${game.title}`} onClick={() => playGame({ kind: "private", id: game.id })}>
                  <div className={gameNavigation.gameAvatar} aria-hidden="true"><Icon name="game" size={23}/></div><span><strong>{game.title}</strong>{gameLastPlayed.has(game.id) && <time className={s.conversationTime}>{new Date(gameLastPlayed.get(game.id)!).toLocaleDateString("zh-CN", {month:"numeric",day:"numeric"})}</time>}<small>{game.synopsis || "私人游戏作品"}</small></span>
                </button>)}</>
                : <div className={gameNavigation.listState}><p>{conversationQuery && visibleBuiltinGames.length === 0 ? "没有找到匹配的游戏。" : "还没有你自己的游戏作品。"}</p>{!conversationQuery && <button onClick={() => openCreatorRoute("studio/games")}>上传游戏</button>}</div>}
              </>}
              {conversationType === "chats" && <div className={gameNavigation.listState}><button onClick={() => openGirlfriendStudio("new")}>上传女友</button></div>}
              {conversationType === "chats" && girlfriends.filter(person => `${person.nickname} ${person.aliasNames.join(" ")} ${person.lines.join(" ")}`.toLocaleLowerCase().includes(conversationQuery.trim().toLocaleLowerCase())).map(person => <button key={person.id} className={gameNavigation.companionEntry} aria-current={companionInMain && mineId === person.id ? "page" : undefined} aria-label={`${person.nickname}，${person.lines[0] || ""}`} onClick={() => openMineGirlfriend(person.id)}>
                <span className={gameNavigation.companionFace}><span className={gameNavigation.companionAvatar} aria-hidden="true"><img src={person.cover} alt="" /></span></span>
                <span className={gameNavigation.companionCopy}><strong>{person.nickname}</strong><small>{person.lines[0]}</small></span>
              </button>)}
              {conversationType === "chats" && chatPeople.map(person => {
                const lane = companionLane(person);
                const row = chatInbox.get(lane);
                const preview = row?.preview || person.line;
                const unread = row?.unread ?? 0;
                return <button key={person.castId || person.variant} className={gameNavigation.companionEntry} aria-current={companionInMain && companionVariant === person.variant && (person.variant !== "cast" || castCompanion?.id === person.castId) ? "page" : undefined} aria-label={unread ? `${person.name}，${unread}条未读，${preview}` : `${person.name}，${preview}`} onMouseEnter={() => warmCompanion(person.variant === "cast" ? "cast" : person.variant, person.castId || undefined)} onFocus={() => warmCompanion(person.variant === "cast" ? "cast" : person.variant, person.castId || undefined)} onClick={() => openCompanion(person.variant, undefined, person.castId || undefined)}>
                  <span className={gameNavigation.companionFace}>
                    <span className={gameNavigation.companionAvatar} aria-hidden="true"><img src={person.cover} alt="" /></span>
                    {unread > 0 && <b className={gameNavigation.companionBadge} aria-hidden="true">{unread > 99 ? "99+" : unread}</b>}
                  </span>
                  <span className={gameNavigation.companionCopy}>
                    <strong>{person.name}</strong>
                    {row?.at ? <time dateTime={new Date(row.at).toISOString()}>{chatListStamp(row.at)}</time> : null}
                    <small>{preview}</small>
                  </span>
                </button>;
              })}
              {conversationType === "chats" && !chatPeople.length && <p className={s.sidebarEmpty} role="status">没有找到匹配的聊天对象</p>}
              {conversationType === "stories" && visibleConversations.map((c) => {
                const ch = conversationCharacters.find((x) => x.id === c.characterId);
                const unread = activeId === c.id ? 0 : storyUnread(c.messages, storySeen[c.id]);
                return (
                  <button
                    key={c.id}
                    className={`${s.conversation} ${activeId === c.id ? s.conversationActive : ""}`}
                    aria-label={chatListOpen ? undefined : `${c.title}${unread ? `，${unread}条未读` : ""}`}
                    onClick={() => selectConversation(c)}
                  >
                    <span className={s.conversationAvatar}>
                      {ch ? <Cover character={ch} /> : <div className={s.unavailableAvatar} aria-hidden="true"><Icon name="chat" size={20} /></div>}
                      {unread > 0 && <b className={s.unreadBadge} aria-label={`${unread}条未读`}>{unread > 99 ? "99+" : unread}</b>}
                    </span>
                    <span className={s.conversationMeta}>
                      <strong>{c.title}</strong>
                      <time className={s.conversationTime}>{formatConversationStamp(c.updatedAt)}</time>
                      <small>
                        {generating[c.id] && <span className={s.conversationGenerating}>正在回复… </span>}
                        {!ch && <span>{pendingCharacterIds.has(c.characterId) ? "正在读取角色" : "角色暂不可用"}</span>}
                        {(!ch ? " · " : "") + (xumengConversationPreview(c.messages.at(-1)?.content ?? "") || (c.messages.at(-1)?.content ? "查看对话" : "开始新的故事"))}
                      </small>
                    </span>
                  </button>
                );
              })}
              {conversationType === "stories" && !visibleConversations.length && (
                <p className={s.sidebarEmpty} role="status">{state.conversations.length ? "没有找到匹配的故事" : "还没有故事记录"}</p>
              )}
            </div>
            {conversationType === "stories" && <button
              className={s.importConversation}
              onClick={() => importChatRef.current?.click()}
            >
              <Icon name="upload" size={16} />
              导入会话
            </button>}
          </aside>
          <button
            type="button"
            className={s.chatListToggle}
            aria-expanded={chatListOpen}
            aria-controls="xumeng-chat-list"
            aria-label={chatListOpen ? "收起会话列表" : "展开会话列表"}
            onClick={toggleChatList}
          >
            <Icon name="chevron" size={16} />
          </button>
          <section className={s.chatMain} style={chatMainStyle}>
              {companionInMain ? (
              <Deferred>
              {companionVariant === "qwen"
                ? <QwenCompanion key={`${cloud.user?.id ?? "loading"}:qwen`} accountId={cloud.user && !cloud.user.isGuest ? cloud.user.id : undefined} avatar={CONTENT_PEOPLE.find(person => person.variant === "qwen")?.cover} onBack={leaveCompanion} onVoiceCall={() => callCompanion("qwen", "phone")} onVideoCall={() => callCompanion("qwen", "video")}/>
                : mineId && !minePerson && !girlfriendsReady ? <main className={s.profileEmpty}><p>正在打开这个女友…</p></main>
                : mineId && !minePerson && customCompanion?.id !== mineId ? <main className={s.profileEmpty}><p>这台设备上没有这个女友。</p><button className={s.secondary} onClick={() => openGirlfriendStudio("new")}>上传女友</button></main>
                : <CompanionPage key={`${cloud.user?.id ?? "loading"}:${companionVariant}:${companionVariant === "cast" ? castCompanion?.id ?? "" : mineId || customCompanion?.id || ""}`} accountId={cloud.user && !cloud.user.isGuest ? cloud.user.id : undefined} variant={companionVariant === "custom" ? "custom" : companionVariant} cast={companionVariant === "cast" ? castCompanion ?? undefined : undefined} lane={mineId ? `mine-${mineId}` : undefined} album={minePerson?.album ?? []} profile={minePerson ? girlfriendProfile(minePerson) : companionVariant === "custom" ? customCompanion ?? REALISTIC_COMPANION_PROFILES[0] : undefined} avatar={companionVariant === "cast" ? castCompanion?.cover : minePerson?.cover || (companionVariant === "custom" ? customCompanion?.cover : CONTENT_PEOPLE.find(person => person.variant === companionVariant)?.cover)} onBack={leaveCompanion} onLogin={() => { openAccount("login"); }} onVoiceCall={() => startCompanionCall("phone")} onVideoCall={() => startCompanionCall("video")}/>}
              </Deferred>
            ) : gameSelection ? (
              gameSelection.kind === "builtin"
                ? (gameLibrary.builtinGame ? <Deferred><GamePlayer key={`${cloud.user?.id}:builtin:${gameSelection.id}`} game={gameLibrary.builtinGame} onBack={leaveGame}/></Deferred> : <div className={gameNavigation.gameLoading} role={gameLibrary.builtinError ? "alert" : "status"}><Icon name="game" size={36}/><p>{gameLibrary.builtinError || "正在打开游戏…"}</p>{gameLibrary.builtinError && <button onClick={gameLibrary.refresh}>重试打开</button>}<button onClick={leaveGame}>返回游戏列表</button></div>)
                : (gameLibrary.privateGame ? <Deferred><GamePlayer key={`${cloud.user?.id}:private:${gameSelection.id}:${gameLibrary.privateGame.version}`} game={gameLibrary.privateGame} onBack={leaveGame}/></Deferred> : <div className={gameNavigation.gameLoading} role={gameLibrary.privateError ? "alert" : "status"}><Icon name="game" size={36}/><p>{gameLibrary.privateError || "正在打开游戏…"}</p>{gameLibrary.privateError && <button onClick={cloud.user?.isGuest ? () => openAccount("login") : gameLibrary.refresh}>{cloud.user?.isGuest ? "登录" : "重试打开"}</button>}<button onClick={leaveGame}>返回游戏列表</button></div>)
            ) : activeCharacter && active ? (
              <>
                <header className={s.chatHeader}>
                  <button
                    className={`${s.iconButton} ${s.mobileBack}`}
                    aria-label="返回会话列表"
                    onClick={() => {
                      setActiveId(null);
                    }}
                  >
                    <Icon name="back" />
                  </button>
                  <button
                    className={s.chatIdentity}
                    onClick={() => showDetail(activeCharacter)}
                  >
                    <Cover character={activeCharacter} />
                    <span>
                      <strong>{activeCharacter.name}</strong>
                      <small><span className={s.onlineDot} />{chatPresence(activeCharacter, busy)}</small>
                    </span>
                  </button>
                  <div className={s.modelPicker}>
                    <button
                      className={s.modelButton}
                      aria-label="选择 AI 模型"
                      aria-expanded={modelMenuOpen}
                      disabled={busy}
                      onClick={() => { if (!activeReplyActive()) setModelMenuOpen((open) => !open); }}
                    >
                      {MODEL_MODES.find(mode => mode.id === normalizeDzmmModelSelection(state.preferences.model))?.label}
                      <Icon name="chevron" size={12} />
                    </button>
                    {modelMenuOpen && (
                      <div className={s.modelMenu}>
                        <div className={s.modelMenuTitle}>
                          AI 模型
                          <button className={s.iconButton} aria-label="关闭模型菜单" onClick={() => setModelMenuOpen(false)}>
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                        <div role="listbox" aria-label="模型模式">
                          {MODEL_MODES.map((mode) => (
                            <button
                              key={mode.id}
                              role="option"
                              aria-selected={normalizeDzmmModelSelection(state.preferences.model) === mode.id}
                              disabled={busy}
                              onClick={() => {
                                if (activeReplyActive()) return;
                                setState((previous) => ({ ...previous, preferences: { ...previous.preferences, model: mode.id } }));
                                setModelMenuOpen(false);
                              }}
                            >
                              <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
                              <span>{normalizeDzmmModelSelection(state.preferences.model) === mode.id && <Icon name="check" size={15} />}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={s.chatHeaderTools}>
                    <button className={s.iconButton} aria-label="当前角色生成语音" title="角色语音" disabled={busy} onClick={() => performActiveCharacter("voice")}><Icon name="volume" size={18} /></button>
                    <button
                      className={s.iconButton}
                      aria-label="查看当前角色"
                      title="查看角色"
                      disabled={busy}
                      onClick={() => showDetail(activeCharacter)}
                    >
                      <Icon name="book" size={17} />
                    </button>
                    <button
                      className={s.iconButton}
                      aria-label="开启新会话"
                      title={getDzmmNewConversationBlockReason(activeCharacter) ?? "开启新会话，保留当前记录"}
                      disabled={busy || getDzmmNewConversationBlockReason(activeCharacter) !== null}
                      onClick={() => startChat(activeCharacter, true)}
                    >
                      <Icon name="plus" size={18} />
                    </button>
                    <button
                      className={`${s.iconButton} ${state.favorites.includes(activeCharacter.id) ? s.favorited : ""}`}
                      aria-label="收藏当前角色"
                      aria-pressed={state.favorites.includes(
                        activeCharacter.id,
                      )}
                      title="收藏角色"
                      onClick={() => toggleFavorite(activeCharacter.id)}
                    >
                      <Icon name={state.favorites.includes(activeCharacter.id) ? "check" : "book"} size={17} />
                    </button>
                    <button
                      className={s.iconButton}
                      aria-label="导出会话"
                      title="导出会话"
                      onClick={exportConversation}
                    >
                      <Icon name="download" size={17} />
                    </button>
                    <button
                      className={s.iconButton}
                      aria-label="聊天设置"
                      title="聊天设置"
                      disabled={busy}
                      onClick={() => setChatSettingsOpen(true)}
                    >
                      <Icon name="sliders" size={17} />
                    </button>
                    {XUMENG_CALLS_ENABLED && <>
                      <button className={`${s.iconButton} ${s.callButton}`} aria-label="给当前角色打语音电话，接通预扣 200 Credit" title={chatBalance !== null && chatBalance < 200 ? "余额低于 200 Credit，暂不能通话" : "语音通话，接通预扣 200 Credit"} disabled={busy || (billingConfig?.enabled === true && chatBalance !== null && chatBalance < 200)} onClick={() => performActiveCharacter("live", "phone")}><Icon name="phone" size={18} /></button>
                      <button className={`${s.iconButton} ${s.callButton}`} aria-label="给当前角色打视频电话，接通预扣 200 Credit" title={chatBalance !== null && chatBalance < 200 ? "余额低于 200 Credit，暂不能通话" : "视频通话，接通预扣 200 Credit"} disabled={busy || (billingConfig?.enabled === true && chatBalance !== null && chatBalance < 200)} onClick={() => performActiveCharacter("live", "video")}><Icon name="video" size={18} /></button>
                    </>}
                  </div>
                </header>
                <div className={s.messageScroll} ref={messageScrollRef} data-message-scroll="">
                  <ChatMediaProvider key={`${cloud.user?.id ?? "offline"}:${active.id}`} accountId={cloud.user?.id}
                    conversationId={active.id} isGuest={cloud.user?.isGuest ?? true} saveNow={cloud.saveNow}
                    onRequireAccount={() => openAccount("login")}
                    onCharged={() => setBillingRefresh(value => value + 1)}
                    onRecharge={() => navigate("recharge")}>
                  <div className={s.messageList}>
                    {active.messages.map((m, index) => (
                      <div
                        key={m.id}
                        className={`${s.messageRow} ${m.role === "user" ? s.userRow : ""} ${index > 0 && active.messages[index - 1]?.role === m.role ? s.messageGrouped : ""}`}
                      >
                        {m.role === "assistant" ? (
                          <button type="button" className={s.messageAvatarButton} aria-label={`查看${activeCharacter.name}`} onClick={() => showDetail(activeCharacter)}>
                            <Cover character={activeCharacter} className={s.messageAvatar} />
                          </button>
                        ) : (
                          <span className={`${s.avatar} ${s.messageAvatar}`} aria-hidden="true">{Array.from(state.preferences.nickname)[0] || "我"}</span>
                        )}
                        <div className={s.messageContent}>
                          <span className={s.srOnly}>{m.role === "user" ? state.preferences.nickname : activeCharacter.name}</span>
                          {m.role === "assistant" && activeOpening?.messages[index]?.role === m.role
                            && activeOpening.messages[index].content.trim() === m.content.trim() && (
                            <small className={s.openingTag}>{activeOpening.kind === "background" ? "故事背景" : activeOpening.kind === "welcome" ? "故事起点" : "开场白"}</small>
                          )}
                          <ChatMessageMedia message={m} disabled={busy} label={`第 ${index + 1} 条消息`}
                            moment={m.id === momentMessageId ? { name: activeCharacter.name, fields: momentFields, sections: momentSections } : undefined}
                            onCopy={() => { void copyMessage(splitXumengMomentTail(splitXumengPanelTail(m.content).body).body); }} onEdit={() => editMessage(m)}
                            onRegenerate={canRegenerateDzmmMessage(active, m.id) ? () => regenerateMessage(m.id) : undefined}>
                          <div className={s.messageBubble} data-message-text>
                            {m.role === "assistant" && activeOpening?.source === "template"
                              && activeOpening.messages[index]?.content.trim() === m.content.trim() ? <CharacterIntroduction text={m.content}
                              characterName={activeCharacter.name} userName={playUserName}
                              additionalNotes={activeOpening?.source === "template" && index === activeOpening.messages.findIndex(message => message.role === "assistant")
                                ? getDzmmCharacterCreatorNotes(activeCharacter) : undefined}
                              renderBody={body => <MessageText text={body} statusLabels={statusBarLabels} showPeeledStatus={m.id !== momentMessageId} />} /> : <MessageText text={m.content} role={m.role} characterName={activeCharacter.name} userName={playUserName} statusLabels={statusBarLabels} showPeeledStatus={m.id !== momentMessageId} />}
                          </div>
                          </ChatMessageMedia>
                          {m.role === "assistant" && m.content.trim() && <ReplySuggestions key={`${profileUser.id}:${active.id}:${m.id}`}
                            contextKey={`${profileUser.id}:${active.id}:${m.id}:${replySuggestionKeys[index]}`}
                            accountId={profileUser.id} onAutomaticStart={() => {}} automatic={false}
                            label={`第 ${index + 1} 条回复`} disabled={busy || cloud.authBusy || (billingConfig?.enabled === true && !!cloud.user && !cloud.user.isGuest && chatBalance === 0)}
                            historical={index !== active.messages.length - 1} onGenerate={signal => generateReplySuggestions(m.id, signal)}
                            onChoose={reply => chooseReplySuggestion(m.id, reply)} />}
                        </div>
                      </div>
                    ))}
                    {busy && active.messages.at(-1)?.role !== "assistant" && (
                      <div className={s.typing}>
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                    {busy && summarizing && <p className={s.memoryProgress} role="status">正在整理较早的剧情，完成后继续回复…</p>}
                    {!busy && !active.messages.some(message => message.role === "user") && (
                      <div className={s.quickStarts}>
                        <button
                          type="button"
                          disabled={cloud.authBusy}
                          onClick={() => { void sendSuggested("请随机生成我的身份和起始地点，从第一场事件开始。"); }}
                        >
                          随机开局 <Icon name="shuffle" size={12} />
                        </button>
                      </div>
                    )}
                    {!busy && !active.messages.some(message => message.role === "user") && Boolean(activeCharacter.suggestedReplies?.length) && <div className={s.quickStarts} aria-label="角色建议回复">{activeCharacter.suggestedReplies?.map((reply, index) => <button key={`${index}:${reply}`} type="button" disabled={cloud.authBusy} onClick={() => { void sendSuggested(reply); }}>{reply}</button>)}</div>}
                    <div ref={endRef} />
                  </div>
                  </ChatMediaProvider>
                </div>
                <div className={s.composerWrap}>
                  {error && (
                    <p className={s.chatError} role="alert">
                      {error}
                      <button
                        onClick={() => setError("")}
                        aria-label="关闭错误提示"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </p>
                  )}
                    {composerStorageWarning && <div className={s.chatError} role="alert"><p>{composerStorageWarning}</p><button type="button" className={s.secondary} onClick={() => download("输入草稿.json", JSON.stringify({ version: 1, accountId: cloud.user?.id, drafts: composerDrafts, ...(composerOriginalCache !== undefined ? { originalCache: composerOriginalCache } : {}) }, null, 2))}>导出输入草稿</button></div>}
                    {pendingDraft && !busy && <details className={s.chatError}><summary>上次发送的内容</summary><p style={{ whiteSpace: "pre-wrap" }}>{pendingDraft.text}</p><button type="button" onClick={() => {
                      const combined = draft ? `${draft}\n${pendingDraft.text}` : pendingDraft.text;
                      if (combined.length > 12000) { setNotice("合并后超过输入上限，请先导出或发送当前输入，再恢复原文。"); return; }
                      if (activeId) setComposerDrafts(previous => ({ ...previous, [activeId]: { text: combined, failed: previous[activeId]?.failed ?? [] } }));
                    }}>恢复到输入框</button><button type="button" onClick={() => {
                      if (activeId) setComposerDrafts(previous => {
                        const current = previous[activeId]; if (!current) return previous;
                        const { pending: confirmed, ...rest } = current; void confirmed;
                        return { ...previous, [activeId]: rest };
                      });
                    }}>移除</button></details>}
                  <ChatBillingStatus key={cloud.user?.id ?? "offline"} accountId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true}
                    enabled={billingConfig?.enabled ?? false} refreshKey={billingRefresh} onUsage={usage => setChatBalance(usage ? usage.availableBalance : null)}
                    onRequireAccount={() => openAccount("login")} onRecharge={() => navigate("recharge")} />
                  <form
                    className={s.composer}
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                  >
                    <div className={s.composerBar}>
                      <ComposerQuickInsert disabled={!loaded || cloud.authBusy} onInsert={insertComposerSnippet} />
                      <span className={s.composerHint}>{enterSends ? "Enter 发送，Shift+Enter 换行" : "点发送按钮发出"}</span>
                    </div>
                    <textarea
                      ref={composerInputRef}
                      aria-label="发送消息"
                      disabled={!loaded || cloud.authBusy}
                      placeholder="输入消息"
                      enterKeyHint={enterSends ? "send" : "enter"}
                      value={draft}
                      maxLength={12000}
                      rows={1}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
                          enterSends
                        ) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <div className={s.composerSendRow}>
                    {busy ? (
                      <button
                        key="stop-generation"
                        className={`${s.sendButton} ${s.stopButton}`}
                        type="button"
                        onClick={(e) => { e.preventDefault(); if (activeId) replyRequests.current.get(activeId)?.abort(); }}
                        aria-label="停止生成"
                      >
                        停止
                      </button>
                    ) : (
                      <button
                        key="send-message"
                        className={s.sendButton}
                        type="submit"
                        disabled={!loaded || cloud.authBusy || !draft.trim() || (billingConfig?.enabled === true && !!cloud.user && !cloud.user.isGuest && chatBalance === 0)}
                        aria-label="发送"
                      >
                        发送
                      </button>
                    )}
                    </div>
                  </form>
                </div>
              </>
            ) : active && pendingCharacterIds.has(active.characterId) ? (
              <div className={s.empty} role="status"><p>正在读取角色…</p></div>
            ) : active ? (
              <UnavailableConversation key={`${profileUser.id}:${active.id}`} conversation={active} nickname={state.preferences.nickname}
                onBack={() => {
                  if (activeReplyActive()) { setNotice("正在停止当前回复，请稍候再返回。"); return; }
                  setActiveId(null);
                }} onExport={exportConversation} onDelete={removeActiveConversation}
                onCopy={text => { void copyMessage(text); }} />
            ) : (
              <div className={s.empty}>
                <span className={s.emptyChatIcon}>
                  <Icon name={conversationType === "games" ? "game" : conversationType === "chats" ? "heart" : "book"} size={38} />
                </span>
                <h2>{conversationType === "chats" ? "聊聊今天的小事" : conversationType === "games" ? "选一部游戏，开始游玩" : state.conversations.length ? "选择一段故事继续" : "开启你的第一段故事"}</h2>
                <p>{conversationType === "chats" ? "从左边选一个人，慢慢认识彼此。" : conversationType === "games" ? "从左边选一部你自己的游戏，或导入新作品。" : state.conversations.length ? "从列表继续剧情，或遇见一个新的角色。" : "去找一个心仪的角色吧"}</p>
                {conversationType !== "games" && <button
                  className={s.primary}
                  onClick={() => conversationType === "chats" ? openCompanion() : navigate("characters")}
                >
                  {conversationType === "chats" ? "开始聊天" : "选择角色"} <Icon name="chevron" size={16} />
                </button>}
                {conversationType === "stories" && <button
                  className={s.textButton}
                  onClick={() => importChatRef.current?.click()}
                >
                  <Icon name="upload" size={15} />
                  导入会话
                </button>}
              </div>
            )}
          </section>
        </main>
      )}

      <Deferred>
      {view === "videos" && !detail && <VideoChannel />}
      {view === "generation" && !detail && (XUMENG_GENERATION_WORKSPACE_ENABLED ? (cloud.user ? <GenerationStudio key={cloud.user.id} userId={cloud.user.id} isGuest={cloud.user.isGuest} onRequireAccount={() => openAccount("register")} onRecharge={XUMENG_PAYMENTS_ENABLED ? () => navigate("recharge") : undefined} onBack={() => navigate("studio")} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>) : <GenerationHistory key={cloud.user?.id ?? "guest"} userId={cloud.user?.id ?? ""} isGuest={cloud.user?.isGuest ?? true} onRequireAccount={() => openAccount("login")} />)}

      {view === "tasks" && !detail && (cloud.user ? <TaskHub key={`${cloud.user.id}:${cloud.user.isGuest}`} userId={cloud.user.id} isGuest={cloud.user.isGuest} isSuper={cloud.user.role === "super"} characters={cloud.catalog} selection={taskSelection} onSelectionChange={(selection) => updateTaskSelection(cloud.user!.id, selection)} onCharacter={(id, selection) => { const character = cloud.catalog.find(card => card.id === id); if (character) showDetail(character, selection); }} onNavigate={(target) => { navigate(target); }} onRequireAccount={() => openAccount("register")} beforeRefresh={cloud.saveNow} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>)}
      {view === "app" && !detail && <InstallApp onBack={() => navigate("characters")} />}
      {view === "checkin" && !detail && (cloud.user ? <DailyCheckin key={`${cloud.user.id}:${cloud.user.isGuest}`} userId={cloud.user.id} isGuest={cloud.user.isGuest} onRequireAccount={() => openAccount("register")} onBack={() => navigate("tasks")} onTasks={() => navigate("tasks")} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>)}
      {(view === "recharge" || view === "vip") && !detail && (cloud.user ? <Recharge key={`${cloud.user.id}:${cloud.user.isGuest}`} focusVip={view === "vip"} userId={cloud.user.id} isGuest={cloud.user.isGuest} onRequireAccount={() => openAccount("login")} onBack={() => navigate("profile")} returnOrderId={paymentReturn?.get("payment_order") || undefined} cancelled={paymentReturn?.get("payment") === "cancel"} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>)}
      {view === "studio" && !detail && <CreatorCenter key={profileUser.id} section={creatorSection} user={cloud.user} drafts={state.custom} onCreate={() => openStudio("new")} onEdit={openStudio} onCharacter={showDetail} onRequireAccount={() => openAccount("register")} onCatalogChanged={cloud.refreshCatalog} onRoute={openCreatorRoute} />}
      {(view === "live" || view === "voice") && !detail && performanceLibrary.error && <div className={s.error} role="alert">{performanceLibrary.error}<button onClick={performanceLibrary.refresh}>重试加载人物</button></div>}
      {view === "live" && !detail && !XUMENG_CALLS_ENABLED && <main className={s.profileEmpty}><h1>通话暂时关闭</h1><p>{XUMENG_CALLS_LOCKED_MESSAGE}</p><button className={s.secondary} onClick={() => navigate("characters")}>回到角色</button></main>}
      {view === "live" && !detail && XUMENG_CALLS_ENABLED && (performanceCharacter ? (liveMode === "phone"
        ? <MiniCpmPhone key={`${profileUser.id}:${cloud.user?.isGuest}:${performanceCharacter.key}`} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} userName={playUserName} initialCharacter={performanceCharacter} onRequireAccount={() => openAccount("login")} onBack={returnFromCall} onVideo={() => setLiveMode("video")} onBusyChange={(working) => { liveBusy.current = working; }} />
        : <LiveStudio key={`${profileUser.id}:${cloud.user?.isGuest}`} preferVideo userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} isSuper={cloud.user?.role === "super"} userName={playUserName} characters={[performanceCharacter]} sources={performanceLibrary.sources} initialCharacter={performanceCharacter} onVoice={(character) => performCharacter(character, "voice")} onRequireAccount={() => openAccount("login")} onBack={() => setLiveMode("phone")} onBusyChange={(working) => { liveBusy.current = working; }} />)
        : <main className={s.profileEmpty}><p>打开一段聊天，再给对方打电话。</p><button className={s.secondary} onClick={() => navigate("chat", "chat/chats")}>去消息</button></main>)}
      {view === "voice" && !detail && <VoiceStudio key={`${profileUser.id}:${cloud.user?.isGuest}`} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} characters={performanceLibrary.characters} initialCharacter={performanceCharacter ?? undefined} onRequireAccount={() => openAccount("login")} onBack={() => navigate("characters")} onBusyChange={(working) => { voiceBusy.current = working; }} />}
      {view === "novels" && !detail && <NovelStudio key={`${profileUser.id}:${novelInitial.id ?? novelInitial.type ?? "library"}`} initialId={novelInitial.id} initialType={novelInitial.type} onNavigate={(id, type) => { novelRoute.current = id === null ? "novels" : id === "new" ? `novels/new/${type ?? "novel"}` : `novels/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${novelRoute.current}`); }} onSaved={id => { novelRoute.current = `novels/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${novelRoute.current}`); }} characters={characters} onPerformCharacter={performCharacter} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} onRequireAccount={() => openAccount("login")} onBack={() => navigate("studio")} onDirtyChange={(dirty) => { novelDirty.current = dirty; }} onBusyChange={(working) => { novelBusy.current = working; }} />}
      {view === "girlfriends" && !detail && <GirlfriendStudio key={`${profileUser.id}:${creatorInitial.id ?? "library"}`} userId={cloud.user?.id ?? null} isGuest={cloud.user?.isGuest ?? true} initialId={creatorInitial.id} onRequireAccount={() => openAccount("login")} onBack={() => { creatorDirty.current = false; navigate("chat", "chat/chats"); }} onOpen={openMineGirlfriend} onSaved={rememberGirlfriend} onDeleted={id => setGirlfriends(people => people.filter(item => item.id !== id))} onDirtyChange={dirty => { creatorDirty.current = dirty; }} />}
      {view === "games" && !detail && <GameStudio key={`${profileUser.id}:${creatorInitial.id ?? "library"}`} userId={cloud.user?.id ?? null} isGuest={cloud.user?.isGuest ?? true} initialId={creatorInitial.id} onNavigate={id => { creatorRoute.current = id ? `studio/games/${encodeURIComponent(id)}` : "studio/games"; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onSaved={id => { creatorRoute.current = `studio/games/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onRequireAccount={() => openAccount("register")} onBack={() => { creatorDirty.current = false; creatorBusy.current = false; navigate("studio"); }} onDirtyChange={dirty => { creatorDirty.current = dirty; }} onBusyChange={working => { creatorBusy.current = working; }}/>}
      {view === "scenarios" && !detail && <ScenarioStudio key={`${profileUser.id}:${creatorInitial.id ?? creatorInitial.roomCode ?? "library"}`} userId={cloud.user?.id ?? null} isGuest={cloud.user?.isGuest ?? true} initialId={creatorInitial.id} initialRoomCode={creatorInitial.roomCode} onNavigate={id => { creatorRoute.current = id ? `studio/scenarios/${encodeURIComponent(id)}` : "studio/scenarios"; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onSaved={id => { creatorRoute.current = `studio/scenarios/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onRoom={code => { creatorRoute.current = `studio/room/${encodeURIComponent(code)}`; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onRequireAccount={() => openAccount("register")} onBack={() => { creatorDirty.current = false; creatorBusy.current = false; navigate("studio"); }} onDirtyChange={dirty => { creatorDirty.current = dirty; }} onBusyChange={working => { creatorBusy.current = working; }}/>}
      {view === "studio-edit" && !detail && editor && <CharacterStudio key={`${profileUser.id}:${studioSession}`} character={editor === "new" ? null : editor} nickname={state.preferences.nickname} user={cloud.user} submission={studioSubmission} onClose={() => { studioDirty.current = false; studioBusy.current = false; setEditor(null); navigate("studio"); }} onDirtyChange={(dirty) => { studioDirty.current = dirty; }} onBusyChange={(working) => { studioBusy.current = working; }} onSave={saveStudioCharacter} onRetrySave={(character) => saveStudioCharacter(character, true)} onSubmit={submitStudioCharacter} onLoadCloud={async () => { if (!await cloud.reloadCloud()) throw new Error("云端版本没有载入，当前编辑内容仍保留。请再加载云端版本。"); }} onTest={testStudioCharacter} onRequireAccount={() => openAccount("register")} />}
      {view === "profile" && !detail && <>
        <ProfileView key={profileUser.id} user={cloud.user} characters={characters} custom={state.custom} favorites={state.favorites} conversations={state.conversations} authors={authors} preferences={state.preferences} onCharacter={showDetail} onAuthor={showAuthor} onConversation={(conversation) => { selectConversation(conversation); navigate("chat"); }} onEditCharacter={openStudio} onCreateCharacter={() => openStudio("new")} onEditProfile={() => navigate("settings")} onSettings={() => navigate("settings")} onPresets={() => navigate("presets")} onRecharge={() => navigate("recharge")} onInvite={() => navigate("invite")} onLogin={() => openAccount("login")} onRegister={() => openAccount("register")} onBrowse={() => navigate("characters")} onDeleteCharacter={deleteCharacter} onAdmin={cloud.user?.role === "super" ? () => navigate("admin") : undefined} />
        <div className={s.profile}>
          {cloud.user && !cloud.user.isGuest && <>
          <section className={`${s.cloudAccount} ${cloud.user?.isGuest ? s.cloudAccountGuest : ""}`} aria-label="账号与数据库同步">
            <div className={s.cloudStatus} data-status={cloud.syncStatus} role="status">
              <span className={s.syncDot} />
              <div><strong>{cloud.syncMessage}</strong>{cloud.syncStatus === "synced" && cloud.lastSyncedAt && <small>最近同步 {new Date(cloud.lastSyncedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}</small>}</div>
            </div>
            <div className={s.cloudActions}>
              {cloud.authenticated && <button className={s.secondary} disabled={cloud.authBusy || busy} onClick={() => void cloud.logout()}>退出账号</button>}
              <button className={s.secondary} disabled={cloud.authBusy || busy || cloud.syncStatus === "saving" || cloud.syncStatus === "loading"} onClick={() => void (cloud.syncStatus === "conflict" ? cloud.reloadCloud() : cloud.retrySync())}><Icon name="refresh" size={14} />{cloud.syncStatus === "conflict" ? "加载云端版本" : "重新同步"}</button>
              {cloud.backupAvailable && <>
                <label className={s.backupChoice}>本地恢复版本
                  <select aria-label="选择本地备份" value={selectedBackup} disabled={cloud.authBusy || busy} onChange={event => setBackupSelection({ accountId: cloud.user?.id ?? "offline", key: event.target.value })}>
                    {cloud.backupChoices.map(item => <option key={item.key} value={item.key}>{new Date(item.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })} · {item.messageCount} 条消息 · 云端版本 {item.version}</option>)}
                  </select>
                </label>
                <button className={s.secondary} disabled={cloud.authBusy || busy || !selectedBackup} onClick={() => cloud.restoreBackup(selectedBackup)}><Icon name="upload" size={14} />恢复本地备份</button>
                <button className={s.secondary} disabled={cloud.authBusy || busy || !selectedBackup} onClick={() => {
                  const backup = cloud.readBackupForExport(selectedBackup);
                  if (backup) download("xumeng-recovery-backup.json", JSON.stringify(backup, null, 2));
                }}><Icon name="download" size={14} />导出所选备份</button>
                <button className={s.secondary} disabled={cloud.authBusy || busy || !selectedBackup} onClick={() => {
                  if (window.confirm("删除所选本地恢复版本？它可能来自另一个标签页。请先导出需要保留的内容；删除后无法从此备份恢复。")) cloud.discardBackup(selectedBackup);
                }}>删除所选备份</button>
              </>}
            </div>
          </section>
          <button className={s.secondary} onClick={() => download("dzmm-account-backup.json", JSON.stringify(state, null, 2))}><Icon name="download" />导出记录备份</button>
          </>}
        </div>
      </>}
      {view === "invite" && !detail && <InviteCenter key={profileUser.id} user={cloud.user} onBack={() => navigate("profile")} onRegister={() => openAccount("register")} onWallet={() => navigate("profile")} />}
      {view === "settings" && !detail && <ProfileSettings key={profileUser.id} user={cloud.user} preferences={state.preferences} onPreferences={savePreferences} onBack={() => navigate("profile")} onPasswordChanged={cloud.passwordConfigured} onEmailBound={cloud.emailBound} />}
      {view === "presets" && !detail && <PresetLibrary key={profileUser.id} preferences={state.preferences} onPreferences={savePreferences} onBack={() => navigate("profile")} />}
      {view === "author" && !detail && (selectedAuthor ? <AuthorProfile key={selectedAuthor.id} author={selectedAuthor} characters={[...characters, ...publicShelf.characters]} preferences={state.preferences} onPreferences={savePreferences} onCharacter={showDetail} onBack={() => navigate("characters")} more={{ total: publicShelf.total, hasMore: publicShelf.hasMore, loading: publicShelf.loading, serverFiltered: publicShelf.serverFiltered, onLoad: publicShelf.loadMore }} /> : publicShelf.loading ? <main className={s.profileEmpty}><p>正在加载作者…</p></main> : <main className={s.profileEmpty}><p>没有找到这位作者。</p><button className={s.secondary} onClick={() => navigate("characters")}>返回角色广场</button></main>)}
      {view === "search" && !detail && <SearchResults query={query} characters={shelfList} authors={authors} favorites={state.favorites} likes={likedForCurrentAccount} preferences={state.preferences} locale={locale} onCharacter={showDetail} onFavorite={toggleFavorite} onLike={toggleLike} onAuthor={showAuthor} onTag={(tag) => { setTab("新手"); setAppliedTags([tag]); navigate("characters"); }} reasons={showRecommendationReasons ? recommendation.reasons : undefined} trackRecommendations={rankReady} searchTopics={XUMENG_FORUM_ENABLED ? searchForumTopics : undefined} onTopic={XUMENG_FORUM_ENABLED ? (topic) => showForumPost(topic.id) : undefined} more={{ total: publicShelf.total, hasMore: publicShelf.hasMore, loading: publicShelf.loading, serverFiltered: publicShelf.serverFiltered, onLoad: publicShelf.loadMore }} />}
      {view === "forum" && !detail && XUMENG_FORUM_ENABLED && <ForumView key={profileUser.id} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} nickname={state.preferences.nickname} isSuper={cloud.user?.role === "super"} postId={forumPostId ?? undefined} onPostChange={showForumPost} onRequireAccount={() => openAccount("register")} characters={shelfList} onCharacter={showDetail} shelfMore={{ total: publicShelf.total, hasMore: publicShelf.hasMore, loading: publicShelf.loading, onLoad: publicShelf.loadMore }} />}
      {view === "admin" && !detail && <AdminDashboard key={`${cloud.user?.id}:${cloud.user?.role}`} user={cloud.user} onRequireAccount={() => openAccount("login")} onAccountChanged={() => setBillingRefresh(value => value + 1)}
        publishingReview={<PublishingCenter key={`review:${profileUser.id}`} admin user={cloud.user} drafts={state.custom} onCreate={() => openStudio("new")} onEdit={openStudio} onCharacter={showDetail} onRequireAccount={() => openAccount("login")} onCatalogChanged={cloud.refreshCatalog} onNovels={() => navigate("novels")} />}
        forumModeration={<ForumView key={profileUser.id} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} nickname={state.preferences.nickname} isSuper={cloud.user?.role === "super"} postId={forumPostId ?? undefined} onPostChange={showForumPost} onRequireAccount={() => openAccount("register")} characters={characters.filter((character) => !isDzmmCharacterBlocked(character, state.preferences.blockedTags))} onCharacter={showDetail} />} />}
      </Deferred>

      <nav className={s.mobileNav} aria-label="移动端导航">
        {localizedNav.map((n) => (
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
      {view !== "chat" && view !== "videos" && view !== "live" && view !== "voice" && view !== "admin" && !detail && state.preferences.showFloatingChat !== false && (
        <button
          className={s.floatingChat}
          style={{ opacity: (state.preferences.floatingOpacity ?? 100) / 100, width: state.preferences.floatingSize === "small" ? 44 : state.preferences.floatingSize === "large" ? 64 : 54, height: state.preferences.floatingSize === "small" ? 44 : state.preferences.floatingSize === "large" ? 64 : 54 }}
          aria-label="打开聊天"
          onClick={() => navigate("chat")}
        >
          <Icon name="chat" size={24} />
        </button>
      )}
      {notice && (
        <div className={s.toast} role="status">
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json,.png,image/png"
        hidden
        onChange={(e) => importRole(e.target.files?.[0])}
      />
      <input
        ref={importChatRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => importConversation(e.target.files?.[0])}
      />

      {detail && (
        <CharacterDetail
          character={localizeCharacter(detail, locale)}
          favorites={state.favorites.includes(detail.id)}
          liked={likedForCurrentAccount.includes(detail.id)}
          likeCount={formatLikeTotal(detail, likeStats[detail.id])}
          related={relatedCards.map((role) => localizeCharacter(role, locale))}
          relatedReasons={relatedRank.status === "ready" ? relatedRank.reasons : undefined}
          inviteCode={inviteCode}
          onBack={closeDetail}
          onStart={(openingIndex, fresh) => startChat(detail, fresh ?? false, openingIndex ?? 0)}
          onLive={XUMENG_CALLS_ENABLED ? () => performCharacter(xumengPerformanceFromCard(detail), "live") : undefined}
          onVoice={XUMENG_CHARACTER_VOICE_ENABLED ? () => performCharacter(xumengPerformanceFromCard(detail), "voice") : undefined}
          onFavorite={() => toggleFavorite(detail.id)}
          onLike={() => toggleLike(detail.id)}
          onHide={isPublicRecommendationCharacter(detail) ? () => hideRecommendation(detail) : undefined}
          onExport={() => {
            void (async () => {
              try {
                if (!detail.authoringDraft && isXumengPinnedCard(detail)) await loadXumengCardProvenance();
                download(`${detail.name}${detail.authoringDraft ? ".draft" : ""}.json`, detail.authoringDraft ? exportCharacterDraftJson(detail) : exportCharacterJson(detail));
                if (detail.authoringDraft) setNotice("私人创作草稿已导出，未完成词条已保留；导入后可继续编辑。");
              } catch (failure) { setNotice(failure instanceof Error ? failure.message : "导出失败，请保留草稿后重试。"); }
            })();
          }}
          onEdit={() => openStudio(detail)}
          onSelect={(role) => showDetail(role, undefined, "related")}
          onNotice={setNotice}
          shareRequiresAccount={!cloud.user || cloud.user.isGuest}
          onRequireAccount={() => openAccount("register")}
          onTag={(tag) => {
            const translatedTags = localizedCharacterTags(detail, locale);
            const sourceTag = detail.tags[translatedTags.indexOf(tag)] ?? tag;
            setTab("新手"); setAppliedTags([sourceTag]); navigate("characters");
          }}
          onAuthor={resolveCharacterAuthorTarget(authors, detail).kind === "unsigned" ? undefined : () => showCharacterAuthor(detail)}
          onFollow={resolveCharacterAuthorTarget(authors, detail).kind === "author" ? () => toggleFollow(detail) : undefined}
          galleryPaths={getDzmmCharacterMedia(detail)?.gallery.map((image) => image.path)}
          userName={playUserName}
          openingOrigin={getDzmmCharacterMedia(detail)?.opening?.origin}
          following={Boolean(findCharacterAuthor(authors, detail.id) && state.preferences.followedAuthors?.includes(findCharacterAuthor(authors, detail.id)!.id))}
        />
      )}
      {chatSettingsOpen && active && activeCharacter && <ChatSettings key={`${profileUser.id}:${active.id}`} conversation={active} preferences={state.preferences} onPreferences={savePreferences} onMemory={saveStoryMemory} onWorldClockMode={saveWorldClockMode} busy={busy} onClose={() => setChatSettingsOpen(false)} onRename={(title) => setState((previous) => ({ ...previous, conversations: previous.conversations.map((conversation) => conversation.id === active.id ? { ...conversation, title, updatedAt: Date.now() } : conversation) }))} onBranch={branchConversation} onDelete={removeActiveConversation} onExport={exportConversation} onPresets={() => navigate("presets")} />}
      {activeCharacter && editingMessage && editingMessage.accountId === activeAccount.current && editingMessage.conversationId === active?.id && view === "chat" &&
        <ChatMessageEditor key={`${editingMessage.conversationId}:${editingMessage.messageId}`} content={splitXumengMomentTail(splitXumengPanelTail(editingMessage.original).body).body} disabled={busy}
          onSave={saveEditedMessage} onClose={() => setEditingMessage(null)} />}
      {rechargeNeeded && <div className={s.overlay} role="presentation" onClick={() => setRechargeNeeded(false)}>
        <div className={s.balanceDialog} role="dialog" aria-modal="true" aria-labelledby="balance-gate-title" onClick={event => event.stopPropagation()}>
          <h2 id="balance-gate-title">余额不够</h2>
          <p>{rechargeMessage || "这条消息还没发出去，输入框里的内容会留着。可以邀请好友、完成今日签到，或充值后再发。"}
            {(!cloud.user || cloud.user.isGuest) && " 新设备赠送的 100 Credit 用完了，注册再送 300 Credit 就能接着聊。"}</p>
          {!cloud.user || cloud.user.isGuest ? <div className={s.balanceActions}>
            <button type="button" className={s.primary} onClick={() => { setRechargeNeeded(false); openAccount("register"); }}>注册领 300 Credit</button>
            <button type="button" className={s.primary} onClick={() => { setRechargeNeeded(false); openAccount("login"); }}>我已有账号，登录</button>
          </div> : <div className={s.balanceActions}>
            <button type="button" className={s.primary} onClick={() => { setRechargeNeeded(false); navigate("invite"); }}>去邀请</button>
            <button type="button" className={s.primary} onClick={() => { setRechargeNeeded(false); navigate("checkin"); }}>去签到</button>
            <button type="button" className={s.primary} onClick={() => { setRechargeNeeded(false); navigate("recharge"); }}>{XUMENG_PAYMENTS_ENABLED ? "充值" : "查看余额"}</button>
          </div>}
          <button type="button" className={s.secondary} onClick={() => setRechargeNeeded(false)}>先留在这里</button>
        </div>
      </div>}
      {accountMode && <AccountModal mode={accountMode} initialReferralCode={pendingInvite} onModeChange={(mode) => { cloud.clearAuthError(); setAccountMode(mode); }} onClose={() => { setAccountMode(null); setGuestGate(gate => gate?.stage === "account" ? null : gate); }} onSubmit={submitAccount} onEmailSubmit={async (values, signal) => { const registered = await cloud.authenticateEmailCode(values, signal); setAccountMode(null); finishGuestGate(registered); }} onPasswordReset={async (values, signal) => { await cloud.resetPassword(values, signal); setAccountMode(null); finishGuestGate(false); }} onClearError={cloud.clearAuthError} submitting={cloud.authBusy} error={cloud.authError} intro={guestGate?.stage === "account" ? `注册并领取新手 Credit 后，即可使用「${guestGate.character.name}」。` : undefined} />}
      {guestGate?.stage === "welcome" && cloud.user && !cloud.user.isGuest && <SignupWelcome accountId={cloud.user.id} characterName={guestGate.character.name} onStart={() => setGuestGate({ ...guestGate, stage: "open" })} onTasks={() => { setGuestGate(null); navigate("tasks"); }} onClose={() => setGuestGate(null)} />}

    </div>
  );
}

type VirtualKeyboardHandle = {
  overlaysContent: boolean;
  readonly boundingRect: { readonly height: number };
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
};

function readVirtualKeyboard(): VirtualKeyboardHandle | null {
  const candidate = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardHandle }).virtualKeyboard;
  if (!candidate || typeof candidate.addEventListener !== "function") return null;
  return candidate;
}

function setKeyboardOverlay(keyboard: VirtualKeyboardHandle | null, overlay: boolean) {
  if (!keyboard) return;
  try { keyboard.overlaysContent = overlay; } catch { /* This browser exposes the keyboard object but rejects the overlay switch. */ }
}

function keyboardInset(keyboard: VirtualKeyboardHandle | null): number {
  if (!keyboard?.overlaysContent) return 0;
  try { return Math.max(0, keyboard.boundingRect?.height ?? 0); } catch { return 0; }
}

function shelfRecommendationSurface(view: string, tab: string): RecommendationSurface | null {
  if (view === "search") return "search";
  if (view !== "characters" && view !== "play-games") return null;
  if (tab === "新手") return "home";
  if (tab === "猜你喜欢") return "for_you";
  if (tab === "榜单") return "ranking";
  if (tab === "分类") return "category";
  return null;
}

function MessageText({ text, role = "assistant", characterName, userName, statusLabels = [], showPeeledStatus = true }: {
  text: string; role?: "user" | "assistant"; characterName?: string; userName?: string;
  statusLabels?: readonly string[]; showPeeledStatus?: boolean;
}) {
  const named = applyDzmmReaderNames(text, { characterName, userName });
  // Status presentation applies to character replies, never to the user's own text.
  const presentation = role === "user" ? { body: named, status: null } : splitXumengMessagePresentation(splitXumengMomentTail(splitXumengPanelTail(named).body).body);
  const peeled = !presentation.status && statusLabels.length
    ? peelXumengLabeledStatusTail(presentation.body, statusLabels) : null;
  const body = peeled?.fields.length ? peeled.body : presentation.body;
  const status = presentation.status ?? (showPeeledStatus && peeled?.fields.length
    ? { title: "状态栏", fields: peeled.fields } : null);
  if (!body && !status) return null;
  return <>
    {body && <MessageTextBody text={body} />}
    {status && <MessageStatus status={status} />}
  </>;
}

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
  return <XumengStatusCard name={status.title || "状态"} sections={sections.map((section, index) => ({
    title: section.title,
    notes: section.notes,
    fields: section.fields.map((field, fieldIndex) => ({
      key: `${index}:${fieldIndex}:${field.label}`,
      label: field.label,
      type: "text" as const,
      value: field.value,
    })),
  }))} />;
}

