"use client";

/* eslint-disable @next/next/no-img-element -- Local research assets and user-imported character covers. */
import { applyDzmmReaderNames, getDzmmCharacterCreatorNotes, getDzmmCharacterPreviewText } from "@/lib/dzmm-character-presentation";
import { characterLinkId, characterSharePath } from "@/lib/xumeng-character-link";
import CharacterIntroduction from "./character-introduction";
import XumengInteractionPanel from "./xumeng-interaction-panel";
import { currentXumengPanelState, splitXumengPanelTail } from "@/lib/xumeng-interaction-panels";
import CharacterRichText, { hasCharacterMarkup } from "./character-rich-text";
import { useDzmmComposerDrafts } from "./use-composer-drafts";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isDzmmListedCharacter,
  parseCharacterImport,
  parseCharacterDraftImport,
  decodeDzmmCharacterImportBytes,
  exportCharacterJson,
  exportCharacterDraftJson,
  type Character,
} from "@/lib/dzmm-characters";
import { getDzmmNewConversationBlockReason, mergeDzmmConversationCharacters, selectDzmmDirectory } from "@/lib/dzmm-catalog";
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
  type DzmmSavedConversation,
  type DzmmSavedMessage,
  type DzmmPreferences,
} from "@/lib/dzmm-storage";
import { dzmmCloudRequest, useDzmmCloud, type DzmmAccountValues } from "@/lib/dzmm-cloud";
import Icon, { type IconName } from "./icons";
import ResponsiveNavigation from "./responsive-navigation";
import CharacterDetail from "./character-detail";
import AccountModal from "./account-modal";
import authorsData from "@/lib/dzmm-authors.json";
import { findCharacterAuthor, isDzmmCharacterBlocked, type DzmmAuthor, type DzmmForumTopic } from "@/lib/dzmm-discovery";
import { characterMatchesShelfTag, coverShelfTags } from "@/lib/xumeng-shelf-tags";
import { DZMM_GLOBAL_QUERY_MAX_LENGTH, dzmmDiscoveryRouteCategory, dzmmDiscoverySource, dzmmSearchDiscoverySource, mergeDzmmDiscoveryHistory, readDzmmDiscoveryHistory,
  defaultDzmmTaskSelection, dzmmTaskSelectionForRole, dzmmTaskDiscoverySource,
  type DzmmDiscoverySource, type DzmmTaskSelection } from "@/lib/dzmm-discovery-history";
import { CatalogDiscovery, SearchResults, AuthorProfile, type CatalogDiscoveryFilters } from "./discovery-views";
import { InviteCenter, ProfileView, ProfileSettings, PresetLibrary } from "./profile-settings";
import ForumView from "./forum-view";
import ChatSettings from "./chat-settings";
import UnavailableConversation from "./unavailable-conversation";
import { fetchDzmmForumPosts } from "@/lib/dzmm-forum";
import { getDzmmCharacterMedia, withDzmmPublicOpening } from "@/lib/dzmm-character-media";
import { xumengImageUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import CharacterStudio from "./character-studio";
import PublishingCenter from "./publishing-center";
import CreatorCenter from "./creator-center";
import GameStudio from "./game-studio";
import { GamePlayer } from "./game-player";
import { useGamePlayLibrary, type GamePlaySelection } from "./use-game-play-library";
import { parseXumengGameId } from "@/lib/xumeng-games";
import gameNavigation from "./game-play-navigation.module.css";
import { ScenarioStudio } from "./scenario-studio";
import { CommunityGuidelinesLink } from "./community-guidelines";
import { XUMENG_PAYMENT_INFO_DRAFT, XUMENG_PAYMENT_INFO_PAGES } from "@/lib/xumeng-payment-info";
import AdminDashboard from "./admin-dashboard";
import NovelStudio from "./novel-studio";
import LiveStudio from "./live-studio";
import MiniCpmPhone from "./minicpm-phone";
import CompanionPage from "@/app/xumeng/girlfriend/companion-page";
import QwenCompanion from "@/app/xumeng/girlfriend/qwen-companion";
import { REALISTIC_COMPANION_PROFILES, type CompanionProfile } from "@/app/xumeng/girlfriend/companion-profiles";
import VoiceStudio from "./voice-studio";
import { usePerformanceCharacters } from "./use-performance-characters";
import { xumengPerformanceFromCard, type XumengPerformanceCharacter } from "@/lib/xumeng-performance-character";
import { buildXumengLiveConversationHandoff } from "@/lib/xumeng-live-conversation";
import GenerationStudio from "./generation-studio";
import GenerationHistory from "./generation-history";
import { XUMENG_GENERATION_WORKSPACE_ENABLED, XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import { DZMM_OFFERED_MODEL_OPTIONS, normalizeDzmmModelSelection } from "@/lib/dzmm-models";
import { TaskHub } from "./task-hub";
import { InstallApp } from "./install-app";
import { Recharge } from "./recharge";
import { ChatMediaProvider, ChatMessageMedia } from "./chat-message-media";
import ChatMessageEditor from "./chat-message-editor";
import { ChatBillingStatus } from "./chat-billing-status";
import { plainXumengStoryText, splitXumengMessagePresentation, splitXumengSpeech, xumengStatusPreview, type XumengMessagePresentation } from "@/lib/xumeng-message-presentation";
import { canRegenerateDzmmMessage, createDzmmRegenerationBranch, createDzmmReplySuggestionBranch, editDzmmConversationMessage } from "@/lib/dzmm-message-actions";
import { dzmmReplySuggestionPrefixKeys, dzmmReplySuggestionSettingsKey, fetchDzmmReplySuggestions, prepareDzmmReplySuggestionsRequest,
  insertDzmmReplySuggestion, type DzmmReplySuggestionInsertion } from "@/lib/dzmm-reply-suggestions-client";
import { DZMM_REPLY_SUGGESTIONS_PROMPT_VERSION } from "@/lib/dzmm-reply-suggestions";
import ReplySuggestions from "./reply-suggestions";
import { fetchDzmmLikeStats, setDzmmCharacterLike, submitDzmmCharacter, fetchDzmmPublishingMine, type DzmmPublishingSubmission } from "@/lib/dzmm-publishing";
import { XUMENG_LOCALES, resolveXumengLocale, xumengHtmlLang, xumengLocaleLabel, xumengTranslate, type XumengMessageKey } from "@/lib/xumeng-i18n";
import s from "./tavern.module.css";

type View = "play-games" | "characters" | "chat" | "forum" | "profile" | "search" | "author" | "settings" | "presets" | "admin" | "studio" | "studio-edit" | "games" | "scenarios" | "novels" | "live" | "voice" | "generation" | "tasks" | "app" | "recharge" | "vip" | "invite";
type Message = DzmmSavedMessage;
type Conversation = DzmmSavedConversation;
type Preferences = DzmmPreferences;
type ChatSection = "stories" | "chats" | "games";
const CHAT_SECTION_ROUTES: Record<ChatSection, string> = { stories: "chat", chats: "chat/chats", games: "chat/games" };
const TABS = ["新手", "关注", "最新", "猜你喜欢", "榜单", "分类"];
const FEATURED_CHARACTER_COUNT = 13;
const MODEL_MODES = DZMM_OFFERED_MODEL_OPTIONS;
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
  { view: "characters", labelKey: "navPlay", icon: "users" },
  { view: "chat", labelKey: "navChat", icon: "chat" },
  { view: "live", labelKey: "navLive", icon: "phone" },
  ...(XUMENG_GENERATION_WORKSPACE_ENABLED ? [{ view: "generation" as const, labelKey: "navGeneration" as const, icon: "image" as const }] : []),
  { view: "forum", labelKey: "navForum", icon: "compass" },
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
    variant: "classic" as const, name: "Yume", line: "商科学生 · 爱打游戏", cover: "/assets/xumeng/content-covers/yume.jpg",
    situation: "宿舍夜里刚打完一局排位，耳机还挂在脖子上，转过椅子接电话。",
    description: "二十二岁，商科在读，住宿舍。这通电话是她刚打完一局排位，想把这局讲给你听。耳机还挂在脖子上，椅子刚转过来。她不知道你没说出口的事。",
    personality: "说话短，先接你刚刚那句。这局赢了会得意两句，输了先骂自己的操作，不把火气甩给你。游戏里的词只在这局相关时用。问你在干嘛是真想知道。你不接话，她把这局的关键两句讲完，再问你要不要听后面。你说先挂，她就停。没发生的事不说成已经发生。",
  },
  {
    variant: "intimate" as const, name: "晚宁", line: "你的恋人", cover: "/assets/xumeng/content-covers/wanning.jpg",
    situation: "晚上灯还亮着，刚忙完一天，靠在灯下想和你说话。",
    description: "二十二岁，商科在读，是你的恋人。晚上灯还亮着，刚忙完，靠在灯下接你。她不是 Yume。问她是谁，她说晚宁。她不说自己是程序，也不说自己能马上线下见面。她只按这通电话里说过的话理解你们。",
    personality: "跟你说话用「你」，句子短，具体。问今天怎样，就从自己刚做完的事接过去。你靠近，她按你说的靠近；你说停、不要或不想，她停在这一句，不记成分手，也不报分数。没做过的事不说成做过。称呼按你刚说的改。关系仍是恋人，除非你在这通电话里改口。",
  },
  {
    variant: "qwen" as const, name: "苏麦", line: "说话直一点", cover: "/assets/xumeng/content-covers/sumai.jpg",
    situation: "夜里在街上走，外套拉链拉到一半，说话直，不绕弯。",
    description: "夜里在街上走，外套拉链拉到一半。她接电话是因为你打来了。她有自己要去的地方，这通电话可以很短。",
    personality: "先答你问的那一句，不哄，不绕。你含糊，她问你到底想说什么。她不把没说过的关系说成已经很熟。你要她留下，她会说自己还在走，再问你这通电话要说到哪。说完她可以挂。",
  },
];
type CompanionVariant = "classic" | "intimate" | "qwen" | "custom";
const CHAT_CALL_CHARACTERS: XumengPerformanceCharacter[] = CONTENT_PEOPLE.map(person => ({
  id: `chat-${person.variant}`, key: `chat:${person.variant}`, source: "character", sourceId: person.variant, sourceLabel: "聊天",
  name: person.name, avatar: person.cover, description: person.description, personality: person.personality, scenario: person.situation, dialogue: "",
  liveVoice: "zh_female_liuchangnv_uranus_bigtts",
}));
function hasCallImage(avatar: string) {
  return Boolean(avatar) && !avatar.endsWith(".svg") && !avatar.includes("placeholder");
}
function gameHeat(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 60 + (hash % 840);
}

const GAME_COVERS: Record<string, string> = {
  "oss-2048": "/assets/xumeng/content-covers/game-2048.jpg",
  "oss-chronicle-of-shadows": "/assets/xumeng/content-covers/game-shadow.jpg",
  "oss-constellation-connect": "/assets/xumeng/content-covers/game-stars.jpg",
  "oss-cat-hop-cloud": "/assets/xumeng/content-covers/game-cat.jpg",
};

type ContentShelfItem =
  | { kind: "game"; key: string; game: { id: string; title: string; synopsis: string } }
  | { kind: "character"; key: string; character: Character }
  | { kind: "companion"; key: string; person: (typeof CONTENT_PEOPLE)[number] };

/** Games and character cards share one shelf. Chat cards stay in their own row. */
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

function Cover({
  character,
  className,
}: {
  character: Character;
  className?: string;
}) {
  return (
    <img
      src={xumengImageUrl(character.cover || XUMENG_FALLBACK_COVER)}
      alt={character.name}
      className={className}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = XUMENG_FALLBACK_COVER;
      }}
    />
  );
}

export default function TavernApp() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const cloud = useDzmmCloud({ busy, onNotice: setNotice });
  const { state, setState, loaded } = cloud;
  const [backupSelection, setBackupSelection] = useState<{ accountId: string; key: string } | null>(null);
  const requestedBackup = backupSelection?.accountId === cloud.user?.id ? backupSelection?.key : undefined;
  const selectedBackup = requestedBackup && cloud.backupChoices.some(item => item.key === requestedBackup)
    ? requestedBackup : cloud.backupChoices[0]?.key ?? "";
  const [accountMode, setAccountMode] = useState<"login" | "register" | null>(null);
  const [pendingInvite, setPendingInvite] = useState("");
  const [view, setView] = useState<View>("characters");
  const [tab, setTab] = useState("新手");
  const [genre, setGenre] = useState("全部");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"recommended" | "heat" | "likes" | "updated" | "name">("recommended");
  const [rankingPeriod, setRankingPeriod] = useState<"day" | "week" | "all">("week");
  const [detail, setDetail] = useState<Character | null>(null);
  const [likeStats, setLikeStats] = useState<Record<string, LikeStat>>({});
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
  const [liveMode, setLiveMode] = useState<"phone" | "video">("phone");
  const activeAccount = useRef<string | null>(null);
  const previousStudioAccount = useRef<string | null>(null);
  activeAccount.current = cloud.user?.id ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedConversationAccount = useRef<string | null>(null);
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationType, setConversationType] = useState<ChatSection>("stories");
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionVariant, setCompanionVariant] = useState<CompanionVariant>("classic");
  const [customCompanion, setCustomCompanion] = useState<CompanionProfile | null>(null);
  const companionWarmup = useRef(new Set<string>());
  const [wideChat, setWideChat] = useState(false);
  const [gameRequest, setGameRequest] = useState<(GamePlaySelection & {accountId: string}) | null>(null);
  const gameSelection = gameRequest?.accountId === cloud.user?.id ? gameRequest : null;
  const gameLibrary = useGamePlayLibrary(cloud.user?.id, cloud.user?.isGuest ?? true, view === "chat" || view === "characters" || view === "play-games", gameSelection);
  const gameLastPlayed = new Map(gameLibrary.recent.map(game => [game.id, game.updatedAt]));
  const visibleGames = [...filterDzmmSearchRows(gameLibrary.games, conversationQuery, game => [game.title, game.synopsis])]
    .sort((a, b) => (gameLastPlayed.get(b.id) ?? b.updatedAt) - (gameLastPlayed.get(a.id) ?? a.updatedAt));
  const companionMatchesSearch = filterDzmmSearchRows(["Yume 商科学生 爱打游戏"], conversationQuery, name => [name]).length > 0;
  const intimateMatchesSearch = filterDzmmSearchRows(["晚宁 恋人"], conversationQuery, name => [name]).length > 0;
  const qwenMatchesSearch = filterDzmmSearchRows(["苏麦 说话直"], conversationQuery, name => [name]).length > 0;
  const chatEntryCount = CONTENT_PEOPLE.length + REALISTIC_COMPANION_PROFILES.length;


  const { drafts: composerDrafts, setDrafts: setComposerDrafts, warning: composerStorageWarning, originalCache: composerOriginalCache } = useDzmmComposerDrafts(cloud.user?.id ?? null);
  const suggestionInsertions = useRef<Record<string, DzmmReplySuggestionInsertion>>({});
  const suggestionRequests = useRef(new Set<AbortController>());
  const draft = activeId ? composerDrafts[activeId]?.text ?? "" : "";
  const pendingDraft = activeId ? composerDrafts[activeId]?.pending : undefined;
  function setDraft(text: string) {
    if (activeId) setComposerDrafts(previous => ({ ...previous, [activeId]: { ...previous[activeId], text, failed: previous[activeId]?.failed ?? [] } }));
  }
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");
  const [billingConfig, setBillingConfig] = useState<DzmmBillingConfig | null>(null);
  const [billingRefresh, setBillingRefresh] = useState(0);
  const [rechargeNeeded, setRechargeNeeded] = useState(false);
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
  const [forumPostId, setForumPostId] = useState<string | null>(null);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [performanceSelection, setPerformanceSelection] = useState<{ accountId: string; character: XumengPerformanceCharacter } | null>(null);
  useEffect(() => { if (view !== "live" && view !== "voice") setPerformanceSelection(null); }, [view]);
  useEffect(() => { if (view !== "live") setLiveMode("phone"); }, [view]);
  useEffect(() => { if (view !== "chat") setGameRequest(null); }, [view]);
  const voiceBusy = useRef(false);
  const [systemDark, setSystemDark] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const requestActive = useRef(false);
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
  const locale = state.preferences.locale ?? "zh-Hans";
  const t = (key: XumengMessageKey) => xumengTranslate(locale, key);
  const localizedNav = NAV.map(item => ({ ...item, label: t(item.labelKey) }));
  const localizedTools = NAV_TOOLS.map(item => ({ ...item, label: t(item.labelKey) }));
  const localizedAdmin = { view: "admin" as const, label: t("navAdmin"), icon: "sliders" as const };
  useEffect(() => {
    document.documentElement.lang = xumengHtmlLang(locale);
  }, [locale]);
  const invitePrompted = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("invite") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
    if (code.length < 6) return;
    setPendingInvite(code);
    params.delete("invite");
    const next = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`);
  }, []);
  useEffect(() => {
    if (!pendingInvite || !loaded || cloud.authBusy || invitePrompted.current || !cloud.user?.isGuest) return;
    invitePrompted.current = true;
    setAccountMode("register");
  }, [pendingInvite, loaded, cloud.authBusy, cloud.user?.isGuest]);
  useEffect(() => {
    if (!loaded || cloud.authBusy || state.preferences.locale || typeof navigator === "undefined") return;
    const detected = resolveXumengLocale(undefined, navigator.languages);
    if (detected === "zh-Hans") return;
    setState(previous => previous.preferences.locale ? previous : { ...previous, preferences: { ...previous.preferences, locale: detected } });
  }, [loaded, cloud.authBusy, state.preferences.locale, setState]);
  const profileUser = cloud.user ?? { id: "offline", nickname: state.preferences.nickname, isGuest: true, role: "user" };
  const playUserName = state.preferences.nickname.trim() || cloud.user?.nickname.trim() || "";
  const likedForCurrentAccount = loaded && !cloud.authBusy
    ? Object.entries(likeStats).filter(([, stat]) => stat.liked).map(([id]) => id)
    : [];
  useEffect(() => {
    if (!loaded || cloud.authBusy || !cloud.user?.id) { setLikeStats({}); return; }
    const controller = new AbortController();
    const ids = [...new Set(cloud.catalog
      .filter((character) => character.sourceKind === "public-summary" || character.publication)
      .map((character) => character.id))];
    setLikeStats({});
    void (async () => {
      for (let index = 0; index < ids.length; index += 100) {
        const batch = await fetchDzmmLikeStats(ids.slice(index, index + 100), controller.signal);
        if (controller.signal.aborted) return;
        setLikeStats((previous) => ({ ...previous, ...batch }));
      }
    })().catch((failure) => {
      if (!controller.signal.aborted) setNotice(failure instanceof Error ? failure.message : "点赞状态暂时无法读取。请稍后重试。");
    });
    return () => controller.abort();
  }, [cloud.catalog, cloud.authBusy, cloud.user?.id, loaded]);
  const authors = useMemo(() => {
    const community = new Map<string, DzmmAuthor>();
    for (const card of cloud.catalog) {
      if (!card.publication) continue;
      const author = community.get(card.publication.authorId) ?? { id: card.publication.authorId, name: card.author, sourceUrl: "", characterIds: [] };
      author.characterIds.push(card.id);
      community.set(author.id, author);
    }
    const sourceAuthors = AUTHORS.map(author => ({ ...author, characterIds: author.characterIds.filter(id => isDzmmListedCharacter({ id })) }))
      .filter(author => author.characterIds.length > 0);
    return [...sourceAuthors, ...community.values()];
  }, [cloud.catalog]);
  const selectedAuthor = authors.find((author) => author.id === authorId);
  function savePreferences(preferences: Preferences) { setState((previous) => ({ ...previous, preferences })); }
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
    return () => {
      controller.current?.abort();
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
    suggestionInsertions.current = {};
    for (const abort of suggestionRequests.current) abort.abort();
    controller.current?.abort();
    setError("");
  }, [cloud.user?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const characters = useMemo(
    () => selectDzmmDirectory(state.custom, cloud.catalog.map(withDzmmPublicOpening), new Set(cloud.suppressedPrivateIds)).map((character) => ({
      ...character,
      likes: formatLikeTotal(character, likeStats[character.id]),
    })),
    [state.custom, cloud.catalog, cloud.suppressedPrivateIds, likeStats],
  );
  const conversationCharacters = useMemo(() => mergeDzmmConversationCharacters(characters), [characters]);
  const visibleConversations = useMemo(() => filterDzmmConversations(state.conversations, conversationCharacters, conversationQuery),
    [state.conversations, conversationCharacters, conversationQuery]);
  const active = state.conversations.find((c) => c.id === activeId);
  const activeCharacter = conversationCharacters.find((c) => c.id === active?.characterId);
  const panelTemplate = activeCharacter?.interactionTemplate;
  const panelState = useMemo(() => panelTemplate && active ? currentXumengPanelState(panelTemplate, active.messages) : null, [panelTemplate, active]);
  useEffect(() => {
    if (!activeId || activeCharacter) return;
    setChatSettingsOpen(false);
    setEditingMessage(null);
    if (requestActive.current) {
      controller.current?.abort();
      setNotice("角色暂不可用，已停止当前回复并保留收到的内容。");
    }
    for (const abort of suggestionRequests.current) abort.abort();
  }, [activeId, activeCharacter]);
  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    // Restored drafts and inserted suggestions do not fire an input change event.
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft, activeId, activeCharacter, view, detail]);
  const activeOpening = useMemo(() => activeCharacter && active ? resolveDzmmConversationOpening(activeCharacter, active) : null, [activeCharacter, active]);
  const chatBusy = busy;
  const replySuggestionKeys = useMemo(() => {
    if (!active) return [];
    const prefixes = dzmmReplySuggestionPrefixKeys(active.messages);
    const world = pruneDzmmWorldJournal(active.worldState, active.messages);
    const memory = matchesDzmmStoryMemory(active.storyMemory, active.messages) ? active.storyMemory : undefined;
    const settings = dzmmReplySuggestionSettingsKey([DZMM_REPLY_SUGGESTIONS_PROMPT_VERSION, activeCharacter, activeOpening,
      state.preferences.preset, state.preferences.persona, state.preferences.nickname, state.preferences.locale]);
    return active.messages.map((message, index) => {
      if (message.role !== "assistant") return prefixes[index];
      // Later world/summary updates must not invalidate earlier cached options.
      const snapshot = world?.snapshots.filter(item => item.sourceCount <= index + 1).at(-1);
      const context = dzmmReplySuggestionSettingsKey([snapshot, memory && memory.sourceCount <= index + 1 ? memory : undefined]);
      return `${prefixes[index]}:${settings}:${context}`;
    });
  }, [active, activeCharacter, activeOpening, state.preferences.preset, state.preferences.persona, state.preferences.nickname, state.preferences.locale]);
  useEffect(() => {
    if (!loaded || cloud.authBusy || requestActive.current) return;
    setState(previous => {
      const conversations = restoreDzmmConversationContexts(previous.conversations, characters);
      return conversations === previous.conversations ? previous : { ...previous, conversations };
    });
  }, [characters, state.conversations, loaded, cloud.authBusy, cloud.user?.id, busy, setState]);
  useEffect(() => {
    const hasOnlyOpening = active && activeOpening && active.messages.length <= activeOpening.messages.length
      && active.messages.every((message, index) => message.role === activeOpening.messages[index]?.role
        && message.content.trim() === activeOpening.messages[index]?.content.trim());
    if (!chatBusy && active && (!active.messages.some(message => message.role === "user") || hasOnlyOpening)) {
      messageScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    endRef.current?.scrollIntoView({
      behavior: chatBusy ? "instant" : "smooth",
      block: "end",
    });
  }, [active, activeOpening, chatBusy, view, detail]);
  useEffect(() => {
    // Only people who have chatted before are prewarmed; a shared pool slot is
    // not spent on every visitor who merely opens the chat list.
    if (!loaded || cloud.authBusy || !cloud.user || conversationType !== "chats") return;
    for (const variant of ["classic", "intimate"] as const) {
      try { if (localStorage.getItem(`xumeng-companion-cache:${variant}`)) warmCompanion(variant); } catch { /* Storage can be blocked. */ }
    }
  }, [loaded, cloud.authBusy, cloud.user, conversationType]);

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
      if (requestActive.current && target !== "chat") { setNotice("请先停止当前回复，再离开聊天。"); if (target.startsWith("chat/")) window.history.replaceState(null, "", "#chat"); return; }
      // Catalog/state updates rerun this effect; only a new route/account or actual traversal restores input.
      const restoreHistory = Boolean(event) || lastResolvedRoute.current?.accountId !== accountId || lastResolvedRoute.current?.route !== target;
      if (target === "chat/girlfriend" || target === "chat/girlfriend-intimate" || target === "chat/girlfriend-qwen" || target.startsWith("chat/girlfriend-custom/")) {
        setConversationType("chats");
        setCompanionOpen(true);
        if (target.startsWith("chat/girlfriend-custom/")) {
          setCustomCompanion(REALISTIC_COMPANION_PROFILES.find(profile => profile.id === target.slice("chat/girlfriend-custom/".length)) || REALISTIC_COMPANION_PROFILES[0]);
          setCompanionVariant("custom");
        } else {
          setCompanionVariant(target === "chat/girlfriend-intimate" ? "intimate" : target === "chat/girlfriend-qwen" ? "qwen" : "classic");
        }
        setGameRequest(null); setActiveId(null); setDetail(null); setView("chat");
      } else if (target === "chat/chats" || target === "chat/games") {
        setCompanionVariant("classic");
        setConversationType(target === "chat/chats" ? "chats" : "games");
        setGameRequest(null); setActiveId(null); setDetail(null); setView("chat");
      } else if (target.startsWith("chat/game/")) {
        const segments = target.split("/");
        let id = ""; try { id = decodeURIComponent(segments[3] ?? ""); parseXumengGameId(id); } catch { setNotice("游戏入口无效，请从游玩列表重新选择。"); return; }
        if (segments.length !== 4 || segments[2] !== "private" || !accountId) { setNotice("这部游戏暂不可用，请从游玩列表重新选择。"); return; }
        setConversationType("games");
        setGameRequest(previous => previous?.accountId === accountId && previous.kind === segments[2] && previous.id === id ? previous : {accountId, kind: segments[2] as GamePlaySelection["kind"], id});
        setActiveId(null); setDetail(null); setView("chat");
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
        setDetail(character);
      } else if (target === "category" || target.startsWith("category/")) {
        const selected = dzmmDiscoveryRouteCategory(target);
        if (!selected) return;
        if (restoreHistory) {
          const item = accountId ? readDzmmDiscoveryHistory(window.history.state, accountId, target) : null;
          const filters = item?.filters ?? { sort: "hot" as const, time: "all" as const, query: "" };
          discoveryFiltersRef.current = filters; setDiscoveryFilters(filters);
        }
        setDetail(null); setView("characters"); setTab("分类"); setCategory(selected.category);
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
      } else if (target.startsWith("forum/post/")) {
        setDetail(null); setForumPostId(target.slice(11)); setView("forum");
      } else if (["play-games", "characters", "chat", "forum", "profile", "settings", "presets", "admin", "search", "studio", "novels", "live", "voice", "generation", "tasks", "app", "recharge", "vip", "invite"].includes(target)) {
        setDetail(null);
        if (target === "chat") { setGameRequest(null); setConversationType("stories"); }
        if (target === "forum") setForumPostId(null);
        if (target === "studio") setCreatorSection("home");
        if (target === "novels") { setNovelInitial({}); novelRoute.current = "novels"; }
        setView(target as View);
      } else return;
      if (restoreHistory && (target === "chat" || target.startsWith("chat/"))) setConversationQuery("");
      if (target !== "chat/girlfriend" && target !== "chat/girlfriend-intimate" && target !== "chat/girlfriend-qwen" && !target.startsWith("chat/girlfriend-custom/")) setCompanionOpen(false);
      lastResolvedRoute.current = { accountId, route: target };
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
    if (requestActive.current && (target !== "chat" || route !== "chat")) {
      setNotice("请先停止当前回复，再离开聊天。");
      return false;
    }
    saveCurrentDiscoveryHistory();
    if (target === "live" && view !== "live") {
      const accountId = cloud.user?.id;
      setPerformanceSelection(accountId && !cloud.user?.isGuest && activeCharacter && active ? { accountId, character: { ...xumengPerformanceFromCard(activeCharacter), scene: buildXumengLiveConversationHandoff(active.messages, active.worldState, Date.now(), active.worldClockMode ?? "story") } } : null);
    } else if (target !== "live" && target !== "voice") setPerformanceSelection(null);
    setDetail(null);
    const companionRoute = route === "chat/girlfriend" || route === "chat/girlfriend-intimate" || route === "chat/girlfriend-qwen" || route.startsWith("chat/girlfriend-custom/");
    setCompanionOpen(target === "chat" && companionRoute);
    setCompanionVariant(route === "chat/girlfriend-intimate" ? "intimate" : route === "chat/girlfriend-qwen" ? "qwen" : route.startsWith("chat/girlfriend-custom/") ? "custom" : "classic");
    if (target === "chat") setConversationType(route === "chat/chats" || companionRoute ? "chats" : route === "chat/games" || route.startsWith("chat/game/") ? "games" : "stories");
    if (target === "studio") setCreatorSection("home");
    if (target === "novels") { setNovelInitial({}); novelRoute.current = "novels"; }
    setView(target);
    creatorRoute.current = ""; studioRoute.current = "";
    novelRouteActive.current = target === "novels";
    liveRouteActive.current = target === "live";
    location.hash = route;
    return true;
  }
  function selectChatSection(section: ChatSection) {
    if (section === conversationType) return;
    if (requestActive.current) { setNotice("请先停止当前回复，再切换分类。"); return; }
    if (!navigate("chat", CHAT_SECTION_ROUTES[section])) return;
    setActiveId(null); setGameRequest(null); setConversationQuery(""); setError("");
  }
  function warmCompanion(variant: "classic" | "intimate" | "qwen") {
    if (variant === "qwen" || companionWarmup.current.has(variant) || typeof window === "undefined") return;
    companionWarmup.current.add(variant);
    const endpoint = variant === "intimate" ? "/api/xumeng/companion-intimate/api/health" : "/api/xumeng/companion/api/health";
    void fetch(endpoint, { method: "GET", cache: "no-store", credentials: "same-origin" }).catch(() => {
      companionWarmup.current.delete(variant);
    });
  }
  function openCompanion(variant: CompanionVariant = "classic", profile?: CompanionProfile) {
    if (!loaded || cloud.authBusy || !cloud.user) { setNotice("正在加载账户，请稍候再打开聊天。"); return; }
    if (variant !== "custom") warmCompanion(variant);
      if (variant === "custom") {
      setCustomCompanion(profile || REALISTIC_COMPANION_PROFILES[0]);
      setCompanionVariant("custom");
      if (!navigate("chat", `chat/girlfriend-custom/${encodeURIComponent((profile || REALISTIC_COMPANION_PROFILES[0]).id)}`)) return;
    } else if (!navigate("chat", variant === "intimate" ? "chat/girlfriend-intimate" : variant === "qwen" ? "chat/girlfriend-qwen" : "chat/girlfriend")) return;
    setGameRequest(null); setActiveId(null); setError("");
  }
  function leaveCompanion() {
    setActiveId(null); setGameRequest(null); navigate("chat", "chat/chats");
  }
  function playGame(selection: GamePlaySelection) {
    if (requestActive.current) { setNotice("请先停止当前回复，再切换到游戏。"); return; }
    const accountId = cloud.user?.id;
    if (!loaded || cloud.authBusy || !accountId) { setNotice("正在加载账户，请稍候再打开游戏。"); return; }
    if (!navigate("chat", `chat/game/${selection.kind}/${encodeURIComponent(selection.id)}`)) return;
    setGameRequest({ ...selection, accountId }); setActiveId(null); setConversationType("games"); setError("");
  }
  function leaveGame() { setGameRequest(null); setActiveId(null); navigate("chat", "chat/games"); }
  function openCreatorRoute(route: string) {
    if (["studio", "novels", "presets", "voice", "characters"].includes(route)) { navigate(route as View); return; }
    if (creatorDirty.current || creatorBusy.current || studioDirty.current || studioBusy.current || novelDirty.current || novelBusy.current || requestActive.current) {
      setNotice("请先保存或完成当前操作，再打开其他作品。"); return;
    }
    setDetail(null); location.hash = route;
  }
  function performCharacter(character: XumengPerformanceCharacter, target: "live" | "voice") {
    const accountId = cloud.user?.id;
    if (!accountId || cloud.user?.isGuest || cloud.authBusy) { openAccount("login"); return; }
    if (!navigate(target)) return;
    setPerformanceSelection({ accountId, character });
  }
  function performActiveCharacter(target: "live" | "voice") {
    if (!activeCharacter || !active) return;
    performCharacter({ ...xumengPerformanceFromCard(activeCharacter),
      scene: buildXumengLiveConversationHandoff(active.messages, active.worldState, Date.now(), active.worldClockMode ?? "story") }, target);
  }
  const performanceLibrary = usePerformanceCharacters(cloud.user?.id, cloud.user?.isGuest ?? true, characters, view === "live" || view === "voice", view === "live");
  const callCharacters = useMemo(() => {
    const cards = performanceLibrary.characters.filter(item => item.source === "character" && hasCallImage(item.avatar) && !/同学妈妈|男高|乱伦|校园/.test(item.name));
    return [...CHAT_CALL_CHARACTERS, ...cards];
  }, [performanceLibrary.characters]);
  const performanceCharacter = performanceSelection && performanceSelection.accountId === cloud.user?.id && !cloud.user?.isGuest && callCharacters.some(item => item.key === performanceSelection.character.key)
    ? performanceSelection.character
    : callCharacters[0];
  function openStudio(card: Character | "new") {
    if (requestActive.current) { setNotice("请先停止当前回复，再编辑角色。"); return; }
    if (creatorDirty.current || creatorBusy.current || novelDirty.current || novelBusy.current || studioDirty.current || studioBusy.current) { setNotice("请先保存或完成当前创作操作。"); return; }
    const owned = card !== "new" && state.custom.some((item) => item.id === card.id);
    const draftCard = card === "new" ? "new" : owned || (card.sourceKind === "original" && !card.publication) ? card : parseCharacterImport(exportCharacterJson(card));
    if (draftCard !== "new" && !owned) setState((previous) => ({ ...previous, custom: [draftCard, ...previous.custom.filter((item) => item.id !== draftCard.id)] }));
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
    if (requestActive.current) { setNotice("请先停止当前回复，再查看作者。"); return; }
    saveCurrentDiscoveryHistory();
    setDetail(null); setAuthorId(author.id); setView("author"); location.hash = `author/${author.id}`;
  }
  function showCharacterAuthor(character: Character) {
    const author = findCharacterAuthor(authors, character.id);
    if (author) showAuthor(author); else navigate("profile");
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
    setState((previous) => ({ ...previous, conversations: [branch, ...previous.conversations] }));
    setActiveId(branch.id); setChatSettingsOpen(false); setNotice("已复制当前会话，可从这里继续新的剧情。");
  }
  function deleteCharacter(character: Character) {
    if (busy || !state.custom.some((item) => item.id === character.id)) return;
    setState((previous) => ({ ...previous, custom: previous.custom.filter((item) => item.id !== character.id), favorites: previous.favorites.filter((id) => id !== character.id), conversations: previous.conversations.filter((item) => item.characterId !== character.id) }));
  }
  function showDetail(character: Character, taskSource?: DzmmTaskSelection) {
    if (requestActive.current) {
      setNotice("请先停止当前回复，再查看角色详情。");
      return;
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
    const route = `character/${character.id}`;
    pendingDetailRoute.current = { accountId: activeAccount.current, route };
    const sharePath = characterSharePath(character.id);
    if (sharePath) {
      if (location.pathname !== sharePath || location.hash) window.history.pushState(window.history.state, "", sharePath);
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
    if (billingConfig.enabled && (!cloud.user || cloud.user.isGuest)) {
      setNotice("登录后可使用钱包 Credit 进行角色对话。"); openAccount("login"); return false;
    }
    return true;
  }
  function editMessage(message: Message) {
    if (!active || !activeCharacter || requestActive.current) return;
    setEditingMessage({ accountId: activeAccount.current, conversationId: active.id, messageId: message.id, original: message.content });
  }
  function saveEditedMessage(content: string) {
    if (!activeCharacter) throw new Error("角色当前不可用，历史消息仅供查看。");
    if (!editingMessage || requestActive.current) throw new Error("请先停止当前回复，再修改消息。");
    if (activeAccount.current !== editingMessage.accountId || active?.id !== editingMessage.conversationId) throw new Error("账户或会话已切换，请重新打开消息编辑。");
    let changed = false;
    setState(previous => {
      const conversation = previous.conversations.find(item => item.id === editingMessage.conversationId);
      if (!conversation || conversation.messages.find(item => item.id === editingMessage.messageId)?.content !== editingMessage.original)
        throw new Error("这条消息已经更新，请关闭编辑后重新打开。");
      const tail = editingMessage.original.slice(splitXumengPanelTail(editingMessage.original).body.length);
      const updated = editDzmmConversationMessage(conversation, editingMessage.messageId, tail.trim() ? `${content.trimEnd()}${tail}` : content);
      changed = updated !== conversation;
      return changed ? { ...previous, conversations: previous.conversations.map(item => item.id === updated.id ? updated : item) } : previous;
    });
    setNotice(changed ? "消息已修改，后续聊天原文已保留。" : "消息未改变。");
  }
  function regenerateMessage(messageId: string) {
    if (!active || !activeCharacter || requestActive.current || !canRegenerateDzmmMessage(active, messageId) || !allowBilledConversation()) return;
    if (active.messages.at(-1)?.id === messageId && active.messages.at(-2)?.role === "user") { void send(true); return; }
    const branch = createDzmmRegenerationBranch(active, messageId);
    setState(previous => ({ ...previous, conversations: [branch, ...previous.conversations] }));
    setActiveId(branch.id); setNotice("已建立分支重新生成，原会话完整保留。");
    void send(true, branch);
  }
  async function generateReplySuggestions(messageId: string, signal: AbortSignal) {
    if (!active || !activeCharacter || cloud.authBusy) throw new Error("请等待账号加载完成，再生成建议。");
    if (!billingConfig) throw new Error("建议费率暂时未能确认，请刷新后重试。");
    if (billingConfig.enabled && (!cloud.user || cloud.user.isGuest)) throw new Error("登录后可使用 Credit 生成下一步建议。");
    const owner = activeAccount.current;
    if (!owner) throw new Error("账号仍在加载，请稍后重试。");
    cloud.assertAccount(owner);
    const request = prepareDzmmReplySuggestionsRequest(activeCharacter, active, messageId, state.preferences);
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
  function chooseReplySuggestion(messageId: string, reply: string) {
    if (!active || !activeCharacter || requestActive.current || cloud.authBusy) throw new Error("请等待当前操作完成且角色可用，再选择建议。");
    const owner = activeAccount.current;
    if (!owner) throw new Error("账号仍在加载，请稍后重试。");
    cloud.assertAccount(owner);
    if (active.messages.at(-1)?.id !== messageId) {
      const branch = createDzmmReplySuggestionBranch(active, messageId);
      setState(previous => ({ ...previous, conversations: [branch, ...previous.conversations] }));
      setComposerDrafts(previous => ({ ...previous, [branch.id]: { text: reply, failed: [] } }));
      setActiveId(branch.id); setNotice("已从这条回复开启新分支，原会话完整保留。请确认输入后发送。");
    } else {
      const insertion = insertDzmmReplySuggestion(draft, reply, suggestionInsertions.current[active.id]);
      suggestionInsertions.current[active.id] = insertion;
      setDraft(insertion.after);
    }
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
    setState((previous) => ({
      ...previous,
      favorites: previous.favorites.includes(id)
        ? previous.favorites.filter((v) => v !== id)
        : [...previous.favorites, id],
    }));
  }
  async function toggleLike(id: string) {
    if (!loaded || cloud.authBusy || !cloud.user?.id) return;
    const previous = likeStats[id] ?? { count: 0, liked: false };
    const nextLiked = !previous.liked;
    setLikeStats((current) => ({ ...current, [id]: { count: Math.max(0, previous.count + (nextLiked ? 1 : -1)), liked: nextLiked } }));
    try {
      const result = await setDzmmCharacterLike(id, nextLiked);
      setLikeStats((current) => ({ ...current, [id]: result }));
    } catch (failure) {
      setLikeStats((current) => ({ ...current, [id]: previous }));
      setNotice(failure instanceof Error ? failure.message : "点赞暂时失败，请稍后重试。");
    }
  }
  function matchCharacter() {
    const pool = characters.filter((character) => !isDzmmCharacterBlocked(character, state.preferences.blockedTags));
    if (pool.length) showDetail(pool[Math.floor(Math.random() * pool.length)]);
    else setNotice("当前没有可匹配的角色，可以调整屏蔽标签。");
  }
  function startChat(character: Character, fresh = false, openingIndex = 0) {
    if (!loaded || cloud.authBusy) {
      setNotice("正在加载你的会话，请稍候再开始。");
      return;
    }
    if (requestActive.current) {
      setNotice("请先停止当前回复，再切换会话。");
      return;
    }
    if (character.authoringDraft) { openStudio(character); setNotice("世界书还有未完成的词条，请先完善草稿再开始对话。"); return; }
    const existing = state.conversations.find(
      (c) => c.characterId === character.id,
    );
    const newConversationBlock = (!existing || fresh) ? getDzmmNewConversationBlockReason(character) : null;
    if (newConversationBlock) {
      setNotice(newConversationBlock); return;
    }
    let opening: ReturnType<typeof captureDzmmConversationOpening>;
    try { opening = existing && !fresh ? resolveDzmmConversationOpening(character, existing)
      : captureDzmmConversationOpening(character, openingIndex); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : "角色开场暂时无法加载。"); return; }
    const openingMessages = opening.messages.map((message) => ({ ...message, id: uid() }));
    if (existing && !fresh) {
      setActiveId(existing.id);
      if (existing.opening !== opening) setState(previous => ({ ...previous, conversations: previous.conversations.map(conversation =>
        conversation.id === existing.id ? { ...conversation, opening } : conversation) }));
      if (!existing.messages.length && openingMessages.length) {
        patchMessages(existing.id, openingMessages);
      }
    }
    else {
      const conversation: Conversation = {
        id: uid(),
        characterId: character.id,
        title: character.name,
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
    setGameRequest(null); navigate("chat");
  }
  function selectConversation(c: Conversation) {
    if (requestActive.current) {
      setNotice("请先停止当前回复，再切换会话。");
      return;
    }
    setConversationType("stories"); setCompanionOpen(false); setGameRequest(null); window.history.replaceState(null, "", "#chat");
    setActiveId(c.id);
    setError("");
  }
  function removeActiveConversation() {
    if (!active || requestActive.current) return;
    const id = active.id;
    setState(previous => ({ ...previous, conversations: previous.conversations.filter(conversation => conversation.id !== id) }));
    setComposerDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
    delete suggestionInsertions.current[id];
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
  async function send(regenerate = false, override?: Conversation) {
    if (!loaded || cloud.authBusy) { setNotice("账号正在加载，请稍候再发送消息。"); return; }
    const owner = activeAccount.current;
    if (owner) {
      try { cloud.assertAccount(owner); }
      catch (failure) { setNotice(failure instanceof Error ? failure.message : "账号正在切换，请稍候再发送消息。"); return; }
    }
    const conversation = override ?? active;
    if (
      requestActive.current ||
      !conversation ||
      !activeCharacter ||
      (!regenerate && !draft.trim())
    )
      return;
    if (!regenerate && composerDrafts[conversation.id]?.pending) { setError("上次回复尚未确认，请先检查会话并恢复或移除待确认原文，再发送新消息。"); return; }
    if (!allowBilledConversation()) return;
    if (activeCharacter.authoringDraft) { setError("这个角色的世界书还有未完成项，请在创作中心完善后继续对话。"); return; }
    const conversationId = conversation.id;
    const originalInput = draft;
    const requestId = uid();
    const previousMessages =
      regenerate && conversation.messages.at(-1)?.role === "assistant"
        ? conversation.messages.slice(0, -1)
        : conversation.messages;
    if (regenerate && !previousMessages.some((m) => m.role === "user")) return;
    const submitted: Message[] = regenerate
      ? previousMessages
      : [
          ...previousMessages,
          { id: uid(), role: "user", content: draft.trim() },
        ];
    const assistantId = uid();
    let answer = "";
    let preparedMemory: Conversation["storyMemory"];
    requestActive.current = true;
    setBusy(true);
    setError("");
    setRechargeNeeded(false);
    if (!regenerate) setComposerDrafts(previous => ({ ...previous,
      [conversationId]: { text: "", failed: previous[conversationId]?.failed ?? [], pending: { requestId, text: originalInput } } }));
    // Keep the saved answer and its continuity state until valid replacement text arrives.
    if (!regenerate) patchMessages(conversationId, submitted);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const worldRuntime = resolveDzmmWorldRuntime(conversation.worldState, submitted, Date.now(), conversation.worldClockMode ?? "story");
      const { request } = await prepareDzmmRememberedRequest({ character: applyDzmmConversationOpening(activeCharacter, { ...conversation, messages: submitted }), messages: submitted,
        world: { clockMode: conversation.worldClockMode ?? "story", ...(worldRuntime ? { state: worldRuntime.state,
          recordedAt: worldRuntime.recordedAt, previousClockMode: worldRuntime.clockMode } : {}) },
        memory: conversation.storyMemory, preset: state.preferences.preset, userPersona: state.preferences.persona,
        userName: playUserName, locale: state.preferences.locale, model: normalizeDzmmModelSelection(state.preferences.model), maxTokens: state.preferences.maxTokens, signal: abort.signal,
        onSummaryStart: () => setSummarizing(true),
        onMemory: (storyMemory) => {
          if (activeAccount.current !== owner) return;
          if (regenerate) {
            if (matchesDzmmStoryMemory(storyMemory, submitted)) preparedMemory = storyMemory;
            return;
          }
          setState((previous) => ({ ...previous, conversations: previous.conversations.map((c) =>
            c.id === conversationId && matchesDzmmStoryMemory(storyMemory, c.messages)
              ? { ...c, storyMemory, updatedAt: Date.now() } : c) }));
        },
      });
      if (activeAccount.current !== owner) return;
      setSummarizing(false);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Xumeng-Request-Id": requestId },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 402) setRechargeNeeded(true);
        if ((response.status === 401 || response.status === 403) && billingConfig?.enabled && (!cloud.user || cloud.user.isGuest)) openAccount("login");
        throw new Error(body?.error || "回复失败，请稍后重试。");
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
      if (activeAccount.current !== owner) return;
      answer = result.answer;
      patchMessages(conversationId, [
        ...submitted,
        { id: assistantId, role: "assistant", content: answer },
      ], result.world, undefined, undefined, preparedMemory);
    } catch (e) {
      if (activeAccount.current !== owner) return;
      const hasValidAnswer = Boolean(answer.trim());
      if (e instanceof DzmmMemoryRequestError && e.status === 402) setRechargeNeeded(true);
      if (e instanceof DzmmMemoryRequestError && (e.status === 401 || e.status === 403) && billingConfig?.enabled && (!cloud.user || cloud.user.isGuest)) openAccount("login");
      if (e instanceof Error && e.name !== "AbortError")
        setError(
          hasValidAnswer ? "回复中断，已保留收到的内容。可以重新生成。" : e.message,
        );
      if (!hasValidAnswer && !regenerate) {
        setComposerDrafts(previous => {
          const current = previous[conversationId] ?? { text: "", failed: [] };
          return { ...previous, [conversationId]: current.text
            ? { ...current, failed: [...current.failed, originalInput] }
            : { ...current, text: originalInput } };
        });
        patchMessages(conversationId, previousMessages);
      }
      if (!hasValidAnswer && regenerate) {
        const restoredMemory = conversation.storyMemory && matchesDzmmStoryMemory(conversation.storyMemory, conversation.messages)
          ? conversation.storyMemory : preparedMemory;
        patchMessages(conversationId, conversation.messages, undefined, conversation.worldState, conversation.opening, restoredMemory);
      }
    } finally {
      if (!regenerate && activeAccount.current === owner) setComposerDrafts(previous => {
        const current = previous[conversationId];
        if (current?.pending?.requestId !== requestId) return previous;
        const { pending: completed, ...rest } = current; void completed;
        return { ...previous, [conversationId]: rest };
      });
      requestActive.current = false;
      setBusy(false);
      setSummarizing(false);
      controller.current = null;
      setBillingRefresh(value => value + 1);
    }
  }

  const filtered = useMemo(() => {
    let list = characters.filter(
      (c) =>
        !isDzmmCharacterBlocked(c, state.preferences.blockedTags) &&
        characterMatchesShelfTag(c.tags, genre),
    );
    if (tab === "新手")
      list = list.filter((c) => c.sourceKind === "public-summary" || c.publication);
    if (tab === "关注")
      list = list.filter((c) => { const author = findCharacterAuthor(authors, c.id); return author && state.preferences.followedAuthors?.includes(author.id); });
    const rankScore = (character: Character) => {
      const heat = heatValue(character.heat);
      const likes = parseLikeBaseline(character.likes || "") || 0;
      const age = Math.max(0, Date.now() - Date.parse(character.createdAt));
      const freshness = Number.isFinite(age) ? Math.max(0, 30 - age / 86_400_000) : 0;
      if (rankingPeriod === "day") return heat * 1.2 + likes * 0.45 + freshness * 250;
      if (rankingPeriod === "all") return heat * 0.8 + likes * 0.9;
      return heat + likes * 0.65 + freshness * 120;
    };
    if (tab === "最新" || sortMode === "updated") list = [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || rankScore(b) - rankScore(a));
    if (tab === "新手" && sortMode === "recommended") list = [...list].sort((a, b) => rankScore(b) - rankScore(a));
    if (tab === "榜单" || sortMode === "heat") list = [...list].sort((a, b) => rankScore(b) - rankScore(a));
    if (sortMode === "likes") list = [...list].sort((a, b) => (parseLikeBaseline(b.likes || "") || 0) - (parseLikeBaseline(a.likes || "") || 0));
    if (sortMode === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    if (tab === "猜你喜欢" && sortMode === "recommended") list = [...list].sort((a, b) => Number(state.favorites.includes(b.id)) - Number(state.favorites.includes(a.id)));
    return list;
  }, [characters, genre, tab, sortMode, rankingPeriod, state.favorites, state.preferences.blockedTags, state.preferences.followedAuthors, authors]);

  const showFeatured = tab === "新手" && genre === "全部" && sortMode === "recommended";
  const featured = useMemo<ContentShelfItem[]>(() => {
    if (!showFeatured) return [];
    const companions: ContentShelfItem[] = CONTENT_PEOPLE.filter(person => person.variant !== "qwen").map(person => ({ kind: "companion", key: `companion:${person.variant}`, person }));
    const cards: ContentShelfItem[] = filtered.slice(0, FEATURED_CHARACTER_COUNT).map(character => ({ kind: "character", key: `character:${character.id}`, character }));
    return [cards[0], companions[0], ...cards.slice(1, 4), companions[1], ...cards.slice(4)].filter((item): item is ContentShelfItem => Boolean(item));
  }, [showFeatured, filtered]);
  const shelf = useMemo(() => weaveEqual<ContentShelfItem>([
    (showFeatured ? filtered.slice(FEATURED_CHARACTER_COUNT) : filtered).map(character => ({ kind: "character", key: `character:${character.id}`, character })),
  ]), [filtered, showFeatured]);

  async function importRole(file?: File) {
    if (!file) return;
    try {
      if (file.size > 262_144) throw new Error("角色卡文件不能超过 256 KB。");
      const owner = activeAccount.current;
      const character = parseCharacterDraftImport(decodeDzmmCharacterImportBytes(await file.arrayBuffer()));
      if (activeAccount.current !== owner || cloud.authBusy) throw new Error("账号已切换，请在当前账号重新导入角色卡。");
      if (!owner || !loaded) throw new Error("账号尚未加载，请稍候再导入角色卡。");
      cloud.assertAccount(owner);
      if (studioDirty.current || studioBusy.current) throw new Error("角色草稿尚未保存，请先在创作工作台保存，再导入新角色卡。");
      setState((p) => ({ ...p, custom: [character, ...p.custom] }));
      if (character.authoringDraft) openStudio(character); else showDetail(character);
      setNotice(character.authoringDraft ? "私人创作草稿已导入，可继续完善世界书。" : "角色卡已导入。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "导入失败。");
    }
    if (importRef.current) importRef.current.value = "";
  }
  async function importConversation(file?: File) {
    if (!file) return;
    if (requestActive.current) {
      setNotice("请先停止当前回复，再导入会话。");
      if (importChatRef.current) importChatRef.current.value = "";
      return;
    }
    try {
      if (file.size > DZMM_CONVERSATION_BACKUP_MAX_BYTES) throw new Error("会话文件不能超过 2 MB。");
      const owner = activeAccount.current;
      const raw = await file.text();
      if (activeAccount.current !== owner) throw new Error("账号已切换，请在当前账号重新导入会话。");
      if (requestActive.current || cloud.authBusy) throw new Error("当前操作尚未完成，请稍后重新导入会话。");
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

  function openAccount(mode: "login" | "register") {
    if (!loaded) { setNotice("正在加载当前账号，请稍候。"); return; }
    if (creatorBusy.current || creatorDirty.current || novelBusy.current || novelDirty.current) { setNotice("请先保存并完成创作操作，再登录其他账号。"); return; }
    if (studioBusy.current) { setNotice("角色草稿正在处理，请稍候再注册或登录。"); return; }
    if (studioDirty.current) { setNotice("请先保存或导出角色草稿，再注册或登录。"); return; }
    if (requestActive.current) {
      setNotice("请先停止当前回复，再切换账号。");
      return;
    }
    try {
      if (cloud.user?.id) cloud.assertAccount(cloud.user.id);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "账号正在切换，请稍候。"); return; }
    cloud.clearAuthError();
    setAccountMode(mode);
  }

  async function submitAccount(values: DzmmAccountValues) {
    if (!accountMode) return;
    await cloud.authenticate(accountMode, values);
    setAccountMode(null);
  }

  const paymentReturn = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const companionInMain = companionOpen || (conversationType === "chats" && wideChat && loaded && !cloud.authBusy && Boolean(cloud.user));

  const renderShelfItem = (item: ContentShelfItem, index: number) => item.kind === "companion" ? (
                  <article key={item.key} className={s.card} style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}>
                    <button className={s.coverButton} aria-label={`和${item.person.name}聊天`} onClick={() => openCompanion(item.person.variant)}>
                      <img src={item.person.cover} alt="" />
                      <span className={s.heat}>AI 女友</span>
                    </button>
                    <div className={s.cardBody}>
                      <button className={s.cardText} onClick={() => openCompanion(item.person.variant)}>
                        <h2>{item.person.name}</h2>
                        <p>{item.person.situation}</p>
                      </button>
                    </div>
                  </article>
                ) : item.kind === "game" ? (
                  <article key={item.key} className={s.card} style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}>
                    <button className={s.coverButton} style={GAME_COVERS[item.game.id] ? undefined : { background: "linear-gradient(165deg,#4a4034,#221e1a)" }} aria-label={`游玩${item.game.title}`} onClick={() => playGame({ kind: "private", id: item.game.id })}>
                      {GAME_COVERS[item.game.id] ? <img src={GAME_COVERS[item.game.id]} alt="" /> : <span className={s.contentPlate} aria-hidden="true">{Array.from(item.game.title)[0] || "游"}</span>}
                      <span className={s.heat}>游戏 · <Icon name="flame" size={14} />{gameHeat(item.game.id)}</span>
                    </button>
                    <div className={s.cardBody}>
                      <button className={s.cardText} onClick={() => playGame({ kind: "private", id: item.game.id })}>
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
                  >
                    <button
                      className={s.coverButton}
                      onClick={() => showDetail(item.character)}
                      aria-label={`查看 ${item.character.name}`}
                    >
                      <Cover character={item.character} />
                      <span className={s.heat}>
                        <Icon name="flame" size={14} />
                        {item.character.heat || "—"}
                      </span>
                      {item.character.sourceKind === "original" && !item.character.publication && (
                        <span className={s.localBadge}>我的角色</span>
                      )}
                    </button>
                    {coverShelfTags(item.character.tags, 2).length > 0 && <div className={s.coverTags}>{coverShelfTags(item.character.tags, 2).map((tag) => <button key={tag} type="button" onClick={() => setGenre(tag)} aria-label={`只看${tag}`}>{tag}</button>)}</div>}
                    <div className={s.cardBody}>
                      <button
                        className={s.cardText}
                        onClick={() => showDetail(item.character)}
                      >
                        <h2>{item.character.name}</h2>
                        <p>{getDzmmCharacterPreviewText(item.character, playUserName)}</p>
                      </button>
                      <div className={s.cardFooter}>
                        <button className={s.author} onClick={() => showCharacterAuthor(item.character)}>
                          <span className={s.authorAvatar}>
                            {Array.from(item.character.author)[0] ?? ""}
                          </span>
                          {item.character.author}
                        </button>
                        <button
                          className={likedForCurrentAccount.includes(item.character.id) ? s.liked : s.like}
                          onClick={() => toggleLike(item.character.id)}
                          aria-label={`${likedForCurrentAccount.includes(item.character.id) ? "取消点赞" : "点赞"} ${item.character.name}`}
                          aria-pressed={likedForCurrentAccount.includes(item.character.id)}
                        >
                          <Icon name="heart" size={15} />
                          <span>{item.character.likes || "—"}</span>
                        </button>
                        <button
                          className={state.favorites.includes(item.character.id) ? s.favorited : ""}
                          onClick={() => toggleFavorite(item.character.id)}
                          aria-label={`${state.favorites.includes(item.character.id) ? "取消收藏" : "收藏"} ${item.character.name}`}
                          aria-pressed={state.favorites.includes(item.character.id)}
                        >
                          <Icon name={state.favorites.includes(item.character.id) ? "check" : "book"} size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                );

  return (
    <div
      className={`${s.app} ${dark ? s.dark : ""} ${view === "chat" && !detail && (active || companionInMain || gameSelection) ? s.chatMode : ""}`}
    >
      <aside className={s.appRail} aria-label="主导航">
        <button type="button" className={s.railUser} onClick={() => navigate("profile")}>
          <span className={s.avatar}>{Array.from(state.preferences.nickname)[0] ?? ""}</span>
          <strong>{state.preferences.nickname}</strong>
        </button>
        <nav>
          {localizedNav.map((n) => (
            <a key={n.view} href={`#${n.view}`}
              onClick={(e) => { e.preventDefault(); navigate(n.view); }}
              className={view === n.view || (n.view === "characters" && view === "play-games") || (n.view === "studio" && ["studio-edit", "games", "scenarios", "novels"].includes(view)) ? s.navActive : ""}>
              <Icon name={n.icon} size={18} />
              {n.label}
            </a>
          ))}
        </nav>
        <p className={s.railLabel}>{t("utilityExploreApps")}</p>
        <nav>
          <a href="#tasks" className={view === "tasks" ? s.navActive : ""} onClick={(event) => { event.preventDefault(); navigate("tasks"); }}><Icon name="trophy" size={18} />{t("navTasks")}</a>
          <a href="#tasks" onClick={(event) => { event.preventDefault(); navigate("tasks"); window.setTimeout(() => document.getElementById("task-daily_checkin")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); }}><Icon name="sun" size={18} />{t("utilityDailyCheckIn")}</a>
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
                navigate(n.view);
              }}
              className={view === n.view || (n.view === "characters" && view === "play-games") || (n.view === "studio" && ["studio-edit", "games", "scenarios", "novels"].includes(view)) ? s.navActive : ""}
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
          currentView={view === "play-games" ? "characters" : view} onNavigate={navigate} locale={locale} />
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
          <select aria-label={t("language")} value={locale} onChange={(event) => setState((previous) => ({ ...previous, preferences: { ...previous.preferences, locale: event.target.value as typeof locale } }))}>
            {XUMENG_LOCALES.map(option => <option key={option} value={option}>{xumengLocaleLabel(option)}</option>)}
          </select>
        </label>
        <button className={s.account} onClick={() => navigate("profile")}>
          <span className={s.avatar}>
            {Array.from(state.preferences.nickname)[0] ?? ""}
          </span>
          <span>{state.preferences.nickname}</span>
        </button>
      </header>

      {(view === "characters" || view === "play-games") && !detail && (
        <>
          <div className={s.browseNav}>
            <nav className={s.tabs} aria-label={t("tabRecommended")}>
              {TABS.map((tabKey) => (
                <button
                  key={tabKey}
                  role="tab"
                  aria-selected={tabKey === tab}
                  className={tabKey === tab ? s.tabActive : ""}
                  onClick={() => {
                    saveCurrentDiscoveryHistory();
                    setTab(tabKey); setQuery("");
                    if (tabKey !== "分类") { setGenre("全部"); location.hash = "characters"; } else chooseDiscoveryCategory(null);
                  }}
                >
                  {tabKey === "榜单" && <Icon name="trophy" size={15} />} {({ "关注": t("tabFollowing"), "最新": t("tabLatest"), "猜你喜欢": t("tabRecommended"), "新手": t("tabNew"), "榜单": t("tabRanking"), "分类": t("tabCategories") } as Record<string, string>)[tabKey] ?? tabKey}
                </button>
              ))}
            </nav>
          </div>
          {tab === "分类" ? <CatalogDiscovery characters={characters} authors={authors} favorites={state.favorites} likes={likedForCurrentAccount} preferences={state.preferences} initialCategory={category} filters={discoveryFilters} onFiltersChange={updateDiscoveryFilters} onCategoryChange={chooseDiscoveryCategory} onCharacter={showDetail} onFavorite={toggleFavorite} onLike={toggleLike} onAuthor={showAuthor} onTag={(tag) => { setTab("新手"); setGenre(tag); }} /> : <>
          <main className={s.catalog}>
            <div className={s.discoveryControls}>
              {genre !== "全部" && <button type="button" className={s.tagActive} onClick={() => setGenre("全部")}>#{genre} · 全部</button>}
              <label className={s.sortSelect}><span>排序</span><select value={sortMode} onChange={event => setSortMode(event.target.value as typeof sortMode)}><option value="recommended">推荐</option><option value="heat">热度</option><option value="likes">点赞</option><option value="updated">最近更新</option><option value="name">名称</option></select></label>
            </div>
            {tab === "榜单" && <div className={s.rankingBar} role="tablist" aria-label="榜单周期">{([ ["day", "日榜"], ["week", "周榜"], ["all", "总榜"] ] as const).map(([period, label]) => <button key={period} role="tab" aria-selected={rankingPeriod === period} className={rankingPeriod === period ? s.rankActive : ""} onClick={() => setRankingPeriod(period)}>{label}</button>)}</div>}
            {featured.length > 0 && <section className={s.featuredShelf} aria-label="优秀作品"><h2>优秀作品</h2><div className={`${s.cardGrid} ${state.preferences.homeLayout === "single" ? s.singleLayout : ""}`}>{featured.map(renderShelfItem)}</div></section>}
            {featured.length > 0 && shelf.length > 0 && <h2 className={s.shelfHeading}>更多推荐</h2>}
            {shelf.length ? (
              <div className={`${s.cardGrid} ${state.preferences.homeLayout === "single" ? s.singleLayout : ""}`}>
                {shelf.map(renderShelfItem)}
              </div>
            ) : featured.length ? null : (
              <div className={s.empty}>
                <Icon name={tab === "关注" ? "heart" : "search"} size={38} />
                <h2>
                  {tab === "关注" ? "还没有关注作者" : "没有找到相关角色"}
                </h2>
                <p>
                  {tab === "关注"
                    ? "进入作者主页，关注后就能在这里看到他的作品。"
                    : genre !== "全部"
                      ? `「${genre}」下还没有角色。创作时加上这个标签，或换一个看看。`
                      : "试试其他关键词，或者定制你自己的角色。"}
                </p>
                <button
                  className={s.primary}
                  onClick={() => {
                    setQuery("");
                    setGenre("全部");
                    setTab("新手");
                  }}
                >
                  浏览角色
                </button>
              </div>
            )}
          </main></>}
          <footer className={s.footer}>
            <span>叙梦 · 与角色相遇，让故事继续。</span>
            <button
              onClick={() =>
                setNotice(
                  "角色目录包含公开介绍原文和原创改写样本，作者与出处见角色详情。",
                )
              }
            >
              内容来源
            </button>
            <button onClick={() => importRef.current?.click()}>
              导入角色卡
            </button>
            <button onClick={() => navigate("presets")}>模型与预设</button>
            <CommunityGuidelinesLink />
            {!XUMENG_PAYMENT_INFO_DRAFT && XUMENG_PAYMENT_INFO_PAGES.map(page => (
              <a key={page.path} href={page.path}>{page.label}</a>
            ))}
          </footer>
        </>
      )}

      {view === "chat" && !detail && (
        <main className={s.chatLayout}>
          <aside
            className={`${s.chatSidebar} ${active || gameSelection || companionInMain ? s.hasActive : ""}`}
          >
            {conversationType === "stories" && <div className={s.sidebarTools}>
              <button
                title="匹配"
                aria-label="匹配角色"
                onClick={matchCharacter}
              >
                <Icon name="shuffle" size={20} />
                <span>匹配</span>
              </button>
              <button
                title="定制"
                aria-label="定制角色"
                onClick={() => openStudio("new")}
              >
                <Icon name="edit" size={20} />
                <span>定制</span>
              </button>
              <button
                title="预设"
                aria-label="对话预设"
                onClick={() => navigate("presets")}
              >
                <Icon name="book" size={20} />
                <span>预设</span>
              </button>
              <button
                title="导入"
                aria-label="导入角色卡"
                onClick={() => importRef.current?.click()}
              >
                <Icon name="upload" size={20} />
                <span>导入</span>
              </button>
            </div>}
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
              {conversationType === "games" && (cloud.user?.isGuest ? <div className={gameNavigation.listState}><p>登录后查看你的游戏作品。</p><button onClick={() => openAccount("login")}>登录</button></div>
                : gameLibrary.loading || !cloud.user ? <p className={s.sidebarEmpty} role="status">正在加载游戏…</p>
                : gameLibrary.error ? <div className={gameNavigation.listState} role="alert"><p>{gameLibrary.error}</p><button onClick={gameLibrary.refresh}>重新加载</button></div>
                : visibleGames.length ? visibleGames.map(game => <button key={game.id} className={`${s.conversation} ${gameSelection?.id === game.id ? s.conversationActive : ""}`} aria-label={`游玩${game.title}`} onClick={() => playGame({ kind: "private", id: game.id })}>
                  <div className={gameNavigation.gameAvatar} aria-hidden="true"><Icon name="game" size={23}/></div><span><strong>{game.title}</strong>{gameLastPlayed.has(game.id) && <time className={s.conversationTime}>{new Date(gameLastPlayed.get(game.id)!).toLocaleDateString("zh-CN", {month:"numeric",day:"numeric"})}</time>}<small>{game.synopsis || "私人游戏作品"}</small></span>
                </button>)
                : <div className={gameNavigation.listState}><p>{conversationQuery ? "没有找到匹配的游戏。" : "还没有游戏作品。"}</p>{!conversationQuery && <button onClick={() => openCreatorRoute("studio/games")}>导入或创作游戏</button>}</div>)}
              {conversationType === "chats" && companionMatchesSearch && <button className={gameNavigation.companionEntry} aria-current={companionInMain && companionVariant === "classic" ? "page" : undefined} onMouseEnter={() => warmCompanion("classic")} onFocus={() => warmCompanion("classic")} onClick={() => openCompanion("classic")}>
                <span className={gameNavigation.companionAvatar} aria-hidden="true"><img src={CONTENT_PEOPLE[0].cover} alt="" /></span>
                <span><strong>Yume</strong><small>商科学生 · 爱打游戏</small></span>
                <Icon name="chevron" size={15}/>
              </button>}
              {conversationType === "chats" && intimateMatchesSearch && <button className={gameNavigation.companionEntry} aria-current={companionInMain && companionVariant === "intimate" ? "page" : undefined} onMouseEnter={() => warmCompanion("intimate")} onFocus={() => warmCompanion("intimate")} onClick={() => openCompanion("intimate")}>
                <span className={gameNavigation.companionAvatar} aria-hidden="true"><img src={CONTENT_PEOPLE[1].cover} alt="" /></span>
                <span><strong>晚宁</strong><small>你的恋人</small></span>
                <Icon name="chevron" size={15}/>
              </button>}
              {conversationType === "chats" && qwenMatchesSearch && <button className={gameNavigation.companionEntry} aria-current={companionInMain && companionVariant === "qwen" ? "page" : undefined} onMouseEnter={() => warmCompanion("qwen")} onFocus={() => warmCompanion("qwen")} onClick={() => openCompanion("qwen")}>
                <span className={gameNavigation.companionAvatar} aria-hidden="true"><img src={CONTENT_PEOPLE[2].cover} alt="" /></span>
                <span><strong>苏麦</strong><small>说话直一点</small></span>
                <Icon name="chevron" size={15}/>
              </button>}
              {conversationType === "chats" && !companionMatchesSearch && !intimateMatchesSearch && !qwenMatchesSearch && <p className={s.sidebarEmpty} role="status">没有找到匹配的聊天对象</p>}
              {conversationType === "stories" && visibleConversations.map((c) => {
                const ch = conversationCharacters.find((x) => x.id === c.characterId);
                return (
                  <button
                    key={c.id}
                    className={`${s.conversation} ${activeId === c.id ? s.conversationActive : ""}`}
                    onClick={() => selectConversation(c)}
                  >
                    {ch ? <Cover character={ch} /> : <div className={s.unavailableAvatar} aria-hidden="true"><Icon name="chat" size={20} /></div>}
                    <span>
                      <strong>{c.title}</strong>
                      <time className={s.conversationTime}>
                        {new Date(c.updatedAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <small>
                        {!ch && "角色暂不可用 · "}{c.messages.at(-1)?.content || "开始新的故事"}
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
          <section className={s.chatMain}>
              {companionInMain ? (
              companionVariant === "qwen"
                ? <QwenCompanion key={`${cloud.user?.id ?? "loading"}:qwen`} avatar={CONTENT_PEOPLE[2].cover} onBack={leaveCompanion}/>
                : <CompanionPage key={`${cloud.user?.id ?? "loading"}:${companionVariant}:${customCompanion?.id ?? ""}`} variant={companionVariant === "custom" ? "custom" : companionVariant} profile={companionVariant === "custom" ? customCompanion ?? REALISTIC_COMPANION_PROFILES[0] : undefined} avatar={companionVariant === "custom" ? customCompanion?.cover : CONTENT_PEOPLE.find(person => person.variant === companionVariant)?.cover} onBack={leaveCompanion}/>
            ) : gameSelection ? (
              gameLibrary.privateGame ? <GamePlayer key={`${cloud.user?.id}:private:${gameSelection.id}:${gameLibrary.privateGame.version}`} game={gameLibrary.privateGame} onBack={leaveGame}/> : <div className={gameNavigation.gameLoading} role={gameLibrary.privateError ? "alert" : "status"}><Icon name="game" size={36}/><p>{gameLibrary.privateError || "正在打开游戏…"}</p>{gameLibrary.privateError && <button onClick={cloud.user?.isGuest ? () => openAccount("login") : gameLibrary.refresh}>{cloud.user?.isGuest ? "登录" : "重试打开"}</button>}<button onClick={leaveGame}>返回游戏列表</button></div>
            ) : activeCharacter && active ? (
              <>
                <header className={s.chatHeader}>
                  <button
                    className={`${s.iconButton} ${s.mobileBack}`}
                    aria-label="返回会话列表"
                    onClick={() => {
                      if (requestActive.current) {
                        setNotice("请先停止当前回复，再返回会话列表。");
                        return;
                      }
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
                      <small>{busy ? "正在输入…" : "单人对话"}</small>
                    </span>
                  </button>
                  <div className={s.modelPicker}>
                    <button
                      className={s.modelButton}
                      aria-label="选择 AI 模型"
                      aria-expanded={modelMenuOpen}
                      disabled={busy}
                      onClick={() => { if (!requestActive.current) setModelMenuOpen((open) => !open); }}
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
                                if (requestActive.current) return;
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
                    <button className={s.iconButton} aria-label="给当前角色打电话" title="带着当前剧情打电话" disabled={busy} onClick={() => performActiveCharacter("live")}><Icon name="phone" size={18} /></button>
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
                  </div>
                </header>
                {panelTemplate && panelState && <XumengInteractionPanel template={panelTemplate} values={panelState.panels} className={s.interactionPanel} />}
                <div className={s.messageScroll} ref={messageScrollRef}>
                  <ChatMediaProvider key={`${cloud.user?.id ?? "offline"}:${active.id}`} accountId={cloud.user?.id}
                    conversationId={active.id} isGuest={cloud.user?.isGuest ?? true} saveNow={cloud.saveNow}
                    onRequireAccount={() => openAccount("login")}
                    onVip={() => navigate("vip")}>
                  <div className={s.messageList}>
                    {active.messages.map((m, index) => (
                      <div
                        key={m.id}
                        className={`${s.messageRow} ${m.role === "user" ? s.userRow : ""}`}
                      >
                        <div className={s.messageContent}>
                          <ChatMessageMedia message={m} disabled={busy} label={`第 ${index + 1} 条消息`}
                            onCopy={() => { void copyMessage(splitXumengPanelTail(m.content).body); }} onEdit={() => editMessage(m)}
                            onRegenerate={canRegenerateDzmmMessage(active, m.id) ? () => regenerateMessage(m.id) : undefined}>
                          <span className={s.messageName}>
                            {m.role === "assistant" ? (
                              <Cover
                                character={activeCharacter}
                                className={s.messageAvatar}
                              />
                            ) : (
                              <span
                                className={`${s.avatar} ${s.messageAvatar}`}
                              >
                                {Array.from(state.preferences.nickname)[0] ?? ""}
                              </span>
                            )}
                            {m.role === "user"
                              ? state.preferences.nickname
                              : activeCharacter.name}
                            {m.role === "assistant" && activeOpening?.messages[index]?.role === m.role
                              && activeOpening.messages[index].content.trim() === m.content.trim() && (
                              <small>{activeOpening.kind === "background" ? "故事背景" : activeOpening.kind === "welcome" ? "故事起点" : "开场白"}</small>
                            )}
                          </span>
                          <div className={s.messageBubble} data-message-text>
                            {m.role === "assistant" && activeOpening?.source === "template"
                              && activeOpening.messages[index]?.content.trim() === m.content.trim() ? <CharacterIntroduction text={m.content}
                              characterName={activeCharacter.name} userName={playUserName}
                              additionalNotes={activeOpening?.source === "template" && index === activeOpening.messages.findIndex(message => message.role === "assistant")
                                ? getDzmmCharacterCreatorNotes(activeCharacter) : undefined}
                              renderBody={body => <MessageText text={body} />} /> : <MessageText text={m.content} role={m.role} characterName={activeCharacter.name} userName={playUserName} />}
                          </div>
                          </ChatMessageMedia>
                          {m.role === "assistant" && m.content.trim() && <ReplySuggestions key={`${profileUser.id}:${active.id}:${m.id}`}
                            contextKey={`${profileUser.id}:${active.id}:${m.id}:${replySuggestionKeys[index]}`}
                            accountId={profileUser.id} onAutomaticStart={() => {}} automatic={false}
                            label={`第 ${index + 1} 条回复`} disabled={busy || cloud.authBusy} billed={Boolean(billingConfig?.enabled)}
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
                          onClick={() =>
                            setDraft(
                              "请随机生成我的身份和起始地点，从第一场事件开始。",
                            )
                          }
                        >
                          随机开局 <Icon name="shuffle" size={12} />
                        </button>
                      </div>
                    )}
                    {!busy && !active.messages.some(message => message.role === "user") && Boolean(activeCharacter.suggestedReplies?.length) && <div className={s.quickStarts} aria-label="角色建议回复">{activeCharacter.suggestedReplies?.map((reply, index) => <button key={`${index}:${reply}`} onClick={() => setDraft(reply)}>{reply}</button>)}</div>}
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
                  {rechargeNeeded && !busy && <p className={s.chatError}><span>当前余额不足以覆盖上下文与最短回复。可减少上下文，或等其他请求的预留结算后重试；未使用的预留会返还。{!XUMENG_PAYMENTS_ENABLED && "收款暂时关闭。"}</span><button type="button" onClick={() => navigate("recharge")}>{XUMENG_PAYMENTS_ENABLED ? "去充值" : "查看余额"}</button></p>}
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
                    enabled={billingConfig?.enabled ?? false} refreshKey={billingRefresh} onRequireAccount={() => openAccount("login")} onRecharge={() => navigate("recharge")} />
                  {activeId && suggestionInsertions.current[activeId]?.after === draft && <p className={s.composerNote}>
                    <button type="button" onClick={() => {
                      const insertion = suggestionInsertions.current[activeId];
                      if (insertion?.after !== draft) return;
                      delete suggestionInsertions.current[activeId]; setDraft(insertion.before);
                    }}>撤销建议</button>
                  </p>}
                  <form
                    className={s.composer}
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                  >
                    <button
                      type="button"
                      className={s.composerPreset}
                      aria-label="对话预设"
                      title="对话预设"
                      onClick={() => navigate("presets")}
                    >
                      <Icon name="sliders" size={16} />
                    </button>
                    <textarea
                      ref={composerInputRef}
                      aria-label="发送消息"
                      disabled={!loaded || cloud.authBusy}
                      placeholder="输入消息 (Shift+Enter 换行)"
                      value={draft}
                      maxLength={12000}
                      rows={1}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    {busy ? (
                      <button
                        key="stop-generation"
                        className={s.sendButton}
                        type="button"
                        onClick={(e) => { e.preventDefault(); controller.current?.abort(); }}
                        aria-label="停止生成"
                      >
                        <Icon name="stop" size={17} />
                      </button>
                    ) : (
                      <button
                        key="send-message"
                        className={s.sendButton}
                        type="submit"
                        disabled={!loaded || cloud.authBusy || !draft.trim()}
                        aria-label="发送"
                      >
                        <Icon name="send" size={17} />
                      </button>
                    )}
                  </form>
                  <p className={s.composerNote}>AI 生成内容</p>
                </div>
              </>
            ) : active ? (
              <UnavailableConversation key={`${profileUser.id}:${active.id}`} conversation={active} nickname={state.preferences.nickname}
                onBack={() => {
                  if (requestActive.current) { setNotice("正在停止当前回复，请稍候再返回。"); return; }
                  setActiveId(null);
                }} onExport={exportConversation} onDelete={removeActiveConversation}
                onCopy={text => { void copyMessage(text); }} />
            ) : (
              <div className={s.empty}>
                <span className={s.emptyChatIcon}>
                  <Icon name={conversationType === "games" ? "game" : conversationType === "chats" ? "heart" : "book"} size={38} />
                </span>
                <h2>{conversationType === "chats" ? "聊聊今天的小事" : conversationType === "games" ? "选一部游戏，开始游玩" : state.conversations.length ? "选择一段故事继续" : "开启你的第一段故事"}</h2>
                <p>{conversationType === "chats" ? "从左边选一个人，慢慢认识彼此。" : conversationType === "games" ? "你的游戏作品都在左侧列表。" : state.conversations.length ? "从列表继续剧情，或遇见一个新的角色。" : "去找一个心仪的角色吧"}</p>
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

      {view === "generation" && !detail && (XUMENG_GENERATION_WORKSPACE_ENABLED ? (cloud.user ? <GenerationStudio key={cloud.user.id} userId={cloud.user.id} isGuest={cloud.user.isGuest} onRequireAccount={() => openAccount("register")} onRecharge={XUMENG_PAYMENTS_ENABLED ? () => navigate("recharge") : undefined} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>) : <GenerationHistory key={cloud.user?.id ?? "guest"} userId={cloud.user?.id ?? ""} isGuest={cloud.user?.isGuest ?? true} onRequireAccount={() => openAccount("login")} />)}

      {view === "tasks" && !detail && (cloud.user ? <TaskHub key={`${cloud.user.id}:${cloud.user.isGuest}`} userId={cloud.user.id} isGuest={cloud.user.isGuest} isSuper={cloud.user.role === "super"} characters={cloud.catalog} selection={taskSelection} onSelectionChange={(selection) => updateTaskSelection(cloud.user!.id, selection)} onCharacter={(id, selection) => { const character = cloud.catalog.find(card => card.id === id); if (character) showDetail(character, selection); }} onNavigate={(target) => { navigate(target); }} onRequireAccount={() => openAccount("register")} beforeRefresh={cloud.saveNow} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>)}
      {view === "app" && !detail && <InstallApp onBack={() => navigate("characters")} />}
      {(view === "recharge" || view === "vip") && !detail && (cloud.user ? <Recharge key={`${cloud.user.id}:${cloud.user.isGuest}`} focusVip={view === "vip"} userId={cloud.user.id} isGuest={cloud.user.isGuest} onRequireAccount={() => openAccount("login")} onBack={() => navigate("profile")} returnOrderId={paymentReturn?.get("payment_order") || undefined} cancelled={paymentReturn?.get("payment") === "cancel"} /> : <main className={s.profileEmpty}><p>正在加载账户…</p></main>)}
      {view === "studio" && !detail && <CreatorCenter key={profileUser.id} section={creatorSection} user={cloud.user} drafts={state.custom} onCreate={() => openStudio("new")} onEdit={openStudio} onCharacter={showDetail} onRequireAccount={() => openAccount("register")} onCatalogChanged={cloud.refreshCatalog} onRoute={openCreatorRoute} />}
      {(view === "live" || view === "voice") && !detail && performanceLibrary.error && <div className={s.error} role="alert">{performanceLibrary.error}<button onClick={performanceLibrary.refresh}>重试加载人物</button></div>}
      {view === "live" && !detail && (liveMode === "phone"
        ? <MiniCpmPhone key={`${profileUser.id}:${cloud.user?.isGuest}:${performanceCharacter?.key ?? "manual"}`} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} userName={playUserName} characters={callCharacters} initialCharacter={performanceCharacter} onPick={character => { const accountId = cloud.user?.id; if (accountId) setPerformanceSelection({ accountId, character }); }} onRequireAccount={() => openAccount("login")} onBack={() => navigate("characters")} onVideo={() => setLiveMode("video")} onBusyChange={(working) => { liveBusy.current = working; }} />
        : <LiveStudio key={`${profileUser.id}:${cloud.user?.isGuest}`} preferVideo userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} isSuper={cloud.user?.role === "super"} userName={playUserName} characters={callCharacters} sources={performanceLibrary.sources} initialCharacter={performanceCharacter} onVoice={(character) => performCharacter(character, "voice")} onRequireAccount={() => openAccount("login")} onBack={() => setLiveMode("phone")} onBusyChange={(working) => { liveBusy.current = working; }} />)}
      {view === "voice" && !detail && <VoiceStudio key={`${profileUser.id}:${cloud.user?.isGuest}`} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} characters={performanceLibrary.characters} initialCharacter={performanceCharacter} onRequireAccount={() => openAccount("login")} onBack={() => navigate("characters")} onBusyChange={(working) => { voiceBusy.current = working; }} />}
      {view === "novels" && !detail && <NovelStudio key={`${profileUser.id}:${novelInitial.id ?? novelInitial.type ?? "library"}`} initialId={novelInitial.id} initialType={novelInitial.type} onNavigate={(id, type) => { novelRoute.current = id === null ? "novels" : id === "new" ? `novels/new/${type ?? "novel"}` : `novels/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${novelRoute.current}`); }} onSaved={id => { novelRoute.current = `novels/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${novelRoute.current}`); }} characters={characters} onPerformCharacter={performCharacter} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} onRequireAccount={() => openAccount("login")} onBack={() => navigate("studio")} onDirtyChange={(dirty) => { novelDirty.current = dirty; }} onBusyChange={(working) => { novelBusy.current = working; }} />}
      {view === "games" && !detail && <GameStudio key={`${profileUser.id}:${creatorInitial.id ?? "library"}`} userId={cloud.user?.id ?? null} isGuest={cloud.user?.isGuest ?? true} initialId={creatorInitial.id} onNavigate={id => { creatorRoute.current = id ? `studio/games/${encodeURIComponent(id)}` : "studio/games"; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onSaved={id => { creatorRoute.current = `studio/games/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onRequireAccount={() => openAccount("register")} onBack={() => { creatorDirty.current = false; creatorBusy.current = false; navigate("studio"); }} onDirtyChange={dirty => { creatorDirty.current = dirty; }} onBusyChange={working => { creatorBusy.current = working; }}/>}
      {view === "scenarios" && !detail && <ScenarioStudio key={`${profileUser.id}:${creatorInitial.id ?? creatorInitial.roomCode ?? "library"}`} userId={cloud.user?.id ?? null} isGuest={cloud.user?.isGuest ?? true} initialId={creatorInitial.id} initialRoomCode={creatorInitial.roomCode} onNavigate={id => { creatorRoute.current = id ? `studio/scenarios/${encodeURIComponent(id)}` : "studio/scenarios"; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onSaved={id => { creatorRoute.current = `studio/scenarios/${encodeURIComponent(id)}`; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onRoom={code => { creatorRoute.current = `studio/room/${encodeURIComponent(code)}`; window.history.replaceState(null, "", `#${creatorRoute.current}`); }} onRequireAccount={() => openAccount("register")} onBack={() => { creatorDirty.current = false; creatorBusy.current = false; navigate("studio"); }} onDirtyChange={dirty => { creatorDirty.current = dirty; }} onBusyChange={working => { creatorBusy.current = working; }}/>}
      {view === "studio-edit" && !detail && editor && <CharacterStudio key={`${profileUser.id}:${studioSession}`} character={editor === "new" ? null : editor} nickname={state.preferences.nickname} user={cloud.user} submission={studioSubmission} onClose={() => { studioDirty.current = false; studioBusy.current = false; setEditor(null); navigate("studio"); }} onDirtyChange={(dirty) => { studioDirty.current = dirty; }} onBusyChange={(working) => { studioBusy.current = working; }} onSave={saveStudioCharacter} onRetrySave={(character) => saveStudioCharacter(character, true)} onSubmit={submitStudioCharacter} onLoadCloud={async () => { if (!await cloud.reloadCloud()) throw new Error("云端版本没有载入，当前编辑内容仍保留。请再加载云端版本。"); }} onTest={testStudioCharacter} onRequireAccount={() => openAccount("register")} />}
      {view === "profile" && !detail && <>
        <ProfileView key={profileUser.id} user={cloud.user} characters={characters} custom={state.custom} favorites={state.favorites} conversations={state.conversations} authors={authors} preferences={state.preferences} onCharacter={showDetail} onAuthor={showAuthor} onConversation={(conversation) => { selectConversation(conversation); navigate("chat"); }} onEditCharacter={openStudio} onCreateCharacter={() => openStudio("new")} onEditProfile={() => navigate("settings")} onSettings={() => navigate("settings")} onPresets={() => navigate("presets")} onRecharge={() => navigate("recharge")} onInvite={() => navigate("invite")} onDeleteCharacter={deleteCharacter} onAdmin={cloud.user?.role === "super" ? () => navigate("admin") : undefined} />
        <div className={s.profile}>
          <section className={s.cloudAccount} aria-label="账号与数据库同步">
            <div className={s.cloudStatus} data-status={cloud.syncStatus} role="status">
              <span className={s.syncDot} />
              <div><strong>{cloud.syncMessage}</strong>{cloud.syncStatus === "synced" && cloud.lastSyncedAt && <small>最近同步 {new Date(cloud.lastSyncedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}</small>}</div>
            </div>
            <div className={s.cloudActions}>
              {cloud.authenticated ? <button className={s.secondary} disabled={cloud.authBusy || busy} onClick={() => void cloud.logout()}>退出账号</button> : <><button className={s.primary} disabled={cloud.authBusy || busy} onClick={() => openAccount("register")}>注册账号</button><button className={s.secondary} disabled={cloud.authBusy || busy} onClick={() => openAccount("login")}>登录</button></>}
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
        </div>
      </>}
      {view === "invite" && !detail && <InviteCenter key={profileUser.id} user={cloud.user} onBack={() => navigate("profile")} onRegister={() => openAccount("register")} onWallet={() => navigate("profile")} />}
      {view === "settings" && !detail && <ProfileSettings key={profileUser.id} user={cloud.user} preferences={state.preferences} onPreferences={savePreferences} onBack={() => navigate("profile")} onPasswordChanged={cloud.passwordConfigured} />}
      {view === "presets" && !detail && <PresetLibrary key={profileUser.id} preferences={state.preferences} onPreferences={savePreferences} onBack={() => navigate("profile")} />}
      {view === "author" && !detail && (selectedAuthor ? <AuthorProfile key={selectedAuthor.id} author={selectedAuthor} characters={characters} preferences={state.preferences} onPreferences={savePreferences} onCharacter={showDetail} onBack={() => navigate("characters")} /> : <main className={s.profileEmpty}><p>没有找到这位作者。</p><button className={s.secondary} onClick={() => navigate("characters")}>返回角色广场</button></main>)}
      {view === "search" && !detail && <SearchResults query={query} characters={characters} authors={authors} favorites={state.favorites} likes={likedForCurrentAccount} preferences={state.preferences} onCharacter={showDetail} onFavorite={toggleFavorite} onLike={toggleLike} onAuthor={showAuthor} onTag={(tag) => { setTab("新手"); setGenre(tag); navigate("characters"); }} searchTopics={searchForumTopics} onTopic={(topic) => showForumPost(topic.id)} />}
      {view === "forum" && !detail && <ForumView key={profileUser.id} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} nickname={state.preferences.nickname} isSuper={cloud.user?.role === "super"} postId={forumPostId ?? undefined} onPostChange={showForumPost} onRequireAccount={() => openAccount("register")} characters={characters.filter((character) => !isDzmmCharacterBlocked(character, state.preferences.blockedTags))} onCharacter={showDetail} />}
      {view === "admin" && !detail && <AdminDashboard key={`${cloud.user?.id}:${cloud.user?.role}`} user={cloud.user} onRequireAccount={() => openAccount("login")} onAccountChanged={() => setBillingRefresh(value => value + 1)}
        publishingReview={<PublishingCenter key={`review:${profileUser.id}`} admin user={cloud.user} drafts={state.custom} onCreate={() => openStudio("new")} onEdit={openStudio} onCharacter={showDetail} onRequireAccount={() => openAccount("login")} onCatalogChanged={cloud.refreshCatalog} onNovels={() => navigate("novels")} />}
        forumModeration={<ForumView key={profileUser.id} userId={cloud.user?.id} isGuest={cloud.user?.isGuest ?? true} nickname={state.preferences.nickname} isSuper={cloud.user?.role === "super"} postId={forumPostId ?? undefined} onPostChange={showForumPost} onRequireAccount={() => openAccount("register")} characters={characters.filter((character) => !isDzmmCharacterBlocked(character, state.preferences.blockedTags))} onCharacter={showDetail} />} />}

      <nav className={s.mobileNav} aria-label="移动端导航">
        {localizedNav.map((n) => (
          <a
            href={`#${n.view}`}
            key={n.view}
            onClick={(e) => {
              e.preventDefault();
              navigate(n.view);
            }}
            className={view === n.view || (n.view === "characters" && view === "play-games") || (n.view === "studio" && ["studio-edit", "games", "scenarios", "novels"].includes(view)) ? s.navActive : ""}
          >
            <Icon name={n.icon} size={21} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      {view !== "chat" && view !== "live" && view !== "voice" && view !== "admin" && !detail && state.preferences.showFloatingChat !== false && (
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
        accept=".json,application/json"
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
          character={detail}
          favorites={state.favorites.includes(detail.id)}
          liked={likedForCurrentAccount.includes(detail.id)}
          likeCount={detail.likes}
          related={characters.filter((c) => c.sourceKind === detail.sourceKind)}
          onBack={closeDetail}
          onStart={(openingIndex, fresh) => startChat(detail, fresh ?? false, openingIndex ?? 0)}
          onLive={() => performCharacter(xumengPerformanceFromCard(detail), "live")}
          onVoice={() => performCharacter(xumengPerformanceFromCard(detail), "voice")}
          onFavorite={() => toggleFavorite(detail.id)}
          onLike={() => toggleLike(detail.id)}
          onExport={() => {
            try {
              download(`${detail.name}${detail.authoringDraft ? ".draft" : ""}.json`, detail.authoringDraft ? exportCharacterDraftJson(detail) : exportCharacterJson(detail));
              if (detail.authoringDraft) setNotice("私人创作草稿已导出，未完成词条已保留；导入后可继续编辑。");
            } catch (failure) { setNotice(failure instanceof Error ? failure.message : "导出失败，请保留草稿后重试。"); }
          }}
          onEdit={() => openStudio(detail)}
          onSelect={showDetail}
          onNotice={setNotice}
          onTag={(tag) => { setTab("新手"); setGenre(tag); navigate("characters"); }}
          onAuthor={() => showCharacterAuthor(detail)}
          onFollow={() => toggleFollow(detail)}
          galleryPaths={getDzmmCharacterMedia(detail)?.gallery.map((image) => image.path)}
          userName={playUserName}
          openingOrigin={getDzmmCharacterMedia(detail)?.opening?.origin}
          following={Boolean(findCharacterAuthor(authors, detail.id) && state.preferences.followedAuthors?.includes(findCharacterAuthor(authors, detail.id)!.id))}
        />
      )}
      {chatSettingsOpen && active && activeCharacter && <ChatSettings key={`${profileUser.id}:${active.id}`} conversation={active} preferences={state.preferences} onPreferences={savePreferences} onMemory={saveStoryMemory} onWorldClockMode={saveWorldClockMode} busy={busy} onClose={() => setChatSettingsOpen(false)} onRename={(title) => setState((previous) => ({ ...previous, conversations: previous.conversations.map((conversation) => conversation.id === active.id ? { ...conversation, title, updatedAt: Date.now() } : conversation) }))} onBranch={branchConversation} onDelete={removeActiveConversation} onExport={exportConversation} onPresets={() => navigate("presets")} />}
      {activeCharacter && editingMessage && editingMessage.accountId === activeAccount.current && editingMessage.conversationId === active?.id && view === "chat" &&
        <ChatMessageEditor key={`${editingMessage.conversationId}:${editingMessage.messageId}`} content={splitXumengPanelTail(editingMessage.original).body} disabled={busy}
          onSave={saveEditedMessage} onClose={() => setEditingMessage(null)} />}
      {accountMode && <AccountModal mode={accountMode} initialReferralCode={pendingInvite} onModeChange={(mode) => { cloud.clearAuthError(); setAccountMode(mode); }} onClose={() => setAccountMode(null)} onSubmit={submitAccount} onEmailSubmit={async (values, signal) => { await cloud.authenticateEmailCode(values, signal); setAccountMode(null); }} onPasswordReset={async (values, signal) => { await cloud.resetPassword(values, signal); setAccountMode(null); }} onClearError={cloud.clearAuthError} submitting={cloud.authBusy} error={cloud.authError} />}

    </div>
  );
}

function heatValue(text: string) {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value * (text.includes("万") ? 10000 : 1) : 0;
}

function MessageText({ text, role = "assistant", characterName, userName }: {
  text: string; role?: "user" | "assistant"; characterName?: string; userName?: string;
}) {
  const named = applyDzmmReaderNames(text, { characterName, userName });
  // Status presentation applies to character replies, never to the user's own text.
  const presentation = role === "user" ? { body: named, status: null } : splitXumengMessagePresentation(splitXumengPanelTail(named).body);
  if (!presentation.body && !presentation.status) return null;
  return <>
    {presentation.body && <MessageTextBody text={presentation.body} />}
    {presentation.status && <MessageStatus status={presentation.status} />}
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
  const preview = xumengStatusPreview(status.fields) || sections.find(section => section.notes.length)?.notes[0]?.slice(0, 60) || "";
  return <details className={s.visibleStatus}>
    <summary>{status.title}{preview && <small>{preview}</small>}</summary>
    {sections.map((section, index) => <section key={index} className={s.statusSection}>
      {section.title && <h4>{section.title}</h4>}
      {section.notes.map((note, j) => <p key={j}>{note}</p>)}
      {section.fields.length > 0 && <dl>{section.fields.map((field, j) => <div key={j} className={field.value.length > 24 ? s.statusWide : undefined}>
        <dt>{field.label}</dt><dd>{field.value}</dd>
      </div>)}</dl>}
    </section>)}
  </details>;
}

