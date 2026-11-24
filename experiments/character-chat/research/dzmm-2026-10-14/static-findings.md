# DZMM AI 与提示词工程：公开客户端静态核验

核验日期：2026-10-14（Asia/Shanghai）。此稿仅分析 DZMM 首页实际声明、以及已下载 JavaScript 实际声明的公开资源。未执行目标脚本，未登录测试聊天，未调用私有或登录态 API，未读取用户凭据或聊天存档。结果是客户端结构与产品公开说明，不能直接代表后台最终实现。逐项原始短段在 [extracts.json](extracts.json)，每项包含来源 URL、文件 SHA-256、UTF-8 零基字节位置与一基行号。

## 结论先行

DZMM 的角色扮演工程在公开客户端里呈现为「结构化角色卡 + 多套开场/示范对话 + 可组合预设/世界书 + 模型与会话设置 + 逐次生成诊断」。它不是一个只能改大段 system prompt 的编辑框。最值得借鉴的是把各层分开，并允许核对每轮究竟注入了什么。

当前证据不能确认其上游基础模型、私有系统提示原文、世界书后台匹配算法或记忆压缩算法。能确认一个客户端专门识别的模型别名族 `x-apex-sigma-0417`（可带 `-数字k` 上下文后缀），并为该族设置默认风格 `apex_dry`。这个名字不等于供应商模型名，不能推断为某一款 Grok、Claude、Gemini 或微调模型。

## 1. 产品面与调用链要区分

主页入口 D12 路由异步加载聊天、角色编辑与预设编辑页面。聊天列表组件 B28 按 `P.type` 选择不同页面：`agent` 进入 C58；普通 AI 角色进入 `ee`，该导出来自 Dm7。C58 内含念白 agent 的工具展示与 AI SDK 通用 transport。其 SDK 构造器默认 `/api/chat` 不能拿来宣称普通角色的实际请求地址。

真实角色页 Dm7 调用共享流订阅函数 `fr({chatId, streamId, signal, callbacks})`，callbacks 有 `onToken`、`onStep`、`onCompaction`。这可确认生成 ID、流恢复/增量显示与整理前情进度的客户端生命周期；具体 transport 与服务端处理仍在共享依赖/后台，不在这份精选源码中。

静态依据：[chat.product.branch](https://www.dzmm.ai/assets/B28hEJCi.js)，UTF-8 byte 87614，line 4（SHA-256 见文末源表）；[chat.role.import](https://www.dzmm.ai/assets/B28hEJCi.js)，UTF-8 byte 3562，line 2（SHA-256 见文末源表）；[role.stream.callbacks](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 24909，line 32（SHA-256 见文末源表）；[agent.sdk.default](https://www.dzmm.ai/assets/C58mxSVt2.js)，UTF-8 byte 117206，line 38（SHA-256 见文末源表）。

## 2. 角色卡不是一句「你是一个可爱的女孩」

角色编辑器默认对象明确标记 `spec: chara_card_v3`、`spec_version: 3.0`。其中有 `name`、`description`、`personality`、`scenario`、`creator_notes`、`system_prompt`、`chat_history`、`character_book`、图像与语音等字段。空卡的 `system_prompt` 是空字符串，这是作者字段的初始值，不能代表后台 system prompt 也为空。

`chat_history` 可保存多份有名字的场景，每份包含 `messages` 与 `role/content`。校验要求至少有 AI 消息、最后一条不能是用户消息。导入兼容 `first_mes`、`alternate_greetings` 等开场字段。公开写作指南明确建议用多种场景展示期望的语气、态度、互动方式和不同反应，并说新聊天可随机选择开场。随机机制在本次客户端中只是公开指南与 `fixedRandomIndex` 创建字段，未验证服务器如何抽样（B28 byte 88878、line 4，见 extracts.json 的 `chat.create.opening.index`）。

静态依据：[character.ccv3.schema](https://www.dzmm.ai/assets/CT6ZjuS1.js)，UTF-8 byte 3018，line 1（SHA-256 见文末源表）；[character.examples.validation](https://www.dzmm.ai/assets/CT6ZjuS1.js)，UTF-8 byte 17405，line 1（SHA-256 见文末源表）；[character.import.openings](https://www.dzmm.ai/assets/CT6ZjuS1.js)，UTF-8 byte 91749，line 1（SHA-256 见文末源表）；[locale.guide.examples](https://www.dzmm.ai/assets/Bv7Q1B9Q2.js)，UTF-8 byte 74150，line 1（SHA-256 见文末源表）。

### 公开的系统指令模板，是什么性质？

编辑器 `Vn` 通过 i18n key `components.writingGuide.system.template` 读取模板，点击插入时把它追加到角色卡已有 `system_prompt` 末尾；已有模板时禁用重复插入。该原文真实存在于 zh-CN studio locale，而不是从聊天中套出来的私有系统提示。

模板由四个块组成：剧情推进、文风、玩家自主、避免重复。内容强调逐步推进、给出具体变化，在关键选择停下；维持角色/场景风格；不替玩家说话、决定或断言其心理；承接事件并减少复述。它允许对白和叙述，因此是叙事角色创作的通用编辑模板，不宜原样搬到我们的「仅实际说话」陪伴聊天。

这里可以迁移的是「有进展、玩家有自主权、减少复读」三个原则。我们的表面输出仍须限定第一人称日常聊天，把剧情描写改成角色实际能说出的自身状态或下一步，保留状态层而不显示小说旁白。

静态依据：[character.template.insertion](https://www.dzmm.ai/assets/CT6ZjuS1.js)，UTF-8 byte 38182，line 1（SHA-256 见文末源表）；[locale.guide.system](https://www.dzmm.ai/assets/Bv7Q1B9Q2.js)，UTF-8 byte 105445，line 1（SHA-256 见文末源表）；[locale.guide.no_player_takeover](https://www.dzmm.ai/assets/Bv7Q1B9Q2.js)，UTF-8 byte 105784，line 1（SHA-256 见文末源表）。

## 3. 世界书与 Apex 预设是两条不同路径

普通预设采用 lorebooks/entries。编辑器默认 `tokenBudget = 2048`，这是世界书/预设预算字段，不是单条回复最大 token。条目结构有 title、keys、content、enabled、constant、position、insertionOrder、extensions；非 constant 条目必须有触发词，常驻条目保存时清空 keys。角色卡自身也有 `character_book.entries`，校验规则同样区分 constant 与关键词条目。

界面公开了八类注入位置名称：角色描述开头/结尾、系统提示前/后、聊天历史、示例开头/结尾、开场白结尾。它证明这些位置是作者可配置的概念，不能据此声称后台最终拼接必定按某个具体顺序；本次也没有建立数值 position 到标签的完整映射。

Apex 预设切换成另一条编辑路径：`forApexModels: true` 时必须填写 `systemPromptContent`，保存到 metadata；一般预设保存 `forApexModels: false` 与空 systemPromptContent。公开 UI 说明是**替换 Apex 默认内容指南部分，身份与规则部分保持**。可见「内容指南」和「身份/规则」有分层概念，但默认内容指南与固定身份/规则的真实文本没有随这些文件下发。

静态依据：[preset.defaults](https://www.dzmm.ai/assets/Dw5MrdXs2.js)，UTF-8 byte 2145，line 1（SHA-256 见文末源表）；[preset.apex.validation](https://www.dzmm.ai/assets/Dw5MrdXs2.js)，UTF-8 byte 3103，line 1（SHA-256 见文末源表）；[preset.entries.validation](https://www.dzmm.ai/assets/Dw5MrdXs2.js)，UTF-8 byte 3644，line 1（SHA-256 见文末源表）；[preset.entries.save](https://www.dzmm.ai/assets/Dw5MrdXs2.js)，UTF-8 byte 4162，line 1（SHA-256 见文末源表）；[preset.apex.metadata](https://www.dzmm.ai/assets/Dw5MrdXs2.js)，UTF-8 byte 4991，line 1（SHA-256 见文末源表）；[locale.apex.content_only](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 130546，line 5（SHA-256 见文末源表）；[locale.preset.positions](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 130770，line 5（SHA-256 见文末源表）；[character.worldbook.validation](https://www.dzmm.ai/assets/CT6ZjuS1.js)，UTF-8 byte 17913，line 1（SHA-256 见文末源表）。

## 4. 记忆与模型设置：公开说明不等于算法证明

角色页读会话 `model`、`maxTokens`、`deepThinking`、`enableMemoryEnhance` 等状态。切换深度思考或模型时还会结合模型 `maxContext` 调整回复额度。模型列表是动态 categories/modelGroups/contexts，含 internalName、displayName、thinkingSupported、会员支持等字段；精选 JS 没有一份足以确认当前供应商全部映射的固定清单。

公开说明将上下文预算分成「角色卡 + 世界书 + 历史记录 + 输出」，并提示提高 maxTokens 会占掉其余部分空间。记忆增强说明称对久远历史做稀疏化，保留最近对话、优先维持重要脉络，并按模型上下文提供不同消息/文本限制。这些是可以核验的产品说明；没有服务端代码、实际请求或保留/丢弃样本，因此无法证明它采用 RAG、向量库、某种摘要树、专门微调或特定论文算法。

`onCompaction` 与「正在整理前情提要」进度表明当前产品确有客户端承载压缩/整理进度的设计，但不证明每一种模式都调用同一个总结模型。应把记忆增强和 compaction 分开记录。

静态依据：[role.apex.alias](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 56805，line 32（SHA-256 见文末源表）；[role.settings.context](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 75108，line 32（SHA-256 见文末源表）；[role.settings.memory](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 75364，line 32（SHA-256 见文末源表）；[locale.context.budget](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 7667，line 1（SHA-256 见文末源表）；[locale.memory.principle](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 18484，line 1（SHA-256 见文末源表）；[locale.memory.progressive](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 19224，line 1（SHA-256 见文末源表）；[locale.memory.limits](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 19622，line 1（SHA-256 见文末源表）；[role.stream.callbacks](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 24909，line 32（SHA-256 见文末源表）。

## 5. 最值得借鉴：逐次生成的可观测性

普通角色页明确声明两个 GET 端点，但本次没有调用它们：

- `/api/chat/assembly?generationId=...`：客户端读取 record，展示 `finalInput`、`originalInput`、`config`、`generationConfig`；配置展示字段包括 model、provider、source、assembly_mode、request_generation_id/trace_id。
- `/api/chat/lorebook-debug?generationId=...`：按 source/entry 展示关键词命中、原因、estimatedTokens、position/depth，以及 usedTokens/tokenBudget。原因枚举包括未启用、空内容、重复内容、概率未命中、主关键词未匹配、次关键词未满足、预算不足、无插入锚点等。

世界书诊断还区分 aggregate 与具体条目视图。公开文案说明普通视图只展示数量和分类；当前代码提示诊断保留 24 小时。它不是所有用户都能随意查看别人完整 prompt 的证据，权限与数据可见性仍由后台控制。

这比继续给角色卡堆形容词更有工程价值：我们应能查看每轮组装结果、每条记忆为何注入或排除、最近窗口与输出预算、最终交付前丢弃了什么。否则很难分清模型能力差、提示互相冲突、角色卡失效、记忆没有命中，还是消息呈现僵硬。

静态依据：[role.assembly.api](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 106518，line 33（SHA-256 见文末源表）；[role.assembly.final](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 109587，line 33（SHA-256 见文末源表）；[role.assembly.config](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 110065，line 33（SHA-256 见文末源表）；[role.worldbook.api](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 95411，line 32（SHA-256 见文末源表）；[role.worldbook.reasons](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 93401，line 32（SHA-256 见文末源表）；[role.worldbook.visibility](https://www.dzmm.ai/assets/Dm7jYsLH.js)，UTF-8 byte 102148，line 32（SHA-256 见文末源表）；[locale.assembly.explanation](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 67777，line 1（SHA-256 见文末源表）；[locale.worldbook.retention](https://www.dzmm.ai/assets/D58JO2kB2.js)，UTF-8 byte 64735，line 1（SHA-256 见文末源表）。

## 6. 迁移到我们的陪伴 demo 的建议（不是 DZMM 已实现声明）

1. **角色卡与示例分开存储**：人格/经历约束稳定保存；示例按安慰、撒娇、轻松吐槽、忙碌、告别、意见分歧、主动分享等情境组织。每轮只选与当前意图相关、近期没有用过的少量示例，避免示例里的物件或剧情无条件泄漏。
2. **把「说话形式」独立成不可混淆的表面规则**：只输出角色实际说的话；状态和主动事项仍可结构化保存，但不渲染括号动作、角色标签或心理旁白。DZMM 的叙事模板不能直接覆盖这个规范。
3. **输出预算先给对话节奏服务**：默认短句、根据实际内容决定一至三条；放大 maxTokens 或思考预算不能代替自然表达。关系阶段只约束称呼、承诺与已建立的事实，不压低关怀温度。
4. **先补每轮 prompt 检视和对比评测**：显示最终角色层、关系层、记忆层、主动事项、示例来源与采样参数；用同一输入多轮试聊比较重复率、旁白率、连续追问、角色越界与主动因果链。不要把少量功能测试通过等同为足够可爱。

## 证据范围与未确认项

这份手工静态分析与 root 独立运行的 REA 证据分开。REA 对路由精选源码成功解析，不代表已复原全站依赖；其 application/semantic coverage 为 partial，存在动态/未抓取依赖。本稿不声称 REA 获得了后端私有提示或解出了真实模型。

未确认：实际模型供应商和版本；模型是否微调；默认 Apex 内容指南、固定身份规则原文；完整 server assembly 顺序；worldbook 匹配实现；记忆选择/摘要算法；实际请求采样参数 temperature/top_p 与其默认值；角色回复多气泡是否由模型原生输出还是后处理拆分；离线主动调度算法。

采集器早期把 Vite mapDeps 的 `assets/` 路径多拼了一次而出现失败记录，这是本地 URL 解析错误，不能作为原站资源缺失结论。本文的源码主张只采用已经成功保存、可复核 SHA 的文件。

## 源文件 SHA-256

以下均为本次成功下载的官方公开 JavaScript；哈希是文件字节的 SHA-256。每项主张的位置及短段均可通过 extracts.json 重定位。

| 官方资源 | SHA-256 |
|---|---|
| [D12SqV8q.js](https://www.dzmm.ai/assets/D12SqV8q.js) | `5dfcb47b825471d5aa49e26333aeef04826ce688702874631f223c794938f420` |
| [B28hEJCi.js](https://www.dzmm.ai/assets/B28hEJCi.js) | `96ce4d844266606a9b0d182f5e3a8d146477bdf654351af1f7ab92a11fb3eab7` |
| [CT6ZjuS1.js](https://www.dzmm.ai/assets/CT6ZjuS1.js) | `815b298adf38ec7d37361ddc4cf25ed1d3564d03db24edf366365adf570cd641` |
| [Dw5MrdXs2.js](https://www.dzmm.ai/assets/Dw5MrdXs2.js) | `d5826464bd6237c1b9b6f68fddbe783dfc9bd6a75c43c8b53eaa8be026e286fe` |
| [Bv7Q1B9Q2.js](https://www.dzmm.ai/assets/Bv7Q1B9Q2.js) | `ddaf04d2b5d53e54d2825ee19ec4da7357b6aad4c07b918ffac0aa78839af415` |
| [D58JO2kB2.js](https://www.dzmm.ai/assets/D58JO2kB2.js) | `5e6e69940d27153452b512955969699710d2097fd785424a42030ad9fb8c52d1` |
| [Dm7jYsLH.js](https://www.dzmm.ai/assets/Dm7jYsLH.js) | `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53` |
| [C58mxSVt2.js](https://www.dzmm.ai/assets/C58mxSVt2.js) | `fd3d4c54629f56d0069e34f4d20f91df1297e7878e25a2e495bc0cba276c009f` |
