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
export const XUMENG_LOCALE_STORAGE_KEY = "xumeng:locale:v1";

export type XumengLocaleOption = {
  readonly locale: XumengLocale;
  /** Native name shown in the language picker. */
  readonly label: string;
  /** BCP 47 language tag used for document.lang and Intl. */
  readonly htmlLang: string;
  /** Short URL segment used in shared language routes and prompt hints. */
  readonly routePrefix: string;
};

export const XUMENG_LOCALE_OPTIONS: readonly XumengLocaleOption[] = Object.freeze([
  { locale: "en", label: "English", htmlLang: "en-US", routePrefix: "en" },
  { locale: "zh-Hans", label: "简体中文", htmlLang: "zh-CN", routePrefix: "zh-cn" },
  { locale: "zh-Hant", label: "繁體中文", htmlLang: "zh-TW", routePrefix: "zh-tw" },
  { locale: "ja", label: "日本語", htmlLang: "ja-JP", routePrefix: "jp" },
  { locale: "ko", label: "한국어", htmlLang: "ko-KR", routePrefix: "ko" },
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

export function xumengLocaleRoutePrefix(locale: XumengLocale): string {
  return xumengLocaleOption(locale).routePrefix;
}

export function xumengLocaleFromPathname(pathname: string): XumengLocale | null {
  const segment = pathname.replace(/^\/+/, "").split("/", 1)[0]?.toLowerCase() ?? "";
  if (segment === "jp") return "ja";
  return normalizeXumengLocale(segment);
}

/** Convert /xumeng or /c/:id into the canonical locale-prefixed route. */
export function xumengLocalePathname(pathname: string, locale: XumengLocale): string {
  let path = pathname || "/xumeng";
  if (!path.startsWith("/")) path = `/${path}`;
  const routeLocale = xumengLocaleFromPathname(path);
  if (routeLocale) path = path.replace(/^\/[^/]+(?=\/|$)/, "") || "/";
  if (path === "/xumeng") path = "/";
  else if (path.startsWith("/xumeng/")) path = path.slice("/xumeng".length);
  if (locale === XUMENG_DEFAULT_LOCALE) return path === "/" ? "/xumeng" : path;
  return `/${xumengLocaleRoutePrefix(locale)}${path === "/" ? "" : path}`;
}

/** Language hint for character replies and localized card variants. */
const LOCALE_INSTRUCTIONS: Readonly<Record<XumengLocale, string>> = Object.freeze({
  en: "Language route: /en. Respond in English unless the user asks for another language.",
  "zh-Hans": "语言路由：/zh-cn。请使用简体中文回复，除非用户指定其他语言。",
  "zh-Hant": "語言路由：/zh-tw。請使用繁體中文回覆，除非使用者指定其他語言。",
  ja: "言語ルート：/jp。ユーザーが別の言語を指定しない限り、日本語で返信してください。",
  ko: "언어 경로: /ko. 사용자가 다른 언어를 지정하지 않는 한 한국어로 답변하세요.",
});

export function xumengLocaleInstruction(locale: XumengLocale): string {
  return LOCALE_INSTRUCTIONS[locale] ?? LOCALE_INSTRUCTIONS[XUMENG_DEFAULT_LOCALE];
}

export type XumengMessageKey =
  | "language"
  | "navPlay" | "navVideos" | "navChat" | "navLive" | "navGeneration" | "navForum" | "navCreate" | "navProfile"
  | "navInvite" | "navEarnCredit" | "navNovels" | "navVoice" | "navTasks" | "navRecharge" | "navVip"
  | "navPresets" | "navSettings" | "navInstallApp" | "navAdmin"
  | "utilityExploreApps" | "utilityDailyCheckIn" | "utilityInviteEarn" | "utilityRechargeVip" | "utilityInstallApp"
  | "searchAll" | "searchAllPlaceholder" | "clearSearch" | "themeLight" | "themeDark" | "themeLightName" | "themeDarkName" | "vipCenter"
  | "discoveryRole" | "discoveryGame" | "tabFollowing" | "tabLatest" | "tabRecommended" | "tabNew" | "tabRanking" | "tabCategories"
  | "match" | "customize" | "presets" | "import" | "newConversation"
  | "conversationSearch" | "conversationSearchPlaceholder" | "clearConversationSearch"
  | "conversationTypeAll" | "conversationTypeRoles" | "conversationTypeGames"
  | "mobileMenu" | "closeNavigation" | "allFeatures" | "mainFeatures" | "moreTools"
  | "guestName"
  | "taskHubNewcomer" | "taskHubMarket" | "taskEyebrow" | "taskHeading" | "taskLead" | "taskRefresh" | "taskRefreshing"
  | "taskCreditLabel" | "taskProgressLabel" | "taskOffer" | "taskEarned" | "taskEarnedNote"
  | "taskCheckinTitle" | "taskCheckinBody" | "taskCheckinAction"
  | "taskGuestTitle" | "taskGuestBody" | "taskGuestAction"
  | "taskStatAll" | "taskStatClaimed" | "taskStatPending"
  | "taskRepeatDaily" | "taskRepeatOnce" | "taskStatusClaimed" | "taskClaim" | "taskClaiming" | "taskLoginClaim"
  | "taskGoCheckin" | "taskGoChat" | "taskGoCreate" | "taskGoDiscover" | "taskGoProfile" | "taskGoForum"
  | "taskResetReady" | "taskResetIn" | "taskOnceReward" | "taskLoading" | "taskUnavailable"
  | "taskHistory" | "taskHistoryEmpty" | "taskExpires" | "taskPermanent" | "taskResetNote"
  | "taskClaimedNotice" | "taskSwitched" | "taskFailed"
  | "taskDailyTitle" | "taskDailyBody" | "taskChatTitle" | "taskChatBody"
  | "taskPublishTitle" | "taskPublishBody" | "taskFollowTitle" | "taskFollowBody"
  | "taskProfileTitle" | "taskProfileBody" | "taskForumTitle" | "taskForumBody";

export type XumengMessages = Readonly<Record<XumengMessageKey, string>>;

const en: XumengMessages = Object.freeze({
  language: "Language",
  navPlay: "Play", navVideos: "Video", navChat: "Messages", navLive: "Calls", navGeneration: "Images / Video", navForum: "Forum", navCreate: "Create", navProfile: "Me",
  navInvite: "Invite friends", navEarnCredit: "Earn Credit", navNovels: "Novel writing", navVoice: "Character voice", navTasks: "Task center", navRecharge: "Credit top-up", navVip: "VIP membership",
  navPresets: "Models & presets", navSettings: "Account settings", navInstallApp: "Install app", navAdmin: "Admin",
  utilityExploreApps: "Explore & apps", utilityDailyCheckIn: "Daily check-in", utilityInviteEarn: "Invite friends, earn Credit", utilityRechargeVip: "Top up & VIP", utilityInstallApp: "Install app",
  searchAll: "Search all", searchAllPlaceholder: "Search all", clearSearch: "Clear search", themeLight: "Switch to light theme", themeDark: "Switch to dark theme", themeLightName: "Light", themeDarkName: "Dark", vipCenter: "VIP center",
  discoveryRole: "Characters", discoveryGame: "Games", tabFollowing: "Following", tabLatest: "Latest", tabRecommended: "For you", tabNew: "Featured", tabRanking: "Ranking", tabCategories: "Categories",
  match: "Match", customize: "Customize", presets: "Presets", import: "Import", newConversation: "New conversation",
  conversationSearch: "Search conversations", conversationSearchPlaceholder: "Search characters, games, or messages", clearConversationSearch: "Clear conversation search",
  conversationTypeAll: "All", conversationTypeRoles: "Characters", conversationTypeGames: "Games",
  mobileMenu: "Menu", closeNavigation: "Close navigation", allFeatures: "All features", mainFeatures: "Main features", moreTools: "More tools",
  guestName: "Guest",
  taskHubNewcomer: "Starter tasks", taskHubMarket: "Player requests", taskEyebrow: "Xumeng · Getting started", taskHeading: "Starter tasks",
  taskLead: "Finish your first steps, collect Credit, and start the story with one line.",
  taskRefresh: "Refresh progress", taskRefreshing: "Refreshing…", taskCreditLabel: "Available Credit", taskProgressLabel: "Starter progress",
  taskOffer: "Finish {count} one-time tasks for +{total} Credit. Daily check-in adds +{daily}.",
  taskEarned: "Task rewards so far: {earned} Credit", taskEarnedNote: "Rewards go straight into available Credit. The signup gift is separate.",
  taskCheckinTitle: "Daily check-in", taskCheckinBody: "Check in each day for Credit. Members can also claim their daily benefit. Both land in your chat balance.", taskCheckinAction: "Check in",
  taskGuestTitle: "Sign in to collect task rewards", taskGuestBody: "Guests can read the tasks. After you register, progress and Credit stay on your account.", taskGuestAction: "Register or sign in",
  taskStatAll: "All tasks", taskStatClaimed: "Collected", taskStatPending: "Credit ready",
  taskRepeatDaily: "Daily", taskRepeatOnce: "Once", taskStatusClaimed: "Collected", taskClaim: "Collect reward", taskClaiming: "Collecting…", taskLoginClaim: "Sign in to collect",
  taskGoCheckin: "Check in", taskGoChat: "Open chat", taskGoCreate: "Create", taskGoDiscover: "Discover", taskGoProfile: "Edit profile", taskGoForum: "Open forum",
  taskResetReady: "Reset. Refresh to continue", taskResetIn: "Resets in {time}", taskOnceReward: "One-time reward",
  taskLoading: "Loading task progress…", taskUnavailable: "Tasks are unavailable. Refresh and try again.",
  taskHistory: "Reward history", taskHistoryEmpty: "Nothing collected yet. Finish a task to start your Credit.",
  taskExpires: "Expires {time}", taskPermanent: "No expiry",
  taskResetNote: "Daily tasks reset at 00:00 Beijing time. The reward shown here follows the server record.",
  taskClaimedNotice: "Collected {points} Credit.", taskSwitched: "The account changed. Refresh the page.", taskFailed: "The task request failed. Try again shortly.",
  taskDailyTitle: "Daily check-in", taskDailyBody: "Come back each day for {points} Credit. Resets at 00:00 Beijing time. Missed days cannot be claimed later.",
  taskChatTitle: "Say the first line", taskChatBody: "Pick a character, send the first line, and keep the conversation.",
  taskPublishTitle: "Publish your first character", taskPublishBody: "Create an original character. Collect the reward after it is approved and listed.",
  taskFollowTitle: "Follow five authors", taskFollowBody: "Follow 5 authors on the character shelf to find more stories.",
  taskProfileTitle: "Write a short intro", taskProfileBody: "Add one line about yourself so your profile feels complete.",
  taskForumTitle: "Leave a mark on the square", taskForumBody: "Reply to a post and say hello to other creators.",
});

const zhHans: XumengMessages = Object.freeze({
  language: "语言",
  navPlay: "游玩", navVideos: "视频", navChat: "陪伴", navLive: "电话", navGeneration: "生成", navForum: "论坛", navCreate: "创作", navProfile: "我的",
  navInvite: "邀请好友", navEarnCredit: "赚 Credit", navNovels: "小说创作", navVoice: "角色语音", navTasks: "任务中心", navRecharge: "Credit 充值", navVip: "VIP 会员",
  navPresets: "模型与预设", navSettings: "账号设置", navInstallApp: "安装应用", navAdmin: "后台管理",
  utilityExploreApps: "探索与应用", utilityDailyCheckIn: "每日签到", utilityInviteEarn: "邀请好友赚 Credit", utilityRechargeVip: "充值与 VIP", utilityInstallApp: "安装应用",
  searchAll: "搜索全站", searchAllPlaceholder: "搜索全站", clearSearch: "清除搜索", themeLight: "切换浅色主题", themeDark: "切换深色主题", themeLightName: "浅色", themeDarkName: "深色", vipCenter: "VIP 会员中心",
  discoveryRole: "角色", discoveryGame: "游戏", tabFollowing: "关注", tabLatest: "最新", tabRecommended: "猜你喜欢", tabNew: "推荐", tabRanking: "榜单", tabCategories: "分类",
  match: "匹配", customize: "定制", presets: "预设", import: "导入", newConversation: "创建新会话",
  conversationSearch: "搜索会话", conversationSearchPlaceholder: "搜索角色、游戏或聊天内容", clearConversationSearch: "清除会话搜索",
  conversationTypeAll: "全部", conversationTypeRoles: "角色", conversationTypeGames: "游戏",
  mobileMenu: "菜单", closeNavigation: "关闭导航菜单", allFeatures: "全部功能", mainFeatures: "主要功能", moreTools: "更多工具",
  guestName: "游客",
  taskHubNewcomer: "新手任务", taskHubMarket: "玩家委托", taskEyebrow: "叙梦 · 新手引导", taskHeading: "新手任务",
  taskLead: "完成第一次探索，领取 Credit，让故事从第一句话开始。",
  taskRefresh: "刷新进度", taskRefreshing: "刷新中…", taskCreditLabel: "可用 Credit", taskProgressLabel: "新手进度",
  taskOffer: "完成 {count} 项一次性任务可得 +{total} Credit，每日签到再领 +{daily}。",
  taskEarned: "任务奖励累计 {earned} Credit", taskEarnedNote: "奖励直接计入可用 Credit，不含注册赠送",
  taskCheckinTitle: "每日签到", taskCheckinBody: "每天签到领取 Credit。会员还可额外领取每日权益，统一计入聊天余额。", taskCheckinAction: "去签到",
  taskGuestTitle: "登录后开启任务奖励", taskGuestBody: "游客可以查看任务；注册账号后，完成的进度和 Credit 会保存在你的账户。", taskGuestAction: "注册或登录",
  taskStatAll: "全部任务", taskStatClaimed: "已领取", taskStatPending: "待领取 Credit",
  taskRepeatDaily: "每日", taskRepeatOnce: "一次性", taskStatusClaimed: "已领取", taskClaim: "领取奖励", taskClaiming: "领取中…", taskLoginClaim: "登录领取",
  taskGoCheckin: "去签到", taskGoChat: "去聊天", taskGoCreate: "去创作", taskGoDiscover: "去发现", taskGoProfile: "去完善", taskGoForum: "去论坛",
  taskResetReady: "已重置，请刷新", taskResetIn: "{time} 后重置", taskOnceReward: "一次性奖励",
  taskLoading: "正在读取任务进度…", taskUnavailable: "任务暂时不可用，点击刷新重试。",
  taskHistory: "领取记录", taskHistoryEmpty: "还没有领取记录。完成一个任务，开始积累你的 Credit。",
  taskExpires: "{time} 到期", taskPermanent: "长期有效",
  taskResetNote: "每日任务在北京时间 00:00 重置。页面显示的奖励以服务器记录为准。",
  taskClaimedNotice: "已领取 {points} Credit。", taskSwitched: "账户已切换，请刷新页面。", taskFailed: "任务请求失败，请稍后再试。",
  taskDailyTitle: "每日签到", taskDailyBody: "每天回来签到领取 {points} Credit，北京时间 00:00 重置，当天未签不能补签。",
  taskChatTitle: "和角色说第一句话", taskChatBody: "选一个喜欢的角色，发送第一句话并保存对话。",
  taskPublishTitle: "发布你的第一个角色", taskPublishBody: "创建一个原创角色，审核通过并上架后领取奖励。",
  taskFollowTitle: "关注五位作者", taskFollowBody: "在角色广场关注 5 位作者，解锁更多故事。",
  taskProfileTitle: "写下个人介绍", taskProfileBody: "写一句自我介绍，让你的个人主页更完整。",
  taskForumTitle: "在广场留下足迹", taskForumBody: "回复一条帖子，和其他创作者打个招呼。",
});

const zhHant: XumengMessages = Object.freeze({
  language: "語言",
  navPlay: "遊玩", navVideos: "影片", navChat: "訊息", navLive: "電話", navGeneration: "生成圖片／影片", navForum: "論壇", navCreate: "創作", navProfile: "我的",
  navInvite: "邀請好友", navEarnCredit: "賺 Credit", navNovels: "小說創作", navVoice: "角色語音", navTasks: "任務中心", navRecharge: "Credit 儲值", navVip: "VIP 會員",
  navPresets: "模型與預設", navSettings: "帳號設定", navInstallApp: "安裝應用程式", navAdmin: "後台管理",
  utilityExploreApps: "探索與應用", utilityDailyCheckIn: "每日簽到", utilityInviteEarn: "邀請好友賺 Credit", utilityRechargeVip: "儲值與 VIP", utilityInstallApp: "安裝應用程式",
  searchAll: "搜尋全站", searchAllPlaceholder: "搜尋全站", clearSearch: "清除搜尋", themeLight: "切換淺色主題", themeDark: "切換深色主題", themeLightName: "淺色", themeDarkName: "深色", vipCenter: "VIP 會員中心",
  discoveryRole: "角色", discoveryGame: "遊戲", tabFollowing: "關注", tabLatest: "最新", tabRecommended: "你可能喜歡", tabNew: "推薦", tabRanking: "排行榜", tabCategories: "分類",
  match: "配對", customize: "自訂", presets: "預設", import: "匯入", newConversation: "建立新對話",
  conversationSearch: "搜尋對話", conversationSearchPlaceholder: "搜尋角色、遊戲或聊天內容", clearConversationSearch: "清除對話搜尋",
  conversationTypeAll: "全部", conversationTypeRoles: "角色", conversationTypeGames: "遊戲",
  mobileMenu: "選單", closeNavigation: "關閉導覽選單", allFeatures: "全部功能", mainFeatures: "主要功能", moreTools: "更多工具",
  guestName: "訪客",
  taskHubNewcomer: "新手任務", taskHubMarket: "玩家委託", taskEyebrow: "敘夢 · 新手引導", taskHeading: "新手任務",
  taskLead: "完成第一次探索，領取 Credit，讓故事從第一句話開始。",
  taskRefresh: "重新整理進度", taskRefreshing: "整理中…", taskCreditLabel: "可用 Credit", taskProgressLabel: "新手進度",
  taskOffer: "完成 {count} 項一次性任務可得 +{total} Credit，每日簽到再領 +{daily}。",
  taskEarned: "任務獎勵累計 {earned} Credit", taskEarnedNote: "獎勵直接計入可用 Credit，不含註冊贈送",
  taskCheckinTitle: "每日簽到", taskCheckinBody: "每天簽到領取 Credit。會員還可額外領取每日權益，統一計入聊天餘額。", taskCheckinAction: "去簽到",
  taskGuestTitle: "登入後開啟任務獎勵", taskGuestBody: "訪客可以查看任務；註冊帳號後，完成的進度和 Credit 會保存在你的帳戶。", taskGuestAction: "註冊或登入",
  taskStatAll: "全部任務", taskStatClaimed: "已領取", taskStatPending: "待領取 Credit",
  taskRepeatDaily: "每日", taskRepeatOnce: "一次性", taskStatusClaimed: "已領取", taskClaim: "領取獎勵", taskClaiming: "領取中…", taskLoginClaim: "登入領取",
  taskGoCheckin: "去簽到", taskGoChat: "去聊天", taskGoCreate: "去創作", taskGoDiscover: "去發現", taskGoProfile: "去完善", taskGoForum: "去論壇",
  taskResetReady: "已重置，請重新整理", taskResetIn: "{time} 後重置", taskOnceReward: "一次性獎勵",
  taskLoading: "正在讀取任務進度…", taskUnavailable: "任務暫時無法使用，請重新整理後再試。",
  taskHistory: "領取紀錄", taskHistoryEmpty: "還沒有領取紀錄。完成一個任務，開始累積你的 Credit。",
  taskExpires: "{time} 到期", taskPermanent: "長期有效",
  taskResetNote: "每日任務在北京時間 00:00 重置。頁面顯示的獎勵以伺服器紀錄為準。",
  taskClaimedNotice: "已領取 {points} Credit。", taskSwitched: "帳戶已切換，請重新整理頁面。", taskFailed: "任務請求失敗，請稍後再試。",
  taskDailyTitle: "每日簽到", taskDailyBody: "每天回來簽到領取 {points} Credit，北京時間 00:00 重置，當天未簽不能補簽。",
  taskChatTitle: "和角色說第一句話", taskChatBody: "選一個喜歡的角色，傳送第一句話並保存對話。",
  taskPublishTitle: "發布你的第一個角色", taskPublishBody: "建立一個原創角色，審核通過並上架後領取獎勵。",
  taskFollowTitle: "關注五位作者", taskFollowBody: "在角色廣場關注 5 位作者，解鎖更多故事。",
  taskProfileTitle: "寫下個人介紹", taskProfileBody: "寫一句自我介紹，讓你的個人主頁更完整。",
  taskForumTitle: "在廣場留下足跡", taskForumBody: "回覆一則貼文，和其他創作者打個招呼。",
});

const ja: XumengMessages = Object.freeze({
  language: "言語",
  navPlay: "遊ぶ", navVideos: "動画", navChat: "メッセージ", navLive: "通話", navGeneration: "画像／動画", navForum: "フォーラム", navCreate: "創作", navProfile: "マイページ",
  navInvite: "友達を招待", navEarnCredit: "Creditを獲得", navNovels: "小説創作", navVoice: "キャラクターボイス", navTasks: "タスクセンター", navRecharge: "Creditチャージ", navVip: "VIP会員",
  navPresets: "モデルとプリセット", navSettings: "アカウント設定", navInstallApp: "アプリをインストール", navAdmin: "管理画面",
  utilityExploreApps: "探索とアプリ", utilityDailyCheckIn: "毎日チェックイン", utilityInviteEarn: "友達を招待してCreditを獲得", utilityRechargeVip: "チャージとVIP", utilityInstallApp: "アプリをインストール",
  searchAll: "全体を検索", searchAllPlaceholder: "全体を検索", clearSearch: "検索をクリア", themeLight: "ライトテーマに切り替え", themeDark: "ダークテーマに切り替え", themeLightName: "ライト", themeDarkName: "ダーク", vipCenter: "VIP会員センター",
  discoveryRole: "キャラクター", discoveryGame: "ゲーム", tabFollowing: "フォロー中", tabLatest: "最新", tabRecommended: "おすすめ", tabNew: "注目", tabRanking: "ランキング", tabCategories: "カテゴリー",
  match: "マッチ", customize: "カスタマイズ", presets: "プリセット", import: "インポート", newConversation: "新しい会話",
  conversationSearch: "会話を検索", conversationSearchPlaceholder: "キャラクター、ゲーム、メッセージを検索", clearConversationSearch: "会話検索をクリア",
  conversationTypeAll: "すべて", conversationTypeRoles: "キャラクター", conversationTypeGames: "ゲーム",
  mobileMenu: "メニュー", closeNavigation: "ナビゲーションを閉じる", allFeatures: "すべての機能", mainFeatures: "主な機能", moreTools: "その他のツール",
  guestName: "ゲスト",
  taskHubNewcomer: "初心者タスク", taskHubMarket: "プレイヤー依頼", taskEyebrow: "叙梦 · はじめに", taskHeading: "初心者タスク",
  taskLead: "最初の探索を終えて Credit を受け取り、物語を最初の一文から始めましょう。",
  taskRefresh: "進捗を更新", taskRefreshing: "更新中…", taskCreditLabel: "使える Credit", taskProgressLabel: "進行状況",
  taskOffer: "1回限りのタスク {count} 件で +{total} Credit。毎日のチェックインでさらに +{daily}。",
  taskEarned: "タスク報酬の累計 {earned} Credit", taskEarnedNote: "報酬は使える Credit に直接入ります。登録ボーナスは含みません。",
  taskCheckinTitle: "毎日チェックイン", taskCheckinBody: "毎日チェックインして Credit を受け取ります。会員は毎日の特典も受け取れ、チャット残高にまとめて入ります。", taskCheckinAction: "チェックインへ",
  taskGuestTitle: "ログインすると報酬を受け取れます", taskGuestBody: "ゲストでもタスクは見られます。登録すると進捗と Credit がアカウントに保存されます。", taskGuestAction: "登録またはログイン",
  taskStatAll: "すべてのタスク", taskStatClaimed: "受取済み", taskStatPending: "受け取れる Credit",
  taskRepeatDaily: "毎日", taskRepeatOnce: "1回限り", taskStatusClaimed: "受取済み", taskClaim: "報酬を受け取る", taskClaiming: "受け取り中…", taskLoginClaim: "ログインして受け取る",
  taskGoCheckin: "チェックインへ", taskGoChat: "チャットへ", taskGoCreate: "創作へ", taskGoDiscover: "見つける", taskGoProfile: "プロフィールへ", taskGoForum: "広場へ",
  taskResetReady: "リセット済み。更新してください", taskResetIn: "{time} 後にリセット", taskOnceReward: "1回限りの報酬",
  taskLoading: "タスクの進捗を読み込んでいます…", taskUnavailable: "タスクを表示できません。更新してもう一度お試しください。",
  taskHistory: "受取履歴", taskHistoryEmpty: "まだ受取履歴はありません。タスクを終えて Credit を貯めましょう。",
  taskExpires: "{time} まで", taskPermanent: "期限なし",
  taskResetNote: "毎日のタスクは北京時間 0:00 にリセットされます。表示される報酬はサーバーの記録が正です。",
  taskClaimedNotice: "{points} Credit を受け取りました。", taskSwitched: "アカウントが切り替わりました。ページを更新してください。", taskFailed: "タスクのリクエストに失敗しました。しばらくしてからもう一度お試しください。",
  taskDailyTitle: "毎日チェックイン", taskDailyBody: "毎日戻ってチェックインし、{points} Credit を受け取ります。北京時間 0:00 にリセットされ、その日を過ぎると補填できません。",
  taskChatTitle: "キャラクターに最初の一言", taskChatBody: "好きなキャラクターを選び、最初の一言を送って会話を保存します。",
  taskPublishTitle: "最初のキャラクターを公開", taskPublishBody: "オリジナルキャラクターを作り、審査を通過して公開されると報酬を受け取れます。",
  taskFollowTitle: "作者を5人フォロー", taskFollowBody: "キャラクター広場で作者を5人フォローし、もっと物語を見つけます。",
  taskProfileTitle: "自己紹介を書く", taskProfileBody: "ひとこと自己紹介を書いて、マイページを整えます。",
  taskForumTitle: "広場に足跡を残す", taskForumBody: "投稿に返信して、ほかの創作者にあいさつします。",
});

const ko: XumengMessages = Object.freeze({
  language: "언어",
  navPlay: "플레이", navVideos: "영상", navChat: "메시지", navLive: "통화", navGeneration: "이미지／동영상", navForum: "포럼", navCreate: "창작", navProfile: "내 정보",
  navInvite: "친구 초대", navEarnCredit: "Credit 받기", navNovels: "소설 창작", navVoice: "캐릭터 음성", navTasks: "작업 센터", navRecharge: "Credit 충전", navVip: "VIP 멤버십",
  navPresets: "모델 및 프리셋", navSettings: "계정 설정", navInstallApp: "앱 설치", navAdmin: "관리자",
  utilityExploreApps: "탐색 및 앱", utilityDailyCheckIn: "매일 출석", utilityInviteEarn: "친구 초대하고 Credit 받기", utilityRechargeVip: "충전 및 VIP", utilityInstallApp: "앱 설치",
  searchAll: "전체 검색", searchAllPlaceholder: "전체 검색", clearSearch: "검색 지우기", themeLight: "라이트 테마로 전환", themeDark: "다크 테마로 전환", themeLightName: "라이트", themeDarkName: "다크", vipCenter: "VIP 멤버십 센터",
  discoveryRole: "캐릭터", discoveryGame: "게임", tabFollowing: "팔로우", tabLatest: "최신", tabRecommended: "추천", tabNew: "추천작", tabRanking: "랭킹", tabCategories: "카테고리",
  match: "매칭", customize: "맞춤 설정", presets: "프리셋", import: "가져오기", newConversation: "새 대화",
  conversationSearch: "대화 검색", conversationSearchPlaceholder: "캐릭터, 게임 또는 메시지 검색", clearConversationSearch: "대화 검색 지우기",
  conversationTypeAll: "전체", conversationTypeRoles: "캐릭터", conversationTypeGames: "게임",
  mobileMenu: "메뉴", closeNavigation: "탐색 메뉴 닫기", allFeatures: "전체 기능", mainFeatures: "주요 기능", moreTools: "추가 도구",
  guestName: "게스트",
  taskHubNewcomer: "시작 과제", taskHubMarket: "플레이어 의뢰", taskEyebrow: "叙梦 · 시작 안내", taskHeading: "시작 과제",
  taskLead: "첫 탐색을 마치고 Credit을 받아, 이야기의 첫 문장부터 시작하세요.",
  taskRefresh: "진행 새로고침", taskRefreshing: "새로고침 중…", taskCreditLabel: "사용 가능 Credit", taskProgressLabel: "시작 진행",
  taskOffer: "1회 과제 {count}개를 마치면 +{total} Credit. 매일 출석하면 +{daily}.",
  taskEarned: "과제 보상 누적 {earned} Credit", taskEarnedNote: "보상은 사용 가능 Credit에 바로 들어갑니다. 가입 선물은 포함하지 않습니다.",
  taskCheckinTitle: "매일 출석", taskCheckinBody: "매일 출석하고 Credit을 받으세요. 회원은 매일 혜택도 받을 수 있으며, 채팅 잔액에 함께 들어갑니다.", taskCheckinAction: "출석하기",
  taskGuestTitle: "로그인하면 과제 보상을 받을 수 있습니다", taskGuestBody: "게스트도 과제는 볼 수 있습니다. 가입하면 진행과 Credit이 계정에 저장됩니다.", taskGuestAction: "가입 또는 로그인",
  taskStatAll: "전체 과제", taskStatClaimed: "받음", taskStatPending: "받을 Credit",
  taskRepeatDaily: "매일", taskRepeatOnce: "1회", taskStatusClaimed: "받음", taskClaim: "보상 받기", taskClaiming: "받는 중…", taskLoginClaim: "로그인하고 받기",
  taskGoCheckin: "출석하기", taskGoChat: "채팅하기", taskGoCreate: "창작하기", taskGoDiscover: "찾아보기", taskGoProfile: "프로필 작성", taskGoForum: "광장으로",
  taskResetReady: "초기화되었습니다. 새로고침하세요", taskResetIn: "{time} 후 초기화", taskOnceReward: "1회 보상",
  taskLoading: "과제 진행을 불러오는 중…", taskUnavailable: "과제를 표시할 수 없습니다. 새로고침 후 다시 시도하세요.",
  taskHistory: "수령 기록", taskHistoryEmpty: "아직 수령 기록이 없습니다. 과제를 마치고 Credit을 모아 보세요.",
  taskExpires: "{time} 만료", taskPermanent: "기한 없음",
  taskResetNote: "매일 과제는 베이징 시간 0:00에 초기화됩니다. 표시된 보상은 서버 기록이 기준입니다.",
  taskClaimedNotice: "{points} Credit을 받았습니다.", taskSwitched: "계정이 바뀌었습니다. 페이지를 새로고침하세요.", taskFailed: "과제 요청에 실패했습니다. 잠시 후 다시 시도하세요.",
  taskDailyTitle: "매일 출석", taskDailyBody: "매일 돌아와 출석하고 {points} Credit을 받으세요. 베이징 시간 0:00에 초기화되며, 지난 날은 보충할 수 없습니다.",
  taskChatTitle: "캐릭터에게 첫 마디", taskChatBody: "마음에 드는 캐릭터를 고르고, 첫 마디를 보낸 뒤 대화를 저장하세요.",
  taskPublishTitle: "첫 캐릭터 공개", taskPublishBody: "오리지널 캐릭터를 만드세요. 심사를 통과해 공개되면 보상을 받습니다.",
  taskFollowTitle: "작가 5명 팔로우", taskFollowBody: "캐릭터 광장에서 작가 5명을 팔로우하고 더 많은 이야기를 찾으세요.",
  taskProfileTitle: "자기소개 쓰기", taskProfileBody: "한 줄 자기소개를 써서 프로필을 완성하세요.",
  taskForumTitle: "광장에 발자국 남기기", taskForumBody: "글에 답글을 남기고 다른 창작자에게 인사하세요.",
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

export function xumengFill(locale: XumengLocale, key: XumengMessageKey, values: Record<string, string | number>): string {
  return xumengMessage(locale, key).replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ""));
}
