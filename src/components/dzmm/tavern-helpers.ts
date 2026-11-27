import authorsData from "@/lib/dzmm-authors.json";
import type { Character } from "@/lib/dzmm-characters";
import { DZMM_DISCOVERY_CATEGORIES, type DzmmAuthor, type DzmmForumTopic } from "@/lib/dzmm-discovery";
import { DZMM_OFFERED_MODEL_OPTIONS } from "@/lib/dzmm-models";
import type { DzmmCatalogLook } from "@/lib/dzmm-public-shelf";
import { isDzmmPublishedCharacterId } from "@/lib/dzmm-storage";
import { GIRLFRIEND_CAST } from "@/app/xumeng/girlfriend/cast";
import { girlfriendLiveVoice } from "@/app/xumeng/girlfriend/companion-voices";
import { characterLinkId } from "@/lib/xumeng-character-link";
import {
  XUMENG_CHARACTER_VOICE_ENABLED,
  XUMENG_FORUM_ENABLED,
  XUMENG_GENERATION_WORKSPACE_ENABLED,
  XUMENG_PAYMENTS_ENABLED,
} from "@/lib/xumeng-feature-availability";
import { xumengHtmlLang, type XumengLocale, type XumengMessageKey } from "@/lib/xumeng-i18n";
import { xumengCategoryName, xumengPage } from "@/lib/xumeng-page-copy";
import type { XumengPerformanceCharacter } from "@/lib/xumeng-performance-character";
import type { RecommendationSurface } from "@/lib/xumeng-recommendations";
import { xumengVideoDramaIdFromRoute } from "@/lib/xumeng-video-catalog";
import type { IconName } from "./icons";

export type TavernView =
  | "play-games" | "videos" | "characters" | "chat" | "forum" | "profile"
  | "search" | "author" | "settings" | "presets" | "admin" | "studio"
  | "studio-edit" | "games" | "girlfriends" | "scenarios" | "novels"
  | "live" | "voice" | "generation" | "aigen" | "tasks" | "app"
  | "recharge" | "vip" | "invite" | "checkin";

export type ChatSection = "stories" | "chats" | "games";
export type LikeStat = { count: number; liked: boolean };
export type CoverTagTone = "rose" | "violet" | "gold" | "blue" | "plum";
export type CompanionVariant = "classic" | "intimate" | "qwen" | "custom" | "sales" | "cast";

export const CHAT_SECTION_ROUTES: Record<ChatSection, string> = {
  stories: "chat",
  chats: "chat/chats",
  games: "chat/games",
};

export const TABS = ["新手", "猜你喜欢", "关注", "最新", "榜单", "分类"];
export const FEATURED_CHARACTER_COUNT = 13;
export const MODEL_MODES = DZMM_OFFERED_MODEL_OPTIONS;
export const MAX_PARALLEL_REPLIES = 3;
export const COARSE_POINTER = "(pointer: coarse)";
export const BROWSE_GENRES_STORAGE_KEY = "xumeng-browse-genres";
export const BROWSE_TAG_LIMIT = 3;
export const AUTHORS: DzmmAuthor[] = authorsData;
export const COIN_GUIDE_KEY = "xumeng.guide.coins";
export const EMPTY_STATUS_LABELS: readonly string[] = Object.freeze([]);

export const HOME_HERO_IMAGES = [
  "/assets/xumeng/home/hero-1.webp",
  "/assets/xumeng/home/hero-2.webp",
  "/assets/xumeng/home/hero-3.webp",
] as const;

export const GAME_COVERS: Record<string, string> = {};

const AUDIENCE_LABELS: Record<string, Record<XumengLocale, string>> = {
  boy: { "zh-Hans": "男性", "zh-Hant": "男性", en: "Men", ja: "男性", ko: "남성" },
  girl: { "zh-Hans": "女性", "zh-Hant": "女性", en: "Women", ja: "女性", ko: "여성" },
  donghua: { "zh-Hans": "动漫", "zh-Hant": "動漫", en: "Anime", ja: "アニメ", ko: "애니" },
  shorts: { "zh-Hans": "短剧", "zh-Hant": "短劇", en: "Shorts", ja: "ショート", ko: "숏폼" },
};

export const NAV: { view: TavernView; labelKey: XumengMessageKey; icon: IconName }[] = [
  { view: "videos", labelKey: "navVideos", icon: "video" },
  { view: "characters", labelKey: "navPlay", icon: "users" },
  { view: "chat", labelKey: "navChat", icon: "chat" },
  ...(XUMENG_FORUM_ENABLED ? [{ view: "forum" as const, labelKey: "navForum" as const, icon: "compass" as const }] : []),
  { view: "studio", labelKey: "navCreate", icon: "edit" },
  { view: "profile", labelKey: "navProfile", icon: "user" },
];

export const NAV_TOOLS: { view: TavernView; labelKey: XumengMessageKey; icon: IconName }[] = [
  ...(XUMENG_GENERATION_WORKSPACE_ENABLED ? [{ view: "generation" as const, labelKey: "navTemplates" as const, icon: "grid" as const }] : []),
  { view: "tasks", labelKey: "navTasks", icon: "trophy" },
  { view: "invite", labelKey: "navInvite", icon: "users" },
  ...(XUMENG_PAYMENTS_ENABLED
    ? [{ view: "recharge" as const, labelKey: "navRecharge" as const, icon: "wallet" as const }, { view: "vip" as const, labelKey: "navVip" as const, icon: "crown" as const }]
    : [{ view: "recharge" as const, labelKey: "navRecharge" as const, icon: "sun" as const }]),
];

export const NAV_SECONDARY_TOOLS: { view: TavernView; labelKey: XumengMessageKey; icon: IconName }[] = [
  { view: "novels", labelKey: "navNovels", icon: "book" },
  ...(XUMENG_CHARACTER_VOICE_ENABLED ? [{ view: "voice" as const, labelKey: "navVoice" as const, icon: "volume" as const }] : []),
  { view: "presets", labelKey: "navPresets", icon: "sliders" },
  { view: "settings", labelKey: "navSettings", icon: "user" },
  { view: "app", labelKey: "navInstallApp", icon: "download" },
];

export const CONTENT_PEOPLE = [
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

export const CHAT_CALL_CHARACTERS: XumengPerformanceCharacter[] = CONTENT_PEOPLE.map(person => ({
  id: `chat-${person.castId || person.variant}`,
  key: `chat:${person.castId || person.variant}`,
  source: "character" as const,
  sourceId: person.castId || person.variant,
  sourceLabel: "聊天",
  name: person.name,
  avatar: person.cover,
  description: person.description,
  personality: person.personality,
  scenario: person.situation,
  dialogue: "",
  liveVoice: girlfriendLiveVoice(person.castId || person.variant),
}));

export type ContentShelfItem =
  | { kind: "game"; key: string; game: { id: string; title: string; synopsis: string } }
  | { kind: "character"; key: string; character: Character }
  | { kind: "companion"; key: string; person: (typeof CONTENT_PEOPLE)[number] };

export function prefetchRoute(target: string) {
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

export function isBrowseLook(id: string): id is DzmmCatalogLook {
  return id === "photo" || id === "anime";
}

export function browseTagName(id: string, locale: XumengLocale): string {
  return AUDIENCE_LABELS[id]?.[locale] ?? xumengCategoryName(locale, id, DZMM_DISCOVERY_CATEGORIES.find((item) => item.slug === id)?.name ?? id);
}

export function coverTagTone(tag: string): CoverTagTone {
  const value = tag.trim().toLowerCase();
  if (/(病娇|抖s|女王|支配|强势|人妻|熟女|成人|性瘾|巨乳|反差|暧昧|暗恋)/u.test(value)) return "rose";
  if (/(战斗|冒险|超英|修仙|异世界|魔法|大世界|游戏)/u.test(value)) return "violet";
  if (/(温柔|治愈|陪伴|日常|乡村|校园)/u.test(value)) return "gold";
  if (/(权力|职场|模拟|悬疑|推理|科幻)/u.test(value)) return "blue";
  return "plum";
}

export function savedCatalogLook(): DzmmCatalogLook | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem("xumeng-catalog-look");
    if (saved === "anime" || saved === "photo") return saved;
  } catch {
    /* The saved look can wait until the next visit. */
  }
  return null;
}

export function readStoredBrowseSelection(): string[] {
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

export function subscribeCoarsePointer(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function readCoarsePointer() {
  return window.matchMedia(COARSE_POINTER).matches;
}

export const uid = () => crypto.randomUUID();

function parseLikeBaseline(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(万|k)?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (match[2]?.toLowerCase() === "k" ? 1000 : match[2] === "万" ? 10000 : 1));
}

export function formatLikeTotal(character: Character, stat?: LikeStat) {
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

export async function searchForumTopics(query: string, signal: AbortSignal): Promise<DzmmForumTopic[]> {
  if (signal.aborted) return [];
  const { fetchDzmmForumPosts } = await import("@/lib/dzmm-forum");
  const result = await fetchDzmmForumPosts({ q: query });
  if (signal.aborted) return [];
  return result.posts.map((post) => ({
    id: post.id,
    title: post.title,
    body: post.body,
    author: post.author.nickname,
    category: post.category,
    updatedAt: post.updatedAt,
  }));
}

export function download(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isGirlfriendRoute(route: string) {
  return route === "chat/girlfriend"
    || route === "chat/girlfriend-intimate"
    || route === "chat/girlfriend-qwen"
    || route === "chat/girlfriend-sales"
    || route.startsWith("chat/girlfriend-custom/")
    || route.startsWith("chat/girlfriend-cast/")
    || route.startsWith("chat/girlfriend-mine/");
}

export function companionVariantFromRoute(route: string): CompanionVariant {
  if (route === "chat/girlfriend-intimate") return "intimate";
  if (route === "chat/girlfriend-qwen") return "qwen";
  if (route === "chat/girlfriend-sales") return "sales";
  if (route.startsWith("chat/girlfriend-custom/") || route.startsWith("chat/girlfriend-mine/")) return "custom";
  if (route.startsWith("chat/girlfriend-cast/")) return "cast";
  return "classic";
}

export function gameHeat(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 60 + (hash % 840);
}

/** Games and character cards share one shelf. Chat cards stay in their own row. */
export function selectedShelfTags(selected: readonly string[]): string[] {
  const slugs = new Set<string>(DZMM_DISCOVERY_CATEGORIES.map((item) => item.slug));
  const fromCategories = DZMM_DISCOVERY_CATEGORIES.filter((item) => selected.includes(item.slug)).flatMap((item) => item.tags);
  return [...fromCategories, ...selected.filter((tag) => !slugs.has(tag) && !isBrowseLook(tag))];
}

export function companionAge(text: string): string | null {
  const digit = /(\d{1,2})\s*岁/u.exec(text);
  if (digit) return `${digit[1]}岁`;
  const written = /([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])岁/u.exec(text);
  return written ? `${written[1]}岁` : null;
}

export function weaveEqual<T>(lanes: readonly (readonly T[])[]): T[] {
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

export function storyUnread(messages: { id: string; role: string; content: string }[], seenId: string | undefined) {
  if (!seenId) return 0;
  const index = messages.findIndex(message => message.id === seenId);
  if (index < 0) return 0;
  return messages.slice(index + 1).filter(message => message.role === "assistant" && message.content.trim()).length;
}

export function formatConversationStamp(updatedAt: number, locale: XumengLocale): string {
  const date = new Date(updatedAt);
  const now = new Date();
  const lang = xumengHtmlLang(locale);
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return xumengPage(locale).yesterday;
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) return date.toLocaleDateString(lang, { weekday: "short" });
  return date.toLocaleDateString(lang, { month: "numeric", day: "numeric" });
}

export function chatPresence(character: { description: string; tags: string[] }, typing: boolean, locale: XumengLocale): string {
  const copy = xumengPage(locale);
  if (typing) return copy.typing;
  const line = character.description.replace(/\s+/g, " ").trim();
  if (!line) return character.tags[0] || copy.online;
  const chars = Array.from(line);
  return chars.length > 18 ? `${chars.slice(0, 18).join("")}…` : line;
}

export function guideSeen(key: string) {
  try { return localStorage.getItem(key) === "1"; }
  catch { return true; }
}

export function linkedPublishedCharacterId(): string | null {
  if (typeof window === "undefined") return null;
  const fromPath = characterLinkId(window.location.pathname);
  if (fromPath && isDzmmPublishedCharacterId(fromPath)) return fromPath;
  if (!window.location.hash.startsWith("#character/")) return null;
  let id = window.location.hash.slice("#character/".length);
  try { id = decodeURIComponent(id); } catch { return null; }
  return isDzmmPublishedCharacterId(id) ? id : null;
}

export type VirtualKeyboardHandle = {
  overlaysContent: boolean;
  readonly boundingRect: { readonly height: number };
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
};

export function readVirtualKeyboard(): VirtualKeyboardHandle | null {
  const candidate = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardHandle }).virtualKeyboard;
  if (!candidate || typeof candidate.addEventListener !== "function") return null;
  return candidate;
}

export function setKeyboardOverlay(keyboard: VirtualKeyboardHandle | null, overlay: boolean) {
  if (!keyboard) return;
  try { keyboard.overlaysContent = overlay; } catch { /* This browser exposes the keyboard object but rejects the overlay switch. */ }
}

export function keyboardInset(keyboard: VirtualKeyboardHandle | null): number {
  if (!keyboard?.overlaysContent) return 0;
  try { return Math.max(0, keyboard.boundingRect?.height ?? 0); } catch { return 0; }
}

export function shelfRecommendationSurface(view: string, tab: string): RecommendationSurface | null {
  if (view === "search") return "search";
  if (view !== "characters" && view !== "play-games") return null;
  if (tab === "新手") return "home";
  if (tab === "猜你喜欢") return "for_you";
  if (tab === "榜单") return "ranking";
  if (tab === "分类") return "category";
  return null;
}
