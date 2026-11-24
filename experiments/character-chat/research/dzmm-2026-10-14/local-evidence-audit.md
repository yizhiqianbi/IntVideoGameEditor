# DZMM 既有公开证据与本地实现审计

日期：2026-10-14（Asia/Shanghai）。本次子任务只读取已有文档、公开采集记录与本地源码，未登录原站、调用模型、读取环境变量、私人会话、支付或邮箱认证输出。本文不能替代本轮官网在线复查。

**审计时序更新：**本文离线审计形成后，根代理已在线取得并保存 [Gamefy 官方全文](public/gamefy-llms-full.txt) 与 9 个关键公开 JS，并完成 REA 分析。本轮现行结论与新证据以 [静态分析](static-findings.md) 和 [公开调研](public-research.md) 为准。下文“没有保存官方原文”“未找到原站 bundle”等语句仅描述旧仓库材料与离线审计形成时的状态，不再代表本轮最终采集状态；正文保留用于说明历史证据来源与推断边界。

## 结论

已有材料支持把 DZMM 看成“角色资料 + 开场对话 + 世界书 + 预设 + 用户身份 + 模型/上下文配置”的创作与聊天平台。最值得借鉴的是可组合的上下文结构及明确的作者控制界面。材料没有证明它的聊天效果依赖某份特定的隐藏 system prompt，也没有证明其展示模型名对应哪一个底层供应商或权重。

**当前仓库 `src/lib/dzmm-*` 是叙梦独立实现。它的 Grok 配置、提示词分层、摘要记忆和导演规则都不能作为 DZMM 原站内部实现的证据。** 这些能力可供本项目比较，但引用时应标为“本地已实现”。

已有原站介绍采集提供 41 条公开介绍正文，逐条 SHA-256 全部通过本次离线校验；原始独立角色卡字段全部未取得。另有 10 条本项目原创改写样本，应分开统计。公开介绍原文、可见开场、原始角色卡和服务端隐藏 prompt 是不同材料。

## 可复查的证据分层

| 材料 | 时间与范围 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| [官方线路页](https://dzmm-home.github.io/dzmm-addr/) | 本轮 `dzmm_public_research` 子任务成功读取，2026-10-14 | 同页列出 `www.lumivale.xyz` 国内线路和 `www.dzmm.ai` 海外访问地址，支持旧 Lumivale 快照的关联来源 | 旧快照在 2026-10-14 仍逐项一致 |
| `output/dzmm/source-feature-exploration-2026-10-03.json` | 17 个 UI 状态；根记录 `2026-10-02T17:37:12.867Z`，即北京时间 2026-10-03 | 当时 Lumivale 可见控件、文案及路径 | 后端组装顺序、完整角色卡、全部世界书规则、当前界面 |
| `output/dzmm/source-extra-pages-2026-10-03.json` | 10 个 UI 状态，任务、安装、悬赏、绘图等 | 当时页面的公开入口与控件 | 聊天模型、隐藏 prompt、已经实际执行的生成 |
| `output/dzmm/lumivale-public-collection.json` | 2026-10-02 UTC / 北京时间 2026-10-02；8 条一般向介绍 | 公开“角色介绍”的逐字正文、作者、URL、哈希 | 原始 `systemPrompt` / `personality` / `scenario` / `firstMessage` / `exampleDialogue` / `worldbook` 独立字段 |
| `output/dzmm/lumivale-expansion-2026-10-03.json` | 2026-10-02 UTC / 北京时间 2026-10-03；33 条介绍 | 新批次公开正文及逐条来源 | 全站覆盖、完整原卡、模型请求中实际注入的内容 |
| `src/lib/dzmm-public-introductions-evidence.json` | 41 条记录 | 运行介绍与采集原文的 ID、来源、时间、哈希对应关系 | 原站的内部 prompt 结构 |
| `src/lib/dzmm-character-media.json` | 角色 `3691277` 的公开页面渲染开场和图库 | 当次可见开场文本、图像来源与哈希 | 未展开宏之前的 `first_mes` 原始模板或隐藏卡 |
| `docs/xumeng-dzmm-developer-knowledge-2026-10-10.md` | Gamefy 文档版 `50dd12a6ec4b`，正文注明核对日 2026-10-05；采集日 2026-10-10 | 既有官方开发文档的归纳及精确来源 URL | 本轮重新下载的官方全文、普通角色聊天的私有协议 |
| `src/lib/dzmm-models.ts`、`dzmm-chat.ts` 等 | 本次读取的本地源码 | 本项目自己的模型、prompt、记忆与校验设计 | DZMM 原站的代码或底层模型 |

文件名的日期与 `observedAt` 的 UTC 日期有差异，主要来自北京时间跨日；引用时使用具体采集时刻或明确时区，不把它误写成两轮独立采集。

## 已观察的 prompt 工程入口

以下是旧 UI 快照内直接可见的事实，**不是本轮重新登录验证的现行实现**。

### 世界书与预设

`preset-editor` 快照位于 [原线路预设编辑页](https://www.lumivale.xyz/studio/presets/new)，显示两种选项：世界书预设通过关键词触发或常驻设定条目；Apex 预设替换 Apex 模型默认内容指南。这支持“平台默认指南可由专用预设替换”及“知识不是每轮整段无条件注入”的设计观察。

该快照只看到类型选择与基础世界书入口，未取得 Apex 默认内容指南正文，也未取得完整世界书扩展规则。不能从“关键词触发”直接推断向量检索、递归扫描、注入位置、优先级算法或 token 裁剪实现。

`presets` 快照还有身份设定、我的预设、预设市场三个页签。这说明用户身份与可复用预设在界面上分开，而不是只编辑一份大 prompt。

### 角色作者控制

`professional-role-editor` 快照来自 [专业编辑器](https://www.lumivale.xyz/studio/edit?mode=full&step=basic)，可见性格、说话方式与行为习惯、场景、系统指令、开场对话、世界书，以及推荐模型。推荐模型说明是新建聊天的默认值，玩家仍可切换。

这些是作者可编辑字段的证据；可见字段不等于服务端只用了这些字段。旧记录没有证明最终 system/history/post-history 的实际顺序，也没有证明默认指南与作者指令之间的优先级。

### 上下文与输出额度

`chat-settings` 快照显示回复建议仅部分模型支持；最大回复额度的说明写明，增大额度会挤占记忆、角色卡、世界书和历史消息，思考与正文共用额度。这支持它面向用户暴露了上下文资源权衡。

其中可见 `x-apex-flux-0217-16k` 文本值，仅可视为当时界面的标识，不能据此确定供应商、微调底模、真实上下文长度或后台路由。也不能把我们本地 `x-ai/grok-4.6` 选择器当成这个标识的映射。

## Gamefy：有价值，但适用范围独立

既有 manifest 为 `output/research/ai-xiaoshuo-2026-10-10/source-manifest.json`。它记录：

| 官方资源 | 既有字节数 | 既有 SHA-256 |
| --- | ---: | --- |
| [Gamefy 文档索引](https://www.dzmm.ai/gamefy/llms.txt) | 3,053 | `c1d713e76e0eea267dbcf8d39c2f9cfa8fd1a42026680452247a98c0a244ab5b` |
| [Gamefy 文档全文](https://www.dzmm.ai/gamefy/llms-full.txt) | 244,166 | `4eea23d62c6a2225b70db81b7d6d5a7027602e9328d61588c0048b39bf38c9f9` |

**两项明确记录 `full_source_copied_to_repository: false`。** 仓库有归纳 draft 和 manifest，没有保存可再解析的官方全文。因此这些哈希是历史采集元数据，不能写成“本次对原文重新计算哈希”。本轮官网访问情况应由在线调研报告单独说明。

有用的精确来源及既有归纳如下：

- [AI 对话](https://www.dzmm.ai/gamefy/docs/sdk/completions.md)：Gamefy `dzmm.completions()` 接收 user/assistant 消息，回调内容为累计全文；并非可任意照搬的 OpenAI chat API。
- [动态模型选择](https://www.dzmm.ai/gamefy/docs/recipes/model-picker.md)：区分 `displayName`、`internalName`、目录默认项和当前 Chat 设置。
- [结构化 JSON](https://www.dzmm.ai/gamefy/docs/recipes/ai-json.md)：提示词格式要求后仍需解析与字段校验，失败由本地确定性逻辑收口。
- [安全调用](https://www.dzmm.ai/gamefy/docs/recipes/completions-safe.md)：区分 UI 超时与底层请求结束，避免旧回复覆盖新状态或重复付费调用。
- [服务端函数](https://www.dzmm.ai/gamefy/docs/serverless.md)：隐藏源码不保证模型不会复述指令，权限与秘密不能靠 prompt 保证。
- [聊天存档](https://www.dzmm.ai/gamefy/docs/sdk/chat.md)、[KV](https://www.dzmm.ai/gamefy/docs/sdk/kv.md)：分支 ID、数据归属、写入接受与落盘确认需要明确。

以上属于游戏卡 SDK。不能据此断言 DZMM 普通角色聊天没有 system 消息，也不能断言它的长期记忆与游戏卡 KV 相同。当前陪伴原型使用自己的 Node 后端，移植时需要适配契约。

既有笔记还给出 [Bot 指南](https://www.dzmm.ai/studio/bots/docs/) 和由其声明的 [公开 JS 资源](https://www.dzmm.ai/assets/DQCRp9VJ2.js)。本任务未找到该资源的本地原文或哈希，它描述 Bot 接入，不能作为角色聊天 prompt 的替代证据。

## 本地实现能借鉴的结构

下面全部描述**本项目叙梦源码**，无原站内部实现的断言。

`dzmm-chat.ts` 的 `buildDzmmPromptPlan()` 提供可追踪层次：基础规则与角色 → 当前触发世界书 → 有边界的对话示例 → 开场 → 旧历史摘要 → 近期真实对话 → 作者历史后指令 → 可选世界状态 → 本轮提醒。诊断只记录层名、role、字符数，避免把私人聊天正文写入诊断。

`dzmm-prompt-card.ts` 只展开 `{{char}}`、`{{user}}`、`{{original}}` 三种字面宏；替换内容不再递归解释。对话示例解析成真实 user/assistant few-shot，但用边界提示明确“示例不是本会话已发生的事情”。语气学习和历史事实分离尤其适合陪伴原型。

`dzmm-character-context.ts` 的世界书是明确的关键词子串匹配，支持启用、常驻、大小写、次要关键词和排序；不是向量 RAG。可以参考这种可解释触发方式，但不可称它还原了 DZMM 的全部规则。

`dzmm-story-memory.ts` 的结构包含 summary、scene、completed、pending、relationships、items，并用消息前缀指纹校验摘要来源。编辑、删除、重生成和分支改变会令旧摘要失效。指纹明确是非密码学缓存键，不能当身份认证或事实真实性证明。模型摘要仍可能遗漏或编造事实，字段校验不能解决所有语义误差。

`dzmm-turn-director.ts` 读取近期重复措辞、暂停、过程概述和明确时间跳跃，注入小范围本轮校准。重复统计只作为文风信号，不删历史事实，也不把重复词全部禁用。

### 与“心动陪伴”规范的冲突

本地叙梦是互动故事，`dzmm-chat.ts` 明确允许 NPC、环境及动作描写，导演层还有场景与过程概述。本次用户要求 chat-only、本人直接说话、无第三人称旁白、无括号动作，因此**不能整段复制这份故事 prompt 到陪伴 demo**。

可迁移的是分层、示例边界、来源校验、失效规则和预算。具体生成规则要维持“只输出本人实际说的话”，把角色自身活动改写为“我刚到家”“我想把这首歌听完”这类聊天表述；场景状态应作为模型参考，不直接成为小说旁白。

## 需要更新的旧文档

`docs/dzmm-research.md` 与 `docs/dzmm-feature-coverage.md` 的主要记录止于 2026-10-03，描述本地三个模式同用 Grok、尚无长期摘要等。当前源码已存在多模型目录、结构化摘要、世界状态和导演层，这些旧段落不可作为本地现状引用。它们仍可证明当时的观察范围。

`public/dzmm/brand/sources.json` 现在写的是本项目原创“叙梦”月牙对话 Logo，创建日 2026-10-03。旧研究文档称此路径保存 DZMM 原站品牌来源的段落已不再适用；不能用该文件验证 DZMM 域名归属或原站资产哈希。

仓库中大量 `output/xumeng/.../baseline-dist/assets/index-*.js` 是本项目发布物或 UI fixture，**不是原站 JS**。本任务未找到可交给 REA 离线分析的原站 bundle snapshot。若把这些文件送入 REA，只能分析叙梦自己的实现，并应在输出中标注目标。

## 下一轮最有价值的复查

1. 从官网当前返回的 HTML/JS 和公开文档收集实际引用 URL，保存日期、字节数、SHA-256、入口关系。优先定位聊天 request builder、模型目录、预设/世界书组合逻辑和公开编辑字段，不枚举猜测接口。
2. 拿到作者授权导出的角色卡时，将原始文件与运行转换版分开保存；各字段标明公开原文、作者导出或本地创作。隐藏平台指南仍应标为未知。
3. 在明确授权的试聊里固定角色、关系阶段与测试输入，分别测试字段是否实际发送、模型是否遵循、长期重复与记忆是否失真。漂亮的 prompt 文本或 UI 字段本身不证明回复质量。
4. 迁移到陪伴原型时保持独立模式：学习上下文编排与状态生命周期，避免引入互动故事旁白。用实际同输入对照评估本人对白、亲密程度、多样性和主动事项连续性。

## 本次离线完整性核对

两批公开介绍共 41 条、41 个唯一 ID；原文 UTF-8 SHA-256 全部匹配记录；`originalCardFields` 非 null 字段数为 0。未运行模型调用或原站状态变更。

| 本地证据文件 | 本次计算 SHA-256 |
| --- | --- |
| `output/dzmm/source-feature-exploration-2026-10-03.json` | `12de1fc579bc6f2ab855aa5100ed43aea0ced044d3ddb2bf678c2ba8adeb8ad3` |
| `output/dzmm/lumivale-public-collection.json` | `1c58763df7f7e82b74032f1a6655b38b5cb6309c5c8027e253c5ea03ccc3eab9` |
| `output/dzmm/lumivale-expansion-2026-10-03.json` | `0c8405523bedb24b32dc8593ae46b22040979406bcd3c7669c5f2443294af5fb` |
| `src/lib/dzmm-public-introductions-evidence.json` | `c4b5f897cac59d18c2babbb24e6bc81e6d169178d39fd5032c5336712ce8ac1a` |
| `output/research/ai-xiaoshuo-2026-10-10/source-manifest.json` | `b1659c60bc337550ca800aa989bee5c3d00345d9180ab667c192a30bccb07b83` |
| `src/lib/dzmm-models.ts` | `ac9f11b99b413ae212423b37ade3b2a93789b8f3847ea9891a1f79cebcbe9b62` |
| `src/lib/dzmm-chat.ts` | `a7c21def55d03bade6fdc46c94d75bf1959ea6b0314f67984e9aee4ff7159e0f` |

