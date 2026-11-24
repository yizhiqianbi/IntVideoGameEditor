# FlexiChrono / 聆屿：主动式角色架构的公开证据

取证日期：2026-10-12。范围为官方网站、其 HTML/JS 明确声明的资源、公开隐私政策和站内 FAQ。未登录、未注册、未调用聊天或状态 API、未下载 App/媒体、未执行下载的 JS。下面的代码结论只证明客户端具有相应协议和分支，不能证明每项能力已对所有账号启用，或服务端实现了某种具体算法。

## 最值得参考的结论

聆屿公开客户端把主动行为拆成了几个独立系统：主动对话偏好、提醒与预约电话、模拟人生、长期记忆、带期限的生活选择，以及前台与后台消息投递。用户要的“主动式 AI”可以沿这个方向扩展：角色有自己的持续事项，事项能在时间推进后产生结果，角色再根据结果和双方记忆决定是否联系用户。后半句是我们的设计推导，不是对其服务端的已证实描述。

## 来源和证据等级

| ID | 结论 | 证据类型 | 来源 |
|---|---|---|---|
| F01 | 产品声称角色会主动联系用户、保留长期记忆并随关系成长 | 官方产品描述 | [首页](https://flexichrono.com/) |
| F02 | FAQ 将长期记忆称为 FlexiMem 多层长期记忆系统，未在本次检索中提供算法或论文链接 | 官方产品描述 | [FAQ](https://flexichrono.com/faq)、[公开 Portal 模块](https://flexichrono.com/assets/index-DfwnIBp6.js) |
| F03 | FAQ 声称主动消息频率可调整或关闭；本次设置代码明确验证的是开关，尚未定位到频率配置控件 | 官方描述 + 限定静态证据 | [FAQ](https://flexichrono.com/faq)、[AI 设置](https://flexichrono.com/assets/AISettingsPage-BAR8Tu6T.js) |
| F04 | 产品列出独立能量状态、情绪模式、主动消息及部分角色主动电话 | 官方产品描述 | [产品能力](https://flexichrono.com/product) |
| F05 | 主动聊天、模拟人生、朋友圈访问控制是可区分的偏好字段 | 静态客户端代码 | [偏好服务](https://flexichrono.com/assets/user-bot-prefs.service-CKQOyBNi.js) |
| F06 | 主动电话使用独立配置，含存储开关、生效开关、资格和勿扰时段 | 静态客户端代码 | [主动服务](https://flexichrono.com/assets/proactive.service-D1ndgkbF.js)、[AI 设置](https://flexichrono.com/assets/AISettingsPage-BAR8Tu6T.js) |
| F07 | 关闭自主主动对话不取消用户已设置的提醒或预约电话 | 静态产品文案与提交分支 | [聊天模块](https://flexichrono.com/assets/ChatDetailPage-Cfq5uZTi.js) |
| F08 | 记忆界面区分故事与用户资料，并携带主动携带策略与时间状态 | 静态客户端代码 | [记忆模块](https://flexichrono.com/assets/index-X7zFXiBz.js) |
| F09 | 模拟人生拥有生活选择消息和结果核验协议，区分当前实例、过期和补算中等状态 | 静态客户端代码 | [聊天模块](https://flexichrono.com/assets/ChatDetailPage-Cfq5uZTi.js) |
| F10 | 前台聊天流和全局通知流采用 SSE，另有网页后台 Web Push | 静态客户端代码 | [主模块](https://flexichrono.com/assets/index-6qoylOuL.js)、[Web Push 模块](https://flexichrono.com/assets/webpush-BmELasJD.js)、[Service Worker](https://flexichrono.com/sw.js) |
| F11 | 政策列出消息通知、来电提醒和 JPush，以及预留的多厂商推送通道 | 官方政策，不是送达实测 | [隐私政策 §2 / §5](https://flexichrono.com/privacy) |
| F12 | 政策列出火山引擎豆包与腾讯 TokenHub，但不能据此确定具体角色当前型号 | 官方政策，不是当前调用证据 | [隐私政策 §5](https://flexichrono.com/privacy) |

## 1. 自主联系和用户委托分开

偏好服务接收 `proactive_opt_in`，映射为界面上的 `proactiveOptIn`。AI 设置读取该偏好并提供开关。聊天模块可以根据服务端消息中的 `proactive_opt_out_offer` 向用户提出关闭主动对话；它带 `message_id` 和规则版本以避免重复呈现。

另一方面，独立主动服务声明以下协议（只读取代码，未访问这些 API）：

```text
GET    /proactive/reminders
DELETE /proactive/reminders/{jobId}
GET    /proactive/call/preferences?bot_id=…&session_id=…
PUT    /proactive/call/preferences
       { bot_id, session_id, enabled?, quiet_ranges? }
```

记忆页面的日程表只展示 `user_reminder` 和 `scheduled_call` 两种事项；按 `fire_at` 排序，保留待触发事项和近期已送达事项。取消按钮使用 `job_id`。聊天页面明确区分“角色自主找人”与“用户要求的提醒或电话”。这很适合我们的设计：用户关掉随机主动聊天后，仍应保留已明确委托的承诺。

不能从这些客户端调用确定服务端采用 cron、持久工作流、延迟队列还是轮询，也不能确定自主聊天如何选择触发时间。

## 2. 角色生活有明确事件和后果

`lifeSimulationEnabled` 是独立的模拟人生 Beta 开关，由角色能力 `life_simulation` 决定是否展示。当前公开界面还要求模拟人生与自定义风格互斥。偏好里另有 `momentsBlocked`，用于控制角色是否可看用户朋友圈；它不能独自证明具体信息检索策略。

聊天模块接受 `contentJson.kind = life_decision` 的角色消息；事件引用至少包括 `instance_id` 和 `decision_id`。客户端查询对应生活事件，提交 `option_id`，或选择系统默认选项，让角色自行决定：

```text
GET  /chat/session/{sessionId}/life-decisions/{decisionId}
     ?instance_id=…
POST /chat/session/{sessionId}/life-decisions/{decisionId}/choice
     { instance_id, option_id }
```

UI 明确区分 `ready`、`catching_up` 和 `inactive_instance`。选择面板还有独立的截止时间检查、是否还能选择、结果读取；旧实例的选择不可再执行。只有当前助手消息可见、会话状态合适且页面在前台时，才自动打开选择面板。提交失败后会查询权威结果，避免把“尚未确认”展示成确定已发生。

这比在 prompt 里写“你有自己的生活”更具体：生活事项有 ID、实例归属、选择期限和结果。我们的角色可拥有考试、烘焙、见朋友等待处理事项，到了事件节点产生结果，再让结果影响情绪与分享内容。这是独立设计建议；客户端没有公开角色日程怎样生成、多久推进、是否后台持续生成生活事件。

## 3. 记忆包含携带策略、时间与承诺

记忆界面分成两种卡片：`fact`（故事）和 `profile`（关于用户）。故事分类覆盖承诺/日程、偏好/爱好、经历/事件、心愿/目标；资料分类覆盖身份、回应偏好、边界、近期状态、目标与计划。字段包括 `profile_category`、`carry_policy`、`temporal_state`、归档状态和 pinned。

界面将 `carry_policy = default` 显示为可主动想起，将 `on_query` 显示为聊到才想起，`never` 不显示对应携带标签。这能确认数据模型和文案，尚不能确认检索评分或注入 prompt 的精确行为，也不能把这个界面称为 FlexiMem 的全部实现。

给我们最直接的启发是把“知道一件事”和“何时可以提这件事”分开。明日面试是有期限的待跟进事项；长期偏好可偶尔自然使用；敏感边界可以用于回避，而不必反复提起。用户能查看、归档和删除记忆，比无限自动记忆更可控。

## 4. 主动电话有关系和时间资格

AI 设置读取 `stored_enabled`、`effective_enabled`、`eligible` 和 `reason`。当 `reason = relationship_too_low` 时，界面提示要达到较高的好朋友阶段才能打开主动电话。客户端没有给出精确关系分数门槛，不能从文案推算数值。

主动电话的勿扰编辑器最多接受 4 段、范围 10:00–22:00 的非重叠时间区间，保存为 `quiet_ranges`。这只能确认该控件限制，不能额外推断所有主动聊天均使用这个时间窗口，或该配置包含用户全部通知偏好。

## 5. 消息投递覆盖前台与后台

公开主模块实现聊天 SSE `/chat/stream`，事件包括 `segment`、`assistant_activity`、`turn_emotion`、`emote`、`end`，还有气泡删除、消息撤回等事件。另有全局 `/notifications/stream`，接收通知和刷新事件。客户端使用序号/游标、重连和前后台生命周期处理，使不同界面可以恢复状态。

`assistant_activity` 具有 owner（reply/photo）、操作 ID、来源 ID、序号、开始和过期时间。展示状态包含输入、说话、拍照、搜索、回忆。它是有期限的交互状态，不是人物生活计划本身，也不能证明这些动作一定由真实工具执行。

Web Push 模块注册 `/sw.js`，取得 VAPID 公钥、请求用户授权并注册订阅。Service Worker 收到 push 后，若已有可见的 `/app` 页面便抑制系统通知；否则展示通知。点击可导航到目标会话。后台可接收通知的客户端能力已明确，真正触发和调度通知的服务端规则仍未公开。

主模块的 heartbeat/65 秒连接存活守卫是运输层断线检测。不要把它当成角色在后台每隔一段时间思考的机制。

## 6. 模型与 prompt 的确认边界

隐私政策提及豆包、腾讯 TokenHub 等供应方，不能确认具体型号。偏好服务允许 `original`、`hakimi_3_7f`、`hakimi_3_8f`；设置界面对应原始模型和两种哈基米别名。别名无法可靠映射到公开模型，没有实际响应和服务端配置就不应猜定。

在本次有限检索中没有找到官方技术论文、FlexiMem 公开源码或主聊天 prompt。不能将公开商品文案、接口字段、模型别名当成训练配方或内部规划器证据。

## 对我们原型的设计推导（不是原站架构复原）

建议增加一条角色自主行为管线：

```text
持久时间 / 用户事件 / 角色生活结果
    → 待跟进事项与分享候选
    → 相关性、时效、关系、近期重复、打扰成本判断
    → 选择不发 / 稍后发 / 一组消息
    → 生成器写出带具体缘由的消息
    → 会话 outbox
    → 前台流 / 离线待收取 / 获授权的系统推送
    → 用户反馈影响下次决策
```

角色生活推进和是否打扰用户应是两个决策。她可以发生新事但暂时不发消息；主动也可以是履行昨天的承诺、记起一件小事或分享自己刚完成的事情。每次都用“在忙吗/想你了”会把主动性变成新的模板。

调度与资格判断应尽量使用规则和持久状态；需要表达或复杂取舍时再调用语言模型。为当前 chat-only 原型，可以先实现本地事件存储、到期事项、角色生活事件、主动候选仲裁和可打断的消息组。真正关闭浏览器后还要继续联系，则需服务器持久调度与投递通道；仅有浏览器 timer 不能满足这一目标。

## 静态快照索引

以下为本次读取的全部 10 份 JS，总计 765,109 字节；均通过 HTML/现有 JS 中声明的路径取得，不含 API 结果。下载内容只作为静态文本检查，未执行。下表有助于在网站更新后复核本次取证版本。

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| index-6qoylOuL.js | 265072 | 066d3c99fd1b42162399bae98d7826d980978b47a92ccd742ecae531a8afa21b |
| index-DfwnIBp6.js | 116066 | bd5000d0b4a2888f29a255286aa683c1881ca2a1dfa042bbf1bf91d94b0e2bc7 |
| AISettingsPage-BAR8Tu6T.js | 47023 | 4517249ac34c272ecc70a8b8fa1f39621c1d6d6a6d5cda314e4242055ac541b7 |
| index-C4Bkeo6A.js | 30090 | 5f8b6a776d6d248a15aed51e9cf1039e79f15da233c1d5a2dc466185c86888ca |
| proactive.service-D1ndgkbF.js | 549 | 98a8b95c24992ddfa5a44f8ec4242f7f857157437b40a1032e811b43c4ad0002 |
| user-bot-prefs.service-CKQOyBNi.js | 5766 | 35d323e086f8962e76bc088ff7d95e7ba8a76d4f3f0d6f407d9c9a34e08aa6f8 |
| index-X7zFXiBz.js | 34672 | 2512d9c12fc35ca961454f94f06895540f2de9f5d76b4bc031d2e19e4295848c |
| ChatDetailPage-Cfq5uZTi.js | 263335 | 3cbd6da350bc4cf9adbf0b0f5cf74e6b036343592c076f41dc029e29d8bb0bcb |
| webpush-BmELasJD.js | 1555 | 5a524a1c5f1387bca7d5096e03d5d00b5127382bec11723a5dfcc9b268976a32 |
| sw.js | 981 | b8c58ccd7aa88a2a3cdccbe0255efede75cc8de59abf3914cf2c12e8ff6177e2 |
