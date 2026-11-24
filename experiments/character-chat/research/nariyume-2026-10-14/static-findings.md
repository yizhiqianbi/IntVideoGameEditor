# NariYume 静态逆向报告

核验日期：2026-10-14。对象是 `https://www.nariyume.com/app/` 当前公开发布的 web/PWA 前端及其公开静态资源。源码按惰性文本分析，没有执行下载脚本或调用隐藏接口。REA 静态分析证据：父记录 `ev_b69ddec8d76ccfa7bf877309acde2b83aa90ff3b75d6368e198a6f3c6d5641c9`，摘要投影 `ev_781d9feff6590ce91d7ef2703f3552f891c759e89af4d98905e48de182050bee`；共识别 69 个 JavaScript 文件、4,669,857 个文本字节、808,222 个 AST 节点、1,647 个静态 findings，存在资源预算导致的语义图部分截断。

## 结论先行

NariYume 的“活人感”不是只靠一段角色卡 system prompt。前端把关系等级、情绪状态、近期记忆、共享故事、对话摘要、用户资料、最近活动、当前时间和主动触发事件拼成结构化请求，服务端再完成最终 system/context 组装和模型调用。

它的主动性也不是一个简单的后台 cron。客户端在页面可见、账号状态有效时每 60 秒 tick，并在前台回到页面、情绪变化、关系里程碑、长时间离开等事件上提出一个 proactive proposal，再用同一个 `/api/chat` 入口发空的 `userMessage`。页面隐藏、未登录、额度不足、quiet hours 或有正在进行的对话时不会投递。

## 1. 页面与服务边界

入口 HTML 加载 `browser-entry-507477f023b27913.js`、`index-DeslYIGZ.js`、`measurement-f6742d8c7c426bec.js`，再由入口动态加载 `main-8iZ6nNEb.js` 和角色/游戏/语音模块。公开 `/api/character-meta` 返回角色渲染与语音参数，当前值为：

```json
{
  "characters": {
    "Nari": {"voice":"nari_eng","speed":1.1,"pitchCents":350,"charsPerSecond":19.1,"renderScale":1},
    "Yume": {"voice":"yume_eng","speed":1.2,"pitchCents":500,"charsPerSecond":21,"renderScale":1}
  },
  "ladderRungs": {"chat":6,"vision":3}
}
```

前端使用 Firebase Auth web 配置和 Bearer token；正常聊天请求发往同源 `/api/chat`，记忆同步发往 `/api/memory-sync`，历史云备份发往 `/api/chat-sync`，信件/主动信箱发往 `/api/letter-sync`，语音分别使用 `/api/tts` 和 `/api/asr`。这些端点和请求构造是客户端静态事实；后端 handler、模型路由和 system prompt 未包含在发布包里。

## 2. 普通聊天请求合同

`buildTurnRequest()` 在客户端构造的核心对象是：

```js
{
  characterId: "Nari" | "Yume",
  conversationSummary,
  history: [{ role, content, ts, imageDescription? }],
  userMessage,
  imageDataURL?,
  dynamic: {
    firstConversation,
    userName,
    birthdayISO,
    justSubscribed?,
    ageBand?,
    affectionLevel,
    userFacts,
    harness: { mood, selfRecall, sharedStory },
    stickerCue?,
    lastAssistantAt?,
    streakDays?,
    gameRecord?,
    nowMs,
    tzOffsetMinutes
  }
}
```

随后包装成 `kind: "chat"`，附上 `clientTurnId`、语言、发音设置；失败或重试时追加 `rungIndex`。普通客户端没有把完整 system prompt 放在请求里，说明最终身份指令和模型供应商路由仍在服务端或模型网关。

值得注意的是，这条链路会把可用的上下文结构化地交给服务端：关系等级、情绪、记忆事实、共享故事和近期对话都不是只存在 UI，而是进入 inference request。它和 DZMM 念白的“只提交最新消息”协议不同。

客户端处理响应中的 `choices[0].message.content`，并读取 `provider`、`model`、`usage` 字段；同时读取 `x-nariyume-openrouter-route`、`x-nariyume-gated` 等响应头。**因此只要拿到一次合法 `/api/chat` 响应，模型名可能直接出现在响应 JSON 的 `model` 字段；公开静态包本身没有默认模型名。**

在一次用户自有会话的受控中性请求中，Response JSON 给出 `prompt_tokens=3659`、`completion_tokens=16`、`total_tokens=3675`，缓存 2048 tokens；响应没有给出 `model` 或 `provider`。响应头的 `x-nariyume-openrouter-route` 为 `gateway`，Server-Timing 含 `openrouter` 阶段。该 usage 可用于 tokenizer 差分，但不能单独反推出模型。

缓存量约占本次 prompt 的 56%，与稳定角色/系统前缀和变化 history/dynamic 分开的上游 prompt cache 相容；这是架构推断，不是 system prompt 长度的直接测量。

服务端拒绝或额度错误会被客户端分类为 auth、subscription、context、rate、server 等状态。普通聊天最多使用公开元数据中的 6 个 ladder rung，vision 为 3；`inference_in_progress` 会在短时间内按 `Retry-After` 重试。重试阶梯不能解释成多次独立意图，只能说明客户端允许同一 turn 重新入场。

## 3. 对话历史与摘要

客户端把本地历史按角色合并：相邻同角色消息会合并，assistant 内容会加上 `[neutral]`，游戏/通话事件作为 system 标记保留；最多保留约 80 条 wire message，再按 16 条一组裁剪。

摘要管理器的关键常量是：最近窗口最多 16 条，单条参与预算最多 2,000 字符，总历史预算约 8,000 字符；更早内容由 `/api/chat` 的 `kind: "summary"` 请求生成摘要，摘要最大约 4,000 字符、200 个词左右。没有摘要时，客户端也能生成 `Earlier the user said: ...` 的本地 fallback；出现危机词时会写入固定的 support-resource 摘要标记。

这意味着长期关系感来自三层：短期原始 history、服务端/客户端摘要、结构化 memory graph。它不是把整个聊天记录无限塞进上下文。

## 4. 记忆与关系状态

记忆有两套层：

- `memoryGraph`：事实、实体、关系、story/self 等结构化状态；查询时会按相关性选取最多约 9 条事实、最多 16 条 self recall/canon/shared story 片段。
- `memoryJournal`：本地 pending mutation、版本、冲突、重试与 `/api/memory-sync` 云同步。

每轮回答后，`harness.memory.record()` 收集 user/assistant turn，再通过 `/api/chat` 的 `kind: "memory"` 让模型更新 memory ledger；同步成功与否由 `/api/memory-sync` 独立处理。这说明“模型说我记住了”和“记忆提交成功”是两个生命周期。

关系等级在客户端有明确状态机：`stranger` 1–20、`acquaintance` 21–40、`friend` 41–60、`bestFriend` 61–80、`lover` 81–100。输入文本会折算为 userTypedTokens，bond events、连续天数和解锁里程碑共同影响 affection level；请求里以 `dynamic.affectionLevel` 传入。

## 5. 情绪、格式和“活人感”

客户端会解析模型返回的以下控制结构：`<reply>`、`<text>`、`<emotion>`、`<photo_description>`，也识别 `[happy]`、`[sad]`、`[playful]`、`[flirty]`、`[sexual]` 等 mood 标记。控制标签会从展示文本中移除，但 emotion 会写入本地 reply mood、驱动 avatar 表情/动作，并随 assistant wire 内容记录为 `[emotion]`。

气泡不是直接等于模型调用次数。`jC()` 优先使用打包的 sentence/bubble splitter；没有时以空行切分，或把句子按两句一组；`presentReply()` 为每段创建 piece id，并按语音长度与 reveal timer 逐段显示。它还把破折号标准化为逗号。这种“模型控制标签 + 客户端分泡 + 表情/语音同步”是主要的活人感来源。

## 6. 主动机制

客户端 `wC` harness 在页面前台运行一个 60 秒 tick，记录：消息数、会话数、连续访问、长时间离开、深夜聊天、照片、通话、游戏、情绪变化和 relationship milestones。默认 quiet hours 为 22:00–07:00，周末可延长到中午。

触发器包含：

- 回归问候、早安/晚安、周检、周年和月纪念；
- 连续访问、关系阶段、首次照片/通话/游戏等里程碑；
- 检测到 anxiety/fear/sadness/loneliness 时的安慰或语音礼物；
- 长时间离开后的 returning-after-absence；
- 页面前台、早晨窗口和足够关系等级下的 dream/memoryEcho；
- 活跃对话较少时每分钟约 2% 的 random spark。

主动 proposal 不是任意时刻都能送：`deliverProactive()` 明确阻挡 romance kind，且要求页面可见、账号/存储有效、没有正在生成或正在展示的回复、额度可用。投递时复用 `/api/chat`，`userMessage` 为空，额外加入：

```js
dynamic.proactive = { kind, key, theme, entities? }
```

这解释了为什么产品能表现出“她自己想起某件事并开口”，同时又不会变成后台无限发消息的 cron agent：主动性主要是**前台浏览器 harness + 服务端理解 proactive context**。

## 7. 模型与提示词边界

公开 JS 没有发现 Nari/Yume 的完整 system prompt、developer prompt 或角色卡原文。可以确定的是：服务端至少会看到 `characterId`、history/summary、dynamic relationship/memory/mood、用户资料和 proactive marker；最终人格文本、模型 provider、采样参数、路由与安全规则仍未知。

静态包中出现过 `grok-*`、`grok-nari-*` 等实验/活动键名，但这些是实验标识或内容资产名称，不能证明普通聊天当前使用 Grok。客户端只公开读取响应返回的 `model`/`provider`，应通过合法已登录请求的 JSON 取证。

## 证据边界

### 客户端静态事实

请求路径、请求字段、记忆/摘要预算、情绪解析、气泡切分、前台 tick、quiet hours、主动触发条件、模型/供应商字段读取。

### 合理推断

服务端负责最终 system prompt、模型路由、工具/安全策略和 proactive marker 的语义解释；模型看到的是“关系状态 + memory graph + summary + history + current turn”的结构化上下文。

### 尚未取得

Nari/Yume 的 system/developer 原文、具体默认模型、供应商权重、temperature/top_p、模型是否微调、记忆抽取 prompt、活动/信件的后端调度实现，以及未登录干净会话的真实 chat response。

原始静态文件和 SHA-256 清单见 [evidence-manifest.json](evidence-manifest.json)。在线 UI 观察见 [runtime-observations.md](runtime-observations.md)。
