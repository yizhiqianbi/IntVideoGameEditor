# 叙梦隐藏世界状态：叙事引擎与生活模拟调研

调研日期：2026-10-06。补充 [角色对话 Prompt 调研](./xumeng-roleplay-prompt-research-2026-10-05.md)。本稿只查阅项目官方文档、作者仓库和源码；没有运行这些项目、调用付费模型或修改叙梦聊天实现。下文“建议”是叙梦的原创设计推导，尚未证明能改善实际模型表现。

## 结论

值得优先实现的是**独立于聊天文本的世界状态、带来源的状态变化、可回退的事件后果**。时间与日程能让人物有自己的生活；前提是区分“计划去做”“正在做”和“已经完成”。仅在提示词里加入好感度、时钟或目标字段，不等于实现了这些系统。

| 项目 | 已核对的机制 | 对叙梦的用途与边界 |
|---|---|---|
| ink | 作者变量、条件选择、访问次数、回合计数、故事状态保存 | 保留完成状态、限制重复事件；回合数不是现实时间，变量不会自动理解聊天 |
| Yarn Spinner | 外部变量存储、条件 storylet、一次性内容、候选内容选择策略 | 从当前时间、场景与关系条件筛选下一件事；时间/关系本身仍由游戏提供 |
| Ren'Py | 可变剧情变量、存档及回退、独立的跨存档 persistent 数据 | 剧情分支与用户设置分开保存；引擎不自动提供角色日程或关系推理 |
| Generative Agents | 模拟时钟、模型生成日程、任务分解、遇人反应、记忆检索与反思 | 参考“角色有计划、遭遇会改计划”；研究原型不能直接当成低成本聊天服务 |
| Monika After Story | 现实日期、离线时长、关系等级、增量限制及变更审计 | 公开源码的陪伴游戏补充案例；规则由作者设定，且许可不能视为普通宽松开源许可 |

## 第一手依据

### ink：明确的剧情状态，而非自动模拟

源码快照：`inkle/ink`，`35c63e52f1d36060930dc7ed3cfba38ea224b528`。

`VAR` 与条件表达式可记录剧情事实；普通选择默认只能使用一次，访问计数可约束后续内容。`TURNS_SINCE` 计算距离上次访问的玩家输入次数，不能解释成经过了多少分钟。适合借鉴“已办完的事不再反复发起”和事件冷却。[语言说明](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/Documentation/WritingWithInk.md)

运行时支持 `state.ToJson()` / `LoadJson()` 保存及恢复故事状态，也允许宿主游戏读写变量。叙梦可以借鉴“文本和状态一起存档”的边界，但需要自行处理自由聊天的事实提取、修改历史与分支失效。[运行时集成](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/Documentation/RunningYourInk.md)

### Yarn Spinner：按状态选择合适事件

核心源码快照：`YarnSpinnerTool/YarnSpinner`，`dd8d9b4f7b752364e3dce94961c00924e13f5d72`；功能说明另以调研日官方文档为准。

Yarn 的变量存储由宿主提供，内置内存存储不会跨游戏运行保留数据。故事变量存在不代表已有存档，更不代表有自动更新关系或日程的机制。[Variable Storage](https://docs.yarnspinner.dev/components/variable-storage)

官方 storylet 示例按星期和时段筛选 NPC 对话，同名节点通过 `when` 条件形成候选集合；`when: once` 用于一次性内容，选择策略决定展示哪个候选。叙梦可借鉴为“条件满足→挑选一个事件→发生后记账”，并为没有合适事件时保留普通对话。越具体的条件需要越多作者内容，不应宣称它能自动编出合理事件。[官方示例](https://docs.yarnspinner.dev/yarn-spinner-for-unity/samples/storylets-and-saliency/basics-storylets-and-saliency)、[选择策略](https://docs.yarnspinner.dev/3.1/write-yarn-scripts/advanced-scripting/storylets-and-saliency-a-primer)

### Ren'Py：剧情回退与跨会话资料分开

官方 `default` 用于可能变化的变量，文档直接示例了关系积分的显式加减；这些是作者代码，不是情感识别器。`define` 用于常量，不宜承载变化的剧情状态。[变量语义](https://www.renpy.org/doc/html/python.html#default-statement)

保存、加载和 rollback 会管理参与其中的剧情状态；`persistent` 则保存独立于某个剧情存档的数据。对叙梦的直接启发是：关系、承诺、物品、事件完成情况跟随聊天分支；显示偏好等用户设置独立保存。重生成不能留下被撤销回复造成的关系增量。[存档与回退](https://www.renpy.org/doc/html/save_load_rollback.html)、[Persistent Data](https://www.renpy.org/doc/html/persistent.html)

### Generative Agents：确有自动计划，但能力应逐项拆开

源码快照：`joonspk-research/generative_agents`，`fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`。

模拟器将 `curr_time` 保存到世界元数据，每次模拟步骤增加 `sec_per_step`，这是**模拟时间**，不是把电脑当前时间当剧情时间。[世界时钟及保存](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/reverie.py)

计划模块调用模型生成起床时间、一天的安排，再拆为有分钟时长的任务；聊天或等待可打断当前行动并调整日程，还设有避免立即重复找同一人聊天的缓冲。它不是通用的确定性任务完成判定器；所查版本的新日规划路径也保留了更新 `daily_req` 的 TODO，不能把论文架构视为每条实现都已完备。[计划与反应实现](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py)

记忆对象区分事件、想法和聊天，并记录时间、重要性、关键词与关联内容；检索组合近期性、重要性和相关性。适合借鉴“事实与想法分型、检索只取当前相关内容”，不能据此声称内置了通用好感度或严格因果系统。[记忆结构](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/memory_structures/associative_memory.py)、[检索](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/retrieve.py)

作者 README 明确提醒多角色模拟的模型调用成本和运行中断问题；该说明针对当时实现，不是今天价格的测算。叙梦宜先用规则计算当下日程，只在新一天、重大事件等边界生成计划，并限制后台展开范围。[运行说明](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/README.md)

### Monika After Story：关系规则与审计的实际案例

公开源码快照：`Monika-After-Story/MonikaModDev`，`6318b0013924d06d1a30a5784b68b7eed5f4b32d`。这里作为补充设计案例，不将它归类为可自由商用的宽松开源项目。

好感模块具有关系等级、增益限制、现实日期/离线时长处理，并记录尝试变化量、实际变化量及变化前后数值。它能证明“好感需要规则、上限和原因记录”，不能证明这些数值来自对自由对话的可靠理解。该项目还含离线扣减规则；叙梦建议只借鉴审计和事件关联，默认不因用户离线而降低关系。[关系模块](https://github.com/Monika-After-Story/MonikaModDev/blob/6318b0013924d06d1a30a5784b68b7eed5f4b32d/Monika%20After%20Story/game/script-affection.rpy)

## 叙梦的原创实现建议

### 时间与日程

- 保存故事时间和现实上次活跃时间两个字段。默认故事时间由叙事推进；明确“第二天”或“走了十分钟”才能作相应跳转。只知道“晚上”时保留该精度，避免编造具体分钟。
- “现实同步”应是可选模式，明确时区和离线推进策略。读一条长回复、网络等待或重试不应额外推进故事时间。
- 日程分为固定承诺、日常习惯、当前行动。记录时间窗、地点、预计时长、状态及来源。约好明天见面只是承诺，不能立刻写成已经见面。
- 状态只在新消息成功落盘、明确时间跳转或加载会话等边界更新。长时间离线时生成有上限的近况，不逐分钟调用模型；处于同一场景的角色不会仅因日程到点而无过程地瞬移。

### 关系与目标

- 关系优先用带来源的定性事实，例如“接受了道歉，但仍对失约存疑”。如需数值，可将熟悉、信任、亲近、紧张分别表示，并允许“未知”。这些维度是设计选择，不宣称它们客观测量真实感情。
- 关系变化绑定具体已发生事件和消息编号，限制单事件幅度并防止重复结算。“说了好听的话”不必自动加分；相同称赞刷屏也不应累计成重大关系跃迁。
- 每个目标保存提出者、状态和完成证据。目标经历提出、进行、完成/放弃等阶段；模型的愿望、猜测与计划不得直接成为完成证据。
- 角色可以完成自身有条件执行的行动；涉及用户的重大选择或承诺，只能以用户实际表达为依据。已完成目标可以产生新后果，但不重新当作未完成事项询问。

### 事件结算与回退

建议流水线为：读取分支状态 → 从当前输入提取候选变化 → 验证来源、范围与前置条件 → 选择本轮可发生事件 → 生成回复 → 回复保存成功后一次性提交实际发生的变化。计划可先成为待办，只有回复明确叙述或用户实际完成的结果才能成为已发生事件。

事件至少保存 `eventId`、`branchId`、来源消息编号、前置条件、实际变化、状态版本、提交回合与一次性/冷却限制。传给模型的是当前相关状态的简短投影，完整账本留在应用存储。隐藏状态可以不在故事里显示分数，但应能供调试查看来源，并允许随编辑、删除、重生成及分支切换重建。

模型输出只作为候选变化，应用负责类型检查、增量边界、唯一编号与幂等提交。请求失败或重试不得重复加分、重复消耗物品、重复推进时间。自由对话的自动事实提取仍可能出错，需以实际行为评测检验；多加几个状态字段本身不能证明问题已解决。

## 落地顺序与验收

优先完成可回退的事实/事件账本，再加入故事时钟与目标状态，随后增加少量日程及关系事实，最后考虑模型生成日计划。先保留后台状态即可，不必给读者展示数值面板。

| 情境 | 应有结果 |
|---|---|
| “十分钟后到咖啡馆”，随后继续聊天 | 时间和位置连贯；同一句重试不会再推进十分钟 |
| 约定明天见面，当前仍是今晚 | 建立待办，不提前记为完成 |
| 找到钥匙后继续 | 使用已有钥匙；不再次发起寻找同一把钥匙 |
| 道歉之后重生成该回复 | 撤回被替换分支的关系变化，再按新结果结算 |
| 用户离线两天，故事时间模式 | 延续原场景；不默认扣关系或判定用户失约 |
| 角色下班时间到了，但仍在重要交谈 | 根据固定承诺与当前互动产生合理行动，不直接换地点 |
| 模型未返回可用状态变化 | 保留已知状态，不用空对象覆盖既有事实 |

以上是验收建议，本轮没有真实模型对照结果。

## 复制源码时的许可边界

本稿建议借鉴机制并独立实现，不复制代码、提示词、角色文本或美术。

- ink 和 Yarn Spinner 核心仓库是 MIT；若实际复制代码，需保留相应版权和许可文本。Yarn 的付费附加组件不能由核心仓库的 MIT 许可推及。[ink 许可](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/LICENSE.txt)、[Yarn 核心许可](https://github.com/YarnSpinnerTool/YarnSpinner/blob/dd8d9b4f7b752364e3dce94961c00924e13f5d72/LICENSE.md)
- Generative Agents 仓库为 Apache-2.0，若复制需核对许可、版权/NOTICE 及修改声明义务；美术素材还应单独核对来源许可，不能只凭代码仓库许可判断。[许可](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/LICENSE)、[素材致谢](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/README.md#acknowledgements)
- Ren'Py 大部分为 MIT，但包含 LGPL 等依赖；完整分发引擎与参考状态机制是不同范围，实际分发需按构建内容核对。[官方许可说明](https://www.renpy.org/doc/html/license.html)
- Monika After Story 的许可文件含自定义限制和 DDLC IP 指南，并明确禁止将其代码/素材用于旨在替代原项目的 mod 或 fork。该文件收录的部分指南为历史版本，不能作为当前全面授权；本次只参考机制，不纳入任何代码、角色或素材。[所查版本许可](https://github.com/Monika-After-Story/MonikaModDev/blob/6318b0013924d06d1a30a5784b68b7eed5f4b32d/LICENSE.md)
