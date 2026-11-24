# 2026-10-12 · 主动角色核心核验

本次以 FlexiChrono 公开产品与客户端协议为参考，增加角色自己的持久生活事项、到期机会和消费账本。当前实现依靠页面可见时的计时器；服务器持久调度、用户委托提醒、事务 outbox、离线待收取和 Web Push 尚未实现。公开证据与设计推导分别见 [FlexiChrono 调研](flexichrono-2026-10-12.md) 和 [架构图](proactive-architecture.html)。

## 功能与界面

- npm test：167/167，通过。包括纯运行时、HTTP 存储重启、并发输入使晚到结果失效、出处归属、重复/安静消费、预算窗口、关闭和重开等。
- npm run test:ui：36/36，通过。旧前端预算门控调整为具体事项可继续、普通续聊仍受三次预算约束；新增前台生活唤醒仅请求 presence、无剩余事项不循环、草稿/隐藏/安静门控。
- public/app.js 和 server.mjs 语法检查通过。
- 3227 主服务已使用最终 engine/runtime 重启；health 返回 x-ai/grok-4.6、reasoning low。角色生成仍用原 provider。
- 主动架构、调研文本与原 NariYume 架构路由 HTTP 200。独立架构 HTML 的 CSP 只允许其内联 script/style 内容哈希，不允许网络连接。
- 隔离 3232 演示会话核验生活卡片、主动开关和输入草稿；其中消息为模拟夹具，不能证明真实模型口吻。演示服务器已清理，用户存档没有作为输入、被刷新或被删除。
- 浏览器直接打开四个 scenario URL 及 goodbye 子入口，核验进展/安静/输入/离开/告别账本。自动化点击情境控件没有可见响应，不能声称点击或 SVG 节点交互已通过；页面使用真实 href 原生入口，无点击拦截。预览为真实浏览器截图 [proactive-architecture-preview.jpg](proactive-architecture-preview.jpg)。

## 真实模型与最后重放

本次真实模型请求共 8 次，均使用自写合成会话，不读取用户历史：

| 记录（evaluations/results） | 调用数 | 结果与修复 |
|---|---:|---|
| agency-2026-10-11T18-28-18-102Z.json | 1 | 最初输出没有 life；主 JSON 输出契约补入 life，真实动作与后续事项关联 |
| agency-2026-10-11T18-32-17-904Z.json | 6 | 两角色完成 normal/具体主动/一句告别；当时 Nari 新进展因省略主语没有入账，后修复 |
| agency-2026-10-11T18-40-28-174Z.json | 1 | Nari state 切掉原句已有“我”，当时归属检查漏收；后修复相邻来源归属 |

不把旧 complete 字段当作全部最终检查成功，也不把历史失败删除或算成最终质量。两处中文归属失败都有原句回归和第三人/用户/引用反例。新代码把中文动作省略和逐字状态片段的实际句子归属一起考虑；词法归属和重复判断仍是近似，不保证完整语义。

最终记录 [agency-replay-2026-10-11T18-49-50-894Z.json](../evaluations/results/agency-replay-2026-10-11T18-49-50-894Z.json) 将上述 6 条加 1 条失败原始模型文本重新 parse，并经过最终 engine 提交：7 条真实历史输出、51 项断言通过，新增模型调用和网络请求都为 0。检查生活进展、原来源消息、事项版本消费、不虚构用户、不写用户记忆或加关系，以及单气泡告别/暂停/无 pending。时间注入与 budget=3 是明确夹具，不能证明真实时间等待、离线运行或推送送达。

实际口吻仍偏薄：两个角色都选择了音乐相关小事，并都用了“我挺喜欢”类评论。当前未做足够长的盲评或开放聊天评测，不能声称完全解决可爱与多样性。没有 Codex 自动优化、定时任务或后台付费循环。

## 最终代码哈希

```json
{
  "engine.mjs": "11f602b5f6f6aab4c79759b23fc7dbcc3459a76c6cc3701ec22529623a7aa115",
  "proactive-runtime.mjs": "3ee18ca13a8a398223e73ac3af328c5e72e2edb8d9a6822925cfb144615e43f3",
  "provider.mjs": "d1b85a32293a08d2ffb5184a2e9e2e12bf04b02ebd8c8adaf2ee678f6f751281",
  "public/app.js": "35d2884b9a73569872b8be7b86c5eed58a37e592ece7226e880090fb60f8d3a9",
  "public/index.html": "b5da22a16d8b5c844329dfda862d4d7cb2611c3ead554f4d7d0f3627f3bd2ea7",
  "public/style.css": "0eb98019c3eb6061efaf07574973cc0c3237d4190dde2919c7e273edb2a5d13c",
  "server.mjs": "e14eb723e26dda4a76de2fdfb90b09645b3ea1b6a948457b75ab8f629f259098",
  "research/proactive-architecture.html": "6fd18cdaf93352763184d54957d7e3af9ef9fb1aac76c84ab591adace06ce5e1"
}
```
