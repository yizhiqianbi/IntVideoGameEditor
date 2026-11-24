/**
 * Central content + SEO configuration for the CCRent replica.
 * Edit copy, prices, contacts and metadata here; tools/build.mjs applies it
 * to every page.
 */

export const SITE = {
  origin: (process.env.SITE_ORIGIN || 'https://ccrent.cc').replace(/\/$/, ''),
  name: 'CCRent',
  tagline: '美国 Mac mini 租用',
  lang: 'zh-CN',
  region: '美国',
  currency: 'USD',
  contact: { wechat: 'yizhiquanbi', telegram: 'AAAXieeeee' },
  prices: { mac: '143', max: '324', ultra: '466' },
  // IndexNow key: also written to dist/<key>.txt and submitted to Bing/Yandex.
  indexNowKey: '8eb77cf3b91d940031bc31fae4cdc130',
  // Cloudflare analytics (zone + Web Analytics RUM site tag for ccrent.cc).
  cloudflare: {
    accountId: '274d62c1f24b885b3dfe562cda5d60c1',
    zoneId: 'b7606ff64337cbabf756487184600df1',
    rumSiteTag: '7ec03beb2541440c813aada73d15ef92',
  },
};

/* ------------------------------------------------------------------ copy -- */
// Applied in order to every page body. Prices first so sentences below can be
// written against the discounted numbers.
export const REPLACEMENTS = [
  // discounted prices (-10%)
  ['$159', '$143'],
  ['$360', '$324'],
  ['$518', '$466'],

  // soften account claims
  ['官方订阅，开通好再交付', '账号随套餐开通，交付即可用'],
  ['是你本人的。Max、Ultra 套餐的账号随套餐一起交付', 'Max、Ultra 套餐的账号随套餐一起交付'],

  // account claim -> US residential IP
  [
    '账号以你本人身份、通过官方渠道订阅，不走逆向，也不是二手号。',
    '美国住宅 IP，原生家宽网络，独享出口；Claude 账号随套餐交付。',
  ],
  [
    '>账号</p><div class="mt-3 flex items-center gap-3"><span class="grid size-11 place-items-center rounded-2xl bg-[#d97757]',
    '>网络与账号</p><div class="mt-3 flex items-center gap-3"><span class="grid size-11 place-items-center rounded-2xl bg-[#d97757]',
  ],
  [
    'Max、Ultra 套餐的账号以你本人身份注册，通过官方渠道订阅 Claude Max 或 Ultra，只给你一个人用，不转让，也不和别人共用；我们可以代为开通，本质上是协助你开通。订阅费由我们代付，服务期内请不要修改账号的订阅和付款信息。仅 Mac 租赁用的是你自己原有的账号。',
    'Max、Ultra 套餐的账号随套餐一起交付，只给你一个人用，不转让、不与他人共用。服务期内请不要修改账号的订阅和付款信息。仅 Mac 租赁使用你自己原有的账号。',
  ],
  [
    '我们协助你以本人身份通过官方渠道开通 Claude Max 或 Ultra，交付时已经开好，不用你自己折腾注册和付款。',
    'Claude Max 或 Ultra 账号交付时已经开好，不用你自己折腾注册和付款。',
  ],
  ['我们再把 Claude 订阅开通好一起交付。', 'Claude 账号随套餐一起交付。'],
  ['我们协助你以本人身份开通新账号（补号）', '我们协助你开通新账号（补号）'],

  // region -> United States (full sentences first)
  [
    '可选地区为美国、日本、韩国、新加坡、马来西亚、印尼、越南，下单时选定，服务期内暂不支持更换。',
    '地区固定为美国，下单时选定，服务期内暂不支持更换。',
  ],
  [
    '地区可选美国、日本、韩国、新加坡、马来西亚、印尼、越南，下单时选定，服务期内不能更换。配置是 Mac mini M4，16G 内存 + 256G 存储（或同等配置），接当地千兆光纤家宽 IP，只给你一个人用。美国地区可选 Mac mini M4 或 Mac mini M6（都是 16G + 256G）。美国的基础设施和运营成本明显更高，定价比其他地区略贵，具体以下单页面显示的价格为准。',
    'Mac 放在美国，接入美国住宅 IP，只给你一个人用。配置是 Mac mini M4，16G 内存 + 256G 存储（或同等配置）。美国可选 Mac mini M4 或 Mac mini M6（都是 16G + 256G），具体以下单页面显示的价格为准。',
  ],
  [
    '美国、日本、韩国、新加坡、马来西亚、印尼、越南；仅 Mac 租赁、Max 或 Ultra。',
    '美国住宅 IP；仅 Mac 租赁、Max 或 Ultra 三种套餐。',
  ],
  ['地区可选美国、日本、韩国、新加坡、马来西亚、印尼、越南。', '地区为美国。'],
  ['美国、日本、韩国、新加坡、马来西亚、印尼、越南', '美国'],
  ['美国 / 日本 / 韩国 / 新加坡 / 马来西亚 / 印尼 / 越南', '美国'],

  // map + steps
  ['你的 Mac，就在这七个地方', '你的 Mac，就在美国'],
  [
    '下单时选一个地区，Mac 接在当地的千兆光纤家宽上。选离你近、延迟低的地区，远程连过去就是这台机器。',
    '每台 Mac 都放在美国，接入千兆家宽的美国住宅 IP。远程连过去，就是这台属于你的机器。',
  ],
  ['下单时选定地区，服务期内不能更换。', '地区固定为美国，服务期内不能更换。'],
  ['点阵世界地图，标出美国、日本、韩国、新加坡、马来西亚、印尼、越南七个地区', '点阵世界地图，标出美国节点位置'],
  ['2 选地区和套餐', '2 选套餐'],
  ['选地区和套餐', '选套餐'],
  ['选好地区和套餐预订', '选好套餐预订'],
  ['想要新加坡的 Ultra', '想要美国的 Ultra'],
  ['>新加坡</span><span class="tabular-nums text-white/60">12ms', '>美国</span><span class="tabular-nums text-white/60">138ms'],
  ['>新加坡</span><svg', '>美国</span><svg'],

  // network wording
  ['接在当地的千兆光纤家宽上', '接入美国住宅 IP'],
  ['接当地千兆光纤家宽 IP', '接入美国住宅 IP'],
  ['当地千兆光纤家宽 IP', '美国住宅 IP（千兆家宽）'],
  ['当地千兆光纤家宽上', '美国住宅 IP 上'],
  ['当地家庭宽带 IP', '美国住宅 IP'],
  ['当地千兆光纤家庭宽带，使用家宽 IP', '美国千兆光纤家庭宽带，使用美国住宅 IP'],
  ['Mac 接在当地的家庭宽带上', 'Mac 接在美国住宅 IP 上'],
  ['千兆光纤家宽 IP', '美国住宅 IP（千兆家宽）'],
  ['千兆光纤家宽上', '美国住宅 IP 上'],

  ['跑在美国住宅 IP（千兆家宽） 上', '接入美国住宅 IP（千兆家宽）'],

  // pricing notes
  [
    '美国地区可选 Mac mini M4 或 Mac mini M6（都是 16G + 256G）。美国的基础设施和运营成本明显更高，定价比其他地区略贵，具体以下单页面显示的价格为准。',
    '美国可选 Mac mini M4 或 Mac mini M6（都是 16G + 256G），具体以下单页面显示的价格为准。',
  ],
  [
    '美国地区的基础设施和运营成本明显更高，定价略高于其他地区。具体价格以下单时页面显示为准，所有价格均以美元计价。',
    '所有价格均以美元计价，具体价格以下单时页面显示为准。',
  ],
  ['；美国地区可选 Mac mini M4 或 Mac mini M6，同样 16G + 256G', '；美国可选 Mac mini M4 或 Mac mini M6，同样 16G + 256G'],

  // terms / help / privacy specifics
  ['你应遵守 Mac 所在地区（即你下单时选定的地区）及你所在地的法律法规', '你应遵守美国及你所在地的法律法规'],
  ['不得用于违反 Mac 所在地区或你所在地法律', '不得用于违反美国或你所在地法律'],
  ['和当地网络运营商', '和美国网络运营商'],
  ['检查网络和地区是否和下单时一致', '检查网络是否为美国住宅 IP'],
  ['主要看你本地到那个地区的线路', '主要看你本地到美国的线路'],
  ['地区固定为美国，下单时选定，服务期内暂不支持更换。', '地区固定为美国，服务期内暂不支持更换。'],
  ['联系时请附上订单号和 Mac 所在的地区，方便我们尽快找到你的机器。', '联系时请附上订单号，方便我们尽快找到你的机器。'],
  ['例如想要的地区、档位和用法', '例如想要的档位和用法'],
  ['想要的地区、档位、台数和备注', '想要的档位、台数和备注'],

  // ---- accounts are provided by CCRent (final override pass) ----
  ['也可以由我们开通 Claude Max 或 Ultra', '也可以直接使用我们提供的 Claude Max 或 Ultra 账号'],
  ['仅租 Mac $143/月，含 Claude 账号 $324/月起', '仅租 Mac $143/月，含 Claude 账号 $324/月起（账号由我们提供）'],
  ['账号随套餐开通，交付即可用', '账号由我们提供，开通好再交付'],
  ['Claude 和常用开发工具都已装好；账号用你自己的，或者交给我们开通。', 'Claude 和常用开发工具都已装好；账号可以用你自己的，也可以直接用我们提供的 Claude Max / Ultra。'],
  ['美国住宅 IP，原生家宽网络，独享出口；Claude 账号随套餐交付。', '美国住宅 IP，原生家宽网络，独享出口；Claude Max / Ultra 账号由我们提供。'],
  ['账号可自带，也可开通 Max / Ultra', '账号可自带，也可由我们提供 Max / Ultra'],
  ['Claude Max 或 Ultra 账号交付时已经开好，不用你自己折腾注册和付款。', 'Claude Max 或 Ultra 账号由我们提供，交付时已经开好，不用你自己注册和付款。'],
  ['选 Max 或 Ultra 套餐，Claude 账号随套餐一起交付。', '选 Max 或 Ultra 套餐，Claude 账号由我们提供，随套餐一起交付。'],
  ['Max、Ultra 套餐的账号随套餐一起交付，只给你一个人用', 'Max、Ultra 套餐的账号由我们提供、随套餐交付，只给你一个人用'],
  ['Max 和 Ultra 另外开通好了 Claude 订阅，交付后直接能用', 'Max 和 Ultra 的 Claude 账号由我们提供，交付后直接能用'],
  ['Claude Max，已开通', 'Claude Max，由我们提供'],
  ['Claude Ultra，已开通', 'Claude Ultra，由我们提供'],
  ['需要我们开通账号的话', '需要我们提供账号的话'],
  ['<b class="font-semibold">Claude Max</b>（用量约为 Pro 的 5 倍）', '<b class="font-semibold">Claude Max 账号由我们提供</b>（用量约为 Pro 的 5 倍）'],
  ['<b class="font-semibold">Claude Ultra</b>（用量约为 Pro 的 10 倍）', '<b class="font-semibold">Claude Ultra 账号由我们提供</b>（用量约为 Pro 的 10 倍）'],

  ['Max、Ultra 套餐的 Claude 账号是你本人的，由我们协助开通并代付订阅费；不得修改账号的订阅或付款信息，不得在 Mac 上登录其他 Claude 账号替换它。', 'Max、Ultra 套餐的 Claude 账号由我们提供并随套餐交付；服务期内不得修改账号的订阅或付款信息，不得在 Mac 上登录其他 Claude 账号替换它。'],
  ['可以只租 Mac，也可以 Mac、网络、Claude 账号全包。', '可以只租 Mac，也可以 Mac、网络、Claude 账号全包（Claude 账号由我们提供）。'],
  ['只租 Mac，或者连同 Claude 账号一起租；多台另议。', '只租 Mac，或者连同 Claude 账号一起租；账号由我们提供，多台另议。'],

  // the FAQ answer used to open with a personal-account claim
  ['是你本人的。', ''],

  // long-tail / SEO copy additions
  ['>常见问题</h2>', '>美国 Mac mini 租用常见问题</h2>'],
  ['>价格常见问题</h2>', '>美国 Mac mini 租用价格常见问题</h2>'],
  ['点阵世界地图，标出美国节点位置', '美国 Mac mini 租用节点地图：美国住宅 IP 所在地'],
  ['每台 Mac 都放在美国，接入千兆家宽的美国住宅 IP。远程连过去，就是这台属于你的机器。', '每台 Mac 都放在美国，接入千兆家宽的美国住宅 IP，相当于一台随租随用的美国 Mac mini 云主机。远程连过去，就是这台属于你的机器。'],
  ['Claude 和常用开发工具都已装好；账号可以用你自己的，也可以直接用我们提供的 Claude Max / Ultra。', 'Claude 和常用开发工具都已装好；账号可以用你自己的，也可以直接用我们提供的 Claude Max / Ultra。适合远程开发、iOS 构建和长时间跑 Claude Code。'],
  ['美国 Mac 租用：专属 Mac、住宅 IP、Claude 账号一站配齐。', '美国 Mac mini 租用：专属 Mac mini M4、美国住宅 IP、Claude Code 云端开发，Claude Max / Ultra 账号由我们提供。'],

  // footer tagline + brand wording
  ['海外 Mac 租用：专属 Mac、家庭宽带、Claude 账号一站配齐。', '美国 Mac 租用：专属 Mac、住宅 IP、Claude 账号一站配齐。'],
  ['海外', '美国'],
];

/* ------------------------------------------------------------------- SEO -- */
export const PAGES = {
  'index.html': {
    path: '/',
    title: '美国 Mac mini 租用｜Claude Code 开机即用 | CCRent',
    description:
      '美国 Mac mini 租用：专属 Mac mini M4 + 美国住宅 IP，预装 Claude Code。仅租 Mac $143/月，含 Claude 账号 $324/月起（账号由我们提供），48 小时内交付。',
    changeFreq: 'weekly',
    priority: '1.0',
    hasFaq: true,
  },
  'pricing.html': {
    path: '/pricing',
    title: '美国 Mac mini 租用价格：仅 Mac $143/月起 | CCRent',
    description:
      '美国 Mac mini 租用价格：仅 Mac 租赁 $143/月（账号自备），Max $324/月起，Ultra $466/月起，Claude 账号由我们提供。均含专属 Mac mini M4 与美国住宅 IP。',
    changeFreq: 'weekly',
    priority: '0.9',
    breadcrumb: '价格',
    hasFaq: true,
  },
  'help.html': {
    path: '/help',
    title: '美国 Mac 远程连接与使用帮助 | CCRent',
    description:
      '美国 Mac 远程连接教程：UU 远程、ToDesk、RustDesk、Tailscale + SSH 配置，交付预装内容、使用注意事项、数据安全与售后联系方式。',
    changeFreq: 'monthly',
    priority: '0.6',
    breadcrumb: '帮助',
  },
  'terms.html': {
    path: '/terms',
    title: '服务条款 | CCRent 美国 Mac mini 租用',
    description:
      'CCRent 服务条款：服务内容、下单与交付、费用与发票、使用规范、Mac 与数据、第三方服务与售后。',
    changeFreq: 'yearly',
    priority: '0.3',
    breadcrumb: '服务条款',
  },
  'refund.html': {
    path: '/refund',
    title: '退款政策 | CCRent 美国 Mac mini 租用',
    description: 'CCRent 退款政策：交付前取消、交付当天故障、服务期开始后的退款规则与联系方式。',
    changeFreq: 'yearly',
    priority: '0.3',
    breadcrumb: '退款政策',
  },
  'privacy.html': {
    path: '/privacy',
    title: '隐私政策 | CCRent 美国 Mac mini 租用',
    description:
      'CCRent 隐私政策：访问统计、客服联系、注册登录、下单付款与数据使用说明。',
    changeFreq: 'yearly',
    priority: '0.3',
    breadcrumb: '隐私政策',
  },
};

export const OG = {
  image: '/assets/img/og.png',
  alt: '美国 Mac mini 租用 · Claude Code 开机即用 · CCRent',
  width: 1200,
  height: 630,
};


/* ------------------------------------------------------- long-tail FAQ ---- */
export const EXTRA_FAQS = {
  home: [
    {
      q: '美国 Mac mini 租用多少钱一个月？',
      a: '仅 Mac 租赁 $143/月，Claude Max 套餐 $324/月起，Claude Ultra 套餐 $466/月起。季付 9 折、年付 8 折，到期不自动续费。',
    },
    {
      q: '美国住宅 IP 和机房 IP 有什么区别？',
      a: '机房 IP 通常是整段数据中心地址，容易被平台标记；美国住宅 IP 来自当地家庭宽带，更接近真实用户的上网环境。CCRent 的 Mac 接入美国千兆家宽，使用美国住宅 IP，只给你一个人用。',
    },
    {
      q: 'Claude Code 一定要用美国 IP 吗？',
      a: 'Claude Code 本身不强制要求美国 IP，但账号注册环境、登录地点和常用出口不一致时，更容易触发额外验证。把 Claude Code 跑在一台美国住宅 IP 的 Mac 上，网络环境更统一，长期远程开发也更稳定。',
    },
    {
      q: '美国 Mac mini 怎么远程连接？',
      a: '交付时会提供 UU 远程或 ToDesk 的设备码和连接密码，也可以按帮助中心的教程配置 RustDesk 或 Tailscale + SSH。连上就是一整台 macOS 桌面。',
    },
    {
      q: '美国 Mac mini 能跑 Xcode 和 iOS 构建吗？',
      a: '可以。Mac mini M4 原生支持 Xcode，适合 iOS 打包、签名、模拟器测试和 macOS 构建。配置为 16G 内存 + 256G 存储，系统环境交付时已经配好。',
    },
    {
      q: '租美国 Mac mini 支持支付宝付款吗？',
      a: '支持。Max、Ultra 套餐可以在线用 Stripe 付款（支持银行卡、支付宝），仅 Mac 租赁和对公打款请联系客服；可开发票，税点另计。',
    },
    {
      q: 'Claude Max 和 Claude Ultra 有什么区别？',
      a: '两者都是 Claude 订阅套餐，主要差别是用量额度：Ultra 约为 Pro 的 10 倍，Max 约为 5 倍。日常写代码选 Max，每天长时间跑 Claude Code 选 Ultra。',
    },
    {
      q: '美国 Mac mini 适合哪些人？',
      a: '适合需要美国住宅 IP 跑 Claude Code 的开发者、需要一台常开 Mac 做 iOS / macOS 构建的团队，以及想要固定远程开发环境、不想占用自己电脑的人。',
    },
  ],
  pricing: [
    {
      q: '美国 Mac mini 季付、年付怎么算？',
      a: '按月计价，也可以季付或年付：机器部分季付 9 折、年付 8 折，Claude 账号部分不打折。到期不自动续费。',
    },
    {
      q: '可以先租一个月试试吗？',
      a: '可以。所有套餐按月计价，最短一个月；到期不续即服务结束，不会自动扣费。',
    },
    {
      q: '美国 Mac mini 租用包含 Claude 账号吗？',
      a: '仅 Mac 租赁不含账号，适合已经有 Claude 订阅的人；Claude Max / Ultra 套餐包含对应账号，账号由我们提供，交付时已经开好。',
    },
    {
      q: '多台或团队租用有优惠吗？',
      a: '有。多台 / 团队按台数和时长一事一议，直接联系客服说明台数和租期即可报价。',
    },
  ],
};

/* -------------------------------------------------------------- llms.txt -- */
export const LLMS_TXT = `# CCRent — 美国 Mac mini 租用

> 美国 Mac mini 租用：专属 Mac mini M4，接入美国住宅 IP（千兆家宽），预装 Claude Code，Claude Max / Ultra 账号由我们提供，远程连上就能用，48 小时内交付。

## 套餐与价格
- 仅 Mac 租赁：$143/月（账号自备）
- Claude Max：$324/月起（含 Claude Max 账号，由我们提供）
- Claude Ultra：$466/月起（含 Claude Ultra 账号，由我们提供）
- 季付 9 折、年付 8 折；到期不自动续费；可开发票（税点另计）

## 关键信息
- 地区：美国（美国住宅 IP，非机房 IP）
- 设备：Mac mini M4，16G 内存 + 256G 存储（美国可选 M4 / M6）
- 预装：Claude 桌面端、Claude Code、Homebrew、Xcode 等
- 远程：UU 远程 / ToDesk / RustDesk / Tailscale + SSH
- 售后：24 小时响应，Ultra 优先
- 联系方式：微信 yizhiquanbi，Telegram @AAAXieeeee

## 页面
- [首页](https://ccrent.cc/)：产品介绍、常见问题、套餐入口
- [价格](https://ccrent.cc/pricing)：三档套餐、套餐对比、计费说明、价格 FAQ
- [帮助](https://ccrent.cc/help)：远程连接教程、预装内容、使用注意
- [服务条款](https://ccrent.cc/terms)
- [退款政策](https://ccrent.cc/refund)
- [隐私政策](https://ccrent.cc/privacy)

## 适合场景
美国住宅 IP 下运行 Claude Code、iOS / macOS 构建、常开远程开发机、团队共享一台专属 Mac。
`;


/* ------------------------------------------------------------- keywords --- */
export const KEYWORDS = {
  '/': [
    '美国Mac mini租用', '美国Mac租用', '美国Mac mini出租', '租美国Mac', '美国云Mac',
    '美国Mac mini云主机', 'Mac mini M4租用', 'Mac mini租用', '美国住宅IP', '美国住宅IP Mac',
    '美国家庭宽带IP', '美国原生IP', 'Claude Code租用', 'Claude Code账号', 'Claude Max账号',
    'Claude Ultra账号', 'Claude Code美国IP', 'Claude Code远程开发', 'Claude Code云端',
    '美国Mac远程开发', '远程Mac开发机', 'iOS构建Mac', 'Xcode云构建', 'macOS云主机',
    '跑Claude Code的Mac', '美国Mac mini多少钱一个月', '美国Mac mini怎么连接', '美国Mac mini安全吗',
  ],
  '/pricing': [
    '美国Mac mini价格', '美国Mac mini租用价格', 'Mac mini月租', 'Claude Max多少钱',
    'Claude Ultra多少钱', 'Claude Code套餐价格', '美国Mac mini季付', '美国Mac mini年付',
    '美国Mac租用费用', 'Mac mini M4价格',
  ],
  '/help': [
    '美国Mac远程连接', 'UU远程连接Mac', 'ToDesk连接Mac', 'RustDesk Mac', 'Tailscale SSH Mac',
    '美国Mac使用教程', 'Mac远程桌面卡顿', '美国Mac传文件',
  ],
  '/terms': ['美国Mac mini租用条款', 'CCRent服务条款', 'Mac租用协议', 'Mac租赁条款'],
  '/refund': ['美国Mac mini退款', 'Mac租用退款政策', 'Mac退款规则'],
  '/privacy': ['CCRent隐私政策', 'Mac租用隐私', '美国Mac数据安全'],
};
