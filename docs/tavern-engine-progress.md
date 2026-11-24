# 后端 SillyTavern 兼容引擎：实施进度

依据《后端切换到 SillyTavern 语义（前端最小改动）》方案执行。所有模块为独立纯函数，先落地引擎与测试，再逐阶段接入现有聊天链路，最后灰度。

## 已完成：P0.1 引擎内核（2026-11-20）

| 模块 | 文件 | 覆盖能力 |
| --- | --- | --- |
| 角色卡 | `src/lib/tavern/card.ts` | ST v2/v3 解析、canonical v3 导出、与现有 `DzmmCharacterContext` 双向转换、`group_only_greetings`、`extensions` 原样保留、兼容性报告 |
| 世界书 | `src/lib/tavern/worldbook.ts` | 主/次关键词、四种 selective 逻辑、大小写、整词、正则关键词、constant、概率、分组权重、递归（含 prevent/exclude/delay）、sticky/cooldown/delay、scanDepth、token 预算、before/after/@depth+role、激活状态折叠 |
| 宏 | `src/lib/tavern/macros.ts` | `{{char}}`/`{{user}}`/`{{description}}`/`{{personality}}`/`{{scenario}}`/`{{persona}}`/时间日期/`{{random}}`/`{{pick}}`/`{{roll:1d6}}`/`{{newline}}`/`{{trim}}`/注释；未知宏保留并上报；深度遍历卡结构 |
| 采样 | `src/lib/tavern/sampler.ts` | ST 风格采样档、层级合并（服务端默认 < 卡扩展 < 会话 < 请求）、按模型能力裁剪、provider 参数映射（不支持项直接丢弃而非报 400） |
| 提示词 | `src/lib/tavern/prompt.ts` | Prompt Manager 式 section 注册表、开关/排序、@depth 注入（作者注、世界书、记忆）、上下文预算裁剪、诊断输出 |

验证：

```bash
npx tsx --test src/lib/tavern/*.test.mts   # 41 tests, all pass
npx tsc --noEmit -p tsconfig.json          # tavern/ 目录 0 错误（仓库原有 12 个历史错误不变）
```

## 下一步

1. **P0.2 接入聊天链路**：`validateDzmmChatInput` 增加可选 `characterId/card/sampler/branch/memory`；`buildTavernPromptPlan` 内部切换到新引擎（`promptStyle="tavern"` 生效，`xumeng` 保持快照不变）；`dzmm-chat-handler` 把采样参数并入 provider 请求。
2. **P1 卡片存储**：`character_payloads`/`card_json` 保存 canonical v3、懒迁移、BACKEND `/v1/tavern/context`。
3. **P2–P6**：采样档 UI 折叠区、群聊、分支 swipe、生图 preset、记忆配置化。
4. **P7**：灰度开关、AGPL NOTICE 与源码页、生产验收。

## 边界

- 尚未改动任何生产代码路径，尚未部署；现有线上行为不变。
- 前端（UI）未改动；后续只按方案加数据字段与最小入口。
- 未复制 SillyTavern 源码；行为按公开规格实现，AGPL 声明与源码公开在 P7 落地。

## P0.1 代码评审记录（2026-11-20）

### 已修复（评审中发现并复现）

| 严重度 | 问题 | 修复 |
| --- | --- | --- |
| 高 | 上下文预算会把**作者手写开场**当旧历史裁掉 | 只裁剪 live history，opening 永久保留 |
| 高 | `@depth` 注入位置在预算裁剪前计算，裁剪后落点错误 | 裁剪后基于最终历史重新计算注入点 |
| 中 | `{{newline}}` 会触发整段 `trim()`，吞掉首尾空格 | 删除整段 trim 分支，按 token 处理 |
| 中 | 预算把作者注重复计入（fixed sections + depth） | 预算中排除 authorNote，单独计一次 |
| 中 | 用户角色开场（user-role opening）转 v3 卡时丢失 | 存入 `extensions.xumeng.openingMessages` 并支持反解 |
| 低 | `scanText`/`cursor`/`totalDepth`/`void group` 等死代码 | 清理并统一 scanDepth |

回归测试从 41 增加到 **45**，全部通过；`tsc` 在 `tavern/` 下 0 错误。

### 未修复、需在后续阶段处理

| 严重度 | 问题 | 处理建议 |
| --- | --- | --- |
| 高 | `useRegex` 关键词来自不可信卡，存在 ReDoS 风险 | P0.2 接入前加扫描文本上限（如 12k 字符）+ 正则长度限制；必要时该能力加开关 |
| 高 | 卡 `extensions` 在转成 context 时丢失 | 由 P1 的 `card_json` 权威存储解决，P0.2 不得依赖 context 往返保真 |
| 中 | `order` 是完整列表，未列出的 section 不会注入；`chatHistory` 总在末尾写出 | 与 ST 的差异记录在案；如要严格对齐 Prompt Manager，可在 P2 增加"仅重排"模式 |
| 中 | 无 `main` 缺省提示词、无 `jailbreak` 缺省值 | P0.2 接入时由 handler 提供现有默认（成人写作规则等） |
| 中 | `sampler.contextTokens` 尚未传给 prompt 预算 | P0.2 串联：resolve → prompt settings |
| 中 | 嵌套宏（`{{random::{{char}}::x}}`）不展开 | 记录为限制，ST 也是有限嵌套；需要时评估 |
| 低 | 时间/日期宏用运行时本地时区（Workers 为 UTC） | P0.2 加 `timeZone: Asia/Shanghai` 选项 |
| 低 | 世界书条目拓展字段除已知项外不保留 | P1 以原始 `character_book` JSON 存储解决 |
| 低 | 世界书条目上限引擎 1000 / 现有解析 200 不一致 | P1 统一为 200 并在导入报告提示 |
| 低 | sticky 与 cooldown 同时设置时 sticky 优先 | 记录语义；ST 文档未明确，按"粘性优先"执行 |
| 低 | 采样仅覆盖标准 OpenAI 兼容参数，无 min_p/xtc/dynamic temperature | 作为 P2 增强，视 OpenRouter 支持情况 |

### 结论

引擎内核可以进入 P0.2 接入，但**必须先补 ReDoS 防护**；`xumeng` 旧提示词路径在接入时保持快照不变。

## P0.2 接入聊天链路（2026-11-20，已上线）

已完成并部署到生产（`dzmm-web` version `2cebc914-fb94-40e4-8d00-63f7b14e6e73`）：

1. **世界书引擎接管 `tavern` 拼法**：`buildTavernPromptPlan` 改用 `activateTavernWorldbook`（不再用旧的关键词过滤）；before/after 与 `@depth` 条目全部走 ST 语义，`@depth` 条目插入聊天历史内部（按 role 与 depth）。
2. **ReDoS 防护**：`useRegex` 关键词长度上限 200 字符、正则扫描文本上限 12k 字符，超限降级为普通关键词并告警。
3. **采样参数接口**：`/api/chat` 接受可选 `sampler`（temperature/top_p/top_k/penalties/maxTokens/contextTokens/stop），非法字段 400；合法参数经 `resolveTavernSampler` 按模型能力裁剪后进入 provider 请求。不传 sampler 时 provider body 与旧版一致。
4. **兼容性**：`promptStyle` 缺省/`xumeng` 的提示词逐字节快照测试通过，线上默认行为不变；`sampler` 目前没有前端入口（休眠字段，供 P2 UI 与后续客户端使用）。

验证：

- `src/lib/tavern/*.test.mts` + `dzmm-chat.test.mts`：50 个测试通过。
- 生产冒烟：`GET /api/chat` 配置正常；非法 sampler 返回 400（"采样参数包含不支持的字段…"）；合法 sampler 的游客请求在计费处 402（未触达模型）；首页 200。
- 既有 4 个 `dzmm-chat-handler.test.mts` 失败与 37 个 worker tsc 错误经 `git stash` 对比确认**改动前就存在**，与本次无关。

下一步：P1 canonical 卡存储 + `/v1/tavern/context` + 懒迁移；P2 采样设置最小 UI；P3 群聊。

## P1' 高级世界书字段打通（2026-11-20，已上线）

结论先行：**没有做 D1 权威卡存储**。线上实测 79 张卡 context 最大 37 KB（上限 80 KB）、0 张超限、0 次分片，瓶颈是前端解析丢字段而不是存储；因此采用零迁移方案。

改动：

1. `DzmmCharacterBookEntry` 扩展 ST 高级字段：`selectiveLogic`、`matchWholeWords`、`useRegex`、`probability/useProbability`、`group/groupWeight`、`preventRecursion/excludeRecursion/delayUntilRecursion`、`sticky/cooldown/delay`、`useBudget`、条目级 `scanDepth`、`depth/role`，位置支持 `an_top/an_bottom/at_depth` 与 numeric `extensions.position`（numeric 优先，符合 ST 语义）。
2. `parseBook` 同时接受 snake_case 与 camelCase，原始 ST 卡与本站导出卡解析结果一致。
3. `prepareDzmmRequest` 在 `promptStyle="tavern"` 时**保留完整世界书**（不再用旧激活函数过滤），由服务端引擎激活；`xumeng` 路径行为不变。
4. 引擎补充 `scanDepth`/`an_top`/`an_bottom` 别名。
5. 新增 `src/lib/tavern/p1-parse.test.mts`：导入保真、导出保真、请求携带、正则/深度/概率真实生效。

验证：`tavern/*` + 世界书位置 + 聊天回归共 61 个测试通过；`check:client` 通过；worker tsc 错误数与改前一致（37，均历史遗留）；部署 `dzmm-web` version `e68eaa8b-d405-4958-b5b7-5f1b1f08a659`；生产首页/API/浏览器冒烟正常，无 JS 报错。

剩余阶段：P2 采样设置最小 UI、P3 群聊多角色、P4 分支 swipe、P5 生图 preset、P6 记忆配置化、P7 灰度/AGPL/验收。

## P2 采样设置最小 UI + 请求接入（2026-11-20，已上线）

改动：

1. `DzmmPreferences` 新增可选 `sampler`（temperature/topP/topK/frequencyPenalty/presencePenalty/repeatPenalty/contextTokens/stop）；本地偏好解析会裁剪非法值并告警。
2. 聊天设置「模型与预设」新增折叠的 **采样参数（高级，可选）**：温度、Top P、Top K、频率惩罚、存在惩罚，留空=模型默认；含「恢复默认」。
3. 请求链路打通：`prepareDzmmRequest` → `prepareDzmmRememberedRequest` → `/api/chat`，偏好里的 sampler 随请求发送；服务端校验 + 按模型能力裁剪（P0.2 已实现）。
4. **后端偏好白名单修复**：`PREFERENCE_EXTRA_FIELDS` 之前漏了 `promptStyle`（这就是线上 D1 里 0 个 tavern 用户的原因——选了酒馆刷新就丢）与 `sampler`，现已加入并加入 `RETAINED_PREFERENCE_FIELDS`。

验证：

- 单测：采样偏好持久化/非法值拒绝；`prepareDzmmRequest` 透传 sampler；tavern 全套 + 聊天回归 **62 通过**。
- 部署：后端 `dzmm-backend` version `e6b57c8c-2a00-42c4-803e-07017806a8f6`；前端 `dzmm-web` version `f0efeaca-6330-4278-b4eb-3d1ba75a1a12`。
- 生产验证：线上 bundle 含「采样参数（高级）」；`PATCH /v1/preferences` 写入 `promptStyle=tavern` 与 `sampler` 后，`GET /v1/state` 能读回（说明白名单修复生效）。

剩余阶段：P3 群聊多角色、P4 分支 swipe、P5 生图 preset、P6 记忆配置化、P7 灰度/AGPL/验收。

## P3 群聊多角色（2026-11-20，已上线）

### 数据模型

- D1 迁移 `0088_tavern_group_chat.sql`：`conversations.members_json`、`messages.speaker`（均可空，旧数据不受影响）。
  - 注意：线上 `d1_migrations` 记录与仓库历史不一致（首次 apply 报 `site_settings already exists`），因此两列用 `wrangler d1 execute` 手工应用到生产；迁移文件保留给全新环境。
- 共享存储层（客户端 + 后端复用 `hydrateDzmmState`）：`DzmmSavedConversation.members`、`DzmmSavedMessage.speaker`，新增 `parseDzmmConversationMembers` 校验（2–4 人、成员角色必须存在、members[0] 必须等于主角色）。
- 后端 `data.ts`：会话/消息读取与增量写入（`TABLE_COLUMNS`）都包含新列；`normalizeState` 走同一校验。

### 引擎（`src/lib/tavern/group.ts`）

- 说话人选择：显式指定 > 最新用户消息 @名字（长名优先）> 轮转（避开上一位发言者）。
- 群聊提示词：成员名册 + 群聊规则（只写本轮发言人、不替他人决定）+ 当前发言人角色卡 + 合并所有成员世界书（含 @depth）+ 历史消息按发言人标注 `【名字】`。
- 每个成员名称/ID 唯一校验；2–4 人限制。

### 请求链路

- `/api/chat` 新增可选 `group`（members 卡片 + speaker）；服务端组装群聊计划，返回 `X-Xumeng-Speaker` / `X-Xumeng-Speaker-Id` 响应头。
- 客户端：`prepareDzmmRequest`/remembered 请求透传 group；流式与最终消息都会带上服务端选中的 `speaker`。
- 计费保持每轮一次 reserve/finalize。

### 最小 UI

- 角色详情新增「一起聊」入口 → 成员多选弹层（最多 4 人）→ 创建群聊会话。
- 聊天头部显示「群聊 · 成员名」；群聊内每条助手消息显示本轮发言人标签。

### 验证

- 单测：群聊引擎 5 例 + 请求/处理器集成（含 speaker 响应头、名册、历史标注）+ 存储往返；全量 tavern/chat/storage/worldbook **106 通过，1 个历史失败**（与改动无关）。
- 部署：后端 `dzmm-backend` `3015c28e-3680-4ae3-bbb5-114d3980a601`；前端 `dzmm-web` `496e33e1-c9d2-4b5a-bb98-46da73035c26`。
- 生产验证：
  - 群聊会话写入 D1 后 `GET /v1/state` 能读回 `members` 与每条消息的 `speaker`（成员/发言人不丢）；
  - 非法群聊（1 人）→ 400「群聊成员必须是 2 至 4 人。」；
  - 合法群聊（游客 0 Credit）→ 402 计费拦截，说明群聊计划已成功组装；
  - 首页 200，线上 bundle 含群聊入口。

剩余阶段：P4 分支 swipe、P5 生图 preset、P6 记忆配置化、P7 灰度/AGPL/验收。

## P4 分支 swipe（2026-11-20，已上线）

### 模型

- 一条助手消息可保存多个版本：`DzmmSavedMessage.swipes`（2–8 条，每条 ≤12000 字）+ `swipeIndex`，要求 `content === swipes[swipeIndex]`（hydrate 校验，不一致则丢弃版本信息，保留正文）。
- D1：`messages.swipes_json`、`messages.swipe_index`（迁移 `0089_message_swipes.sql`；线上同样因 `d1_migrations` 历史漂移，用 `d1 execute` 手工加列）。
- 后端 `TABLE_COLUMNS`、消息读取/写入均包含新列；旧行/旧客户端不受影响。

### 行为

- **最新一条回复**重新生成：不再新建会话，而是在原消息上追加一个版本并激活（保留原版本，可来回切换）。
- **中间消息**重新生成：仍沿用"复制会话分支"流程，避免覆盖后续历史。
- UI：消息下方出现 `‹ 1/2 ›` 版本切换；切换只改可见正文与官方上下文，不改其他消息。
- 切换/追加版本时按前缀一致性自动失效剧情记忆与世界状态（复用既有校验函数），避免记忆错位。

### 验证

- 单测：版本追加/切换/上限/相同内容拒绝/非法操作；存储 hydrate 版本一致性；`p4-swipe` 5 例 + 存储 31 例（1 个历史失败，与本次无关）。
- 部署：后端 `dzmm-backend` `090659ee-77ad-460f-abbf-3f749ff94194`；前端 `dzmm-web` `d9c0e14e-1304-415e-b01a-9c8ddd0081cf`。
- 生产验证：写入含 `swipes`/`swipeIndex` 的会话后 `GET /v1/state` 原样读回；线上 bundle 含「上一个版本」控件；首页 200。

剩余阶段：P5 生图 preset、P6 记忆配置化、P7 灰度/AGPL/验收。

## P5 生图 preset（2026-11-20，已上线）

- 新增 `src/lib/tavern/image.ts`：5 个内置预设（叙梦写实/电影剧照/二次元/水彩/暗调胶片），组合「前缀 + 原 prompt + 后缀 + 负面词」，1400 字上限且不截断代理对。
- 服务端：`/v1/chat-media/generate` 与 `/illustrate` 接受可选 `imagePreset`（未知 id 静默回退默认，不改变旧行为），在 `chat-media.ts` 生成 provider prompt 前应用。
- 客户端：聊天设置新增「生图风格」，偏好 `imagePreset` 同步后端；`dzmm-chat-media` 读取本地偏好并随请求发送。
- 验证：单测 5 例 + 偏好持久化；生产 PATCH/GET 可读回 `imagePreset=cinematic`；bundle 含「生图风格」。部署：后端 `85b57dd0`，前端 `64b2d24e`。

## P6 记忆配置化（2026-11-20，已上线）

- 新增 `src/lib/tavern/memory.ts`：摘要档位 `balanced/compact/detailed`（影响摘要长度与保留项）+ 注入配置 `{depth, role}`（0=最新消息之后，N=倒数第 N 条前）。
- 请求链路：`memoryConfig` 随 `/api/chat` 发送；`tavern` 构建器按 depth 把记忆注入历史内部（未配置时保持旧布局）。
- 摘要器：`/api/memory` 接受 `profile`，在系统提示词追加档位要求；客户端自动摘要把偏好档位带上。
- 聊天设置「剧情记忆」新增「记忆详细程度」与「记忆注入位置」；偏好 `memoryProfile/memoryDepth` 同步后端。
- 验证：`memory/*.test`、注入位置集成测试、偏好校验测试；生产 PATCH/GET 可读回 `memoryProfile=compact&memoryDepth=2`；bundle 含「记忆详细程度」。部署：后端 `86de629b`，前端 `c90331c6`。

## P7 灰度开关 / AGPL 披露 / 生产验收（2026-11-20，已上线）

### 功能开关

`src/lib/tavern/flags.ts` 提供 5 个独立开关（默认全开，Worker 变量设为字符串 `false` 即关闭，无需发版）：

| 变量 | 关闭后的行为 |
| --- | --- |
| `TAVERN_ENGINE` | `promptStyle="tavern"` 回退到 `xumeng` 拼装，群聊/memoryConfig 一并忽略 |
| `TAVERN_GROUP` | 群聊请求返回 403 `TAVERN_GROUP_DISABLED` |
| `TAVERN_SAMPLER` | 忽略请求里的 sampler（回到固定默认温度） |
| `TAVERN_IMAGE_PRESETS` | 忽略 `imagePreset`，出图 prompt 保持原样 |
| `TAVERN_MEMORY` | 忽略 memoryConfig（记忆回到旧布局） |

### AGPL 与源码披露

- 新增根目录 `NOTICE`：声明 `src/lib/tavern/`（含集成点）以 AGPL-3.0 发布、给出源码地址与上游 SillyTavern 归属，说明未复制上游代码。
- 线上披露页：`GET /legal/tavern-engine`（Worker 直接返回纯文本，含许可、源码链接、引擎入口、上游致谢与边界说明）。
- 入口：游玩页页脚「引擎开源声明」。

### 生产验收（证据）

| 项 | 结果 |
| --- | --- |
| 测试（tavern + chat + handler + storage + worldbook） | 139 例：134 通过，5 个失败均为改动前既有（已用 git stash 对比确认） |
| 类型检查 | `check:client` 通过；worker tsc 37 个历史错误数量未变 |
| D1 列 | `conversations.members_json`、`messages.speaker/swipes_json/swipe_index` 均存在 |
| `/legal/tavern-engine` | HTTP 200，含 AGPL/源码链接 |
| 页脚入口 | 游玩页存在「引擎开源声明」链接 |
| 群聊 | 非法成员 400；成员与发言人写 D1 后可读回 |
| 分支 swipe | `swipes/swipeIndex` 写 D1 后可读回 |
| 采样/生图/记忆偏好 | PATCH 后 GET `/v1/state` 可读回 `sampler`、`imagePreset`、`memoryProfile/memoryDepth`、`promptStyle` |
| 回滚 | 关闭对应 `TAVERN_*` 变量即可；D1 新增列可空，旧代码不受影响 |

### 各阶段部署版本

| 阶段 | 后端 dzmm-backend | 前端 dzmm-web |
| --- | --- | --- |
| P1' | e6b57c8c / 3015c28e（群聊列修复） | e68eaa8b |
| P2 | e6b57c8c | f0efeaca |
| P3 | 3015c28e | 496e33e1 |
| P4 | 090659ee | d9c0e14e |
| P5 | 85b57dd0 | 64b2d24e |
| P6 | 86de629b | c90331c6 |
| P7（最终） | f6a22879-76d2-4b76-b2e2-4a5d05ebb650 | df84286c-3541-483f-ab92-e054f1fcf5ae |

### 遗留与后续

- 线上 `d1_migrations` 记录与仓库历史漂移，新增列通过 `d1 execute` 手工应用；迁移文件已入库供全新环境使用，后续应单独梳理一次迁移基线。
- 中间消息的「重新生成」仍走复制会话分支；最新消息才使用 swipe（可后续统一为消息树）。
- 群聊暂不支持"手动指定发言人"的前端选择器（服务端已支持 `speaker` 字段与 `@名字` 自动识别）。
- 采样参数、生图 preset、记忆档位当前只有聊天设置入口，没有独立预设库/跨会话复用。
