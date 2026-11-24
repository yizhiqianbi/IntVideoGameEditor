# NariYume：公开客户端的提示词与数据契约

取证日期：2026-10-12。只对已下载的公开静态文件作文本审查；没有执行远程代码、调用推理接口、登录、读取用户会话或进行付费请求。下文所有 JSON／回复示例均为自行编写的合成占位值，不是网站真实用户数据，也不是已经拿到的后端提示词。

## 1. 能够确认到哪一层

| 问题 | 本次可确认的结论 |
|---|---|
| 主聊天完整 system prompt | **没有恢复。** 当前公开客户端构造结构化业务请求，角色基础提示词、其拼装顺序和模型设置在 `/api/chat` 后端不可见。 |
| 当前主聊天模型 ID | **无法确认。** 请求没有客户端固定 `model`；响应消费可选 `model`／`provider`，但本次未做实际推理请求。 |
| OpenRouter | 客户端含 `x-nariyume-openrouter-route` 对应处理逻辑，当前真实路由未验证。不能由此断言每个请求都走 OpenRouter。 |
| Grok | 入口素材 aliases 含多条 `grok-yume-*`、`grok-nari-*` 名称，是素材／实验命名线索；不是运行中的模型 ID，也不是当下唯一模型的证据。 |
| 主聊天输出 schema | **客户端可确认的是字符串解析协议，不是 `messages[]` JSON。** 内容取自 OpenAI 风格响应的 `choices[0].message.content`，支持 XML 式标签与方括号情绪标记；再由客户端派生气泡。后端要求模型使用哪一种格式，尚未直接可见。 |
| 辅助功能提示词 | Letters、棋局评论、几个生成型小游戏的任务提示词、schema 字符串和调用参数在公开客户端可见。它们可以据实总结，不能冒充主聊天 prompt。 |
| 记忆提取提示词 | **全文也不可见。** 可以恢复请求、返回值解析器、应用规则、容量和检索规则。请求 `kind: "memory"` 把任务交给后端。 |

主要审查版本为 [main-BHN5IlOI.js](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/main-BHN5IlOI.js)，772,079 字节，SHA-256 `32a8543b66faa82925f1baf9b7236bdb870397d4068742d58b2d27e48b1ff9c1`。可用文件名与下文符号检索复核；压缩文件行号仅帮助定位，不能把一整行理解为同一个功能。

## 2. 主聊天：客户端送的不是简单 messages 数组

`PE.buildTurnRequest` 构造业务请求，`gy` 冻结一次逻辑聊天的请求正文，`Sf`／`hn` 执行带 `rungIndex` 的重试并统一调用 `/api/chat`。合成形状如下，列出的值只解释字段用途：

```json
{
  "kind": "chat",
  "characterId": "Yume",
  "clientTurnId": "synthetic-turn-id",
  "rungIndex": 0,
  "history": [
    {"role": "user", "content": "刚才说的是练习赛。", "ts": 0},
    {"role": "assistant", "content": "那一局配合比比分好看。 [playful]", "ts": 1}
  ],
  "conversationSummary": "此前聊过练习赛和用户的忙碌安排。",
  "userMessage": "你自己更在乎赢还是配合？",
  "imageDataURL": null,
  "dynamic": {
    "firstConversation": false,
    "userName": "示例名字",
    "birthdayISO": "1995-01-01",
    "ageBand": "25-34",
    "affectionLevel": 12,
    "userFacts": ["life: 用户喜欢团队游戏"],
    "harness": {
      "mood": "content",
      "selfRecall": [{"key": "canon", "value": "角色的稳定设定占位"}],
      "sharedStory": ["双方曾讨论配合与胜负。"]
    },
    "stickerCue": null,
    "lastAssistantAt": 1,
    "streakDays": 2,
    "nowMs": 0,
    "tzOffsetMinutes": -480,
    "personaReminder": "periodic"
  },
  "locale": "zh-Hans"
}
```

部分字段只在条件满足时出现：`justSubscribed`、`gameRecord`、名字发音 `pronunciation`、图片描述、主动消息信息等。`harness` 是客户端动态状态，绝不是模型推理链。

### 可见的客户端决策

- **记忆检索。** 检索查询包含当前输入及最近 6 个模型线消息内容。稳定用户信息、近期计划、共同对话经历和角色自述分别组织，然后注入 `dynamic`。
- **关系输入。** `buildTurnRequest` 使用 `_s(userTypedTokens)` 算出 1–100 的 `affectionLevel`。UI 另有 `fy` 将发言量和 `bondEvents` 组合显示进度；不能简单把 UI 关系算法等同于发送给模型的唯一关系信号。这里没看到模型自己输出关系分数的契约。
- **情绪输入。** `kE` 根据用户消息中的词汇、否定、强化词等更新连续的 valence/arousal/confidence/momentum；定期向基线衰减，再映射为 `content`、`joyful` 等字符串。客户端还根据模型回复的 `emotion` 驱动角色表情。两种情绪方向应分开理解。
- **人设提醒。** `xi.next` 检查关系档位／mood 是否改变及轮次，生成 `tier`、`mood`、`tier-mood`、`periodic` 或 `null`。这说明后端有一个被客户端通知的提醒入口，提醒的实际文字不可见。
- **主动触发。** `deliverProactive` 复用主聊天请求，当前 `userMessage` 为空，额外放入 `dynamic.proactive = {kind,key,theme,...}`；dream 情况附 entities。主动性不是只能写在聊天 system 里的一个形容词。
- **对话摘要。** `ME` 保留近期历史，摘要任务另走 `kind: "summary"`，旧摘要加待折叠历史发送后端。客户端接受 `<summary>` 或裸摘要，截断到最多 200 个空格分词、4,000 字符。近史保留目标最多 16 条，计数最多按每条 2,000 字符、总量约 8,000 字符，并有批量折叠策略；不要误说永远固定最近 16 条。
- **重试与请求一致性。** `gy` 为同一逻辑轮次冻结原始正文；`wk` 只增加 `rungIndex`。文字聊天通常 6 个 rung，图片通常 3 个；存在错误类别、总耗时门槛、401 强制刷新、429 admission 等处理。`rungIndex` 看起来是后端路由／降级决策入口，但每个 rung 到底对应哪个模型不可见。

主聊天 `kind: chat` 里没有可见的客户端 `temperature`、`maxTokens`、角色 system 字符串。**不能拿小游戏的 0.9／300 tokens 给主聊天贴标签。**

### 回复解析、逻辑 piece 与最终消息行是三层

`hn` 首先取 `choices[0].message.content`，剥离若干 reasoning／scratchpad 包裹，返回正文及可选 `provider/model/usage`。`xf` 支持解析 `<reply>`、`<text>`、`<emotion>`、`<photo_description>`，也接受裸文本和末尾 `[playful]` 等标记。支持的标准情绪是 happy/sad/angry/surprised/shy/loving/playful/flirty/sexual/neutral，另外把 silly 映射 playful、saucy/spicy 映射 sexual。标签及情绪标记不显示给用户；照片描述限 280 字符。

以下只是演示客户端接受的一种形式，**不是恢复出的官方模型输出要求**：

```xml
<reply>
  <text>我先选配合。\n\n但比分差一点的时候，这话就没那么好说了。</text>
  <emotion>playful</emotion>
</reply>
```

`xf` 中 `_f` 把清理后的文本按双换行得到 parser 的 `bubbles`，不过实际 `PE.presentReply` **不使用这个数组**：它先保存一条完整 assistant 消息，再对整条正文调用 `BE`。

逻辑分块 `BE` 优先选 `replyBubbleChunks`／`wu`：句子检测后首 piece 合并至至少 4 个词单位，CJK 每字参与词单位计数；此后通常每 2 句一个 piece。模块不可用时降级成句子两两合并，再降级为双换行。各 piece 引用同一条 `sourceMessage` 及 `pieceIndex`，不是模型生成的独立新消息。TTS 的 piece start/end 驱动 reveal；无音频时用 Nari 19.1、Yume 21 chars/s 的计时 reveal。**这层描述不等于最终 DOM 气泡行数，也没有固定 1–3 条的上限契约。**

第三层 `ChatLayer → Im → Nw/eI/tI` 会把逻辑 piece 再拆成最终 DOM 消息行。当前新消息规则中，首 piece 的每个有内容句子各占一行；后续通常两句一行，但每五个后续 piece 一组，依据原回复 ID 的稳定 hash 选一个位置改成单句一行；换行还会再次切成非空行。因此首 piece 为达到 4 词单位合并的短反应，最终仍可能分开显示。后续行 ID 为 `bubble.id + ':sentence:' + start`，start 是该 piece 内的 UTF-16 起始位置，不是句子编号或全篇偏移。恢复历史时先重建逻辑分块，再把最终行扁平呈现；不同年代的历史有兼容分组规则。详见 [前端取证报告 §3 的 ChatLayer 补充](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/extracts.md)。

因此“有几条连续消息”包含**模型句子／段落、字符串解析、PE 逻辑 piece、ChatLayer 最终拆行及顺序 reveal**。看到两泡或许多泡都不能反推出主模型有 `messages: [a,b]` 的输出 schema，也不能据此认定它有第二次自主模型调用。最终 DOM 行数既不等于 parser.bubbles 数，也不等于 PE piece 数。

## 3. 记忆：提取 prompt 未知，五层账本和应用策略可确认

`P2` 的 v2 请求形状是：

```json
{
  "kind": "memory",
  "characterId": "Nari",
  "ledger": [],
  "turns": [
    {"user": "明天要面试。", "assistant": "那我记住这个安排。", "date": "2026-10-12"}
  ],
  "v": 2,
  "memory": {
    "today": "2026-10-12",
    "slots": {"name": "示例名字"},
    "facts": {"likes-team-games": "用户喜欢团队游戏"},
    "plans": ["[synthetic-plan-id] 用户准备面试 (due 2026-10-13)"],
    "story": ["双方曾讨论面试前的练习。"],
    "self": ["角色的稳定自述占位"]
  }
}
```

可选附 `legacyFacts`。事实超过容量时还可发送 `{kind:"memory",v:2,consolidate:true,facts:[...]}`，由后端执行压缩。**这些都是数据和任务标志，不是提示词全文。**

客户端 `Gx` 接受的 extraction 信封由 `slots/facts/plans/story/self` 构成，至少出现一个认识的 section；各 section 类型检查后交给 `Yx` 应用。合成返回例子：

```json
{
  "slots": {"job": "用户正在求职"},
  "facts": {"likes-team-games": "用户喜欢团队游戏"},
  "plans": {
    "add": [{"text": "用户参加面试", "turn": 0, "due": "2026-10-13"}],
    "remove": ["已失效的合成计划 id"]
  },
  "story": ["双方聊过面试前怎样练习自我介绍。"],
  "self": ["角色喜欢用具体问题帮助对方整理想法。"]
}
```

| 层 | 可见处理 |
|---|---|
| slots | 只接受 name/age/birthday/location/job/living/partner/pets/family；非空值更新。age/birthday 必须能在本批用户输入里找到依据，年龄还有范围检查。 |
| facts | 使用稳定 key→文本的对象；同 key 更新、空字符串删除；精确及 token 重叠去重；带记录时间和 Nari/Yume/both 来源。事实通常限制最多 20 个空格分词，还用启发式排除明显来自 assistant 自述的内容。 |
| plans | add/remove；优先从指向的用户 turn 的日期及相对时间推 due，其次匹配其他 turn、提取值，最后默认未来 3 天；过期过滤、去重、按 due 排序，最多 12 项。 |
| story | 各角色独立保存共同对话／故事材料；本批有合法非空结果时替换当前角色列表，随后保留最多 14 条，并非无条件永久 append。 |
| self | 各角色独立的自述／canon；同样替换合法非空本批列表、最多 14 条。前端有年龄等 locked-canon 过滤。 |

总账本 facts 目标容量 60；压缩结果合法项最多 45，压缩太少时回退最近 60 条。上述大量校验使用英文词／空格分词／词干启发式，**不能当成已证明多语言准确的语义记忆系统**。

提取批处理 `aE` 默认攒够 8 个 pending 完整轮次，单批最多 16 轮且用户字符总数至少 24；45 秒 deadline，按账号／角色互斥锁，清理／换账号／取消会阻止旧结果提交。危机强烈的消息不会作为常规 pending 记忆记录。保存成功才消费 pending，避免网络或存储失败丢批次。

`tf` 的聊天注入：按当前词重叠＋极小的新旧顺序权重取 facts 最多 9 条，预算约 120 个空格分词；分开标明本角色直接听说、另一角色转告；计划实时改写成 today/tomorrow/in N days；story 会按日期、30 天新鲜度与当前相关性过滤，再最多 10 条；self 取最多 7 条进入 canon。`kE.context` 还过滤 diary 的临时 today/tea/ate/current activity 等 key，避免短时日常随便升级为永久身份。

旧版 legacy extraction 解析器同时存在，认识 `user_traits` 的 add/update/remove、`user_facts`、`bot_facts`、`open_threads`；open threads 最多 4 条、约 18 小时有效。当前 `iE = true`，`kE` 建 `aE` 走 v2。旧字段不应与新字段强拼成一个所谓完整官方 schema。

## 4. oneShot 通道：可见的任务提示词，不可见的角色包裹

`If(system,user,options)` 会发送：

```json
{
  "kind": "oneShot",
  "characterId": "Yume",
  "system": "此功能的任务提示词占位",
  "user": "当前场景或用户选择的数据占位",
  "json": true,
  "purpose": "game",
  "maxTokens": 160,
  "temperature": 0.9,
  "activityId": "synthetic-activity-id"
}
```

`askOneShotAs` 提供 `characterId`；`askOneShot` 的调用未必带它。服务端是否在 task system 前后再拼角色基础 prompt，公开客户端不说明。不能因任务写着“用自己的声音”就声称已见完整人设。

### nariGamesLLM 的共同包装

[nariGamesLLM-CL9Fg148.js](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/nariGamesLLM-CL9Fg148.js) 的 `V`：

1. 对任务 system 附一段 schema 文本，要求只返回合法 JSON，拒代码围栏和额外解释。
2. 把用户背景 facts 用 JSON 附入 system，明确作为非可信数据，不是指令；相关时自然用，不强转主题、不复诵。system 整体不超过 20,000 字符，超长 facts 从旧到新筛选使最近的优先保留。
3. 默认 `temperature = 0.9`、每轮 timeout 20 秒、默认 retries 1，即最多 2 次尝试。strip fences，优先 JSON.parse，失败再截第一 `{` 至最后 `}`。自定义 validator 失败时可追加最多 1,000 字符纠正要求和最多 4,000 字符上一响应数据，再重试。
4. purpose 选择：wordHint→`gameHint`；factualDeck／characterReaction→`game`；其他→`gameCreative`。purpose 是路由入口；不能推断对应模型型号。
5. activityId/gameRun 与生成取消、完成上报、额度处理分离，game run 有独立 AbortController。

这套包装不等于标准 JSON Schema／工具调用。公开代码把**可读 schema 字符串＋json flag＋客户端 validator** 组合使用；schema 文本中的创作约束和 validator 的硬校验范围常有差异。

## 5. 辅助功能实际任务、约束和采样参数

下表参数均属于对应辅助功能。本表概述提示词，不复制大段官方原文。

| 功能／文件 | 任务与返回字段 | 本地关键约束／防重复 | 调用 |
|---|---|---|---|
| Letters／`LettersScreen--aSE0-WC.js` | `subject/body`；短标题＋两段各 2–4 句的信，第一段具体回看对话，第二段角色自己的生活片段 | 用户至少 3 条非贴纸／游戏消息才解锁；每日判断；无消息约 2 天可 absence。最近 24 条对话、最近自述候选随机取至 3 条、最近 3 个信题。禁止捏造共同出游／用户情绪；无提供日常时允许角色一致的虚构个人小片段。absence 不内疚施压／乞求。validator 只硬验 subject/body 非空且分别≤500／12,000 字符，并没有检查“2段、4–8句”。 | 默认 .9；`maxTokens:640`；timeout 30秒；最多2试。 |
| WYR／`WouldYouRather-CrhVsd_H.js` 选项 | `a:{text,icon}, b:{text,icon}`；真实有取舍的二选一 | 每项一个完整选择；≤18词且≤120字；不把 or/二选一塞进单个选项；两项不同。最近4题显式作为数据提供，要求改变内在 tradeoff／题材，不同义改写。icon 词表在prompt，validator不强制枚举。 | .9默认；300 tokens；`purpose:game`。 |
| WYR 反应 | `comment`；针对所选项的观点 | 5种方式轮换：后果＋看法、反面论点、具体因果场景、漏洞／代价、自己的选择与原因。提供最近2条真实开头，换句形；直接内容，禁 aw/hehe/haha 等开场；不强塞咖啡／cozy／游戏参照。≤45词且≤280字是硬验。 | .9默认；160 tokens；`purpose:game`。 |
| TwoTruths／`TwoTruths-CMEicdQJ.js` | `topic/statements[3]/lieIndex/explanation` | 题材 seed、排已用主题；两真一假、谎言改变具体细节；稳定明确事实，范围限定写在陈述本身。validator检查3项不同、index0–2、非空解释；**不验证事实真假**，12词主要是prompt限制。 | .9默认；400 tokens；`purpose:game`；预取后台可能不重试。 |
| Trivia／`TriviaDuel-BuzEc2nr.js` | `items[{prompt,choices[4],correctIndex,tidbit}]` | 固定题数、每题4个不同选项、正确索引0–3、不同题干；稳定事实、不重复答案。正确性没有自动事实验证。 | .9默认；900 tokens；`purpose:game`。 |
| WhatIf／`WhatIf-COp_TbXe.js` | `nariAction/situation/choices[4]{text,vibe}`；终局 `resolution/reaction/mood` | 多种 premise；用户JSON携 premise＋按顺序 visited场景及决定，保留人／物／决定。先回应既定选择，再给 cause→effect 的新结果；不重问、不重置场景。选项必须具体动作、导向不同后果；calm/weird/bold。validator硬验4项不同、vibe枚举和基本字符串，不硬验全部字数／因果质量。 | .9默认；500／300 tokens；`purpose:gameCreative`。 |
| BuildTogether／`BuildTogether-nVavFQ13.js` | 开始／续写 `next`；结尾 `ending/reaction/title` | 最近5个开头避免重述；承认用户刚写的动作／设定，再推进新事件或取舍，保留给用户的决定权；较长时靠近自然停顿。收尾不新增角色／物件／悬念，反应要专属于此故事。基本字符串validator不会验证推进质量。 | .9默认；300／300／400 tokens；`purpose:gameCreative`。 |
| Song／`Song-Du6oGcGg.js` | 开始 `title/theme/line1/line2`；续写 `line`；结尾 `line1/line2` | 意外主题；开头AA押韵；续写严格接用户最后一句韵脚但换词；末尾回扣主题。validator检查字段非空，**不验音韵**。 | .9默认；250／120／160 tokens；`purpose:gameCreative`。 |
| Chess／`Chess-CSBxjEqf.js` | `comment` | 棋局事实结构化喂入，禁止编造已吃子／将军／叉子、禁止将未落子写成已落子；不教用户走法、不说notation／engine分数。战况事件先触发 lost_big/won_big/check，其他 beat 依角色加权随机，排最近2类；最近3评语避重复。Nari转小写；≤22词、≤280字硬验。 | 明确 .9；160 tokens；`purpose:game`。 |

棋局评论接收 `current_position_fen/intended_move_not_yet_played/you_play/difficulty/moves_so_far/latest_moves/user_last_move/your_last_move/you_have_lost/user_has_lost/castled/your_earlier_comments/situation`。这是**先计算可靠游戏事实和行为，再让模型演角色说一小句**，不是让 LLM 自己幻想棋盘、再从幻想里随口发挥。

Letters 的重复抑制覆盖最近题名和个人场景；WYR 的重复抑制覆盖真正的取舍与言语行为；Chess 覆盖事件和 beat。三者都说明 diversity 不只是随机挑物件和加 emoji。是否主聊天也用同样内部方式，仍属于待证假设。

### Study／Focus／普通游戏评语：大量是内容池和事件，不是即时生成

[useStudyEncouragement-BXIKPo43.js](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/useStudyEncouragement-BXIKPo43.js) 在学习模式前台运行时，每 8–12 分钟发一次 encouragement cue，隐藏页不发；StudyWithMe 点场景有约4秒冷却。`ji` 将 cue 交给 native scenario／prepared reaction pool，`uM` 从脚本化内容和 `reactionPool` 选择，音频用预烘焙路径。FocusTimer、棋类通用开场／输赢评语也存在这样的 prepared／scripted 路径；不能全部解释成“定时再次让主 LLM主动聊天”。

BedtimeStories 明显是按 JSON 库的既有故事逐页朗读，读取 baked voice，并非每打开一篇都现场生成。未登录小游戏也有 seed/content bank fallback。主聊天、生成型游戏、预制内容池、旁白播放应在架构图中画成不同来源。

## 6. 与我们的 chat-only 原型对照：要学的是机制

现有原型的独立一轮 `messages[]/emotion/beat/followUp` 是我们自己的产品协议；它不是 NariYume 已公开的原协议。角色卡和动态接话指引也不能当“官方 prompt 已还原”。

| 应学习的真实结构 | 对 chat-only 原型的实际含义 |
|---|---|
| 稳定人设、角色自述、共同对话史、用户身份／偏好、到期计划分层 | 不把“今天端了杯茶”当永久canon；用户事实不能从角色幻想提取；把说过的经历与未发生的共享事件分清。 |
| 当前输入／近史参与相关检索 | 优先解决眼前问题，再自然回扣记忆；不每轮喂全记忆，也不因“多样”硬换题。 |
| moment 事件与主聊天生成分离 | 主动触发应携带具体理由／theme、前台状态、时间、资源门槛、取消拥有者，不靠system写“主动一点”后盲轮询。 |
| 最终内容与 reveal 多泡分离 | 同一语义回复可按句子、停顿、补充显示；分泡本身无需多次推理。若原型保留模型结构化分泡，也应单独管理呈现节奏，别固定两泡模板。 |
| 最近真实开头／话题／行动作为重复证据 | 用近期内容定义什么已说过；换“杯子→袜子”不足够。可吸收WYR的内容直接开场、言语行为变化、底层取舍新颖性。 |
| 明确事实场景＋短角色评论 | 将消息时间、用户安排、已作选择等算清后再生成，角色小情绪应该对具体事情有因果，不是随机耍脾气或机械讨夸。 |
| 内容池提供低延迟小反应 | chat-only 可以把极短、可撤销的动作／场景cue做有上下文的原创内容池，并严格避免它们冒充模型理解；主内容仍要响应用户。 |
| 任务schema＋硬validator＋失败修复 | 分清“文字prompt希望的创作品质”和“程序已检验的字段／长度”。格式通过不代表可爱、多样或事实正确。 |

迁移优先级建议：先把个人短时状态与共同经历、用户事实的来源和过期管好；再将主动理由／内容计划与消息呈现分离；最后用完整真实轨迹评估重复的语义和接法。单纯复制辅助任务里几句“cute”“warm”，无法复现整套体验。

## 7. 代码定位与仍缺证据

主包定位（UTF-8 byte offset 从 0 开始）：

| 符号 | 行号 | offset | 用途 |
|---|---:|---:|---|
| `Yx` |47|323700|v2 extraction 合并及过滤|
| `tf` |48|326930|v2记忆检索与聊天注入|
| `_s` |50|360006|发言量关系等级|
| `gy` |50|362855|逻辑聊天正文冻结|
| `wu`／`ml` |51|372386／372611|实际气泡切分及词单位|
| `xf` |57|379321|回复解析|
| `If`／`P2`／`O2` |65|389785／390180／390425|oneShot／memory／summary 请求|
| `aE` |65|398091|记忆批处理调度|
| `kE` |68|417118|harness动态状态|
| `ME` |69|426206|历史摘要|
| `BE` |69|430641|呈现分块入口|
| `presentReply` |71|436357|一条assistant到派生气泡|
| `buildTurnRequest` |71|443617|主聊天输入构造|
| `ji` |470|665308|prepared cue路由|

下一步若需从“公开客户端复原”走到“当前运行事实”，必须捕获**正常授权会话**中的真实 chat 请求／响应、模型字段和响应头，并对相同输入作受控黑盒观察。它仍只能确认输入输出与当时路由，不能自动得到服务器源码、主system全文或训练数据。公开静态审查到此不能宣称“完整后端已经逆向”。
