/**
 * Shared locale and shell copy for the 内容台 client.
 *
 * The content of a character card is user supplied and should stay in the
 * language chosen by its author.  This module only covers product chrome and
 * keeps locale detection independent of React so it can also be used by
 * metadata, tests, and other clients.
 */

export const FOLIO_LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const;
export type FolioLocale = (typeof FOLIO_LOCALES)[number];

export const FOLIO_DEFAULT_LOCALE: FolioLocale = "zh-Hans";
export const FOLIO_LOCALE_STORAGE_KEY = "folio:locale:v1";

export type FolioLocaleOption = {
  readonly locale: FolioLocale;
  /** Native name shown in the language picker. */
  readonly label: string;
  /** BCP 47 language tag used for document.lang and Intl. */
  readonly htmlLang: string;
  /** Short URL segment used in shared language routes and prompt hints. */
  readonly routePrefix: string;
};

export const FOLIO_LOCALE_OPTIONS: readonly FolioLocaleOption[] = Object.freeze([
  { locale: "en", label: "English", htmlLang: "en-US", routePrefix: "en" },
  { locale: "zh-Hans", label: "简体中文", htmlLang: "zh-CN", routePrefix: "zh-cn" },
  { locale: "zh-Hant", label: "繁體中文", htmlLang: "zh-TW", routePrefix: "zh-tw" },
  { locale: "ja", label: "日本語", htmlLang: "ja-JP", routePrefix: "jp" },
  { locale: "ko", label: "한국어", htmlLang: "ko-KR", routePrefix: "ko" },
]);

const localeSet = new Set<FolioLocale>(FOLIO_LOCALES);

/** Return a supported locale, or null when a value is not a locale code. */
export function isFolioLocale(value: unknown): value is FolioLocale {
  // This guard is used when parsing persisted/API values, which must use the
  // canonical five codes. Browser tags should go through normalizeFolioLocale.
  return typeof value === "string" && localeSet.has(value as FolioLocale);
}

export function normalizeFolioLocale(value: unknown): FolioLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
  if (normalized === "zh-hans" || normalized === "zh-cn" || normalized === "zh-sg" || normalized === "zh-my") return "zh-Hans";
  if (normalized === "zh-hant" || normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo") return "zh-Hant";
  // Keep already-normalized values explicit if new aliases are added later.
  if (localeSet.has(value as FolioLocale)) return value as FolioLocale;
  return null;
}

/**
 * Resolve an explicit preference first, then the browser's language list.
 * Unsupported browser languages intentionally fall back to Simplified Chinese
 * to preserve the existing 内容台 experience.
 */
export function resolveFolioLocale(
  preferred: unknown,
  languages: readonly string[] = [],
): FolioLocale {
  const explicit = normalizeFolioLocale(preferred);
  if (explicit) return explicit;
  for (const language of languages) {
    const detected = normalizeFolioLocale(language);
    if (detected) return detected;
  }
  return FOLIO_DEFAULT_LOCALE;
}

export function folioLocaleOption(locale: FolioLocale): FolioLocaleOption {
  return FOLIO_LOCALE_OPTIONS.find(option => option.locale === locale) ?? FOLIO_LOCALE_OPTIONS[1];
}

export function folioLocaleLabel(locale: FolioLocale): string {
  return folioLocaleOption(locale).label;
}

export function folioHtmlLang(locale: FolioLocale): string {
  return folioLocaleOption(locale).htmlLang;
}

export function folioLocaleRoutePrefix(locale: FolioLocale): string {
  return folioLocaleOption(locale).routePrefix;
}

export function folioLocaleFromPathname(pathname: string): FolioLocale | null {
  const segment = pathname.replace(/^\/+/, "").split("/", 1)[0]?.toLowerCase() ?? "";
  if (segment === "jp") return "ja";
  return normalizeFolioLocale(segment);
}

/** Convert /folio or /c/:id into the canonical locale-prefixed route. */
export function folioLocalePathname(pathname: string, locale: FolioLocale): string {
  let path = pathname || "/folio";
  if (!path.startsWith("/")) path = `/${path}`;
  const routeLocale = folioLocaleFromPathname(path);
  if (routeLocale) path = path.replace(/^\/[^/]+(?=\/|$)/, "") || "/";
  if (path === "/folio") path = "/";
  else if (path.startsWith("/folio/")) path = path.slice("/folio".length);
  if (locale === FOLIO_DEFAULT_LOCALE) return path === "/" ? "/folio" : path;
  return `/${folioLocaleRoutePrefix(locale)}${path === "/" ? "" : path}`;
}

/** Language hint for character replies and localized card variants. */
const LOCALE_INSTRUCTIONS: Readonly<Record<FolioLocale, string>> = Object.freeze({
  en: "Language route: /en. Respond in English unless the user asks for another language.",
  "zh-Hans": "语言路由：/zh-cn。请使用简体中文回复，除非用户指定其他语言。",
  "zh-Hant": "語言路由：/zh-tw。請使用繁體中文回覆，除非使用者指定其他語言。",
  ja: "言語ルート：/jp。ユーザーが別の言語を指定しない限り、日本語で返信してください。",
  ko: "언어 경로: /ko. 사용자가 다른 언어를 지정하지 않는 한 한국어로 답변하세요.",
});

export function folioLocaleInstruction(locale: FolioLocale): string {
  return LOCALE_INSTRUCTIONS[locale] ?? LOCALE_INSTRUCTIONS[FOLIO_DEFAULT_LOCALE];
}

export type FolioMessageKey =
  | "language"
  | "navPlay" | "navVideos" | "navChat" | "navLive" | "navGeneration" | "navForum" | "navCreate" | "navProfile"
  | "navInvite" | "navEarnCredit" | "navNovels" | "navVoice" | "navTasks" | "navRecharge" | "navVip"
  | "navPresets" | "navSettings" | "navInstallApp" | "navAdmin"
  | "utilityExploreApps" | "utilityDailyCheckIn" | "utilityInviteEarn" | "utilityRechargeVip" | "utilityInstallApp"
  | "searchAll" | "searchAllPlaceholder" | "clearSearch" | "themeLight" | "themeDark" | "vipCenter"
  | "discoveryRole" | "discoveryGame" | "tabFollowing" | "tabLatest" | "tabRecommended" | "tabNew" | "tabRanking" | "tabCategories"
  | "match" | "customize" | "presets" | "import" | "newConversation"
  | "conversationSearch" | "conversationSearchPlaceholder" | "clearConversationSearch"
  | "conversationTypeAll" | "conversationTypeRoles" | "conversationTypeGames"
  | "mobileMenu" | "closeNavigation" | "allFeatures" | "mainFeatures" | "moreTools";

export type FolioMessages = Readonly<Record<FolioMessageKey, string>>;

const en: FolioMessages = Object.freeze({
  language: "Language",
  navPlay: "Play", navVideos: "Video", navChat: "Messages", navLive: "Calls", navGeneration: "Images / Video", navForum: "Forum", navCreate: "Create", navProfile: "Me",
  navInvite: "Invite friends", navEarnCredit: "Earn Credit", navNovels: "Novel writing", navVoice: "Character voice", navTasks: "Task center", navRecharge: "Credit top-up", navVip: "VIP membership",
  navPresets: "Models & presets", navSettings: "Account settings", navInstallApp: "Install app", navAdmin: "Admin",
  utilityExploreApps: "Explore & apps", utilityDailyCheckIn: "Daily check-in", utilityInviteEarn: "Invite friends, earn Credit", utilityRechargeVip: "Top up & VIP", utilityInstallApp: "Install app",
  searchAll: "Search all", searchAllPlaceholder: "Search all", clearSearch: "Clear search", themeLight: "Switch to light theme", themeDark: "Switch to dark theme", vipCenter: "VIP center",
  discoveryRole: "Characters", discoveryGame: "Games", tabFollowing: "Following", tabLatest: "Latest", tabRecommended: "For you", tabNew: "Featured", tabRanking: "Ranking", tabCategories: "Categories",
  match: "Match", customize: "Customize", presets: "Presets", import: "Import", newConversation: "New conversation",
  conversationSearch: "Search conversations", conversationSearchPlaceholder: "Search characters, games, or messages", clearConversationSearch: "Clear conversation search",
  conversationTypeAll: "All", conversationTypeRoles: "Characters", conversationTypeGames: "Games",
  mobileMenu: "Menu", closeNavigation: "Close navigation", allFeatures: "All features", mainFeatures: "Main features", moreTools: "More tools",
});

const zhHans: FolioMessages = Object.freeze({
  language: "语言",
  navPlay: "游玩", navVideos: "视频", navChat: "陪伴", navLive: "电话", navGeneration: "生成", navForum: "论坛", navCreate: "创作", navProfile: "我的",
  navInvite: "邀请好友", navEarnCredit: "赚 Credit", navNovels: "小说创作", navVoice: "角色语音", navTasks: "任务中心", navRecharge: "Credit 充值", navVip: "VIP 会员",
  navPresets: "模型与预设", navSettings: "账号设置", navInstallApp: "安装应用", navAdmin: "后台管理",
  utilityExploreApps: "探索与应用", utilityDailyCheckIn: "每日签到", utilityInviteEarn: "邀请好友赚 Credit", utilityRechargeVip: "充值与 VIP", utilityInstallApp: "安装应用",
  searchAll: "搜索全站", searchAllPlaceholder: "搜索全站", clearSearch: "清除搜索", themeLight: "切换浅色主题", themeDark: "切换深色主题", vipCenter: "VIP 会员中心",
  discoveryRole: "角色", discoveryGame: "游戏", tabFollowing: "关注", tabLatest: "最新", tabRecommended: "猜你喜欢", tabNew: "推荐", tabRanking: "榜单", tabCategories: "分类",
  match: "匹配", customize: "定制", presets: "预设", import: "导入", newConversation: "创建新会话",
  conversationSearch: "搜索会话", conversationSearchPlaceholder: "搜索角色、游戏或聊天内容", clearConversationSearch: "清除会话搜索",
  conversationTypeAll: "全部", conversationTypeRoles: "角色", conversationTypeGames: "游戏",
  mobileMenu: "菜单", closeNavigation: "关闭导航菜单", allFeatures: "全部功能", mainFeatures: "主要功能", moreTools: "更多工具",
});

const zhHant: FolioMessages = Object.freeze({
  language: "語言",
  navPlay: "遊玩", navVideos: "影片", navChat: "訊息", navLive: "電話", navGeneration: "生成圖片／影片", navForum: "論壇", navCreate: "創作", navProfile: "我的",
  navInvite: "邀請好友", navEarnCredit: "賺 Credit", navNovels: "小說創作", navVoice: "角色語音", navTasks: "任務中心", navRecharge: "Credit 儲值", navVip: "VIP 會員",
  navPresets: "模型與預設", navSettings: "帳號設定", navInstallApp: "安裝應用程式", navAdmin: "後台管理",
  utilityExploreApps: "探索與應用", utilityDailyCheckIn: "每日簽到", utilityInviteEarn: "邀請好友賺 Credit", utilityRechargeVip: "儲值與 VIP", utilityInstallApp: "安裝應用程式",
  searchAll: "搜尋全站", searchAllPlaceholder: "搜尋全站", clearSearch: "清除搜尋", themeLight: "切換淺色主題", themeDark: "切換深色主題", vipCenter: "VIP 會員中心",
  discoveryRole: "角色", discoveryGame: "遊戲", tabFollowing: "關注", tabLatest: "最新", tabRecommended: "你可能喜歡", tabNew: "推薦", tabRanking: "排行榜", tabCategories: "分類",
  match: "配對", customize: "自訂", presets: "預設", import: "匯入", newConversation: "建立新對話",
  conversationSearch: "搜尋對話", conversationSearchPlaceholder: "搜尋角色、遊戲或聊天內容", clearConversationSearch: "清除對話搜尋",
  conversationTypeAll: "全部", conversationTypeRoles: "角色", conversationTypeGames: "遊戲",
  mobileMenu: "選單", closeNavigation: "關閉導覽選單", allFeatures: "全部功能", mainFeatures: "主要功能", moreTools: "更多工具",
});

const ja: FolioMessages = Object.freeze({
  language: "言語",
  navPlay: "遊ぶ", navVideos: "動画", navChat: "メッセージ", navLive: "通話", navGeneration: "画像／動画", navForum: "フォーラム", navCreate: "創作", navProfile: "マイページ",
  navInvite: "友達を招待", navEarnCredit: "Creditを獲得", navNovels: "小説創作", navVoice: "キャラクターボイス", navTasks: "タスクセンター", navRecharge: "Creditチャージ", navVip: "VIP会員",
  navPresets: "モデルとプリセット", navSettings: "アカウント設定", navInstallApp: "アプリをインストール", navAdmin: "管理画面",
  utilityExploreApps: "探索とアプリ", utilityDailyCheckIn: "毎日チェックイン", utilityInviteEarn: "友達を招待してCreditを獲得", utilityRechargeVip: "チャージとVIP", utilityInstallApp: "アプリをインストール",
  searchAll: "全体を検索", searchAllPlaceholder: "全体を検索", clearSearch: "検索をクリア", themeLight: "ライトテーマに切り替え", themeDark: "ダークテーマに切り替え", vipCenter: "VIP会員センター",
  discoveryRole: "キャラクター", discoveryGame: "ゲーム", tabFollowing: "フォロー中", tabLatest: "最新", tabRecommended: "おすすめ", tabNew: "注目", tabRanking: "ランキング", tabCategories: "カテゴリー",
  match: "マッチ", customize: "カスタマイズ", presets: "プリセット", import: "インポート", newConversation: "新しい会話",
  conversationSearch: "会話を検索", conversationSearchPlaceholder: "キャラクター、ゲーム、メッセージを検索", clearConversationSearch: "会話検索をクリア",
  conversationTypeAll: "すべて", conversationTypeRoles: "キャラクター", conversationTypeGames: "ゲーム",
  mobileMenu: "メニュー", closeNavigation: "ナビゲーションを閉じる", allFeatures: "すべての機能", mainFeatures: "主な機能", moreTools: "その他のツール",
});

const ko: FolioMessages = Object.freeze({
  language: "언어",
  navPlay: "플레이", navVideos: "영상", navChat: "메시지", navLive: "통화", navGeneration: "이미지／동영상", navForum: "포럼", navCreate: "창작", navProfile: "내 정보",
  navInvite: "친구 초대", navEarnCredit: "Credit 받기", navNovels: "소설 창작", navVoice: "캐릭터 음성", navTasks: "작업 센터", navRecharge: "Credit 충전", navVip: "VIP 멤버십",
  navPresets: "모델 및 프리셋", navSettings: "계정 설정", navInstallApp: "앱 설치", navAdmin: "관리자",
  utilityExploreApps: "탐색 및 앱", utilityDailyCheckIn: "매일 출석", utilityInviteEarn: "친구 초대하고 Credit 받기", utilityRechargeVip: "충전 및 VIP", utilityInstallApp: "앱 설치",
  searchAll: "전체 검색", searchAllPlaceholder: "전체 검색", clearSearch: "검색 지우기", themeLight: "라이트 테마로 전환", themeDark: "다크 테마로 전환", vipCenter: "VIP 멤버십 센터",
  discoveryRole: "캐릭터", discoveryGame: "게임", tabFollowing: "팔로우", tabLatest: "최신", tabRecommended: "추천", tabNew: "추천작", tabRanking: "랭킹", tabCategories: "카테고리",
  match: "매칭", customize: "맞춤 설정", presets: "프리셋", import: "가져오기", newConversation: "새 대화",
  conversationSearch: "대화 검색", conversationSearchPlaceholder: "캐릭터, 게임 또는 메시지 검색", clearConversationSearch: "대화 검색 지우기",
  conversationTypeAll: "전체", conversationTypeRoles: "캐릭터", conversationTypeGames: "게임",
  mobileMenu: "메뉴", closeNavigation: "탐색 메뉴 닫기", allFeatures: "전체 기능", mainFeatures: "주요 기능", moreTools: "추가 도구",
});

export const FOLIO_MESSAGES: Readonly<Record<FolioLocale, FolioMessages>> = Object.freeze({
  en, "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko,
});

export function folioMessages(locale: FolioLocale): FolioMessages {
  return FOLIO_MESSAGES[locale] ?? FOLIO_MESSAGES[FOLIO_DEFAULT_LOCALE];
}

export function folioMessage(locale: FolioLocale, key: FolioMessageKey): string {
  return folioMessages(locale)[key] ?? FOLIO_MESSAGES[FOLIO_DEFAULT_LOCALE][key];
}

/** Short alias for call sites that render shell copy. */
export const folioTranslate = folioMessage;
