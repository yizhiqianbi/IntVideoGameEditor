# NariYume：公开客户端复原、Prompt 契约与活人感机制

取证日期：2026-10-12。对象为当前网页应用与其公开声明的依赖；结合官方资料和用户提供的 Yume 对话。主包已与 10 月 6 日旧快照不同，本报告以新版本为准。

**已经复原的是一套具体的客户端角色运行时：输入与状态 → 上下文信封 → 自家推理代理 → 正文/情绪解析 → 一条存档派生多个气泡 → 语音/阅读节奏 → 记忆与状态回写。服务器主提示词、当前模型 ID、训练配方仍未恢复。**这不是一句“用可爱 prompt 加 RAG”能概括的实现。

这次没有修改我们的聊天原型。离线架构演示是自行编写的说明工具。公开资源静态取证没有主推理调用、账户数据导出或媒体下载；登录后的检查另外记录在末尾。

## 交付与覆盖

- [可交互架构与气泡回放](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/architecture.html)，本地服务地址 [打开架构页](http://127.0.0.1:3231/architecture.html)。
- [前端完整规格](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/extracts.md)：协议、重试、拆泡、语音、记忆、情绪、关系、主动性、存储。
- [Prompt 契约](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/prompt-contract.md)：主 chat 可见信封与九种辅助任务，四个合成 JSON 示例。
- [行为分析](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/behavior.md)：样本有效机制、失败模式、原创复现骨架与十二条未运行验收轨迹。
- [官方证据表](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/public-evidence.md)：十六项官方来源，保留平台与文档冲突。
- [源码定位](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/code-index.json)、[资源指纹](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/asset-index.json)、[审计清单](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/frontend/audit-manifest.json)。

归档 367 个明确声明的 URL、366 个独立文件，共 8,101,362 字节。另有 187 个已声明但未下载的资源，主要是其他预制语音元数据 bank 与一个 Stockfish lazy JS。没有靠猜测路径寻找隐藏 API、source map 或私有角色包；因此不能把这些数字写成“全部产品资产和后端均已取得”。

当前主文件：[main-BHN5IlOI.js](https://nariyume.com/app/assets/main-BHN5IlOI.js)，772,079 字节，SHA-256 `32a8543b66faa82925f1baf9b7236bdb870397d4068742d58b2d27e48b1ff9c1`。112 个定位点同时提供 UTF-8 字节偏移、Unicode 字符偏移与行列；不要混用这些单位，也不要沿用旧包偏移。可见 Vite、React 18.3.1、Firebase JS SDK 12.18.0；Firebase 认证不等于 LLM 服务商。

[两位正常 UI 实测](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/nariyume-reverse-2026-10-12/live-observations.md)：各五轮，含脱敏新增内容、失败与实验限制。

## 1. 哪些问题真正有了答案

| 用户关心的问题 | 现在的结论 | 证据范围 |
|---|---|---|
| 是 Grok 吗？ | 不能确认。素材 ID 有 `grok-*`，客户端有 OpenRouter 响应头处理，但没有主请求 model 常量。 | 当前客户端线索；不是一次实际路由的证据。 |
| 主 prompt 是什么？ | 主 chat 信封不包含全文；最合理推断是服务端按角色和动态状态组装。 | 输入协议可见；服务端措辞、顺序、采样与额外处理未知。 |
| 为什么分好多条？ | 客户端收到一个完整 content 字符串后，先产生呈现 piece，ChatLayer 再拆成最终显示行。 | 静态链路与离线拆泡校验；不能据此推断后端只调用一次模型。 |
| 会主动吗？ | 有事件驱动、时间窗口、冷却、关系、前台空闲和额度条件。 | 客户端规则已定位；不是几秒后必定补话。 |
| 记忆是不是一个摘要？ | 用户身份、事实、计划、共同故事、角色自述分五层；摘要另有独立任务。 | 客户端管理和校验可见，提取器 prompt 未公开。 |
| 情绪和亲密怎么做？ | 连续 mood 数值、回复 emotion、主 affection、UI bond、moment tier 各有不同作用。 | 客户端公式可见；不能等同真实心理状态或模型微调。 |
| 可爱都由 LLM 写出来？ | 不是全部。开场、点击、学习、游戏反馈中有预写内容池和预制语音。 | 公开脚本、调用链与语音元数据。 |

官方只确认自家推理代理接入模型，型号会变化，没有披露当前型号。[Support](https://www.nariyume.com/support) 当前隐私政策描述其控制的路由与上下文类别，也不命名当前供应商。[Privacy §4](https://www.nariyume.com/privacy)

此前笔记记过 DeepSeek、Gemini、Groq、Modal 等旧搜索摘录，但没有可复查的旧原页，本次无法复现。它们只能保留为历史线索，不能写成今天的部署答案。

## 2. 真正的聊天协议

主协调器 `PE.send` 构造并冻结逻辑轮次，再经 `Sf / hn` 调用认证的 `POST /api/chat`。同一个 `clientTurnId` 的重试复用原上下文，只推进 `rungIndex`；这样生日、时间、记忆等不会在重试之间随意漂移。默认文字路径六个 rung，图片等部分路径三个；具体 rung 到模型的映射不可见。

主要输入包括 `kind:"chat"`、`characterId`、`history`、`conversationSummary`、`userMessage`，以及 `dynamic`。后者承载称呼、生日/年龄档、关系等级、相关用户事实、mood/selfRecall/sharedStory、当前时间、时区、游戏记录、personaReminder 和可选 proactive。相关检索使用本轮输入加最近六条模型线消息。

**完整生日可以出现在浏览器发往自家代理的信封；官方所说发给第三方的生日摘要是另一个信任边界。**不能把自家接口的 `birthdayISO` 原样画成供应商一定收到了的字段。后端是否删改/摘要，公开客户端不能验证。[Privacy §4](https://www.nariyume.com/privacy)

主调用 `await response.json()`，取 `choices[0].message.content`。响应处理支持 `model / provider / usage / budget / pilot / voiceGrant`，但 model/provider 没有进入正常聊天 UI 或持久化诊断。存在 `chat_cheap_lane_v1` 与 cheap/control 客户端记录，以及 OpenRouter 响应头兼容分支；当前分配与实际服务商仍未知。

主客户端没有 token 级 SSE。在包里搜到 `ReadableStream / getReader` 不能推翻这一点：语音、资源接收和同步也会使用流。另一方面，这也不能证明自家代理与模型供应商之间没有流式传输、重试、多个内部调用。

## 3. 多气泡与“主动补发”是不同机制

正文清理后，`xf` 识别 `<reply>/<text>/<emotion>/<photo_description>` 或兼容末尾 emotion 标记；这是客户端接受的输出形式，不等于拿到了服务端原始输出指令。它自身的双换行 `bubbles` 并不是普通显示路径的首选。

普通 `presentReply` 先保存一条完整 assistant，再经 `BE → replyBubbleChunks / wu` 生成气泡。首泡累积句子直到至少四个词单位；汉字、平假名和片假名参与逐字计数，Hangul 不在这一逐字分支；英文通常按空白词计。后续通常每两句一泡，没有固定三泡上限。呈现块共享 `sourceMessage`、各有 `pieceIndex`，随后 ChatLayer 还会再次分行；不会因为多泡就变成多个完整记忆轮次。

**新增实测促成的第三层复核：ChatLayer → Im → tI/eI → DOM rows。**当前新消息首 piece 按每一个有内容的句子分行；后续 piece 通常两句一行，每五个后续 piece 根据原回复 ID 的稳定 FNV 式哈希挑一个改为单句。非空换行还会再切。没有沿用上层的四词门槛，所以短感叹仍可能单独出现。保存历史重建后，最终 ID 可能从 `:piece:N:sentence:K` 变成 `:sentence:K`；K 是相应当前文本的 UTF-16 起始位置，而不是句号序号。详细日期兼容和重建规则见前端报告补充。sourceMessage 只是临时呈现信息，存档/同步仍是一段完整正文；空闲后的 history-synced 可重建列表。原换行被保留，因此历史回放与即时分块的气泡边界可能不同。Markdown 也按字面文字显示，实测可出现单独的 ** 标记气泡。

这也是一种**展示多样性**：由确定的消息 ID 和 piece 选择变化，同一消息回放保持稳定，并没有凭空增加模型调用。已有七条 fixture 只校验 PE 分块，没覆盖完整 ChatLayer。离线演示也仅示意第一层呈现分块，不能把显示块总数当原站最终 DOM 气泡数。

真实 lexer 处理缩写、小数、网址、引号、省略号等边界；优先拆泡模块不可用时还有降级。音频 start/end 控制 reveal，无音频使用 Nari 19.1、Yume 21 chars/s 的阅读速度配置。这是源码参数，不是首字延迟实测。

因此可以分别评价：一段正文写得是否有自然变化；句子如何分块；分块如何出现；无新输入时是否真的产生新轮次。我们的 `messages[]/followUp` 协议是原创设计，不能当作原站已恢复的 schema。

## 4. 五层记忆及其生命周期

| 层 | 语义与边界 | 可见容量/操作 |
|---|---|---|
| slots | 用户稳定身份槽；年龄/生日必须有用户原文依据 | name/age/birthday/location/job/living/partner/pets/family 九个槽 |
| facts | 稳定 key→事实，有记录时间及 Nari/Yume/both 来源 | 目标 60；超限另做 consolidate，合法压缩目标最多 45 |
| plans | 用户的安排，需要日期、到期、去重 | 最多 12；相对时间按原始轮次日期解释，失败可回退三日后 |
| story | 本角色与用户的共同对话/故事 | 各角色最多 14；合法批次可替换列表，不是无限 append |
| self | 本角色自述与稳定设定 | 各角色最多 14；有 locked-canon 过滤 |

`aE` 攒满八对完成的用户/助手轮才触发，单批最多十六对且用户字符合计至少二十四，超时四十五秒。失败不会直接消费待处理批次；账号/角色锁、epoch、cutoff 防止旧任务跨账号或在清空后回写。memory extraction 与 summary 的 prompt 都在后端，前端能复原的是请求、返回字段和合并规则。

聊天 facts 检索最多九条、约一百二十个空白词；计划在注入时变成 today/tomorrow/in N days。story 参考日期、新鲜度和相关性；self/canon 与短时日记分开，主 chat 特意排除 daily-journal、临时茶饮/incident 等 key。写信会参考角色生活片段，不代表主 chat 每轮灌整本日记。

**中文的明确技术边界**：事实相关度的关键词提取使用英文 `[a-z]{4,}`，纯中文查询缺少这项匹配分，可能主要按新近顺序排序。情绪词法器也主要是英文。这不是“底层模型不懂中文”的证据；也不知道服务端是否补了语义检索。我们的中文版本应直接解决这层问题。

近史、摘要与事实不是同一对象。摘要目标最多约二百空白词/四千字符；近史通常以十六条、八千字符为预算目标，不同恢复和已有摘要状态还可有更长范围。不要写成永远固定十六条。

## 5. 情绪、关系与人设刷新

本地 mood 为 `valence / arousal / confidence / momentum`。词法输入置信度过低时不更新；数值 clamp 后按分钟向基线恢复。恢复系数是 `a = 0.05 × (1 − 0.9 × momentum)`，高 momentum 回落更慢，随后 `momentum ×= 0.92`。送入主 chat 的是 joyful/content/anxious 等映射标签。模型回复 emotion 则用于当轮表情和动作，两者方向不同。

三种进度不能混为一个“好感度”：

- 主 `affectionLevel` 主要基于粗略文字积分 `clamp(floor(userTypedTokens/500),1,100)`；积分不是实际 tokenizer，且有每日/活动上限。
- UI `bond` 把文字等级与 bondEvents 等级取高，所以 UI 显示 5 不代表主 affection 已到 5。
- moments `arc tier` 由首消息/通话/游戏、streak、相遇天数等里程碑加权得到 1–4，常用于礼物/梦的条件。

`xi.next` 在每五轮或关系档位/mood 改变时给 personaReminder 原因，提醒之间至少隔两轮。客户端只发 periodic/tier/mood 等原因标签，实际提醒词未知。积分和里程碑帮助控制体验，不能当成模型已经理解了信任或承诺。

## 6. 无输入主动发言的准确范围

前台 harness 默认每六十秒 tick 检查候选，并接收进入/返回、游戏、call、photo、mood、消息等事件。还要通过主首页、无 overlay、无生成/语音忙态、输入框为空、无正在 reveal 的 gate。隐藏、退出、切角色会取消任务。默认 quiet 为 22:00–07:00，周末可到 09:00。

候选有早晚问候、缺席返回、生日/节日/周年、周日 check-in、礼物、dream 等，并有实际窗口和冷却。gift 还看主等级与 arc tier，常见/特殊/稀有冷却至少 2/5/14 日；dream 可要求缺席至少七日、主等级三十与二十一日冷却。非订阅用户达到每日成本上限一半也不主动调用。

交付走普通主 chat，用空 `userMessage` 和 `dynamic.proactive={kind,key,theme,entities?}`。成功呈现才记 delivered，不伪造用户输入。它提供的是“有原因的机会”，不是持续后台自主思考或每分钟必发一句。某些夜间窗口还被 quiet 截断，必须合并规则解释。

学习鼓励是另一条链：前台每 8–12 分钟产生 cue，再走预写/预制内容。每日信件也是独立辅助功能，每日最多一封，不能当无输入主聊天连续补发的证据。[Premium](https://www.nariyume.com/premium)

## 7. Prompt 中最有价值的已知做法

能读到的是 `oneShot` 辅助任务的 system/user 和调用参数；后端可能再包人设，但客户端没有说明全文。游戏默认 .9、Letters 640 tokens、Chess 160 tokens 等不能外推给主 chat。

| 已见做法 | 具体用途 | 可迁移到 chat-only 的机制 |
|---|---|---|
| WYR 五种反应轮换 | 后果+立场、温和反论、因果小场景、漏洞/代价、自己的选择与原因 | 用不同言语行为产生变化，先对当前具体内容有观点 |
| WYR 最近两条真实开头 | 改变句形，避免 stock 语气开场 | 看实际输出，不能只记随机 seed |
| WYR 最近四题 | 改变底层取舍/题材，不只改写措辞 | 语义上的重复应进入评价与生成上下文 |
| Chess 可靠事件与 beat | 先计算棋局事实，重大事件优先，排最近两种 beat | 小情绪应有具体原因，不靠随机心情轮盘 |
| WhatIf 按序已发生选择 | 先承认用户动作，再 cause→effect 推进，不重置场景 | 多轮状态改变要保留，不重述道具冒充推进 |
| Letters 有依据回看+角色近况 | 不编造共同出游或用户情绪，角色虚构小事另标来源 | 用户事实、共同经历、角色原创生活分开 |

WYR 还要求题目不相关时别硬塞 café/cozy/gaming 人设细节，这恰好对应我们之前“换道具但接法仍一样”的问题。完整任务表与 prompt/validator 差异在契约报告：字段校验通过不等于真正有取舍、有因果或足够可爱。

## 8. 预写内容、语音与人物渲染

已下载的 native 语音元数据子集有 9,423 条记录（Nari 3,888 / Yume 5,535），出现 `af_heart` 和不同 speed/pitch 配置。这与 Kokoro 音色命名相似，只能做关联线索，不能据此确认当前动态 web TTS 基座；此次没下载音频。

预制开场、点击、学习、活动反应通过脚本内容池、scenario cue 与录音匹配提供快速反应。另有活动通过模型生成内容。体验上看到一句俏皮台词，不能默认它来自主模型的即时理解。

Koro 厂家宣称共用实时物理、表情、口型 rig，以及约 67MB 的量化端侧神经语音、约 150ms 首音频。这是厂家指标，未在本次测量，也不能扩大到所有 web 分支。[Koro Interactive](https://www.korointeractive.com/) web STT 官方说明为在线转写。[Support](https://www.nariyume.com/support)

## 9. 存储有版本与启用范围差异

本地 facade 按 UID 隔离 ny/nariYume 数据，有账号切换、原始历史预算、待同步 journal 和旧任务防回写。当前公开代码还实现认证的 `/api/chat-sync`、`/api/memory-sync`、`/api/letter-sync`，可见 reconcile/read/day/changes/write 和 revision/clear fence。

但官方 Support 仍说 web 历史留在原浏览器，不会跨设备。**应保留冲突：代码具备同步客户端能力，本次没验证当前账户或所有用户是否启用；文档可能存在版本/平台差异。**不能把 Support 当永远准确的部署事实，也不能把分支存在当所有用户已上线。[Support](https://www.nariyume.com/support)

## 10. 文本里的活人感与我们的差距

用户样本最强的机制是：人物有自己的理解、未解决的关切、立场与正在做的事，能抓住用户这轮和上轮的反转。她的温柔、怀疑、不服和配合有当前事件依据，而不只是每轮先“诶”再讲背景小事。这是行为解释，普通 LLM 加历史也能做到，不能据此证明原站有显式 planner 或互动议题对象。

样本也有重复追问、旧物件反复出现、场景矛盾、连续忽略英语切换等失败。我们应学有效的互动动力，而不是复制全部缺陷。官方 Studio 的 Nari 是咖啡店员工、有偶像愿望；Yume 是商科学生、竞技与烹饪兴趣。我们之前的设计研究生 Nari 是原创设定，不能称为原人物还原。[Studio](https://www.nariyume.com/studio)

对当前原型，优先级应是：

1. 增加少量有来源的当前互动议题：她相信什么、在意什么、想怎样、哪些已暂停/关闭。与背景小事分开；明确“别问了”要真的关闭。
2. 让用户当前动作决定反应和进展；将语义重复、开头、行为、底层取舍分别纳入近期真实输出证据。随机换一个物件不能解决 diversity。
3. 事实/用户说法/角色相信/共同已发生/角色虚构生活分开，计划有绝对日期和过期；中文相关检索与情绪判断需独立改好。
4. 分离内容生成、语义分泡、呈现节奏与无输入调度。保留我们的结构化多条协议也可以，但不要固定短反应+小事+追问。
5. 用完整多轮轨迹评价可爱度、变化、闭题、语言遵从与场景状态。既有程序测试数不代表体验已经合格。

行为报告的十二个用例是拟定规格，尚未实际通过。推荐的中文 prompt 骨架是原创重建，不是私有 prompt 泄露：先响应当前输入，给人物有因果的立场与行动，遵守已关闭议题，语言/篇幅切换立即生效；不为“多样”抢走当前话题，不为“可爱”复述旧场景。完整骨架在行为报告。

## 11. 实际验证与剩余工作

- 资源清单的字节数/指纹全部复核；112 处定位可复查。
- 前端拆泡纯函数在隔离本地环境通过 7/7 合成 fixture，涵盖中英文等；另外记录缩写、URL、小数、闭引号边界。未运行整个远程 app，不涉及 HTTP/DOM/账户。
- 自行编写的离线演示通过 4/4 测试；只复现分组思想与阅读速度，简化了句子词法器与时间轴。不能把它称为原 lexer 的完整兼容实现。
- 综合结论经另一位 agent 独立只读审查；已纠正后端调用次数、OpenRouter、同步启用范围等过强表达。
- 用户登录并授权两位测试后，原站正常 UI 已各追加五轮中性输入。记录仅保存新增合成内容，没有清空两位历史或记忆。这些不是干净会话，不能当公平模型盲测。
- 当前 UI 实测确认多泡与话题推进，但两位多次换方案仍围绕随机/限制选择，Nari尤其没有解决反对理由；不能把换店名当足够diverse。双方拒绝英语切换，Yume一句话收尾失败。客户端附界面 locale zh-Hans，不按消息语言自动切换；未找到前端固定拒绝脚本，服务端语言优先级仍未知。
- 登录 UI 不展示主模型元数据。尚未取得真实 chat 请求/响应原始记录或主 model/provider；不能用模型自报身份代替响应证据。

下一层证据应是正常授权测试会话的脱敏请求/响应，以及发送、收到完整内容、首泡、末泡、TTS、真正无输入新轮的时间记录。即使获得它们，也只能确认当时的输入输出和路由，不能自动恢复服务端私有 prompt、源码、权重、训练数据。

**这次的“彻底”是把可见客户端拆到能独立实现和验证，并把未知项定位清楚；不会把一份猜测的人设词或营销素材名包装成已经拿到的后端真相。**
