/**
 * Shared locale and shell copy for the XUMENG client.
 *
 * The content of a character card is user supplied and should stay in the
 * language chosen by its author.  This module only covers product chrome and
 * keeps locale detection independent of React so it can also be used by
 * metadata, tests, and other clients.
 */

export const XUMENG_LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const;
export type XumengLocale = (typeof XUMENG_LOCALES)[number];

export const XUMENG_DEFAULT_LOCALE: XumengLocale = "zh-Hans";
export const XUMENG_LOCALE_STORAGE_KEY = "qingyu:locale:v1";

export type XumengLocaleOption = {
  readonly locale: XumengLocale;
  /** Native name shown in the language picker. */
  readonly label: string;
  /** BCP 47 language tag used for document.lang and Intl. */
  readonly htmlLang: string;
};

export const XUMENG_LOCALE_OPTIONS: readonly XumengLocaleOption[] = Object.freeze([
  { locale: "en", label: "English", htmlLang: "en-US" },
  { locale: "zh-Hans", label: "简体中文", htmlLang: "zh-CN" },
  { locale: "zh-Hant", label: "繁體中文", htmlLang: "zh-TW" },
  { locale: "ja", label: "日本語", htmlLang: "ja-JP" },
  { locale: "ko", label: "한국어", htmlLang: "ko-KR" },
]);

const localeSet = new Set<XumengLocale>(XUMENG_LOCALES);

/** Return a supported locale, or null when a value is not a locale code. */
export function isXumengLocale(value: unknown): value is XumengLocale {
  // This guard is used when parsing persisted/API values, which must use the
  // canonical five codes. Browser tags should go through normalizeXumengLocale.
  return typeof value === "string" && localeSet.has(value as XumengLocale);
}

export function normalizeXumengLocale(value: unknown): XumengLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
  if (normalized === "zh-hans" || normalized === "zh-cn" || normalized === "zh-sg" || normalized === "zh-my") return "zh-Hans";
  if (normalized === "zh-hant" || normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo") return "zh-Hant";
  // Keep already-normalized values explicit if new aliases are added later.
  if (localeSet.has(value as XumengLocale)) return value as XumengLocale;
  return null;
}

/**
 * Resolve an explicit preference first, then the browser's language list.
 * Unsupported browser languages intentionally fall back to Simplified Chinese
 * to preserve the existing XUMENG experience.
 */
export function resolveXumengLocale(
  preferred: unknown,
  languages: readonly string[] = [],
): XumengLocale {
  const explicit = normalizeXumengLocale(preferred);
  if (explicit) return explicit;
  for (const language of languages) {
    const detected = normalizeXumengLocale(language);
    if (detected) return detected;
  }
  return XUMENG_DEFAULT_LOCALE;
}

export function xumengLocaleOption(locale: XumengLocale): XumengLocaleOption {
  return XUMENG_LOCALE_OPTIONS.find(option => option.locale === locale) ?? XUMENG_LOCALE_OPTIONS[1];
}

export function xumengLocaleLabel(locale: XumengLocale): string {
  return xumengLocaleOption(locale).label;
}

export function xumengHtmlLang(locale: XumengLocale): string {
  return xumengLocaleOption(locale).htmlLang;
}

/** Language hint for character replies. Card content itself is never translated. */
const LOCALE_INSTRUCTIONS: Readonly<Record<XumengLocale, string>> = Object.freeze({
  en: "Respond in English unless the user asks for another language.",
  "zh-Hans": "请使用简体中文回复，除非用户指定其他语言。",
  "zh-Hant": "請使用繁體中文回覆，除非使用者指定其他語言。",
  ja: "ユーザーが別の言語を指定しない限り、日本語で返信してください。",
  ko: "사용자가 다른 언어를 지정하지 않는 한 한국어로 답변하세요.",
});

export function xumengLocaleInstruction(locale: XumengLocale): string {
  return LOCALE_INSTRUCTIONS[locale] ?? LOCALE_INSTRUCTIONS[XUMENG_DEFAULT_LOCALE];
}

export type XumengMessageKey =
  | "language"
  | "navPlay" | "navChat" | "navLive" | "navGeneration" | "navForum" | "navCreate" | "navProfile"
  | "navInvite" | "navEarnCredit" | "navNovels" | "navVoice" | "navTasks" | "navRecharge" | "navVip"
  | "navPresets" | "navSettings" | "navInstallApp" | "navAdmin"
  | "utilityExploreApps" | "utilityDailyCheckIn" | "utilityInviteEarn" | "utilityRechargeVip" | "utilityInstallApp"
  | "searchAll" | "searchAllPlaceholder" | "clearSearch" | "themeLight" | "themeDark" | "vipCenter"
  | "discoveryRole" | "discoveryGame" | "tabFollowing" | "tabLatest" | "tabRecommended" | "tabNew" | "tabRanking" | "tabCategories"
  | "match" | "customize" | "presets" | "import" | "newConversation"
  | "conversationSearch" | "conversationSearchPlaceholder" | "clearConversationSearch"
  | "conversationTypeAll" | "conversationTypeRoles" | "conversationTypeGames"
  | "mobileMenu" | "closeNavigation" | "allFeatures" | "mainFeatures" | "moreTools";

export type XumengMessages = Readonly<Record<XumengMessageKey, string>>;

const en: XumengMessages = Object.freeze({
  language: "Language",
  navPlay: "Play", navChat: "Messages", navLive: "Calls", navGeneration: "Images / Video", navForum: "Forum", navCreate: "Create", navProfile: "Me",
  navInvite: "Invite friends", navEarnCredit: "Earn Credit", navNovels: "Novel writing", navVoice: "Character voice", navTasks: "Task center", navRecharge: "Credit top-up", navVip: "VIP membership",
  navPresets: "Models & presets", navSettings: "Account settings", navInstallApp: "Install app", navAdmin: "Admin",
  utilityExploreApps: "Explore & apps", utilityDailyCheckIn: "Daily check-in", utilityInviteEarn: "Invite friends, earn Credit", utilityRechargeVip: "Top up & VIP", utilityInstallApp: "Install app",
  searchAll: "Search all", searchAllPlaceholder: "Search all", clearSearch: "Clear search", themeLight: "Switch to light theme", themeDark: "Switch to dark theme", vipCenter: "VIP center",
  discoveryRole: "Characters", discoveryGame: "Games", tabFollowing: "Following", tabLatest: "Latest", tabRecommended: "For you", tabNew: "New", tabRanking: "Ranking", tabCategories: "Categories",
  match: "Match", customize: "Customize", presets: "Presets", import: "Import", newConversation: "New conversation",
  conversationSearch: "Search conversations", conversationSearchPlaceholder: "Search characters, games, or messages", clearConversationSearch: "Clear conversation search",
  conversationTypeAll: "All", conversationTypeRoles: "Characters", conversationTypeGames: "Games",
  mobileMenu: "Menu", closeNavigation: "Close navigation", allFeatures: "All features", mainFeatures: "Main features", moreTools: "More tools",
});

const zhHans: XumengMessages = Object.freeze({
  language: "语言",
  navPlay: "探险", navChat: "聊天", navLive: "电话", navGeneration: "生图/视频", navForum: "小岛社区", navCreate: "灵感工坊", navProfile: "我的",
  navInvite: "邀请好友", navEarnCredit: "赚 Credit", navNovels: "小说创作", navVoice: "角色语音", navTasks: "任务中心", navRecharge: "Credit 充值", navVip: "VIP 会员",
  navPresets: "模型与预设", navSettings: "账号设置", navInstallApp: "安装应用", navAdmin: "后台管理",
  utilityExploreApps: "探索与应用", utilityDailyCheckIn: "每日签到", utilityInviteEarn: "邀请好友赚 Credit", utilityRechargeVip: "充值与 VIP", utilityInstallApp: "安装应用",
  searchAll: "搜索全站", searchAllPlaceholder: "搜索全站", clearSearch: "清除搜索", themeLight: "切换浅色主题", themeDark: "切换深色主题", vipCenter: "VIP 会员中心",
  discoveryRole: "角色", discoveryGame: "游戏", tabFollowing: "关注", tabLatest: "最新", tabRecommended: "猜你喜欢", tabNew: "新手", tabRanking: "榜单", tabCategories: "分类",
  match: "匹配", customize: "定制", presets: "预设", import: "导入", newConversation: "创建新会话",
  conversationSearch: "搜索会话", conversationSearchPlaceholder: "搜索角色、游戏或聊天内容", clearConversationSearch: "清除会话搜索",
  conversationTypeAll: "全部", conversationTypeRoles: "角色", conversationTypeGames: "游戏",
  mobileMenu: "菜单", closeNavigation: "关闭导航菜单", allFeatures: "全部功能", mainFeatures: "主要功能", moreTools: "更多工具",
});

const zhHant: XumengMessages = Object.freeze({
  language: "語言",
  navPlay: "遊玩", navChat: "訊息", navLive: "電話", navGeneration: "生成圖片／影片", navForum: "論壇", navCreate: "創作", navProfile: "我的",
  navInvite: "邀請好友", navEarnCredit: "賺 Credit", navNovels: "小說創作", navVoice: "角色語音", navTasks: "任務中心", navRecharge: "Credit 儲值", navVip: "VIP 會員",
  navPresets: "模型與預設", navSettings: "帳號設定", navInstallApp: "安裝應用程式", navAdmin: "後台管理",
  utilityExploreApps: "探索與應用", utilityDailyCheckIn: "每日簽到", utilityInviteEarn: "邀請好友賺 Credit", utilityRechargeVip: "儲值與 VIP", utilityInstallApp: "安裝應用程式",
  searchAll: "搜尋全站", searchAllPlaceholder: "搜尋全站", clearSearch: "清除搜尋", themeLight: "切換淺色主題", themeDark: "切換深色主題", vipCenter: "VIP 會員中心",
  discoveryRole: "角色", discoveryGame: "遊戲", tabFollowing: "關注", tabLatest: "最新", tabRecommended: "你可能喜歡", tabNew: "新手", tabRanking: "排行榜", tabCategories: "分類",
  match: "配對", customize: "自訂", presets: "預設", import: "匯入", newConversation: "建立新對話",
  conversationSearch: "搜尋對話", conversationSearchPlaceholder: "搜尋角色、遊戲或聊天內容", clearConversationSearch: "清除對話搜尋",
  conversationTypeAll: "全部", conversationTypeRoles: "角色", conversationTypeGames: "遊戲",
  mobileMenu: "選單", closeNavigation: "關閉導覽選單", allFeatures: "全部功能", mainFeatures: "主要功能", moreTools: "更多工具",
});

const ja: XumengMessages = Object.freeze({
  language: "言語",
  navPlay: "遊ぶ", navChat: "メッセージ", navLive: "通話", navGeneration: "画像／動画", navForum: "フォーラム", navCreate: "創作", navProfile: "マイページ",
  navInvite: "友達を招待", navEarnCredit: "Creditを獲得", navNovels: "小説創作", navVoice: "キャラクターボイス", navTasks: "タスクセンター", navRecharge: "Creditチャージ", navVip: "VIP会員",
  navPresets: "モデルとプリセット", navSettings: "アカウント設定", navInstallApp: "アプリをインストール", navAdmin: "管理画面",
  utilityExploreApps: "探索とアプリ", utilityDailyCheckIn: "毎日チェックイン", utilityInviteEarn: "友達を招待してCreditを獲得", utilityRechargeVip: "チャージとVIP", utilityInstallApp: "アプリをインストール",
  searchAll: "全体を検索", searchAllPlaceholder: "全体を検索", clearSearch: "検索をクリア", themeLight: "ライトテーマに切り替え", themeDark: "ダークテーマに切り替え", vipCenter: "VIP会員センター",
  discoveryRole: "キャラクター", discoveryGame: "ゲーム", tabFollowing: "フォロー中", tabLatest: "最新", tabRecommended: "おすすめ", tabNew: "初心者", tabRanking: "ランキング", tabCategories: "カテゴリー",
  match: "マッチ", customize: "カスタマイズ", presets: "プリセット", import: "インポート", newConversation: "新しい会話",
  conversationSearch: "会話を検索", conversationSearchPlaceholder: "キャラクター、ゲーム、メッセージを検索", clearConversationSearch: "会話検索をクリア",
  conversationTypeAll: "すべて", conversationTypeRoles: "キャラクター", conversationTypeGames: "ゲーム",
  mobileMenu: "メニュー", closeNavigation: "ナビゲーションを閉じる", allFeatures: "すべての機能", mainFeatures: "主な機能", moreTools: "その他のツール",
});

const ko: XumengMessages = Object.freeze({
  language: "언어",
  navPlay: "플레이", navChat: "메시지", navLive: "통화", navGeneration: "이미지／동영상", navForum: "포럼", navCreate: "창작", navProfile: "내 정보",
  navInvite: "친구 초대", navEarnCredit: "Credit 받기", navNovels: "소설 창작", navVoice: "캐릭터 음성", navTasks: "작업 센터", navRecharge: "Credit 충전", navVip: "VIP 멤버십",
  navPresets: "모델 및 프리셋", navSettings: "계정 설정", navInstallApp: "앱 설치", navAdmin: "관리자",
  utilityExploreApps: "탐색 및 앱", utilityDailyCheckIn: "매일 출석", utilityInviteEarn: "친구 초대하고 Credit 받기", utilityRechargeVip: "충전 및 VIP", utilityInstallApp: "앱 설치",
  searchAll: "전체 검색", searchAllPlaceholder: "전체 검색", clearSearch: "검색 지우기", themeLight: "라이트 테마로 전환", themeDark: "다크 테마로 전환", vipCenter: "VIP 멤버십 센터",
  discoveryRole: "캐릭터", discoveryGame: "게임", tabFollowing: "팔로우", tabLatest: "최신", tabRecommended: "추천", tabNew: "초보자", tabRanking: "랭킹", tabCategories: "카테고리",
  match: "매칭", customize: "맞춤 설정", presets: "프리셋", import: "가져오기", newConversation: "새 대화",
  conversationSearch: "대화 검색", conversationSearchPlaceholder: "캐릭터, 게임 또는 메시지 검색", clearConversationSearch: "대화 검색 지우기",
  conversationTypeAll: "전체", conversationTypeRoles: "캐릭터", conversationTypeGames: "게임",
  mobileMenu: "메뉴", closeNavigation: "탐색 메뉴 닫기", allFeatures: "전체 기능", mainFeatures: "주요 기능", moreTools: "추가 도구",
});

export const XUMENG_MESSAGES: Readonly<Record<XumengLocale, XumengMessages>> = Object.freeze({
  en, "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko,
});

export function xumengMessages(locale: XumengLocale): XumengMessages {
  return XUMENG_MESSAGES[locale] ?? XUMENG_MESSAGES[XUMENG_DEFAULT_LOCALE];
}

export function xumengMessage(locale: XumengLocale, key: XumengMessageKey): string {
  return xumengMessages(locale)[key] ?? XUMENG_MESSAGES[XUMENG_DEFAULT_LOCALE][key];
}

/** Short alias for call sites that render shell copy. */
export const xumengTranslate = xumengMessage;
