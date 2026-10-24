/** Public review copy only. This module never reads an account or enables checkout. */
export const XUMENG_PAYMENT_INFO_DRAFT = true;
export const XUMENG_PAYMENT_SUPPORT_EMAIL = "850587960@qq.com";
export const XUMENG_PAYMENT_INFO_UPDATED = "2026-10-15";

export type XumengPaymentInfoPath = "/pricing" | "/terms" | "/privacy" | "/refund-policy" | "/support";
export type XumengPaymentInfoSection = {
  id: string;
  title: string;
  paragraphs: readonly string[];
  items?: readonly string[];
};
export type XumengPaymentInfoPage = {
  path: XumengPaymentInfoPath;
  label: string;
  title: string;
  description: string;
  lead: string;
  sections: readonly XumengPaymentInfoSection[];
};

// Editorial sections stay separate from the renderer so reviewed policy copy can
// replace the draft without changing navigation, routing or payment behavior.
export const XUMENG_PAYMENT_INFO_PAGES: readonly XumengPaymentInfoPage[] = [
  {
    path: "/pricing", label: "方案与价格", title: "方案与价格 · 晴屿",
    description: "晴屿人民币月卡的价格、领取方式与当前支付状态。审核草稿，暂不可付款。",
    lead: "看清价格和权益，再决定是否购买。",
    sections: [
      { id: "monthly", title: "人民币月卡", paragraphs: [
        "晴屿 VIP 人民币月卡：CNY ¥28，一次性购买 30 天权益，不自动续费，不定期扣款。每期为 30 × 24 小时，以账号内显示的生效与到期时间为准。",
        "到期后可自行购买下一期；提前续购的权益期间衔接在已有有效期间之后。Waffo Pancake 可用支付方式以正式收银台实际提供为准。",
      ], items: ["有效期内每天可手动领取 100 Credit，最多领取 30 次，合计最多 3,000 Credit。", "按北京时间（Asia/Shanghai）计算，同一账号每天最多领取一次，每日零点开始新一天。"] },
      { id: "claim", title: "每日领取方式", paragraphs: [
        "购买月卡不会一次性发放 3,000 Credit。登录或查看会员状态也不会自动领取，需要在每日领取入口操作。漏领不补，未领取的当日额度不累计。",
        "已经领取到余额的 Credit 不因本期会员到期而自动清零。会员确认、每日领取与余额消费是不同流程。",
      ] },
      { id: "credits", title: "Credit 如何使用", paragraphs: [
        "Credit 用于站内支持的 AI 服务。聊天、创作和图片、视频生成的消耗可能不同，以实际模型、生成前费用提示及本人消费记录为准。",
        "月卡不承诺无限次数、固定回复字数、任意媒体效果或所有功能始终可用。管理员预览或测试权限不属于购买本月卡获得的权益。",
      ] },
      { id: "availability", title: "当前支付状态与交付", paragraphs: [
        "Waffo 正式收款审核尚未通过，人民币月卡尚不能付款。收款入口可显示套餐，但不表示订单已创建、已付款或会员已开通。审核通过并恢复可付款状态后，网站会更新提示；请勿为此向客服个人转账。",
        "开放后，网站以服务端核验的支付结果确认权益。进入收银台、扫描二维码、点击返回或提供截图，都不能单独认定支付成功。",
        `如已扣款但账号没有对应权益，请联系 ${XUMENG_PAYMENT_SUPPORT_EMAIL}，提供账号邮箱、订单编号及脱敏付款凭据，我们会核对处理。`,
      ] },
      { id: "history", title: "历史订单与其他套餐", paragraphs: [
        "历史套餐按购买时保存的订单权益执行。本页不把旧套餐的每日 500 Credit 或 USDT 季卡权益套用到当前人民币月卡。",
        "其他渠道是否开放及其价格，应在相应套餐页明确展示；停用套餐不提供新购买承诺。购买前请阅读本页页脚链接中的服务条款、退款政策与隐私政策。",
      ] },
    ],
  },
  {
    path: "/terms", label: "服务条款", title: "服务条款 · 晴屿",
    description: "晴屿的服务范围、账号使用与付费权益说明草稿。",
    lead: "了解晴屿提供的服务与使用边界。",
    sections: [
      { id: "service", title: "服务与经营者", paragraphs: [
        "晴屿（Xumeng）提供 AI 角色聊天、故事与角色创作、创作素材生成，以及在浏览器内运行用户私人 HTML 游戏的功能。电话功能可结合用户选择的人物资料、故事背景与相关上下文；对话对象是 AI，不是真人客服、真人陪聊或公共电话服务。",
        "功能开放范围以页面实际可用状态为准。游戏功能目前是承载私人 HTML 游戏的容器，不承诺统一自动存档、任意外部游戏兼容或与站内钱包互通。图片、视频与语音为 AI 生成，参考素材和动作示例不构成对最终效果的保证。",
        "经营者法律名称与主体说明待经营者确认，本草稿不填写或公开未经确认的姓名。版本为审阅稿，生效日期在确认并正式发布时填写。",
        `联系邮箱：${XUMENG_PAYMENT_SUPPORT_EMAIL}。`,
      ] },
      { id: "account", title: "账号与使用资格", paragraphs: [
        "晴屿面向年满 18 周岁的用户。请提供可使用的账号资料，妥善保管密码与验证码，不向他人提供登录凭据。发现疑似账号被盗或异常交易时，可通过支持邮箱联系，我们将核验身份并处理相关请求。",
        "请勿在邮件、论坛或截图中发送密码、验证码、Cookie、API Key 或完整付款凭据。",
      ] },
      { id: "content", title: "内容与使用规则", paragraphs: [
        "使用服务应遵守适用法律、他人权利及晴屿社区公约。不得实施诈骗、骚扰、恶意程序传播、虚假互动、批量刷奖励、盗用他人账号或绕过安全措施。",
        "上传图片、音频、文字、角色与游戏内容前，请确认自己拥有相应权利。涉及其他真实人物的照片或声音，应先取得其适当许可；不得上传未经许可的私人资料或私密影像，不得伪造他人身份、授权或真实言行。取得素材许可不等于允许用于违法、侵犯人格权或欺骗性的合成。",
        "禁止涉及未成年人的性化与剥削、非自愿私密影像、现实暴力威胁、恐怖主义宣传以及其他违法内容。公开封面、标题与论坛内容应遵守社区公约中的展示边界。AI 输出可能涉及第三方权利，使用、分享或商业使用前仍需核对，平台不保证输出必然具有独占著作权或不侵权。",
        "私人角色草稿、小说和游戏不会因保存而自动公开。角色投稿经审核后才可能进入公开目录；论坛主题与回复发布后即对他人可见。有关违规或侵权内容，可按公约举报，或向支持邮箱提供页面链接、具体问题与必要的脱敏证据。",
      ] },
      { id: "purchase", title: "价格、交付与续购", paragraphs: [
        "当前人民币月卡为 CNY ¥28 一次性购买、30 天、每日手动领取 100 Credit、每期最多 30 次。完整说明见方案与价格页面。会员确认、每日领取、余额消费和退款为不同流程；未付款订单、测试付款及尚未领取的额度不计为已获得余额。",
        "该月卡不自动续费，无需取消自动扣款。停止购买下一期即可停止续购；退出登录或停止使用不自动发起退款。已有订单按购买时冻结的价格和权益处理，后续价格调整不自动改写历史订单。",
        "当前 Waffo 正式收款尚未通过审核，暂不可付款。恢复后由 Waffo Pancake 提供支付流程，用户也需查看收银台展示的支付服务条款。晴屿不会要求用户向站点客服提供银行卡密码或钱包私钥。",
      ] },
      { id: "refunds", title: "退款与取消", paragraphs: [
        `拟采用人工退款政策，不表示网站已实现自动退款。发生重复扣款、付款成功但权益未交付、服务与购买时说明明显不符或其他支付错误时，可通过 ${XUMENG_PAYMENT_SUPPORT_EMAIL} 申请核查。`,
        "我们核对订单、实际付款、权益交付和使用情况，并与支付服务方协调。根据事实、适用法律和渠道规则，处理可能包括补发应有权益、修正账务、全额或部分退款；已领取或使用部分权益的情况结合实际核实，不以数字服务一律不退排除法定救济。",
        "未发生真实扣款的失败或待支付请求，不作已付款退款处理。退款获准不等于已经到账，不承诺固定审核天数、无条件退款或自动即时到账。完整申请资料与核对方式见退款政策页面；本条不要求用户放弃向支付服务方或法定渠道求助的权利。",
      ] },
      { id: "availability", title: "AI 输出与可用性", paragraphs: [
        "AI 回答、剧情、图像、音频与视频可能包含错误、遗漏或不符合预期的内容。它们用于创作与娱乐，不能代替真实人物的承诺或合格专业人员的判断。",
        "平台及模型、媒体、网络供应商发生故障时，相关功能可能暂时不可用。我们会依据实际故障处理恢复、费用核对和用户反馈，不保证持续无中断或每次生成达到特定效果。",
      ] },
      { id: "disputes", title: "违规处理、暂停与争议", paragraphs: [
        "对于经核实的违规内容，可依公约退回投稿、下架公开角色或删除违规论坛内容；严重违法、欺诈或危害服务安全的行为，可依法采取限制或暂停相关服务等必要措施。用户可通过支持邮箱说明异议，我们将结合实际记录复核。",
        "本条不承诺已具备自动封号、自动没收 Credit 或自动退款能力，也不允许以暂停服务为由任意取消用户法定权利。任何条款均不排除适用法律规定的不可放弃权利。",
        "条款更新应展示版本与生效日期；涉及价格、购买权益或个人信息处理方式的实质变化，应在相应页面清楚说明。未确定经营主体和适用规则前，本草稿不约定司法辖区、强制仲裁地点或赔偿上限。",
      ] },
    ],
  },
  {
    path: "/privacy", label: "隐私政策", title: "隐私政策 · 晴屿",
    description: "晴屿账号、创作和支付相关信息的处理说明草稿。",
    lead: "清楚说明信息的使用范围。",
    sections: [
      { id: "information", title: "处理的信息与用途", paragraphs: [
        "注册、登录和账号恢复使用邮箱、昵称、账号编号、验证状态、密码校验值、验证码与会话记录，用于身份核验及账号保护；服务端保存密码散列，不以明文密码作为账号记录。",
        "聊天与创作会处理用户输入、AI 回复、对话分支、角色与世界设定、剧情记忆、偏好、小说和游戏源码，以保存、恢复和继续创作。媒体生成会处理参考素材及其文件信息、生成描述、模板、模型、任务状态、音色与结果。",
        "AI 电话使用所选人物与背景、交互文字，以及启用麦克风后发送的音频和相关转写；启用相应实时服务时，也可能产生供应商侧录制内容。",
        "社区与反馈信息用于展示、审核和处理问题。套餐、订单编号、金额、币种、支付状态、会员期间、领取、消费与预留记录用于交付、计费、防止重复记账及争议核对。服务还处理请求时间、连接信息、错误状态和防滥用记录，限流使用由身份或 IP 派生的摘要标识。",
        "请不要将身份证件、钱包私钥、完整银行卡资料或他人的敏感私人信息写入故事、生成描述或公开反馈。服务通常不需要这些内容。",
      ] },
      { id: "storage", title: "保存与浏览器存储", paragraphs: [
        "账号、聊天、创作和账务等结构化记录由 Cloudflare D1 保存；上传及生成媒体使用 Cloudflare R2，服务运行在 Cloudflare Workers 等基础设施上。私人内容接口按账号校验访问权限，公开投稿与论坛内容按发布状态展示。",
        "浏览器使用登录 Cookie 保持身份，并使用本地存储或标签页存储保存部分偏好、草稿恢复副本、游戏恢复记录及待核对请求。清理浏览器数据可能移除本地副本，不会自动删除服务器数据；退出登录也不等同于注销账号。",
        "登录会话目前有效期为 30 天，验证码有效期为 10 分钟。生成参考图片目前设置 30 天可用期限，过期或删除后不再用于新的读取，文件清理可能随后完成。有效期结束不等于所有相关记录立即从备份和系统中彻底删除。",
        "已完成生成任务删除时会移出可见历史并尝试删除媒体，但账务与防重复请求的必要记录仍保留。目前没有覆盖全部账号、对话、作品、账务及备份的一致自动删除期限，也没有完整的一键账号注销流程。",
      ] },
      { id: "providers", title: "第三方处理与分享", paragraphs: [
        "完成用户选择的功能时，必要信息会发送至相应服务方，并非只停留在浏览器内：",
      ], items: [
        "Cloudflare 负责网站运行、数据库、媒体存储、网络传输和验证码邮件发送；部分聊天图片与语音通过 Workers AI 处理。",
        "OpenRouter 及实际执行请求的模型供应商处理用户发起的聊天、创作、摘要或媒体请求，包括相关输入、人物设定、所需上下文和参考图。具体模型以发起请求时页面展示及实际配置为准。",
        "Vidu 在相应功能开放并由用户启用时，处理音色合成及实时 AI 角色互动所需的文本、人物图像和音视频。当前实时服务实现启用了转写及供应商录制配置，不能承诺通话从不录制或从不生成转写。",
        "Waffo Pancake 在人民币月卡支付流程中接收账号标识、账号邮箱（如有）、商品及订单关联编号，并在其收银台处理付款资料。晴屿保存交易状态与权益记录，不通过本接入收集完整银行卡号或银行卡验证码，也不会将私人角色聊天或小说正文作为订单资料发送给 Waffo。",
        "用户主动发送至客服邮箱的信息由邮箱服务处理；使用已开放的 Telegram 反馈渠道时，相关消息、发送者标识和附件元数据可能进入反馈记录。不要在公开论坛或群组提交无需公开的个人资料。",
      ] },
      { id: "boundaries", title: "处理范围与公开边界", paragraphs: [
        "第三方有各自的数据处理规则和基础设施，信息可能在用户所在地区之外处理。当前实现不能证明所有供应商均为零保留、均不用于模型训练或均仅在同一国家保存，因此不作这些承诺。",
        "模型调用、媒体生成、付款与公开发帖具有不同的数据流，请按所需功能提供必要内容。除履行用户请求、运营与安全处理、适用法律要求及争议处理等必要情形外，其他新增用途应先清楚说明，并在依法需要时取得相应授权。",
        "公开内容可被他人查看、复制或转发；私人草稿保存不会自动转为公开投稿。",
      ] },
      { id: "requests", title: "用户选择与人工权利请求", paragraphs: [
        "可使用页面已有的编辑、导出、删除和偏好设置功能管理内容。麦克风权限由用户决定，可在浏览器设置中关闭；关闭后需要麦克风的交互无法继续。停止使用 AI 功能可停止新的该类请求，但不会自动撤销已经发出的处理或删除已保存记录。",
        `需要访问、更正、导出、删除个人数据，撤回适用授权或注销账号时，请写信至 ${XUMENG_PAYMENT_SUPPORT_EMAIL}，说明账号邮箱、请求种类及内容范围。我们核验身份后，按请求范围、实际保存状态与适用法律人工办理。`,
        "核验不会要求账号密码、登录验证码、钱包私钥或无关证件。因安全调查、履约争议或法定义务需要保留的部分，应与可删除内容区别处理；处理结果及依法不能立即完成的原因会通过人工回复说明，不承诺所有历史数据立即清空或固定完成时限。",
      ] },
      { id: "safety", title: "安全、未成年人和政策更新", paragraphs: [
        "我们使用密码散列、登录会话、账号访问校验及必要的服务端密钥配置等措施降低风险。网络或存储方案不能保证绝对安全；发现问题后会按实际情况采取必要处置，并履行适用法律规定的通知等义务。",
        "晴屿面向年满 18 周岁的用户。发现未成年人使用或相关个人信息问题时，可通过支持邮箱联系。经营者法律名称待确认后补充。",
        "本政策版本为审阅稿，生效日期在确认并正式发布时填写。政策实质变更应说明变更内容、版本与生效时间，文字更新不会被当作已经取得新的数据用途授权。",
      ] },
    ],
  },
  {
    path: "/refund-policy", label: "退款政策", title: "退款政策 · 晴屿",
    description: "晴屿人民币月卡的支付问题与退款联系说明草稿。",
    lead: "支付有疑问时，先把订单情况核对清楚。",
    sections: [
      { id: "status", title: "退款政策与续购方式", paragraphs: [
        "本页为拟采用的人工退款政策，待经营者确认后生效，不表示网站已实现自动退款。Waffo 正式收款审核尚未通过，人民币月卡尚不能付款。",
        "月卡一次性购买、手动续购，不自动续费，无需取消自动扣款。停止购买下一期即可停止续购；退出登录或停止使用不自动发起退款。",
      ] },
      { id: "contact", title: "如何申请核查", paragraphs: [
        `如果发生重复扣款、付款成功但服务权益未交付、服务与购买时说明明显不符或其他支付错误，请通过 ${XUMENG_PAYMENT_SUPPORT_EMAIL} 申请核查。`,
        "请提供账号邮箱、订单编号、购买日期、问题描述，以及必要的脱敏凭据。我们核对订单、实际付款、权益交付和使用情况，并与支付服务方协调处理。",
        "不要发送完整银行卡资料、支付密码、短信验证码、钱包私钥或助记词。需要凭证时请先遮挡无关个人信息。",
      ] },
      { id: "review", title: "核查与处理方式", paragraphs: [
        "核查可能形成补发应有权益、修正账务、全额或部分退款等处理结果；具体方式依据事实、适用法律和支付渠道规则确定。",
        "已经领取或使用部分权益的情况，需要结合未交付部分、实际使用情况及法定权利判断，不以数字服务一律不退排除用户依法享有的救济。",
        "未发生真实扣款的失败或待支付请求，不作已付款退款处理。未经核验的截图、返回页面或待支付状态，不单独作为已完成扣款的证明。",
      ] },
      { id: "progress", title: "退款进度与用户权利", paragraphs: [
        "退款获准不等于款项已经到账，进度及到账情况以支付渠道的确认和记录为准。本政策不承诺固定审核天数、无条件退款或自动即时到账。",
        "申请核查不要求用户先放弃向支付服务方、消费者保护机构或其他法定渠道求助的权利。任何说明都不排除适用法律规定的不可放弃权利。",
      ] },
    ],
  },
  {
    path: "/support", label: "支持与联系", title: "支持与联系 · 晴屿",
    description: "联系晴屿，反馈功能、账号、权益与支付问题。",
    lead: "说明遇到的情况，我们才能一起定位问题。",
    sections: [
      { id: "email", title: "联系邮箱", paragraphs: [
        `客服、订单、退款与隐私联系邮箱：${XUMENG_PAYMENT_SUPPORT_EMAIL}。`,
        "可联系咨询功能故障、账号访问、权益显示、支付订单及隐私相关问题。发现疑似账号被盗、异常交易或对内容处理有异议时，也可通过该邮箱说明情况。",
      ] },
      { id: "details", title: "建议提供的信息", paragraphs: [
        "功能问题请描述所在页面、操作步骤、预期结果和实际结果。截图请先遮挡个人信息，无需提供私人故事或聊天全文。",
      ], items: [
        "订单问题：提供账号邮箱、订单编号、购买日期、问题描述和必要的脱敏付款凭据。",
        "隐私请求：说明账号邮箱、访问、更正、导出、删除或注销等请求种类，以及涉及的内容范围。我们可能进行必要的身份核验。",
        "违规或侵权问题：使用站内举报入口，或邮件提供页面链接、具体问题与必要的脱敏证据；对处理有异议时可申请复核。",
        "不要发送密码、验证码、Cookie、API Key、完整银行卡资料、私钥、助记词或无关证件。",
      ] },
      { id: "handling", title: "如何处理反馈", paragraphs: [
        "我们结合实际记录人工核对，订单问题会核实实际付款、权益交付和使用情况，并按需要与支付服务方协调。数据请求按请求范围、实际保存状态和适用法律办理。",
        "处理结果及依法不能立即完成的原因会通过人工回复说明。本页不承诺自动退款、自动账号注销或固定完成时限。",
      ] },
      { id: "payments", title: "关于当前付款", paragraphs: [
        "Waffo 正式收款审核尚未通过，人民币月卡尚不能付款。收款入口显示套餐并不等于已经付款或开通权益，请勿向客服个人转账来购买权益。",
        "若已扣款但账号没有对应权益，请按订单问题提供资料。无需向客服发送资金、银行卡密码或钱包私钥来核验订单。",
      ] },
    ],
  },
];

export function getXumengPaymentInfoPage(path: string): XumengPaymentInfoPage | undefined {
  let normalized = path;
  try { normalized = decodeURIComponent(normalized); } catch { /* Invalid encoding is not a route alias. */ }
  normalized = normalized.replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
  return XUMENG_PAYMENT_INFO_PAGES.find(page => page.path === normalized);
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Fixed editorial strings only; both the Worker and SPA render the same draft. */
export function renderXumengPaymentInfoPage(page: XumengPaymentInfoPage): string {
  const contents = page.sections.map((section, index) => `<a href="#${escapeHtml(section.id)}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(section.title)}</a>`).join("");
  const sections = page.sections.map((section, index) => `<section class="community-rule" id="${escapeHtml(section.id)}" tabindex="-1" aria-labelledby="${escapeHtml(section.id)}-title"><div class="community-rule-number">${String(index + 1).padStart(2, "0")}</div><div><h2 id="${escapeHtml(section.id)}-title">${escapeHtml(section.title)}</h2>${section.paragraphs.map(paragraph => `<p class="payment-info-paragraph">${escapeHtml(paragraph)}</p>`).join("")}${section.items ? `<ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}</div></section>`).join("");
  const pageLinks = XUMENG_PAYMENT_INFO_PAGES.map(item => `<a href="${item.path}"${item.path === page.path ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("");
  return `<style>.payment-info-page .payment-info-draft{padding:14px 18px;margin-top:25px;border:1px solid #66502a;border-radius:10px;background:#221c12;color:#f4ddb1;font-size:14px;line-height:1.8}.payment-info-page .payment-info-paragraph{font-size:15px;line-height:1.9;margin:0 0 16px;overflow-wrap:anywhere}.payment-info-page .payment-info-contact{overflow-wrap:anywhere;text-decoration:underline;text-underline-offset:4px}.payment-info-page .payment-info-footer-nav{display:flex;flex-wrap:wrap;gap:4px 20px}.payment-info-page .payment-info-footer-nav a{min-height:44px;display:inline-flex;align-items:center}.payment-info-page [aria-current=page]{color:var(--community-accent)}.payment-info-page .community-footer{align-items:flex-start}.payment-info-page .payment-info-footer-nav{width:100%}@media(max-width:700px){.payment-info-page .payment-info-paragraph{font-size:14px}.payment-info-page .community-topbar nav{gap:12px}.payment-info-page .community-rule{grid-template-columns:20px minmax(0,1fr)}} </style><div class="community-page payment-info-page"><a class="community-skip" href="#payment-info-content">跳到正文</a><header class="community-topbar"><a class="community-brand" href="/#characters" aria-label="返回晴屿角色广场"><img src="/assets/qingyu/brand/qingyu-mark.svg" alt="" width="34" height="34"><span>晴屿<small>XUMENG</small></span></a><nav aria-label="服务页面导航"><a href="/pricing">方案与价格</a><a href="/support">支持与联系</a></nav></header><main class="community-document" id="payment-info-content" tabindex="-1"><div class="community-intro"><p class="community-eyebrow">晴屿 · 服务说明</p><h1>${escapeHtml(page.label)}</h1><p class="community-lead">${escapeHtml(page.lead)}</p><p class="community-version">审核草稿<span aria-hidden="true"> · </span><time datetime="${XUMENG_PAYMENT_INFO_UPDATED}">${XUMENG_PAYMENT_INFO_UPDATED}</time></p><p class="payment-info-draft" role="note"><strong>草稿 · 待确认</strong><br>本页用于本地审核准备，内容尚待确认。Waffo 正式收款审核尚未通过，人民币月卡尚不能付款。</p></div><div class="community-body"><aside class="community-index"><nav aria-label="本页目录">${contents}</nav><p>一次性购买 · 手动续购<br>不自动续费</p></aside><div class="community-rules">${sections}<section class="community-closing" aria-labelledby="payment-info-help"><h2 id="payment-info-help">需要帮助？</h2><p>请通过支持邮箱联系，并避免发送敏感凭据。</p><a class="community-primary payment-info-contact" href="mailto:${XUMENG_PAYMENT_SUPPORT_EMAIL}">${XUMENG_PAYMENT_SUPPORT_EMAIL}</a></section></div></div></main><footer class="community-footer"><span>晴屿 · 服务说明草稿</span><nav class="payment-info-footer-nav" aria-label="服务与政策">${pageLinks}<a href="/community-guidelines">社区公约</a><a href="/#characters">返回晴屿</a></nav></footer></div>`;
}
