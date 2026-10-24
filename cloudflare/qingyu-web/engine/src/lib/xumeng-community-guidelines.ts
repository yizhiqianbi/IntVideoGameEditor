export const XUMENG_COMMUNITY_GUIDELINES_PATH = "/community-guidelines";
export const XUMENG_COMMUNITY_GUIDELINES_TITLE = "晴屿社区公约";
export const XUMENG_COMMUNITY_GUIDELINES_VERSION = "1.0";
export const XUMENG_COMMUNITY_GUIDELINES_DATE = "2026-10-10";
export const XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION = "晴屿的社区交流、创作发布、隐私保护与举报规则。";

export const XUMENG_COMMUNITY_GUIDELINES = [
  {
    id: "respect", title: "交流有分寸", summary: "可以讨论作品，也可以保留不同的喜好。",
    rules: [
      "评价设定、剧情和使用体验时，尽量说清问题与建议。不要辱骂、威胁、歧视他人，或组织围攻创作者和玩家。",
      "别人拒绝交流后，请停止追问、反复提醒或纠缠。虚构故事中的关系不代表现实中的同意。",
      "不通过恶意举报、拉踩或泄露聊天记录来报复他人。举报应说明具体内容和理由。",
    ],
  },
  {
    id: "publishing", title: "发布前说清楚", summary: "让读者知道自己将看到什么。",
    rules: [
      "为角色和主题选择相符的分类、标题及标签；对惊悚、暴力等可能引起不适的题材提前提示，讨论关键情节时注明剧透。",
      "公开封面、标题和论坛内容不应包含露骨性描写或私密部位特写。不得借创作、任务或评论招揽性服务。",
      "正文、人设和作者说明各司其职。致谢、使用建议与更新记录尽量放在作者备注，避免让玩家把作者的话当成角色剧情。",
      "角色草稿与小说工作台内容不会自动成为公开作品。角色提交审核后，可在创作者中心查看状态与修改意见；论坛主题和回复发布后即公开。",
    ],
  },
  {
    id: "rights", title: "尊重原创与授权", summary: "分享之前，先确认自己有权分享。",
    rules: [
      "只发布自己的作品、已获许可的素材或明确允许相应用途的内容。不要冒充作者、搬运私人角色卡，或删除来源与许可信息。",
      "改编、引用和使用他人图片、声音、角色时，遵守原作者的授权范围，并按要求署名。能在网上看到不等于获得转载许可。",
      "使用 AI 辅助创作时，不伪造作者身份或授权证明；涉及真实人物形象和声音，须先取得适当许可。",
    ],
  },
  {
    id: "safety", title: "守住内容边界", summary: "晴屿面向年满 18 周岁的用户。",
    rules: [
      "不得传播真实的非自愿私密影像、性剥削内容、恐怖主义宣传，或鼓励现实伤害、诈骗及其他违法行为。",
      "不得上传恶意程序、钓鱼链接，或故意绕过内容安全措施。私人创作和 AI 生成同样应遵守适用法律与服务规则。",
    ],
  },
  {
    id: "privacy", title: "保护彼此的隐私", summary: "公开之前，先遮住不该公开的信息。",
    rules: [
      "不要发布他人的电话、住址、证件、支付信息或未经许可的私聊截图；不要冒充他人或要求玩家交出账号凭据。",
      "反馈问题时遮住密码、验证码、API Key、Cookie 和付款资料。完整私人故事不需要贴到公开论坛才能说明一个故障。",
      "不要向陌生人提供账号或收款资料。对于交易和外部链接，先核实来源；社区展示的内容不构成平台对第三方的担保。",
    ],
  },
  {
    id: "fair-use", title: "公平参与社区", summary: "让真正的作品和讨论被看见。",
    rules: [
      "不重复发帖、刷屏、制造虚假互动或批量注册账号刷奖励；不要利用漏洞套取 Credit 或会员权益。",
      "不得在作品、评论或任务中发布垃圾广告、欺诈收款、资源倒卖或诱导交易链接，也不以福利交换点赞和关注。",
      "AI 对话是虚构生成，可能出现事实或剧情错误。它不能代替现实中的专业判断，也不能替任何人作出承诺。",
      "充值 Credit、任务奖励 Credit 与 VIP 每日领取额度按各自规则发放并计入同一聊天余额。涉及费用请以充值页、生成报价与本人消费记录为准。",
    ],
  },
  {
    id: "report", title: "遇到问题怎么反馈", summary: "给出可核对的线索，比争吵更有用。",
    rules: [
      "举报论坛内容：登录正式账号，打开主题详情，点击“举报”并填写理由。若问题在回复中，写明回复作者和相关内容所在位置。",
      "反馈功能故障或对处理有异议：到论坛“站务与求助”说明页面链接、操作步骤、预期结果及实际结果；可附已遮挡隐私的截图。不要公开验证码或支付凭据。",
      "版权问题请说明作品链接、原始出处及授权关系。避免在公开反馈中上传证件、完整合同等敏感资料。",
      "管理员按具体内容核查，可能删除违规主题或回复、退回角色投稿或下架公开角色。审核意见可在创作者中心查看，修改后可重新提交。",
    ],
  },
] as const;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Only our fixed editorial data is rendered; no user content or account is read. */
export function renderXumengCommunityGuidelines(): string {
  const contents = XUMENG_COMMUNITY_GUIDELINES.map((section, index) => `<a href="#${section.id}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(section.title)}</a>`).join("");
  const sections = XUMENG_COMMUNITY_GUIDELINES.map((section, index) => `<section class="community-rule" id="${section.id}" tabindex="-1" aria-labelledby="${section.id}-title"><div class="community-rule-number">${String(index + 1).padStart(2, "0")}</div><div><h2 id="${section.id}-title">${escapeHtml(section.title)}</h2><p class="community-rule-summary">${escapeHtml(section.summary)}</p><ul>${section.rules.map(rule => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></div></section>`).join("");
  return `<div class="community-page"><a class="community-skip" href="#community-content">跳到公约正文</a><header class="community-topbar"><a class="community-brand" href="/#characters" aria-label="返回晴屿角色广场"><img src="/assets/qingyu/brand/qingyu-mark.svg" alt="" width="34" height="34"><span>晴屿<small>XUMENG</small></span></a><nav aria-label="公约页面导航"><a href="/#characters">角色广场</a><a href="/#forum">进入论坛 <span aria-hidden="true">↗</span></a></nav></header><main class="community-document" id="community-content" tabindex="-1"><div class="community-intro"><p class="community-eyebrow">晴屿 · 社区</p><h1>社区公约</h1><p class="community-lead">写自己的故事，也尊重别人的边界。</p><p class="community-scope">适用于公开角色、封面、论坛主题与回复，以及任务中的交流内容。</p><p class="community-version">版本 ${XUMENG_COMMUNITY_GUIDELINES_VERSION}<span aria-hidden="true"> · </span><time datetime="${XUMENG_COMMUNITY_GUIDELINES_DATE}">${XUMENG_COMMUNITY_GUIDELINES_DATE}</time></p></div><div class="community-body"><aside class="community-index"><nav aria-label="公约目录">${contents}</nav><p>参与须年满 18 周岁。<br>发布前请先阅读相关条目。</p></aside><div class="community-rules">${sections}<section class="community-closing" aria-labelledby="community-update-title"><h2 id="community-update-title">公约更新</h2><p>公约会随产品和社区需要调整，本页标明版本与更新时间。它说明社区参与和公开发布的规则，不代替充值页的费用说明。</p><a class="community-primary" href="/#forum">返回论坛<span aria-hidden="true"> →</span></a></section></div></div></main><footer class="community-footer"><span>晴屿 · 社区公约</span><a href="/#studio">创作者中心</a><a href="/#recharge">充值与 VIP</a></footer></div>`;
}
