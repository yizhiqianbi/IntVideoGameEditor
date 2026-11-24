# 叙梦角色对话 Prompt：开源调研与改造建议

调研日期：2026-10-05。比较官方源码及文档，并对照叙梦当前实际请求。本文件为研究及设计稿，本轮没有修改或发布聊天实现，也没有调用付费模型做行为对照。

后续实现另见 [角色对话与剧情记忆](./xumeng-roleplay-memory.md)；以下本地差距表保留调研时的状态。

## 结论

优先采用分层提示词、本轮简短提醒、可追溯的剧情记忆和角色卡兼容。叙梦已经有主动推进指令；下一步需要验证模型实际收到的上下文，并保存被裁掉的剧情事实。继续增加相似规则的收益尚未验证。

## SillyTavern

源码快照：`release` 分支 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`，不是对所有版本的概括。

其默认 Main Prompt 只指定下一次角色回复，剧情风格由其他内容和预设共同决定。默认配置把人物资料、世界书、示例、聊天历史和 Post-History Instructions 分开排序，末尾指令默认是空的。[默认配置](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/default/content/presets/openai/Default.json#L51-L83)

Prompt Manager 可配置每段的角色、相对位置或聊天内深度，也能区分正常回复、续写和重新生成。可以借鉴为叙梦的分段组装器，便于检查某条作者指令和推进规则发生了什么冲突。[Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)

Author's Note 支持随聊天保存、在指定深度和频率注入。官方还指出历史会影响后续风格，因此用临近末尾的提醒和新会话对照测试检验修改。文档描述的是经验性提示方法，不是所有模型都服从最后一句的保证。[Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/)、[历史与后置指令](https://docs.sillytavern.app/usage/prompts/#effect-of-message-history)

历史和示例分别作为消息集合处理，预算从上下文额度扣除回复额度。固定定义、控制指令、历史和示例有独立预算处理；函数的调用先后也不等于最终消息顺序，最终位置还由配置决定。[实际组装源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L1185-L1348)、[预算计算](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L3982-L3986)

World Info 按关键词等条件选择条目，并支持插入位置、深度、预算和递归等设置；宏会把人物名及用户名等占位符替换为实际值。能力存在不代表每个预设都启用了它们。[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)、[Macros](https://docs.sillytavern.app/usage/core-concepts/macros/)

Summarize 扩展生成并保存历史摘要，再把摘要注入请求；自动更新取决于配置和可用后端。官方提醒摘要可能遗漏或臆造事实，因此叙梦需要保留来源、可编辑状态以及重新生成后的失效机制。[Summarize](https://docs.sillytavern.app/extensions/summarize/)、[保存及注入源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/memory/index.js#L963-L982)

## RisuAI

源码快照：`main` 分支 `9f3b589b6e74230401a431a00fd977986d212870`。该版本欢迎向导应用 `OAI2 / Default Prompt`；不能把数据库兜底的旧顺序当成新安装用户的默认模板。[欢迎向导](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/lib/Others/WelcomeRisu.svelte#L73-L99)

这个模板明确区分人物、用户设定、世界书、作者说明、记忆、较早历史、最近两条消息和后置内容。它的叙事规则通过人物行动、事件及后果推动剧情，并强调减少重复。可借鉴分段和连续性原则，叙梦的具体措辞与节奏需要自行设计。[模板与顺序](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/templates/templates.ts#L321-L383)

示例中的角色和用户前缀会解析为 assistant/user 消息，并展开人物及用户宏；然后才与开场及真实历史组装。这是叙梦目前“原文示例放进 system”之外的一项明确差异。[示例解析](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/exampleMessages.ts#L25-L65)、[宏展开](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/cbs.ts#L147-L181)、[历史组装](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/index.svelte.ts#L831-L884)

HypaV3 具有真实的分批摘要、保存关联消息编号及摘要检索路径：超出预算时摘要旧消息，按重要性、近期性和相似性等选择旧摘要，再按时间顺序注入。调用依赖角色/房间及记忆后端的开启；模板里有 memory 插槽并不等于自动启用长期记忆。[启用及裁剪路径](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/index.svelte.ts#L1068-L1153)、[摘要保存](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/memory/hypav3.ts#L1012-L1158)、[摘要选择](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/memory/hypav3.ts#L1224-L1404)

世界书支持近期扫描、递归、预算及位置控制；Trigger 能持久化脚本变量并加入额外提示。后者是作者可以使用的机制，不能称为自动理解“目标已完成”的剧情规划器。[世界书](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/lorebook.svelte.ts#L565-L624)、[状态变量](https://github.com/kwaroran/Risuai/blob/9f3b589b6e74230401a431a00fd977986d212870/src/ts/process/triggers.ts#L1203-L1231)

## Agnaistic

源码快照：`dev` 分支 `fccee00f5f7628d150760c787c4be87e6b1a652c`。特定 OpenAI/OpenRouter 预设要求主动推进剧情、避免重复、保持角色身份及不替用户决定台词与行动。角色及聊天设置可以覆盖提示，因此这些规则不是所有预设统一生效的保证。[OpenAI 预设](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/common/presets/openai.ts#L78-L103)、[OpenRouter 预设](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/common/presets/openrouter.ts#L3-L18)、[覆盖处理](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/common/prompt.ts#L646-L674)

Simple 顺序分开系统、场景、人格、历史检索、世界书记忆、示例和历史，再加后置内容；示例会处理人物与用户占位符。Author's Note 和 Post-History Instructions 是可插入的提示槽位，本身不自动维护剧情状态。[顺序定义](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/common/prompt-order.ts#L78-L103)、[示例处理](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/common/prompt.ts#L574-L616)

Memory Book 按近期消息的关键词选择作者已写好的条目，并按预算和优先级纳入请求；它不是自动抽取历史事实。另有语义历史检索，但依赖加载的消息、嵌入引擎及预算。[Memory Book](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/common/memory.ts#L65-L224)、[历史语义检索](https://agnai.guide/docs/memory/embeddings.html)

Scenario Events 可以根据触发条件和 flags 筛选事件，执行后更新剧情标记；官方说明聊天文字不会自动改变这些 flags。适合未来让作者编排“已见过某人”“线索已揭示”等阶段，但叙梦仍需要从真实历史维护自己的事实记忆。[事件实现](https://github.com/agnaistic/agnai/blob/fccee00f5f7628d150760c787c4be87e6b1a652c/web/store/event.ts#L140-L239)、[官方 Scenario 说明](https://agnai.guide/docs/library/scenarios.html)

## 三个项目最值得借鉴的部分

| 项目 | 已核对的实现 | 对叙梦的用途 |
|---|---|---|
| SillyTavern | 可排序的提示分段、深度注入、Author's Note、摘要扩展 | 查看实际请求；用简短的本轮提醒控制节奏 |
| RisuAI | 示例分角色、宏展开、可选摘要与检索、世界书预算 | 兼容角色卡；避免旧剧情随原文裁剪而完全丢失 |
| Agnaistic | 明确的自主权与推进规则、模板槽位、作者配置的事件 flags | 保持推进边界；为可编排剧情提供阶段机制 |

以上是能力及指定源码路径的比较，不是默认启用状态或效果排名；没有开展三个项目同模型的实测。

## 与叙梦当前实现对照

| 项目 | 当前事实 | 改造方向 |
|---|---|---|
| 主提示词 | 已有 NPC 主动行动、完成事项收束、短回复处理、暂停和用户自主权规则 | 保留这些边界，减少重复规则，检查实际输出 |
| 请求顺序 | 复合 system → 选中开场及近期历史 → 作者后置 system | 分段呈现来源、顺序和预算；增加可配置的本轮提醒 |
| 历史 | 最近40条，再按80,000字符和180,000 UTF-8字节裁剪；保留开场 | 预算感知的近期原文，加被裁掉历史的事实摘要 |
| 示例 | 对话示例作为 system 中一段原文 | 兼容格式有效时解析为明确的 user/assistant 示例回合 |
| 卡片宏 | 作者字段和示例中的宏直接发送 | 补人物、用户及原始提示等所需宏；不执行卡片中的任意代码 |
| 世界书 | 默认扫描近10条、一次关键词激活、排序后放在首条 system | 按实际卡片需求补预算、插入位置和更完整的激活兼容 |
| 模型效果验证 | 模拟 provider 验证 prompt 正确组装 | 用固定场景和真实模型做小规模行为对照 |

代码依据：[请求组装](/Users/pencil/Documents/IntVideoGameEditor/src/lib/dzmm-chat.ts:129)、[历史裁剪](/Users/pencil/Documents/IntVideoGameEditor/src/lib/dzmm-context.ts:50)、[世界书激活](/Users/pencil/Documents/IntVideoGameEditor/src/lib/dzmm-character-context.ts:166)、[会话保存结构](/Users/pencil/Documents/IntVideoGameEditor/src/lib/dzmm-storage.ts:13)、[模拟模型测试](/Users/pencil/Documents/IntVideoGameEditor/src/lib/dzmm-chat-handler.test.mts:31)。

**推断而非已证实的停滞原因：**长对话中，开场仍在，中间完成任务的消息却可能被裁掉，导致模型重新发起旧任务。作者后置指令也可能影响推进规则。短对话是否停滞，还需要检查具体卡片、历史和模型输出，不能只归因于裁剪。

## 建议的请求结构

固定扮演及自主权规则 → 角色资料与有效示例 → 用户人设及写作预设 → 当前相关世界书 → 选中开场（与历史去重）→ 有来源的历史事实摘要 → 近期真实对话 → 作者后置设定与本轮短提醒。

这是叙梦的设计建议，不是声称三个项目拥有相同默认顺序。角色卡的作者规则应保留并标明冲突；本轮提醒应由用户选定的节奏及真实状态生成，不能暗中改变人物性格或用户选择。开场是原始起点，当前场景以随后确认的真实历史为准。

事实记忆至少区分：当前场景、已完成事项、仍未解决事项、关系及物品变化。每项绑定消息范围或消息编号，只记录已经发生的事；角色愿望不能被摘要写成已经实现的事实。编辑、重生成、删除或分支切换后，应使依赖旧消息的摘要失效。

## 原创本轮提醒草案

此段是根据调研提出的叙梦草案，尚未上线或证明优于当前版本。

```text
承接最近一条用户消息和已确认的剧情事实，写出角色当下的具体回应。
按当前节奏，让眼前未完成的事自然走到下一步：呈现角色行动的结果、确认的信息，或有意义的关系变化。用户要求暂停或停留时，尊重该要求。
将已经完成的事情作为后续事实；已有答案的问题无需再问。用户只说“继续”或简短回应时，先承接其具体意思；可以让角色完成无需用户新增同意的自身行动，重大选择仍留给用户。
角色保持自己的目标和说话方式；用户的台词、行动、决定和感受由用户表达。自然结束本轮，不机械添加提问或选项，只输出故事回应。
```

它需要与事实记忆和近期历史配合。单独复制此段不能证明长期记忆已解决。

## 验证方法及落地顺序

先让开发者能查看最终请求的分段、角色、顺序、预算和裁剪范围，再补宏及有效示例解析，随后落地事实记忆和本轮提醒。token 预算由模型配置决定；摘要调用会有额外费用及延迟，需要记录实际开销。

行为对照使用相同模型、采样设置、角色及消息，每个场景比较当前版与候选版。检查重复提问、已完成事项回退、用户被代写、无依据跳场及适度进展。

| 测试场景 | 期望行为 |
|---|---|
| 已找到地图，用户说“继续” | 使用已有地图推进眼前行动，不再次索要地图 |
| 用户已明确回答问题 | 承接答案及结果，不换一种措辞重问 |
| 用户说“停一下，我想想” | 停留、等待，不强制追加事件 |
| 用户要求安静陪伴 | 有符合情境的回应，不机械制造危机 |
| 关键任务在40条以前完成 | 记住完成事实，不重启任务 |
| 世界书中的线索再次相关 | 加入相关资料，不把整本设定全部塞入 |
| 用户编辑或重生成旧消息 | 记忆随新历史更新，不沿用旧分支结果 |
| 不同角色使用同样场景 | 各自保持设定与语气，不被统一提醒抹平 |

当前研究没有真实模型 A/B 结果，不能宣称停滞率已下降。
