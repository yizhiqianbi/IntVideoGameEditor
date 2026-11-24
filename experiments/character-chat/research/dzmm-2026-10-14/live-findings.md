# 当前模型目录与普通角色请求链：在线补查

> 最新官方诊断核验（2026-10-14）：现已通过自有未上架测试卡取得 2649 字符的平台 system、完整四条组装输入及 5 份生成参数/token 记录。分词复验明显支持 DeepSeek 系计数特征，但实际型号与 provider 仍隐藏。下文为此前阶段记录；最新结论见 [官方诊断实测报告](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/verified-runtime-2026-10-14/results.md)。

> 后续实测更新（2026-10-14）：浏览器控制已恢复，已取得真实生成和提取候选；下文的“未生成/超时”是此前阶段记录。诊断权限中的 owner 已纠正为角色卡作者/所有者。详见 [本轮实验记录](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-extraction-2026-10-14/results.md) 与 [权限核验](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-extraction-2026-10-14/diagnostics-access-gate.md)。

核验日期：2026-10-14，Asia/Shanghai。

本次取得了一个实际在线结果：**不带登录信息的 `chat.models` 查询返回 HTTP 200，目录有 44 个模型项、5 个系列，defaultModel 为 `x-apex-surge-0505`。**这属于公共目录默认值，尚未确认用户当前测试会话选择了哪个模型，也没有观察到一次实际生成。

## 1. 现行模型目录

查询根据公开客户端已声明的 `chat.models({service:'chat'})` 与 `/api/trpc` transport 构造，只发出一次 GET；没有携带 Cookie、Authorization、浏览器存储或用户凭据，没有调用生成接口。

来源：[官方模型目录查询](https://www.dzmm.ai/api/trpc/chat.models?input=%7B%22json%22%3A%7B%22service%22%3A%22chat%22%7D%7D)。采集响应为 21905 bytes，SHA-256 `1338c365f408a1a1614672cd6264f1d310620c60823e60ba665359f72a4677e1`；[采集记录](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public/anonymous-model-catalog-manifest.json)、[原始响应](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public/anonymous-model-catalog-response.json)、[整理版](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public/model-catalog-summary.json)。

| 系列 | 目录模型项数（含上下文变体） | 目录中的系列版本 |
|---|---:|---|
| XL | 3 | XL-0826 |
| Apex | 29 | Surge、Dash、Pulse、Sigma、Flux、Prism 的多个版本 |
| Max | 3 | Max-0826 |
| Turbo | 6 | Turbo-0101、Turbo-0826 |
| Medium | 3 | Medium-0826 |

目录将部分 Apex 子系列分别定位为情绪互动、快速回复、长线剧情等用途，并暴露上下文、思考支持、强制思考和会员层级字段。这是平台产品说明和可选配置，不是我们实测的质量排序。没有把 price 字段解释成未经核验的收费单位。

目录内部名有 `x-apex-*` 和 `nalang-*` 前缀，没有提供足以确认供应商、基础权重或训练方法的映射。因此无法认定这些模型是 Grok、Gemini、Claude 或某个自训模型。`defaultModel` 也不能代替具体会话设置或一次生成记录里的 `model/provider`。

## 2. prompt 主要在哪里组装

公开共享组件的普通生成 builder 发送以下不同用途的字段：

```text
角色卡 ID
+ 会话设置（模型、风格、回复额度、思考、记忆开关）
+ 预设 ID 与合并的用户身份文本
+ 近期真实消息 prompts
+ 当前操作及输入/附件
+ 可选状态
→ POST /api/chat
→ 后台取卡、处理预设/记忆并组装（具体规则仍未知）
→ 回复流
→ 有权限时查看该次生成的组装与世界书诊断
```

这里的箭头是客户端请求/观测关系，不表示恢复了后台的所有步骤。特别是 builder 本身没有把人物人格、场景和世界书全文直接展开成一个 system 消息。**前端有引用与控制字段，最后给模型的 messages 仍在服务端边界之后。**来源：[官方共享组件](https://www.dzmm.ai/assets/1OYk4JId.js)。

客户端通常取最近 500 条非内部消息；分块功能开启时可保留 500–599 条旧消息，再追加本轮用户输入。这个消息条数窗口不是模型 token 容量、长期记忆算法或实际可保留的全部历史。预设可使用会话覆盖，全局和会话身份文本采用拼接。详细字段与源码位置见 [请求契约核验](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/request-contract-notes.md)。

## 3. 游客实测进展与限制

游客主页与消息列表曾成功读取，用户已手动进入一般向成年日常角色的测试会话。此后自动截图、页面读取及同一浏览器中新开轻量聊天入口均超时。**目前未发出任何中性测试消息，未取得真实生成、模型选择或 prompt 诊断，不能将这些操作尝试统计为试聊成功。**原用户页面没有被关闭，没有读取其凭据或其他用户的会话。

代码确认的正常诊断入口是刚生成、未编辑 AI 回复上的“世界书诊断”和“查看组装上下文”。角色卡作者/所有者可能有世界书入口，完整组装诊断还需后台可见性检查；自己的游客会话仍需核验实际权限。入口和范围见 [菜单定位](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/guest-ui-notes.md)。

公开角色页面只能用于核对公开资料，不能把介绍文本或通用编辑器字段文案当成后台完整人物 prompt。该项单独核验见 [公开角色字段审计](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public-role-field-audit.md)。

## 4. 对我们原型的具体意义

值得学习的是可解释的配置引用、身份/预设控制、真实历史边界和逐次诊断。我们的角色声音示例、关系状态和明确用户记忆应各自带来源；表面输出继续只展示角色实际说的话。要判断“软、可爱、主动、多样”是否改善，需要真正完成同输入对照及人评，目录中的系列描述与静态代码不能代替这个检验。

总调研及 REA 安装见 [report.md](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/report.md)。
