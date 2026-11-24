# 念白：Prompt 与上下文来源审计

本报告只使用已下载的公开前端代码及其显式声明的一个公开 import。它描述代码中存在的实现分支，不等同于每个分支在当前账号均已开启。浏览器实测结果由主报告另行记录。

**目前没有取得念白的实际 system prompt。已确定的是它使用独立 Agent 请求链路，前端只发送本轮消息与会话、人格选择；上下文不在该组件中拼成完整 prompt。普通角色聊天曾取得的 2649 字符 system 不应归到念白。**

## 请求与上下文的实际边界

念白组件 `C58mxSVt2.js` 自定义 AI SDK transport，目标为 `POST /api/agent/pod/chat`。请求 builder 的核心等价于：

```js
{
  ...body,
  id: chatId,
  messages: uiMessages.slice(-1),
  conversationId,
  mode,          // 默认 companion
  persona,       // 默认 gentle
  personaMode    // 默认 manual
}
```

发送函数另外可加 `imageUrls`；创建会话的 `agent.create` 也提交 `mode/persona/personaMode`。这些是实际代码字段，不是猜测出来的 prompt 字段。[证据 `transport`、`default-options`、`send`、`create`]

历史由 `agent.messages({conversationId, limit:200, includeStalled:true})` 加载，按 `seq` 排序，接受 `user/assistant/system` 三种角色，再复原文字、工具结果和记忆保存状态用于显示。**200 是前端加载条数，不能据此宣称模型上下文只保留 200 条。** 历史可有 system 角色也不证明这里包含完整实际系统词。[`history`、`history-tools`]

由“发送时仅传最后一条消息＋会话 ID”和“历史另行读取”可以强推断，历史恢复和实际模型上下文在服务器侧管理。但是服务器究竟使用多少历史、是否压缩、如何检索记忆、system 的先后顺序、token 预算和具体模型，都不在这份前端证据中。

## 人格：确认开关与名称，尚未取得人格文本

两个人格枚举为 `gentle` 和 `direct`；中文 UI 标签分别为“温柔”和“直接”。显式导入的 `BjxJ3Cc_2.js` 定义两个名称：温柔人格是“念白”，直接人格是“白念”。切换调用 `agent.persona.set({conversationId, persona})`，回复过程中 UI 会禁用手动切换。[`persona-toggle`、`persona-names-prewarm`、`locale-persona`]

组件还识别工具结果 `switch_persona`：当结果 `switched` 为真，且 `persona` 为 gentle/direct 时同步显示状态。这证明前端支持“工具修改人格状态”的结果，不证明其触发条件，也不能反推出“什么话一定切换人格”的规则。[`persona-tool-result`]

`personaMode` 默认 manual，但仅看到一个默认值，不能凭此虚构其它模式、人格路由阈值或第二个模型。

## 长期记忆：两种存储展示形态与明确的状态恢复

前端并存两类记忆展示：

- 普通条目列表：显示内容、时间和 pinned；UI 文案传入 `max:30`，这不是经服务器验证的全系统容量上限。
- 文件形态：首条 `id === "memory-file"` 时显示主文件内容，后续读取服务端返回的 `workspacePath`；通过 `agent.memoryFile({path})` 懒加载内容。解析器明确认识 `MEMORY.md`、`memory/`、`diary/`，以及部分 Markdown、JSON 条目和 `id/importance/pinned/createdAt/updatedAt/mood` 元数据。

`agent.memories` 和 `agent.diaryEntries` 查询本身不传 conversationId；“删除对话”的官方文案明确说记忆不会被删除。两者共同支持“记忆寿命独立于单条会话”的设计判断，尚不能确认它在服务器上具体按账号、Agent 或 workspace 哪个主键组织。[`memory-query`、`memory-file-branch`、`memory-lazy-read`、`memory-format`、`locale-delete-memory`]

工具显示映射包含 `memory_save/search/list/edit/write/delete`、`diary_write`、`search_conversations/read_conversation`、`workspace_status/read/write`、`shell_exec`。这些名称与运行状态支持“工具式记忆与工作区”架构，但映射表不是完整 tool schema，也不是当前账号所有工具都可调用的保证。[`memory-tools`、`workspace-tools`]

回复中有 `memorySaveStatus`，界面区分 failed、unknown、conflict；恢复界面又区分 blocked、pending、conflict。pending 的文案明确表示上一轮记忆尚未补存、本轮可能读不到。由此能确定记忆保存并非一句 UI 装饰，产品有独立的保存／补存状态；不能据此确认具体事务或数据库实现。[`history-tools`、`memory-recovery`]

## 哪些“活人感”来自展示协议

文字分泡按两个及以上换行切分；流式处理中将已完整的段落与未完成末段区分，过滤纯横线段。前端可按至少 800ms 的节奏放出已收到的片段。[`bubble-format`、`bubble-reveal`]

因此多气泡不要求服务端为每个泡重新调用模型。可合理推断其输出风格会偏向短段落，但 **“请用空行分泡”这句 prompt 原文尚未看到**；也可能由服务器后处理形成段落。

公开文件还显示 pod 预热：feature flag `nianbai.pod-prewarm` 开启时，初始化和输入框获焦会触发 `agent.prewarmPod`，客户端限制五分钟内不重复预热。结合 starting/capacity 等错误处理，支持有冷启动或容量等待机制。不能只靠 `pod` 名称确认 Kubernetes 或具体云服务。[`persona-names-prewarm`]

## 离线主动性有范围：任务提醒

官方 UI 文案明确承诺：开启后即使没开网页，也会在绑定会话提醒未领的奖励、快完成的任务和签到；每天最多一条；提醒本身不扣聊天积分；每个账号只绑定一个念白对话；时间按 UTC+8；符合条件时可推送 Telegram。

对应界面有 `agent.offlineTaskReminderSettings` 与 `agent.setOfflineTaskReminderSettings`。这足以确定产品设计包含离线任务通知，并不证明它存在任意情绪驱动的主动聊天、自由心跳循环或后台持续思考。[`locale-reminders`]

## 实际 prompt、产品文案、推断必须分开

| 项目 | 当前证据等级 | 可确认的内容 |
|---|---|---|
| 念白 system prompt 原文 | 未取得 | 不应以普通角色 system 替代 |
| 人格选择 | 代码确认 | gentle/direct，念白/白念 |
| 人格的精确语言指令 | 未取得 | 无逐字复原依据 |
| 请求 payload | 代码确认 | 最新 UI message＋会话 ID＋mode/persona/personaMode |
| 服务器恢复上下文 | 强推断 | 客户端不发送完整历史或 system |
| 记忆文件与工具渲染 | 代码确认 | MEMORY.md、memory/、diary/、工作区工具显示 |
| 记忆注入算法/向量检索 | 未取得 | 不能宣称已用 RAG 或 embedding |
| 离线任务提醒 | 官方 UI 合约 | 范围、频率、绑定会话和 Telegram 条件 |
| 自主情绪主动聊天 | 未证实 | 不能用离线任务提醒替代证明 |
| 念白所用模型及采样参数 | 未取得 | 请求 builder 没有 model 字段 |

如果制作兼容原型，可据此设计“人格层＋服务器历史＋记忆工具＋任务提醒＋分泡渲染”；具体 prompt 文字应标为我们重建的实现，而非官方泄露原文。

## 诊断和公开模板检索结果

在念白主组件中，`assembly`、`diagnostic`、`systemPrompt`、`system_prompt`、`SOUL`、`AGENTS`、`HEARTBEAT`、`model`、`onContextMenu` 的逐字检索均为 0。`prompt` 只有一次，为画图结果 `image.prompt` 的展示。`system` 两处分别是 AI SDK 通用 role schema 与历史角色筛选。这个检索不证明服务器没有相应文件，只说明本次公开组件没有下发其正文。

共享中文语言包包含普通角色的 Prompt Assembly 翻译，但念白组件没有调用相关入口，不能把共享翻译当作念白的诊断访问证据。已见 `memoryFile({path})` 的用途是读取 UI 列表返回的工作区文件路径，不是任意系统文件检查器。

进一步对已有 115 份公开脚本检索 `.state/actions.md`、`.state/capsules.md`、`.state/context.md`、`.state/countdowns.md`、`.state/profile.md`、`memory/imported.md`、`SOUL.md`、`HEARTBEAT.md`，未命中。`AGENTS.md` 唯一命中来自 Gamefy CLI 工作台说明，不能用于佐证念白系统文件。这个结果仅界定公开语料范围，不否定服务器文件的存在，见 [prompt-template-path-search.json](prompt-template-path-search.json)。

原始短片段、来源 SHA-256 和 UTF-8 字节偏移见 [prompt-and-context-extracts.json](prompt-and-context-extracts.json)。全部 23 段已按源文件字节重新核对。新增公开 import 的抓取记录见 [persona-import-manifest.json](persona-import-manifest.json)。
