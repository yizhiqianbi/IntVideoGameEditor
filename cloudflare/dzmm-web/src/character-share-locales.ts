import type { XumengLocale } from "../../../src/lib/xumeng-i18n";

export type CharacterLocaleCopy = {
  readonly htmlLang: string;
  readonly hreflang: string;
  readonly ogLocale: string;
  readonly routePrefix: string;
  readonly siteName: string;
  readonly titleSuffix: string;
  readonly breadcrumbHome: string;
  readonly breadcrumbCharacters: string;
  readonly charactersPath: string;
  readonly homePath: string;
  readonly tagsHeading: string;
  readonly openingHeading: string;
  readonly summaryNote: string;
  readonly startChatCta: string;
  readonly moreCharactersCta: string;
  readonly relatedHeading: string;
  readonly faqHeading: string;
  readonly genre: string;
  readonly directoryTitle: string;
  readonly directoryDescription: string;
  readonly directoryHeading: string;
  readonly directoryLead: string;
  readonly canonicalLabel: string;
  readonly buildFaq: (characterName: string) => readonly { question: string; answer: string }[];
};

export const CHARACTER_LOCALE_COPY: Readonly<Record<XumengLocale, CharacterLocaleCopy>> = Object.freeze({
  "zh-Hans": {
    htmlLang: "zh-CN",
    hreflang: "zh-CN",
    ogLocale: "zh_CN",
    routePrefix: "",
    siteName: "叙梦",
    titleSuffix: " - AI角色聊天",
    breadcrumbHome: "叙梦",
    breadcrumbCharacters: "公开角色",
    charactersPath: "/characters",
    homePath: "/",
    tagsHeading: "角色标签与题材",
    openingHeading: "开场情境预览",
    summaryNote: "这是叙梦（XUMENG）的公开角色卡摘要。私人会话、账号信息、余额与未公开内容不会出现在本页。",
    startChatCta: "在叙梦开始角色互动",
    moreCharactersCta: "更多公开角色",
    relatedHeading: "相似与精选公开角色",
    faqHeading: "角色互动常见问题",
    genre: "互动角色卡",
    directoryTitle: "叙梦精选公开角色｜角色卡与互动故事",
    directoryDescription: "适合直接浏览与引用的叙梦公开角色卡，涵盖古风、都市、校园、悬疑、治愈与奇幻题材，支持角色扮演与长记忆互动。",
    directoryHeading: "叙梦精选公开角色",
    directoryLead: "精选公开角色卡可直接查看摘要、标签与开场情境，点击进入站内即可开始 AI 角色扮演与长记忆互动。",
    canonicalLabel: "规范网址",
    buildFaq: (name: string) => [
      {
        question: `如何免费开始和「${name}」进行 AI 角色聊天？`,
        answer: `点击本页的“在叙梦开始角色互动”，无需下载客户端，打开网页即可基于「${name}」的角色卡、世界书与开场白直接续写剧情。`,
      },
      {
        question: `和「${name}」对话支持长记忆、角色语音或剧情生图吗？`,
        answer: `支持。在叙梦站内互动时可自由切换多模型、启用长期记忆摘要，并按需生成角色中文语音与剧情场景画面。`,
      },
      {
        question: `我与「${name}」的聊天记录会被公开吗？`,
        answer: `不会。公开角色页仅展示角色名称、公开摘要、标签与封面；你的私人会话、账号信息、余额与未公开内容始终保持私密。`,
      },
    ],
  },
  "zh-Hant": {
    htmlLang: "zh-TW",
    hreflang: "zh-TW",
    ogLocale: "zh_TW",
    routePrefix: "/zh-tw",
    siteName: "敘夢",
    titleSuffix: " - AI角色聊天",
    breadcrumbHome: "敘夢",
    breadcrumbCharacters: "公開角色",
    charactersPath: "/zh-tw/characters",
    homePath: "/zh-tw",
    tagsHeading: "角色標籤與題材",
    openingHeading: "開場情境預覽",
    summaryNote: "這是敘夢（XUMENG）的公開角色卡摘要。私人對話、帳號資訊、餘額與未公開內容不會出現在本頁。",
    startChatCta: "在敘夢開始角色互動",
    moreCharactersCta: "更多公開角色",
    relatedHeading: "相似與精選公開角色",
    faqHeading: "角色互動常見問題",
    genre: "互動角色卡",
    directoryTitle: "敘夢精選公開角色｜角色卡與互動故事",
    directoryDescription: "精選敘夢公開角色卡，涵蓋古風、都市、校園、懸疑、治癒與奇幻題材，支援角色扮演、世界書與長記憶 AI 陪伴。",
    directoryHeading: "敘夢精選公開角色",
    directoryLead: "瀏覽精選公開角色卡的摘要、標籤與開場情境，點擊即可在網頁版免下載直接開始互動。",
    canonicalLabel: "規範網址",
    buildFaq: (name: string) => [
      {
        question: `如何開始和「${name}」進行 AI 角色聊天？`,
        answer: `點擊本頁的「在敘夢開始角色互動」，免下載 App，在瀏覽器中即可依照「${name}」的角色卡與世界書直接續寫故事。`,
      },
      {
        question: `和「${name}」對話支援長記憶、語音與劇情生圖嗎？`,
        answer: `支援。站內互動可自由切換多種對話模型，支援長對話記憶、角色語音播放與情境畫面生成。`,
      },
      {
        question: `我和「${name}」的聊天內容會公開嗎？`,
        answer: `不會。公開頁僅展示角色基本設定與摘要，私人對話紀錄、帳號與餘額均不對外公開。`,
      },
    ],
  },
  en: {
    htmlLang: "en-US",
    hreflang: "en",
    ogLocale: "en_US",
    routePrefix: "/en",
    siteName: "XUMENG",
    titleSuffix: " - AI Character Chat",
    breadcrumbHome: "XUMENG",
    breadcrumbCharacters: "Public Characters",
    charactersPath: "/en/characters",
    homePath: "/en",
    tagsHeading: "Character Tags & Genres",
    openingHeading: "Opening Scene Preview",
    summaryNote: "This is a public character card summary on XUMENG. Private conversations, account details, balances, and unpublished content never appear here.",
    startChatCta: "Start Interactive Chat on XUMENG",
    moreCharactersCta: "Explore More Characters",
    relatedHeading: "Related & Featured Characters",
    faqHeading: "Character Chat FAQ",
    genre: "Interactive Character Card",
    directoryTitle: "Featured Public AI Characters | XUMENG Character Cards",
    directoryDescription: "Explore featured public AI roleplay character cards on XUMENG across mystery, romance, urban, fantasy, and cozy slice-of-life stories. Instant web play with worldbooks and long memory.",
    directoryHeading: "Featured Public AI Characters on XUMENG",
    directoryLead: "Preview character profiles, genres, and opening scenes below, then jump straight into long-memory AI roleplay on the web—no app download required.",
    canonicalLabel: "Canonical URL",
    buildFaq: (name: string) => [
      {
        question: `How can I chat with ${name} on XUMENG?`,
        answer: `Click "Start Interactive Chat on XUMENG" to launch the character directly in your browser using ${name}'s full character card, worldbook, and opening scene.`,
      },
      {
        question: `Does chatting with ${name} support long-term memory, voice, and scene visuals?`,
        answer: `Yes. XUMENG supports multi-model switching, long-conversation memory, character voice playback, and on-demand scene image generation inside the chat.`,
      },
      {
        question: `Are my private chats with ${name} visible on this public page?`,
        answer: `No. Public character pages only display the character summary, tags, and cover artwork. Private chats, account data, and Credit balances remain strictly private.`,
      },
    ],
  },
  ja: {
    htmlLang: "ja-JP",
    hreflang: "ja",
    ogLocale: "ja_JP",
    routePrefix: "/jp",
    siteName: "XUMENG",
    titleSuffix: " - AIキャラクターチャット",
    breadcrumbHome: "XUMENG",
    breadcrumbCharacters: "公開キャラクター",
    charactersPath: "/jp/characters",
    homePath: "/jp",
    tagsHeading: "タグ・ジャンル",
    openingHeading: "導入シーンのプレビュー",
    summaryNote: "これは XUMENG（叙梦）の公開キャラクターカード概要です。個人チャット履歴、アカウント情報、残高、非公開コンテンツは掲載されません。",
    startChatCta: "XUMENG でキャラクター会話を始める",
    moreCharactersCta: "ほかの公開キャラクターを見る",
    relatedHeading: "関連・注目の公開キャラクター",
    faqHeading: "よくある質問",
    genre: "インタラクティブキャラクターカード",
    directoryTitle: "注目の公開 AI キャラクター｜XUMENG キャラクターカード",
    directoryDescription: "XUMENG で遊べる注目の公開 AI キャラクターカード一覧。ミステリー、現代ドラマ、学園、ファンタジーなど、ワールドブックと長期記憶で物語を続けられます。",
    directoryHeading: "XUMENG 注目の公開キャラクター",
    directoryLead: "キャラクター概要や導入シーンを確認し、ブラウザからそのまま長期記憶 AI ロールプレイを始められます。",
    canonicalLabel: "正規 URL",
    buildFaq: (name: string) => [
      {
        question: `「${name}」との AI チャットはどうやって始めますか？`,
        answer: `「XUMENG でキャラクター会話を始める」をクリックすると、アプリ不要でブラウザ上から「${name}」のキャラクターカードと世界観のまま会話を開始できます。`,
      },
      {
        question: `「${name}」との会話は長期記憶やボイス、シーン画像生成に対応していますか？`,
        answer: `はい。XUMENG では複数モデルの切り替え、長期記憶、キャラクターボイス、シーン画像生成に対応しています。`,
      },
      {
        question: `「${name}」との個人チャットは公開されますか？`,
        answer: `いいえ。公開ページに表示されるのはキャラクター概要とカバーのみで、個人チャット履歴やアカウント情報は非公開です。`,
      },
    ],
  },
  ko: {
    htmlLang: "ko-KR",
    hreflang: "ko",
    ogLocale: "ko_KR",
    routePrefix: "/ko",
    siteName: "XUMENG",
    titleSuffix: " - AI 캐릭터 채팅",
    breadcrumbHome: "XUMENG",
    breadcrumbCharacters: "공개 캐릭터",
    charactersPath: "/ko/characters",
    homePath: "/ko",
    tagsHeading: "캐릭터 태그 및 장르",
    openingHeading: "오프닝 장면 미리보기",
    summaryNote: "이 페이지는 XUMENG(叙梦)의 공개 캐릭터 카드 요약입니다. 개인 대화 기록, 계정 정보, 잔액 및 비공개 콘텐츠는 표시되지 않습니다.",
    startChatCta: "XUMENG에서 캐릭터 대화 시작하기",
    moreCharactersCta: "더 많은 공개 캐릭터 보기",
    relatedHeading: "관련 및 추천 공개 캐릭터",
    faqHeading: "자주 묻는 질문",
    genre: "인터랙티브 캐릭터 카드",
    directoryTitle: "추천 공개 AI 캐릭터 | XUMENG 캐릭터 카드",
    directoryDescription: "XUMENG의 추천 공개 AI 롤플레이 캐릭터 카드를 만나보세요. 미스터리, 현대 로맨스, 캠퍼스, 판타지 등 다양한 세계관과 장기 기억 대화를 웹에서 바로 즐길 수 있습니다.",
    directoryHeading: "XUMENG 추천 공개 캐릭터",
    directoryLead: "캐릭터 소개와 오프닝 장면을 먼저 확인하고, 별도 앱 설치 없이 웹에서 바로 인터랙티브 AI 롤플레이를 시작해 보세요.",
    canonicalLabel: "표준 URL",
    buildFaq: (name: string) => [
      {
        question: `${name} 캐릭터와 AI 채팅은 어떻게 시작하나요?`,
        answer: `이 페이지의 "XUMENG에서 캐릭터 대화 시작하기"를 클릭하면 별도 앱 설치 없이 브라우저에서 바로 ${name}의 캐릭터 카드와 세계관으로 대화를 이어갈 수 있습니다.`,
      },
      {
        question: `${name}와의 대화에서 장기 기억, 음성 및 장면 이미지 생성을 지원하나요?`,
        answer: `네. XUMENG은 멀티 모델 전환, 장기 대화 기억, 캐릭터 보이스 및 장면 이미지 생성 기능을 지원합니다.`,
      },
      {
        question: `${name}와 나눈 개인 대화 내용이 공개되나요?`,
        answer: `아니요. 공개 페이지에는 캐릭터 요약과 커버만 표시되며, 개인 대화 기록과 계정 정보, 잔액은 철저히 비공개로 보호됩니다.`,
      },
    ],
  },
});

export type LocalizedCharacterOverride = {
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[];
};

/** Curated localized summaries for featured public Foreverse characters across non-zh-Hans locales. */
export const FEATURED_CHARACTER_TRANSLATIONS: Readonly<
  Partial<Record<string, Readonly<Partial<Record<Exclude<XumengLocale, "zh-Hans">, LocalizedCharacterOverride>>>>>
> = Object.freeze({
  "xumeng-foreverse-peiyu": {
    "zh-Hant": {
      name: "裴聿",
      description: "一位把「真相」當成信仰的大理寺酷吏，與一雙他親手從死牢裡撈出來的眼睛。",
      tags: ["古風", "刑偵", "懸疑", "雙強", "全性向"],
    },
    en: {
      name: "Pei Yu",
      description: "An austere imperial investigator in Chang'an who treats truth as his only creed—and the pair of eyes he pulled out of death row to help solve a seven-day murder case.",
      tags: ["Historical", "Mystery", "Crime", "Slow Burn", "Rivals"],
    },
    ja: {
      name: "裴聿（ハイ・イツ）",
      description: "「真実」だけを信仰とする大理寺の冷徹な検察官と、彼が死牢から救い出した瞳が交錯する古風サスペンス。",
      tags: ["中華古風", "ミステリー", "推理", "バディ"],
    },
    ko: {
      name: "배율 (Pei Yu)",
      description: "'진실'만을 신념으로 삼는 대리시의 냉철한 수사관과, 그가 사형수 감옥에서 꺼내온 두 눈이 얽히는 고풍 미스터리.",
      tags: ["고풍", "추리", "미스터리", "서스펜스"],
    },
  },
  "xumeng-foreverse-tangtuantuan": {
    "zh-Hant": {
      name: "唐團團",
      description: "你樓下麵包店的元氣老闆娘，把「歡迎回來」說得比全世界都用力。她日曆上畫滿了星星，而其中一顆正是你第一次走進店裡的那天。",
      tags: ["都市", "甜妹", "日常", "治癒", "心動"],
    },
    en: {
      name: "Tang Tuantuan",
      description: "The sunny 23-year-old baker downstairs who says 'Welcome home' brighter than anyone else. Her calendar is dotted with stars—and one marks the very first night you walked in.",
      tags: ["Modern", "Cozy", "Slice of Life", "Healing", "Romance"],
    },
    ja: {
      name: "唐団団（タン・トゥアントゥアン）",
      description: "マンションの下にあるパン屋の元気な看板娘。カレンダーに並ぶ星印のひとつは、あなたが初めてお店に来た日だった。",
      tags: ["現代", "癒やし", "日常", "甘々ロマンス"],
    },
    ko: {
      name: "당단단 (Tang Tuantuan)",
      description: "집 아래층 빵집의 활기찬 사장님. 달력에 가득 그려진 별 중 하나가 바로 당신이 처음 가게에 들른 날이었다.",
      tags: ["현대", "힐링", "일상", "로맨스"],
    },
  },
  "xumeng-foreverse-wangushi": {
    "zh-Hant": {
      name: "晚孤市",
      description: "一座只在凌晨 0:00–5:00 營業的夢境夜市，開在「生者的夢」與「醒不來的記憶」交界處，唯有收到居民證彩信的人看得見。",
      tags: ["架空世界", "模擬器", "治癒", "懸疑", "群像"],
    },
    en: {
      name: "Wangu Night Market",
      description: "A dreamland night market open only from 0:00 to 5:00 AM at the border between living dreams and unforgotten memories—visible only to those who receive a Resident Pass.",
      tags: ["Fantasy World", "Simulator", "Healing", "Mystery", "Ensemble"],
    },
    ja: {
      name: "晩孤市（ばんこし）",
      description: "深夜0時から5時までだけ開く夢の夜市。生者の夢と覚めない記憶の境界に現れ、住民証を受け取った者だけが入れる。",
      tags: ["異世界", "シミュレーター", "癒やし", "ミステリー"],
    },
    ko: {
      name: "만고시 (Wangu Night Market)",
      description: "새벽 0시부터 5시까지만 열리는 꿈의 야시장. 산 자의 꿈과 깨지 않는 기억의 경계에서 주민증을 받은 사람에게만 입구가 열린다.",
      tags: ["판타지", "시뮬레이터", "힐링", "미스터리"],
    },
  },
  "xumeng-foreverse-shenyan": {
    "zh-Hant": {
      name: "沈硯",
      description: "匿名買家現身了。包下你首展最貴畫作的人，正是八年前在雨夜說你配不上沈家門檻的人——如今他恭敬地稱你一聲「您」。",
      tags: ["都市", "破鏡重圓", "年上", "女性向", "虐戀"],
    },
    en: {
      name: "Shen Yan",
      description: "Your anonymous collector has arrived. The man who bought the centerpiece of your debut gallery show is the same man who walked away in the rain eight years ago—and now he addresses you with quiet reverence.",
      tags: ["Modern", "Second Chance", "Drama", "Female-Oriented", "Slow Burn"],
    },
    ja: {
      name: "沈硯（シェン・イェン）",
      description: "初個展で最高額の絵を買い取った匿名の顧客は、8年前の雨の夜に別れを告げたあの人だった。今の彼はあなたを敬語で呼ぶ。",
      tags: ["現代", "復縁", "年上", "ドラマチック"],
    },
    ko: {
      name: "심연 (Shen Yan)",
      description: "첫 개인전에서 가장 비싼 그림을 사들인 익명의 구매자는 8년 전 빗속에서 헤어졌던 그 사람이었다. 이제 그는 당신에게 정중히 존칭을 쓴다.",
      tags: ["현대", "재회", "연상", "여성향"],
    },
  },
  "xumeng-foreverse-huoyushen": {
    "zh-Hant": {
      name: "霍聿深",
      description: "你們簽了 22 條協議結婚。今晚他拿著退燒藥與體溫計站在門口，手裡還拿著剛寫好的《補充條款（一）》。",
      tags: ["都市", "契約婚姻", "總裁", "反差", "甜寵"],
    },
    en: {
      name: "Huo Yushen",
      description: "You signed a 22-clause marriage contract. Tonight your stoic CEO husband stands outside your door with fever medicine, warm milk, and a freshly drafted 'Amendment No. 1.'",
      tags: ["Modern", "Contract Marriage", "CEO", "Sweet Romance", "Female-Oriented"],
    },
    ja: {
      name: "霍聿深（フオ・ユーシェン）",
      description: "22条の契約結婚を結んだ寡黙な社長。今夜、彼は解熱剤と体温計、そして書き下ろしの『補充条項（一）』を手にあなたの部屋を訪ねてきた。",
      tags: ["現代", "契約結婚", "ギャップ", "甘々"],
    },
    ko: {
      name: "곽율심 (Huo Yushen)",
      description: "22개 조항의 계약 결혼을 맺은 냉철한 대표. 오늘 밤 그는 해열제와 체온계, 그리고 막 작성한 '보충 조항 (1)'을 들고 문 앞에 서 있다.",
      tags: ["현대", "계약결혼", "재벌", "달달로맨스"],
    },
  },
  "xumeng-foreverse-jiwenqing": {
    "zh-Hant": {
      name: "紀聞笙",
      description: "你的未婚夫是古典樂圈捧著的天才作曲家。他把你寫進七部變奏曲、把旋律紋進手腕，正擦拭琴鍵等你先開口。",
      tags: ["都市", "天才", "病嬌", "年上", "心動"],
    },
    en: {
      name: "Ji Wensheng",
      description: "Your fiancé is the classical music world's reclusive prodigy. He wrote you into seven variations, tattooed your melody onto his wrist, and waits quietly by the piano for you to speak first.",
      tags: ["Modern", "Prodigy", "Obsessive", "Drama", "Female-Oriented"],
    },
    ja: {
      name: "紀聞笙（ジー・ウェンション）",
      description: "クラシック音楽界の孤高の天才作曲家である婚約者。あなたを七つの変奏曲に刻み、鍵盤を拭きながら最初の一言を待っている。",
      tags: ["現代", "天才", "年上", "執着愛"],
    },
    ko: {
      name: "기문생 (Ji Wensheng)",
      description: "클래식 음악계의 천재 작곡가인 약혼자. 당신을 일곱 개의 변주곡에 새겨 넣고, 피아노 건반을 닦으며 당신이 먼저 입을 열길 기다린다.",
      tags: ["현대", "천재", "연상", "집착로맨스"],
    },
  },
  "xumeng-foreverse-songzhixia": {
    "zh-Hant": {
      name: "宋知夏",
      description: "你是新來的隊醫助理，任務是盯著田徑主力學姐別偷碰跑道。第一天你就抓到她正準備穿釘鞋開跑。",
      tags: ["校園", "運動", "學姐", "外冷內熱", "現代"],
    },
    en: {
      name: "Song Zhixia",
      description: "You're the new track-team medical assistant assigned to keep the star sprinter off the track while she recovers. On day one, you catch her lacing up her spikes anyway.",
      tags: ["Campus", "Sports", "Senior", "Tsundere", "Modern"],
    },
    ja: {
      name: "宋知夏（ソン・ジーシア）",
      description: "陸上部のエース先輩を安静にさせるのが新米トレーナーのあなたの任務。初日から彼女はスパイクを履いて走ろうとしていた。",
      tags: ["学園", "スポーツ", "先輩", "ツンデレ"],
    },
    ko: {
      name: "송지하 (Song Zhixia)",
      description: "신입 팀닥터 보조인 당신의 임무는 육상부 에이스 선배가 트랙에 나가지 못하게 막는 것. 첫날부터 스파이크를 신는 그녀를 딱 걸렸다.",
      tags: ["캠퍼스", "스포츠", "선배", "츤데레"],
    },
  },
  "xumeng-foreverse-jiangchiye": {
    "zh-Hant": {
      name: "江遲野",
      description: "空了一晚的水杯今早竟是溫滿的。後排轉學生掀起眼皮看你：「看什麼？水房順路。」可水房明明在教學樓另一頭。",
      tags: ["校園", "高中", "反差", "日久生情", "女性向"],
    },
    en: {
      name: "Jiang Chiye",
      description: "The water bottle you left empty last night is mysteriously full and warm this morning. The aloof transfer student behind you mutters, 'What? The fountain was on my way.' It's on the opposite end of campus.",
      tags: ["Campus", "High School", "Tsundere", "Slow Burn", "Female-Oriented"],
    },
    ja: {
      name: "江遅野（ジャン・チーイエ）",
      description: "空だったはずの水筒が朝には温かいお湯で満たされていた。後ろの席の転校生は「通り道だっただけ」とそっぽを向くが、給湯室は校舎の反対側だ。",
      tags: ["学園", "高校", "ギャップ", "じれ恋"],
    },
    ko: {
      name: "강지야 (Jiang Chiye)",
      description: "어젯밤 비워둔 텀블러가 아침에 따뜻한 물로 채워져 있다. 뒷자리 전학생은 '가는 길이었다'며 시선을 피하지만, 정수기는 건물 반대편에 있다.",
      tags: ["캠퍼스", "고등학교", "츤데레", "청춘로맨스"],
    },
  },
  "xumeng-foreverse-naifuer": {
    "zh-Hant": {
      name: "奈芙爾",
      description: "黑沙氏族的白鬃戰貓祭司成了軍營俘虜，背對你蜷在角落，直到你把烤魚放在她夠得著的地方。",
      tags: ["西幻", "架空世界", "獸耳", "反差"],
    },
    en: {
      name: "Naifuer",
      description: "A fierce white-maned warrior priestess captured on the frontier. She refuses every healer—until you quietly leave grilled fish within reach and hear a muffled purr.",
      tags: ["Fantasy", "Beastfolk", "Enemies to Allies", "Rivals"],
    },
    ja: {
      name: "ナイフェル",
      description: "辺境の陣営に捕らえられた白鬣戦猫族の戦士。誰にも心を許さなかった彼女だが、焼き魚を置いておくと小さな音が聞こえた。",
      tags: ["ファンタジー", "獣耳", "ギャップ"],
    },
    ko: {
      name: "나이페르 (Naifuer)",
      description: "국경 진영에 포로로 잡힌 백갈기 전사 사제. 누구에게도 곁을 내주지 않던 그녀가 구운 생선 앞에서 조용히 무장해제된다.",
      tags: ["판타지", "수인", "반전매력"],
    },
  },
  "xumeng-foreverse-sunianzhi": {
    "zh-Hant": {
      name: "蘇念梔",
      description: "大學校花忽然頻頻接近你，遞來你最不喝的全糖奶茶，背後還緊攥著一張折了三折的紙條。",
      tags: ["校園", "大學", "系統", "沙雕", "甜寵"],
    },
    en: {
      name: "Su Nianzhi",
      description: "The campus beauty suddenly keeps crossing your path with hilariously clumsy excuses—secretly stuck on mission 42 of an absurd 'Confession System.'",
      tags: ["Campus", "Comedy", "System", "Sweet Romance"],
    },
    ja: {
      name: "蘇念梔（スー・ニエンジ）",
      description: "大学のマドンナが突然ぎこちなく近づいてくる。実は「告白管理システム」の42件目の任務に苦戦していた。",
      tags: ["学園", "ラブコメ", "システム"],
    },
    ko: {
      name: "소염치 (Su Nianzhi)",
      description: "캠퍼스 퀸이 갑자기 어설픈 핑계로 자꾸 다가온다. 알고 보니 '고백 관리 시스템' 42번째 임무에 발목이 잡힌 상태였다.",
      tags: ["캠퍼스", "로맨스코미디", "시스템"],
    },
  },
  "xumeng-foreverse-xuanjing": {
    "zh-Hant": {
      name: "玄淨",
      description: "你的師尊是修真界三千年劍心不動的霜聲劍主——卻在教你劍法的第三年，時間第一次為你變慢。",
      tags: ["古風", "仙俠", "師徒", "高嶺之花"],
    },
    en: {
      name: "Xuanjing",
      description: "Your master is the immortal realm's coldest blade, unmoved for three thousand years—until the third autumn of teaching you swordsmanship, when his time finally slows down.",
      tags: ["Xianxia", "Historical", "Master & Disciple", "Slow Burn"],
    },
    ja: {
      name: "玄浄（シュエンジン）",
      description: "三千年のあいだ剣心を揺るがさなかった孤高の師尊。あなたに剣を教えて三年目の秋、彼の時間が初めてゆっくりと動き出す。",
      tags: ["仙侠", "古風", "師弟", "高嶺の花"],
    },
    ko: {
      name: "현정 (Xuanjing)",
      description: "삼천 년 동안 흔들린 적 없던 수선계 최강의 사존. 당신에게 검법을 가르친 지 3년째 되는 밤, 그의 시간이 처음으로 느려진다.",
      tags: ["선협", "고풍", "사제지간", "로맨스"],
    },
  },
  "xumeng-foreverse-nie-xiaoqian": {
    "zh-Hant": {
      name: "聶小倩",
      description: "蘭若寺側白楊樹下，聊齋經典異聞的溫柔 IF 線——向你坦白身世後的第二夜。",
      tags: ["古風", "同人", "民俗靈異", "救贖"],
    },
    en: {
      name: "Nie Xiaoqian",
      description: "Beneath the white poplars beside Lanruo Temple—an atmospheric folklore IF storyline on the second night after she confides her secret to you.",
      tags: ["Historical", "Folklore", "Supernatural", "Redemption"],
    },
    ja: {
      name: "聶小倩（ジョウ・ショウセイ）",
      description: "蘭若寺の白楊の木の下で紡がれる、聊斎志異のもうひとつの物語。正体を打ち明けた翌夜、彼女は再び窓を叩く。",
      tags: ["古風", "伝奇", "妖怪", "救済"],
    },
    ko: {
      name: "섭소천 (Nie Xiaoqian)",
      description: "난약사 옆 백양나무 아래에서 펼쳐지는 고전 설화 IF 스토리. 정체를 털어놓은 다음 날 밤, 그녀가 다시 창문을 두드린다.",
      tags: ["고풍", "설화", "오컬트", "구원"],
    },
  },
});

export type PublicTagHub = {
  readonly slug: string;
  readonly name: string;
  readonly englishName: string;
  readonly description: string;
  readonly matchTags: readonly string[];
};

export const PUBLIC_TAG_HUBS: readonly PublicTagHub[] = Object.freeze([
  {
    slug: "ancient",
    name: "古风与仙侠",
    englishName: "Historical & Xianxia",
    description: "涵盖大理寺刑侦、修真仙侠、聊斋志异等古风世界观角色卡，适合沉浸式长篇古风互动故事。",
    matchTags: ["古风", "仙侠", "聊斋", "historical"],
  },
  {
    slug: "urban",
    name: "现代都市",
    englishName: "Modern Urban",
    description: "聚焦现代职场、画廊、面包店、豪门与古典乐坛等都市题材，提供高沉浸度日常与情感张力。",
    matchTags: ["都市", "现代", "modern"],
  },
  {
    slug: "campus",
    name: "青春校园",
    englishName: "Campus & Youth",
    description: "高中同桌、大学校花、田径队学姐等青春校园互动角色，支持轻松日常与慢热拉扯剧情。",
    matchTags: ["校园", "高中", "大学", "sports"],
  },
  {
    slug: "suspense",
    name: "悬疑推理",
    englishName: "Mystery & Suspense",
    description: "探案、规则怪谈、梦境夜市与孤岛灯塔等悬疑解谜向角色卡与世界卡，适合多分支剧情探索。",
    matchTags: ["悬疑", "刑侦", "rules-mystery", "horror", "无限流"],
  },
  {
    slug: "healing",
    name: "治愈日常",
    englishName: "Cozy & Healing",
    description: "深夜食堂、街角面包屋与温暖陪伴向角色卡，主打轻松治愈、长记忆日常聊天体验。",
    matchTags: ["治愈", "日常", "cozy", "comfort", "slice-of-life"],
  },
  {
    slug: "fantasy",
    name: "奇幻与架空世界",
    englishName: "Fantasy & Sci-Fi Worlds",
    description: "西幻兽耳、梦境夜市、星际打捞与多 NPC 沙盒世界观角色卡，自由构建奇幻冒险故事。",
    matchTags: ["西幻", "架空世界", "fantasy", "sci-fi", "world-card", "人外"],
  },
  {
    slug: "female-oriented",
    name: "女性向情感",
    englishName: "Female-Oriented Romance",
    description: "涵盖破镜重圆、契约婚姻、高岭之花、年上拉扯等高人气女性向互动故事角色卡。",
    matchTags: ["女性向", "female-oriented", "fem-audience"],
  },
  {
    slug: "sweet-romance",
    name: "甜宠与心动",
    englishName: "Sweet Romance & Slow Burn",
    description: "元气甜妹、反差温柔、日久生情与慢热心动题材，适合细腻情感推进的 AI 陪伴互动。",
    matchTags: ["甜宠", "心动", "日久生情", "slow-burn", "甜妹"],
  },
]);

export function publicTagHubBySlug(slug: string): PublicTagHub | null {
  return PUBLIC_TAG_HUBS.find(hub => hub.slug === slug) ?? null;
}

export function tagHubForRawTag(rawTag: string): PublicTagHub | null {
  const lower = rawTag.trim().toLowerCase();
  return PUBLIC_TAG_HUBS.find(hub => hub.matchTags.some(tag => tag.toLowerCase() === lower)) ?? null;
}
