# 开源角色聊天方案：面向可爱、主动与连续性

核验日期：2026-10-11（Asia/Shanghai）。范围是官方文档、官方仓库、官方 DevLog；四个仓库浅取后只读核验。没有安装或运行这些项目，没有调用模型，没有访问原型密钥或真实用户存档。下面的“已有”指指定版本源码存在，不能据此保证某个在线演示或发布二进制启用了相同功能。

## 结论与原型优先项

目前公开实现最有用的共同设计是：把“角色是谁”“这轮在做什么”“为什么此刻要说话”“怎么送出这几句话”分开管理。可爱由具体偏好、情绪原因、亲近动作和对用户当下内容的反应组成；单独写“可爱、顺从”、调高 temperature 或增加 emoji，没有任何这些项目提供的实证能保证效果。

建议这一轮优先实现：

1. 角色卡提供稳定但有区分的喜好、说话习惯、可执行的小愿望，以及多种真实聊天节奏的例子。轮末只注入一个当下情境与说话动机，不把长篇要求全部压到尾部。
2. 维护少量有来由的角色状态：当前念头、未完成的小话题、期待、上一次主动话题和冷却次数。用户事件决定状态变化；不把任何一句话统一解释成委屈或焦虑。
3. 主动生成前先检查有没有可说的新内容：承接用户提过的事、兑现刚才承诺、角色当前小念头。允许安静；有内容才能消费主动机会。限频、忙碌/休息暂停、输入优先仍需服务端保护。
4. 一次生成直接输出 1–3 条完整手机消息；兴奋反应、补一句、轻微自我纠正才多条。前端按长度与语义播放。不要复制 AIRI 的第二次 LLM 拆句请求，否则会增加首轮延迟与费用。
5. 对话状态和事实记忆分开。来源清晰的旧事件按重要性、近期、相关性预算召回，并保持时间顺序；暂停/结案话题与说过的梗有冷却记录。语义防重复比只惩罚 token 更适合避免“又一杯奶茶”“又一只杯盖”。
6. 验收用真实模型长聊轨迹、用户打断与主动轨迹，检查有没有贡献新内容、有没有主动又不催促、角色是否有不同情绪、是否记住因果。不要只凭某一条甜句或已通过功能测试宣称“有活人感”。

以上是本次工程推论，不是各项目官方宣称的效果保证。

## 核验快照

| 项目 | 源码快照 | 最有用的已存在能力 | 需要避免的误读 |
|---|---|---|---|
| SillyTavern | `06bde939fb1e9c4c8d8641d810f0a916b5bce127`，2026-09-14，package 1.19.0 | 多源 prompt 排序、注入深度、生成类型、lore 预算与冷却、群聊自动回复 | 自带主动人格或默认超强角色模型 |
| RisuAI | `979dbc9d5fd913abd6996eaec64e0f83be53964d`，2026-10-10 | 可编排 prompt、事件脚本与变量、HypaV3 分配记忆预算 | 所有角色卡都自动拥有有因果的情绪/无限准确记忆 |
| Project AIRI | `ec682e2413279aee49dc3d5bfa68192d958a41dc`，2026-10-11，package 0.12.0-beta.5 | 带来源的运行上下文、Spark Notify 可安静/可命令、Telegram 行为选择与分条消息 | Voice/Live2D 自动改善纯聊天；Memory Alaya 已完整落地 |
| Open-LLM-VTuber | backend `992309c0aa19845960228f880013d4685fde93b5`，2026-05-15，1.2.1；Web main `d176e7df2366952e3bacbf12cf9a8b18a4315932`，2025-09-05 | idle 状态触发、独立主动信号、语音/文本中断、只记用户听见的片段 | 内置复杂主动动机规划或成熟事实记忆 |

Open-LLM-VTuber 后端固定的 frontend submodule 是 `06a659b114fff788cf0daaa86e484576db4975bf`（build 分支）；这里的 Web 源码阅读使用上表 main 快照，不能声称与后端发布包逐文件一致。AIRI 新 Spark 代码在 main 可读；本调研没有逐项证明其全部进入 beta.5 二进制。发布范围应查各自 release notes。[SillyTavern releases](https://github.com/SillyTavern/SillyTavern/releases)、[RisuAI releases](https://github.com/kwaroran/RisuAI/releases)、[AIRI releases](https://github.com/moeru-ai/airi/releases)、[Open-LLM-VTuber releases](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/releases)。

## SillyTavern：控制语境，比寻找一份神奇总 prompt 更实用

官方 Prompt Manager 把主指令、角色、用户 persona、世界信息、示例、历史、末尾指令分开排列；还能按 Normal、Continue、Quiet 等生成类型启用不同提示。源码 `public/scripts/PromptManager.js` 的 Prompt 有 `injection_depth`、`injection_position`、`injection_trigger`，而 `public/scripts/openai.js` 在插入历史前保留控制指令预算，再由近及远装入历史。值得移植的是可检查的组装顺序和预算，而不是把所有人物资料塞进一段 system。[官方 Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)，[Prompt 定义源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/PromptManager.js#L133)，[预算与历史组装](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L886)。

Author's Note 能按聊天深度与频率插入当前状态或写法提示。对当前原型，可让长期卡定义偏好与气质，近尾小段只写“刚被夸，得意但想装乖；先亲近回应，再分享一个自己的念头”。这比近尾塞几十条“不许/禁止/不能”更容易形成明确下一步；这是工程建议，尚需模型对比。[官方 Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/)。

World Info 是按条件开启的上下文，不仅是百科。源码有 sticky、cooldown、delay；这些计数主要按消息推进，不是后台钟表事件。可用相同思路让一个偏好/场景持续几轮，让刚说过的自创笑点暂时退出候选，减少重复制造小物件剧情。[官方 World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)，[timed effects 实现](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js#L499)。

群聊 auto-mode 默认 5 秒扫描，会按提及与 talkativeness 等策略选角色；官方文档说明输入会关闭 auto，但已经排队的生成不会因此自动停止。源码 worker 先检查开关、连接、当前群与生成状态，再进入群生成。它能证明“无需用户新消息也能触发”是已实现能力，却不是内容动机规划。我们的单人聊天应保留当前输入取消和版本校验，避免机械连发。[官方群聊机制](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/Characters/groupchats.md)，[自动 worker](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L1398)。

长聊方面，官方新版 Chat Vectorization 会召回旧消息，保留近期消息，并把被召回内容标为过去事件且带发言者；默认配置和注入位置可调。旧 Smart Context 已标注不维护。官方 Summarize 明确说明摘要可能漏细节或幻觉，并提供恢复/人工编辑；不能把“无限记忆”当事实。我们的记忆更适合保留源消息、日期与状态，召回片段标清来处，不把摘要当新的用户自述。[Chat Vectorization](https://docs.sillytavern.app/extensions/chat-vectorization/)，[Summarize](https://docs.sillytavern.app/extensions/summarize/)，[旧 Smart Context 状态](https://docs.sillytavern.app/extensions/smart-context/)。

## RisuAI：把角色状态写成可观测的小程序

`src/ts/process/prompt.ts` 的 PromptItem 支持 description、persona、lorebook、memory、authornote、chat range、postEverything 等类型与角色选择；`index.svelte.ts` 根据模板排序和 token 数组装。适合借鉴的是：作者写的稳定资料、运行时状态、源自对话的记忆三者可以各有位置和权限。[PromptItem 类型](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/prompt.ts#L8)，[实际组装](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/index.svelte.ts#L350)。

`triggers.ts` 有 start/manual/output/input/display/request 等事件，动作包含变量赋值/增减、指定位置追加 system prompt、调用其他 trigger、阻止发送；较强动作如 runLLM、sendAIprompt 需要角色 lowLevelAccess。输出 trigger 的 sendAIprompt 会驱动下一次生成。可把这套思路简化为：用户夸奖→短时开心；用户说休息→收起主动机会；角色小愿望已回应→结案；不要引入完整可执行脚本系统。[trigger 模式与动作](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/triggers.ts#L107)，[setvar 与 systemprompt](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/triggers.ts#L1347)，[output 后续生成](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/index.svelte.ts#L1763)。

HypaV3 的 Summary 保存 `chatMemos` 来源关联和 isImportant；非实验主实现依次分配重要、近期、相似、剩余随机记忆预算，取出后重新按历史顺序排序，包进过去事件摘要。它不是纯粹向量 top-k。适合我们的是重要/近期/相关的小预算和时间顺序；随机召回可做轻微“想起一件事”，但不适合优先解决事实准确性。实现还包含独立 summarization/embedding 的限速与并发配置，说明这不是免费零延迟的增强。[HypaV3 实现与来源](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/memory/hypav3.ts#L79)，[分配预算](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/memory/hypav3.ts#L501)，[恢复发生顺序](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/memory/hypav3.ts#L871)。

## AIRI：事件与内容动机最值得看，多模态包装不宜全搬

截至核验的 main，`packages/core-agent/src/agents/spark-notify/agent.ts` 已有一个执行单次准备好事件的跨平台 agent；调度和模型选择属于宿主。默认 allowNoResponse=true，forceTextResponse/forceResponse 才改变策略。工具允许“不需要回应”与下发 Spark Command，command 包含目标、priority、intent、interrupt 和 parentEventId。因此可把主动拆成事件资格判断与角色反应，而不把“时间到了”当每次必说的理由。[Spark Notify 实现](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/packages/core-agent/src/agents/spark-notify/agent.ts#L96)，[NoResponse 与 Command 工具](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/packages/core-agent/src/agents/spark-notify/tools.ts#L134)。

Telegram 集成的实际循环每 60 秒选择行动，结合当前消息、已执行动作、未读消息与时间，允许 send_message、想出 idea/goals 或休息等。其 attention-handler 还有私聊/提及/回复/关键词、冷却与回复率；这是某一集成的实现，不是纯聊天前端默认每分钟发信。这些机制适合简化为受会话约束的动机候选，不需要为用户新增 Codex 定时任务。[行为生成](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/integrations/telegram-bot/src/llm/actions.ts#L20)，[实际周期循环](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/integrations/telegram-bot/src/bots/telegram/index.ts#L311)，[attention handler](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/integrations/telegram-bot/src/bots/telegram/agent/attention-handler.ts#L73)。

分条提示非常明确：完整想法保持一条，兴奋、思考停顿、补一句才拆；多数回复 1–2 条。实际 send-message 再调用一次模型拆原文本，随后 typing + 按长度等待逐条发送。我们可以学习语义节奏与例子，但宜在一次主生成里直接产出 messages，省掉二次拆句调用。该 Telegram personality 具有明确自我偏好与意见，且强调选话题；其 ReLU 设定与用户要的成年软甜角色并不相同，不应该复制人物内容。[分条提示](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/integrations/telegram-bot/src/prompts/message-split-v1.velin.md)，[发送实现](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/integrations/telegram-bot/src/bots/telegram/agent/actions/send-message.ts#L80)。

运行上下文源码刻意移除随机 ID 与毫秒时间等易变元数据，减少缓存抖动；其注释还说明较弱本地模型可能复述明显的 XML 标签，所以用紧凑的可读列表。这里需要学习的是控制上下文复杂度，并在实际模型上检查是否泄露系统格式；不等于所有模型都不能使用 XML。[context prompt](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/packages/core-agent/src/messages/context-prompt.ts#L12)。

记忆必须区分设计与完成度。官方 2025-04-14 DevLog 讨论相似度、时效、召回频次、情绪的实验平台，明确仍有未完成部分；2026-01-01 FlowChat 实验是创建表、由模型 tool 写陈述句、每轮拼全部记忆。当前 README 把 Memory Alaya 标 WIP，`packages/memory-pgvector/src/index.ts` 也只有事件客户端/配置回调脚手架，不能用目录名证明完整记忆引擎已发布。可以学习情绪与记忆有关的设计，但先实现来源与过期状态，避免幻想式回忆。[记忆实验 DevLog](https://airi.moeru.ai/docs/en/blog/DevLog-2025.04.14/)，[FlowChat 2026 实验](https://airi.moeru.ai/docs/en/blog/DevLog-2026.01.01/)，[pgvector 模块现状](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/packages/memory-pgvector/src/index.ts)。

## Open-LLM-VTuber：借交互状态机，别把一句主动提示当规划器

Web 的 ProactiveSpeakProvider 默认关闭，idleSecondsToSpeak 默认 5；AI 状态进入 IDLE 才设一次 timeout，离开时清掉。trigger-speak 发送独立 `ai-speak-signal` 和 idle_time。AI 状态还有 WAITING（正在打字）、LISTENING、THINKING_SPEAKING、INTERRUPTED。这种资格门控对于文字聊天同样有用，能避免角色在用户正在输入或听见一半时突然插嘴。[前端主动状态机](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/d176e7df2366952e3bacbf12cf9a8b18a4315932/src/renderer/src/context/proactive-speak-context.tsx#L20)，[官方 Web 使用说明](https://docs.llmvtuber.com/en/docs/user-guide/frontend/web/)。

后端识别独立主动事件，加载可配置 proactive_speak_prompt，并给伪输入加 skip_memory 与 skip_history；当前默认模板只是让模型说适合当前语境的话。BasicMemoryAgent 的 `_to_messages` 会让该输入参与本次推理，但不把它记作真实用户发言；实际主动生成的 assistant 内容仍加入 agent memory，而 single_conversation 最后存生成的 AI 回复。它提供“主动控制输入不污染用户历史”的做法，没有提供复杂角色念头/语义新颖性评分。[主动 handler](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/conversations/conversation_handler.py#L35)，[当前主动 prompt](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/prompts/utils/proactive_speak_prompt.txt)，[memory 输入处理](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/agents/basic_memory_agent.py#L281)。

中断时 BasicMemoryAgent 会把最后 assistant 改成用户实际听见的文本，并标明 interrupted；这是语音正确因果。文字原型已经完整收到的消息无需删掉；若要支持真正流式文字中断，需要区分已显示与未显示。句子分割和并发 TTS 主要降低语音等待，不自动改善人格或小情绪。[中断记忆](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/agents/basic_memory_agent.py#L195)，[句子管道](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/src/open_llm_vtuber/agent/agents/basic_memory_agent.py#L585)。

## 采样与防重复的实质限制

四个项目都以用户选择或后端支持的模型为主，并没有一套已证明跨模型有效的“可爱参数”。SillyTavern 会按 provider 删除或限制部分采样参数；RisuAI 有 repetition 等参数导入适配；AIRI 当前主模块 temperature 保存值 0.7、top_p 1.0，但只有用户启用覆盖才发送；Open-LLM-VTuber 多个 LLM 配置默认 temperature=1.0。这些是配置事实，不是对话效果结论。[ST provider 参数适配](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L2934)，[RisuAI 参数适配](https://github.com/kwaroran/RisuAI/blob/979dbc9d5fd913abd6996eaec64e0f83be53964d/src/ts/process/prompt.ts#L259)，[AIRI sampling 开关](https://github.com/moeru-ai/airi/blob/ec682e2413279aee49dc3d5bfa68192d958a41dc/packages/stage-ui/src/stores/modules/consciousness.ts#L58)，[VTuber 配置](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/992309c0aa19845960228f880013d4685fde93b5/config_templates/conf.default.yaml#L98)。

工程推论：保持 Grok low 并不妨碍做以上架构，但 low 无法替代好角色与有效话题状态。对结构性重复，记录最近主动动机/话题/表达与结案状态，并让本轮换一个有来由的意图；对语言重复，再看少量采样调整。不能让高惩罚毁掉称呼、必要事实或中文自然用词。此次只做资料与代码核验，未提供跨模型可爱度排行榜，也未确认 NariYume 使用上述任一实现。

